import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { user_id, search_query, location, radius, list_id, list_name } = body;

    if (!user_id || !search_query) {
      return new Response(JSON.stringify({ success: false, error: 'user_id e search_query são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try Google Places API first, fallback to Firecrawl
    const googleApiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

    let rawLeads: Lead[] = [];

    if (googleApiKey) {
      console.log(`[extract-google-maps] Using Google Places API for: "${search_query}"`);
      rawLeads = await extractViaGooglePlaces(googleApiKey, search_query, location, radius);
    } else if (firecrawlKey) {
      console.log(`[extract-google-maps] Falling back to Firecrawl for: "${search_query}"`);
      rawLeads = await extractViaFirecrawl(firecrawlKey, search_query);
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: 'Nenhuma API de extração configurada. Configure GOOGLE_PLACES_API_KEY ou FIRECRAWL_API_KEY.',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[extract-google-maps] Extracted ${rawLeads.length} raw leads`);

    if (rawLeads.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        total_leads: 0,
        message: 'Nenhum lead com telefone encontrado. Tente refinar sua busca.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create or use existing list
    let targetListId = list_id;
    const targetListName = list_name || `Google Maps - ${search_query.substring(0, 50)}`;

    if (!targetListId) {
      const { data: newList, error: listErr } = await supabase
        .from('wa_contact_lists')
        .insert({
          user_id,
          name: targetListName,
          source: 'google_maps',
          contact_count: 0,
        })
        .select('id')
        .single();
      if (listErr) throw listErr;
      targetListId = newList.id;
    }

    // Sanitize contacts
    const sanitizeRes = await fetch(`${supabaseUrl}/functions/v1/sanitize-contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        user_id,
        list_id: targetListId,
        contacts: rawLeads.map(l => ({
          phone: l.phone,
          name: l.name,
          group_name: l.address,
          source: 'google_maps',
          metadata: l.metadata || {},
        })),
        check_whatsapp: false,
      }),
    });

    const sanitizeData = await sanitizeRes.json();

    if (!sanitizeData.success) {
      throw new Error(sanitizeData.error || 'Erro na higienização');
    }

    const stats = sanitizeData.stats || {};

    return new Response(JSON.stringify({
      success: true,
      total_leads: stats.total_valid || 0,
      inserted: sanitizeData.inserted_count || 0,
      list_id: targetListId,
      list_name: targetListName,
      search_results_count: rawLeads.length,
      stats,
      api_used: googleApiKey ? 'google_places' : 'firecrawl',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[extract-google-maps] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ====================== TYPES ======================

interface Lead {
  phone: string;
  name: string;
  address: string | null;
  metadata?: Record<string, any>;
}

// ====================== GOOGLE PLACES API ======================

async function extractViaGooglePlaces(
  apiKey: string,
  query: string,
  location?: string,
  radius?: number
): Promise<Lead[]> {
  const leads: Lead[] = [];
  const seenPhones = new Set<string>();

  // Step 1: Text Search to get place IDs
  const searchParams = new URLSearchParams({
    query,
    key: apiKey,
    language: 'pt-BR',
  });

  if (location) searchParams.set('location', location);
  if (radius) searchParams.set('radius', String(radius));

  let nextPageToken: string | null = null;
  let pages = 0;
  const MAX_PAGES = 3; // Google returns max 20 per page, 3 pages = 60 results

  do {
    if (nextPageToken) {
      searchParams.set('pagetoken', nextPageToken);
      // Google requires a short delay between page token requests
      await new Promise(r => setTimeout(r, 2000));
    }

    const searchRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?${searchParams.toString()}`
    );

    if (!searchRes.ok) {
      console.error(`Google Places search error: ${searchRes.status}`);
      break;
    }

    const searchData = await searchRes.json();
    const results = searchData.results || [];

    // Step 2: For each result, get details (phone number)
    for (const place of results) {
      try {
        const detailRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,international_phone_number,formatted_address,rating,user_ratings_total,website,types,opening_hours,business_status&key=${apiKey}&language=pt-BR`
        );

        if (!detailRes.ok) continue;

        const detailData = await detailRes.json();
        const detail = detailData.result;

        if (!detail) continue;

        const phone = detail.international_phone_number || detail.formatted_phone_number;
        if (!phone) continue;

        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 10 || seenPhones.has(cleanPhone)) continue;

        seenPhones.add(cleanPhone);

        leads.push({
          phone: cleanPhone,
          name: detail.name || place.name || 'Lead Google Maps',
          address: detail.formatted_address || place.formatted_address || null,
          metadata: {
            rating: detail.rating || null,
            reviews_count: detail.user_ratings_total || null,
            website: detail.website || null,
            category: detail.types?.[0] || null,
            business_status: detail.business_status || null,
            opening_hours: detail.opening_hours?.weekday_text || null,
            source_api: 'google_places',
          },
        });
      } catch (detailErr) {
        console.warn(`Detail fetch failed for ${place.place_id}:`, detailErr);
      }
    }

    nextPageToken = searchData.next_page_token || null;
    pages++;
  } while (nextPageToken && pages < MAX_PAGES);

  return leads;
}

// ====================== FIRECRAWL FALLBACK ======================

function extractPhone(text: string): string | null {
  if (!text) return null;
  const matches = text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,3}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/g);
  if (!matches || matches.length === 0) return null;
  const cleaned = matches[0].replace(/\D/g, '');
  if (cleaned.length < 10) return null;
  return cleaned;
}

async function extractViaFirecrawl(firecrawlKey: string, searchQuery: string): Promise<Lead[]> {
  const leadsMap = new Map<string, Lead>();

  const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${firecrawlKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `${searchQuery} telefone contato site:google.com/maps OR site:google.com.br/maps`,
      limit: 20,
      lang: 'pt',
      country: 'BR',
      scrapeOptions: { formats: ['markdown'] },
    }),
  });

  if (!searchResponse.ok) {
    const errData = await searchResponse.json();
    throw new Error(errData.error || `Firecrawl retornou status ${searchResponse.status}`);
  }

  const searchData = await searchResponse.json();
  const results = searchData?.data || [];

  for (const result of results) {
    const markdown = result.markdown || '';
    const title = result.title || '';
    const phone = extractPhone(markdown);
    if (phone && !leadsMap.has(phone)) {
      const addressMatch = markdown.match(/(?:Endereço|Rua|Av\.|Avenida|R\.)[:\s]*([^\n]+)/i);
      leadsMap.set(phone, {
        name: title.replace(/ - Google Maps.*$/i, '').replace(/\|.*$/, '').trim().substring(0, 200),
        phone,
        address: addressMatch ? addressMatch[1].trim().substring(0, 500) : null,
        metadata: { source_api: 'firecrawl' },
      });
    }
  }

  // Also try direct Google Maps scrape
  try {
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: mapsUrl, formats: ['markdown'], waitFor: 3000 }),
    });

    if (scrapeResponse.ok) {
      const mapsScrapeData = await scrapeResponse.json();
      if (mapsScrapeData?.data?.markdown) {
        const blocks = mapsScrapeData.data.markdown.split(/\n{2,}/);
        for (const block of blocks) {
          const phone = extractPhone(block);
          if (phone && !leadsMap.has(phone)) {
            const firstLine = block.split('\n')[0].replace(/^[#*\s]+/, '').trim();
            leadsMap.set(phone, {
              name: firstLine.substring(0, 200) || 'Lead Google Maps',
              phone,
              address: null,
              metadata: { source_api: 'firecrawl_scrape' },
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('Maps scrape fallback error:', e);
  }

  return Array.from(leadsMap.values());
}
