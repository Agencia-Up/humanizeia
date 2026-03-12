import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function extractPhone(text: string): string | null {
  if (!text) return null;
  // Match phone patterns like (11) 99999-9999, +55 11 99999-9999, 5511999999999
  const matches = text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,3}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/g);
  if (!matches || matches.length === 0) return null;
  const cleaned = matches[0].replace(/\D/g, '');
  // Must be at least 10 digits (DDD + number)
  if (cleaned.length < 10) return null;
  // Add country code if missing
  if (cleaned.length === 10 || cleaned.length === 11) {
    return '55' + cleaned;
  }
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
      name: string;
      phone: string;
      address: string | null;
      website: string | null;
    }

    const leadsMap = new Map<string, Lead>();

    // Parse from search results
    for (const result of results) {
      const markdown = result.markdown || '';
      const title = result.title || '';
      
      const phone = extractPhone(markdown);
      if (phone) {
        if (!leadsMap.has(phone)) {
          // Try to extract address
          const addressMatch = markdown.match(/(?:Endereço|Rua|Av\.|Avenida|R\.)[:\s]*([^\n]+)/i);
          // Try to extract website
          const urlMatch = markdown.match(/https?:\/\/(?!www\.google)[^\s"'<>]+/);
          
          leadsMap.set(phone, {
            name: title.replace(/ - Google Maps.*$/i, '').replace(/\|.*$/, '').trim().substring(0, 200),
            phone,
            address: addressMatch ? addressMatch[1].trim().substring(0, 500) : null,
            website: urlMatch ? urlMatch[0].substring(0, 500) : null,
          });
        }
      }
    }

    // Parse from maps scrape
    if (mapsScrapeData?.data?.markdown) {
      const md = mapsScrapeData.data.markdown;
      // Try to find business listings with phone numbers
      const blocks = md.split(/\n{2,}/);
      for (const block of blocks) {
        const phone = extractPhone(block);
        if (phone && !leadsMap.has(phone)) {
          const firstLine = block.split('\n')[0].replace(/^[#*\s]+/, '').trim();
          leadsMap.set(phone, {
            name: firstLine.substring(0, 200) || 'Lead Google Maps',
            phone,
            address: null,
            website: null,
          });
        }
      }
    }

    const leads = Array.from(leadsMap.values());
    console.log(`[extract-google-maps] Extracted ${leads.length} unique leads with phone numbers`);

    if (leads.length === 0) {
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
    let targetListName = list_name || `Google Maps - ${search_query.substring(0, 50)}`;

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

    // Insert contacts
    const contactRows = leads.map(lead => ({
      user_id,
      list_id: targetListId,
      phone: lead.phone,
      name: lead.name,
      source: 'google_maps',
      group_name: lead.address,
    }));

    let insertedCount = 0;
    for (let i = 0; i < contactRows.length; i += 500) {
      const batch = contactRows.slice(i, i + 500);
      const { error: insertErr } = await supabase.from('wa_contacts').insert(batch);
      if (insertErr) {
        console.error('Insert batch error:', insertErr);
      } else {
        insertedCount += batch.length;
      }
    }

    // Update list count
    const { count } = await supabase
      .from('wa_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('list_id', targetListId);

    await supabase
      .from('wa_contact_lists')
      .update({ contact_count: count || 0 })
      .eq('id', targetListId);

    return new Response(JSON.stringify({
      success: true,
      total_leads: insertedCount,
      list_id: targetListId,
      list_name: targetListName,
      search_results_count: results.length,
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
