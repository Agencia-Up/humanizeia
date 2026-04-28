
const https = require('https');

const LEGACY_URL = 'https://seyljsqmhlopkcauhlor.supabase.co';
const LEGACY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNleWxqc3FtaGxvcGtjYXVobG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMDEyNywiZXhwIjoyMDg5NTA2MTI3fQ.b5oaiDazO1ncJYdwlHJo-tnOx88UBjeIwCf175eBrJM';

function queryDB(url, key, table, queryParams) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${url}/rest/v1/${table}?${queryParams}`;
    const req = https.request(fullUrl, {
      method: 'GET',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    }, res => {
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
  const jid = '5512997423129@s.whatsapp.net';
  console.log(`\n=== STATUS DO LEAD NO CRM: ${jid} ===`);
  const lead = await queryDB(LEGACY_URL, LEGACY_KEY, 'ai_crm_leads', `remote_jid=eq.${jid}`);
  console.log(JSON.stringify(lead, null, 2));
}
main().catch(console.error);
