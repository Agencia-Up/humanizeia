
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
  const phone = '5512997423129';
  console.log(`\n=== HISTORICO DO LEAD: ${phone} ===`);
  // Buscando pelo JID correspondente
  const jid = `${phone}@s.whatsapp.net`;
  const msgs = await queryDB(LEGACY_URL, LEGACY_KEY, 'wa_chat_history', `remote_jid=eq.${jid}&order=created_at.desc&limit=10`);
  
  if (Array.isArray(msgs)) {
    msgs.reverse().forEach(m => {
      console.log(`[${m.created_at}] ${m.role}: ${m.content}`);
      console.log('---');
    });
  } else {
    console.log('Erro ao buscar historico:', msgs);
  }
}
main().catch(console.error);
