import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function extractPhone(text: string): string | null {
  if (!text) return null;
  const matches = text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,3}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/g);
  if (!matches || matches.length === 0) return null;
  const cleaned = matches[0].replace(/\D/g, '');
  if (cleaned.length < 10) return null;
  return cleaned;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { user_id, search_query, list_id, list_name } = body;

    if (!user_id || !search_query) {
      return new Response(JSON.stringify({ success: false, error: 'user_id e search_query são obrigatórios' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (!firecrawlKey) {
      return new Response(JSON.stringify({ success: false, error: 'Firecrawl não configurado' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[extract-google-maps] Searching: "${search_query}"`);

    // Use Firecrawl search to find businesses
    const searchResponse = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `${search_query} telefone contato site:google.com/maps OR site:google.com.br/maps`,
        limit: 20,
        lang: 'pt',
        country: 'BR',
        scrapeOptions: { formats: ['markdown'] },
      }),
    });

    if (!searchResponse.ok) {
      const errData = await searchResponse.json();
      console.error('Firecrawl search error:', errData);
      throw new Error(errData.error || `Firecrawl retornou status ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const results = searchData?.data || [];

    console.log(`[extract-google-maps] Got ${results.length} search results`);

    // Also do a direct Google Maps scrape
    const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(search_query)}`;
    let mapsScrapeData: any = null;
    try {
      const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: mapsUrl,
          formats: ['markdown'],
          waitFor: 3000,
        }),
      });
      if (scrapeResponse.ok) {
        mapsScrapeData = await scrapeResponse.json();
      }
    } catch (e) {
      console.error('Maps scrape fallback error:', e);
    }

    // Parse leads from all results
    interface Lead {
      phone: string;
      name: string;
      address: string | null;
    }

    const leadsMap = new Map<string, Lead>();

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
        });
      }
    }

    if (mapsScrapeData?.data?.markdown) {
      const md = mapsScrapeData.data.markdown;
      const blocks = md.split(/\n{2,}/);
      for (const block of blocks) {
        const phone = extractPhone(block);
        if (phone && !leadsMap.has(phone)) {
          const firstLine = block.split('\n')[0].replace(/^[#*\s]+/, '').trim();
          leadsMap.set(phone, {
            name: firstLine.substring(0, 200) || 'Lead Google Maps',
            phone,
            address: null,
          });
        }
      }
    }

    const rawLeads = Array.from(leadsMap.values());
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

    // Call sanitize-contacts for dedup, E.164 formatting, and WhatsApp check
    console.log(`[extract-google-maps] Sanitizing ${rawLeads.length} leads...`);

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
        })),
        check_whatsapp: false, // Google Maps leads may not have WhatsApp
      }),
    });

    const sanitizeData = await sanitizeRes.json();

    if (!sanitizeData.success) {
      throw new Error(sanitizeData.error || 'Erro na higienização');
    }

    const stats = sanitizeData.stats || {};
    console.log(`[extract-google-maps] Sanitization stats:`, stats);

    return new Response(JSON.stringify({
      success: true,
      total_leads: stats.total_valid || 0,
      inserted: sanitizeData.inserted_count || 0,
      list_id: targetListId,
      list_name: targetListName,
      search_results_count: results.length,
      stats,
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
