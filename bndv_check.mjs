// Diagnóstico BNDV - verifica valores reais de transmissionName
const SUPABASE_URL = 'https://seyljsqmhlopkcauhlor.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNleWxqc3FtaGxvcGtjYXVobG9yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzkzMDEyNywiZXhwIjoyMDg5NTA2MTI3fQ.b5oaiDazO1ncJYdwlHJo-tnOx88UBjeIwCf175eBrJM';
const BNDV_API_URL = 'https://api-estoque.azurewebsites.net/graphql';

function normalizeBndvText(value) {
  return String(value || '').toLowerCase().trim();
}

function bndvIncludes(haystack, needle) {
  if (!needle || !String(needle).trim()) return true;
  return normalizeBndvText(haystack).includes(normalizeBndvText(needle));
}

async function main() {
  // Buscar token
  const intRes = await fetch(`${SUPABASE_URL}/rest/v1/platform_integrations?platform=eq.bndv&select=api_key_encrypted,is_active`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const integrations = await intRes.json();
  let token;
  try { token = JSON.parse(integrations[0].api_key_encrypted).api_token; }
  catch { token = integrations[0].api_key_encrypted; }

  // Buscar estoque
  const bndvRes = await fetch(BNDV_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ query: `query { vehiclesBy { modelName markName year transmissionName versionName pictureJs } }` })
  });
  const payload = await bndvRes.json();
  const vehicles = payload?.data?.vehiclesBy || [];

  // Mostrar valores únicos de transmissionName
  const transmissions = [...new Set(vehicles.map(v => v.transmissionName))].filter(Boolean);
  console.log('=== VALORES ÚNICOS DE transmissionName NA BNDV ===');
  transmissions.forEach(t => {
    const lower = normalizeBndvText(t);
    console.log(`  "${t}" → lower: "${lower}"`);
    console.log(`    includes('automatico'): ${lower.includes('automatico')}`);
    console.log(`    includes('aut'): ${lower.includes('aut')}`);
    console.log(`    includes('automático'): ${lower.includes('automático')}`);
  });

  // Simular busca: Onix 2019 automatico
  console.log('\n=== SIMULANDO BUSCA: modelo=onix, ano=2019, cambio=automatico ===');
  const filtered = vehicles.filter(v => {
    const matchModelo = bndvIncludes(v.modelName, 'onix');
    const matchAno = Number(v.year) >= 2019 && Number(v.year) <= 2019;
    const matchCambio = bndvIncludes(v.transmissionName, 'automatico');
    return matchModelo && matchAno && matchCambio;
  });
  console.log(`Encontrados com cambio='automatico': ${filtered.length}`);
  filtered.forEach(v => console.log(`  - ${v.markName} ${v.modelName} ${v.versionName} ${v.year} | trans: "${v.transmissionName}"`));

  // Tentar com 'aut'
  console.log('\n=== SIMULANDO BUSCA: modelo=onix, ano=2019, cambio=aut ===');
  const filtered2 = vehicles.filter(v => {
    const matchModelo = bndvIncludes(v.modelName, 'onix');
    const matchAno = Number(v.year) >= 2019 && Number(v.year) <= 2019;
    const matchCambio = bndvIncludes(v.transmissionName, 'aut');
    return matchModelo && matchAno && matchCambio;
  });
  console.log(`Encontrados com cambio='aut': ${filtered2.length}`);
  filtered2.forEach(v => {
    const pics = v.pictureJs ? (typeof v.pictureJs === 'string' ? JSON.parse(v.pictureJs) : v.pictureJs) : [];
    console.log(`  - ${v.markName} ${v.modelName} ${v.versionName} ${v.year} | fotos: ${pics.length}`);
  });

  // Todos onix 2019
  console.log('\n=== TODOS ONIX 2019 (sem filtro de câmbio) ===');
  const allOnix2019 = vehicles.filter(v => bndvIncludes(v.modelName, 'onix') && Number(v.year) === 2019);
  allOnix2019.forEach(v => {
    const pics = v.pictureJs ? (typeof v.pictureJs === 'string' ? JSON.parse(v.pictureJs) : v.pictureJs) : [];
    console.log(`  - ${v.versionName} ${v.year} | trans: "${v.transmissionName}" | fotos: ${Array.isArray(pics) ? pics.length : 0}`);
  });
}

main().catch(console.error);
