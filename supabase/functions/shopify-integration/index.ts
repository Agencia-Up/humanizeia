import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const token = authHeader.replace('Bearer ', '');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      console.error('[Shopify] Auth error:', claimsError?.message);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const userId = claimsData.claims.sub;
    const body = await req.json();
    const action = body.action;

    console.log(`[Shopify] Action: ${action}, User: ${userId}`);

    if (action === 'save_credentials') {
      const { apiKey, storeUrl } = body;
      if (!apiKey || !storeUrl) {
        return new Response(JSON.stringify({ error: 'Missing credentials' }), { 
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const cleanUrl = storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      
      const { data, error } = await supabase
        .from('platform_integrations')
        .upsert({
          user_id: userId,
          platform: 'shopify',
          api_key_encrypted: apiKey,
          store_url: cleanUrl,
          is_active: true,
          sync_status: 'pending'
        }, { onConflict: 'user_id,platform' })
        .select()
        .single();

      if (error) {
        console.error('[Shopify] Save error:', error);
        return new Response(JSON.stringify({ error: 'Save failed' }), { 
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      return new Response(JSON.stringify({ success: true, data }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (action === 'get_status') {
      const { data } = await supabase
        .from('platform_integrations')
        .select('*')
        .eq('user_id', userId)
        .eq('platform', 'shopify')
        .maybeSingle();

      return new Response(JSON.stringify({ data }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (action === 'test_connection') {
      const { data: integration } = await supabase
        .from('platform_integrations')
        .select('*')
        .eq('user_id', userId)
        .eq('platform', 'shopify')
        .single();

      if (!integration?.api_key_encrypted || !integration?.store_url) {
        return new Response(JSON.stringify({ error: 'No credentials' }), { 
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const res = await fetch(
        `https://${integration.store_url}/admin/api/2024-01/shop.json`,
        { headers: { 'X-Shopify-Access-Token': integration.api_key_encrypted } }
      );

      if (!res.ok) {
        await supabase
          .from('platform_integrations')
          .update({ sync_status: 'error', is_active: false })
          .eq('user_id', userId)
          .eq('platform', 'shopify');

        return new Response(JSON.stringify({ success: false, error: 'Connection failed' }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const shopData = await res.json();
      
      await supabase
        .from('platform_integrations')
        .update({ 
          sync_status: 'connected',
          is_active: true,
          last_sync_at: new Date().toISOString(),
          metadata: { shop_name: shopData.shop?.name }
        })
        .eq('user_id', userId)
        .eq('platform', 'shopify');

      return new Response(JSON.stringify({ success: true, shop: shopData.shop }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (action === 'sync_orders') {
      const { data: integration } = await supabase
        .from('platform_integrations')
        .select('*')
        .eq('user_id', userId)
        .eq('platform', 'shopify')
        .single();

      if (!integration?.api_key_encrypted) {
        return new Response(JSON.stringify({ error: 'No credentials' }), { 
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const res = await fetch(
        `https://${integration.store_url}/admin/api/2024-01/orders.json?status=any&limit=50`,
        { headers: { 'X-Shopify-Access-Token': integration.api_key_encrypted } }
      );

      if (!res.ok) {
        return new Response(JSON.stringify({ error: 'Fetch orders failed' }), { 
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const ordersData = await res.json();
      const orders = ordersData.orders || [];

      for (const order of orders) {
        await supabase.from('shopify_orders').upsert({
          user_id: userId,
          shopify_order_id: String(order.id),
          order_number: order.name,
          order_date: order.created_at,
          total_price: parseFloat(order.total_price || 0),
          currency: order.currency,
          financial_status: order.financial_status,
          customer_email: order.email,
          line_items: order.line_items
        }, { onConflict: 'user_id,shopify_order_id' });
      }

      await supabase
        .from('platform_integrations')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('platform', 'shopify');

      return new Response(JSON.stringify({ success: true, synced: orders.length }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (action === 'disconnect') {
      await supabase
        .from('platform_integrations')
        .update({ is_active: false, api_key_encrypted: null, sync_status: 'disconnected' })
        .eq('user_id', userId)
        .eq('platform', 'shopify');

      return new Response(JSON.stringify({ success: true }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { 
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('[Shopify] Error:', error);
    return new Response(JSON.stringify({ error: 'Server error' }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
