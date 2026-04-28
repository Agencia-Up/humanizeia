
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://seyljsqmhlopkcauhlor.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNleWxqc3FtaGxvcGtjYXVobG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMDEyNywiZXhwIjoyMDg5NTA2MTI3fQ.b5oaiDazO1ncJYdwlHJo-tnOx88UBjeIwCf175eBrJM');

async function main() {
  console.log('Listando arquivos do bucket creatives...');
  const { data, error } = await supabase.storage.from('creatives').list();
  if (error) return console.error('Erro ao listar:', error);
  
  const payloadFiles = data.filter(f => f.name.startsWith('payload_diag')).sort((a, b) => b.created_at.localeCompare(a.created_at));
  
  if (payloadFiles.length === 0) return console.log('Nenhum payload encontrado.');
  
  const latest = payloadFiles[0];
  console.log('Baixando', latest.name);
  
  const { data: fileData, error: dlError } = await supabase.storage.from('creatives').download(latest.name);
  if (dlError) return console.error('Erro ao baixar:', dlError);
  
  const buffer = Buffer.from(await fileData.arrayBuffer());
  fs.writeFileSync('last_payload.json', buffer);
  console.log('Salvo em last_payload.json');
}

main();
