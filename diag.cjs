const https = require('https');

const SUPABASE_URL = 'https://qrxsiixufdiemwwyhxvd.supabase.co';
const SERVICE_KEY = 'sb_secret_IDsZ4xWArGiGPs8XIcy45g_iEGI0zgw';

// Use legacy project for ai_team_members (project seyljsqmhlopkcauhlor)
const LEGACY_URL = 'https://seyljsqmhlopkcauhlor.supabase.co';
const LEGACY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNleWxqc3FtaGxvcGtjYXVobG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMDEyNywiZXhwIjoyMDg5NTA2MTI3fQ.b5oaiDazO1ncJYdwlHJo-tnOx88UBjeIwCf175eBrJM';

async function queryDB(baseUrl, key, table, params = '') {
  return new Promise((resolve, reject) => {
    const fullUrl = `${baseUrl}/rest/v1/${table}?${params}`;
    const url = new URL(fullUrl);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('=== VENDEDORES CADASTRADOS (banco legacy) ===');
  const members = await queryDB(LEGACY_URL, LEGACY_KEY, 'ai_team_members', 'select=id,name,whatsapp_number,is_active&is_active=eq.true');
  if (Array.isArray(members)) {
    members.forEach(m => {
      const digits = String(m.whatsapp_number || '').replace(/\D/g, '');
      console.log(`  ${m.name}: stored="${m.whatsapp_number}" -> digits="${digits}"`);
    });
  } else {
    console.log('Erro ou nao eh array:', JSON.stringify(members).slice(0, 200));
  }

  console.log('\n=== LEADS RECENTES (banco legacy) ===');
  const leads = await queryDB(LEGACY_URL, LEGACY_KEY, 'ai_crm_leads', 'select=id,lead_name,remote_jid,status,assigned_to_member_id&order=last_interaction_at.desc&limit=5');
  if (Array.isArray(leads)) {
    leads.forEach(l => {
      const phone = (l.remote_jid || '').split('@')[0];
      console.log(`  ${l.lead_name}: phone="${phone}" status="${l.status}" assigned="${l.assigned_to_member_id}"`);
    });
  } else {
    console.log('Resposta:', JSON.stringify(leads).slice(0, 200));
  }

  console.log('\n=== BNDV INTEGRATION (banco novo) ===');
  const integrations = await queryDB(SUPABASE_URL, SERVICE_KEY, 'platform_integrations', 'select=platform,is_active,api_key_encrypted&platform=eq.bndv');
  if (Array.isArray(integrations)) {
    integrations.forEach(i => {
      console.log(`  platform=${i.platform} is_active=${i.is_active} key_len=${(i.api_key_encrypted||'').length}`);
    });
  } else {
    console.log('Resposta:', JSON.stringify(integrations).slice(0, 200));
  }
}

main().catch(console.error);
