#!/usr/bin/env node
/**
 * Bateria de regressao do Pedro v2 (busca de estoque).
 *
 * Roda dry-runs REAIS contra a Edge Function `pedro-webhook-v2` e valida as garantias
 * que ja quebraram em producao (cada caso aqui veio de um bug real reportado):
 *   1. PRESENCA  — todo modelo do estoque continua encontravel ("tem <modelo>?").
 *   2. PRECO A CONFIRMAR (v62) — carro com saleValue=R$0 (erro de cadastro do lojista)
 *      NAO some quando o lead nomeia o modelo; vem com preco_a_confirmar=true. (Caso Cruze)
 *   3. CARROCERIA EXPLICITA (v62) — "polo hatch"/"onix sedan" sobem a carroceria pedida
 *      ao 1o lugar SEM eliminar a outra (ranking, nunca filtro).
 *   4. v61 PRESERVADO — "polo 2013" traz o Polo (inclui Sedan), nunca "nao temos".
 *   5. CATEGORIA PURA — busca por carroceria sem modelo NAO mostra o carro R$0
 *      (allowPriceless so vale quando o lead nomeia o modelo).
 *
 * Uso:
 *   PEDRO_SERVICE_KEY=<service_role_jwt> node scripts/pedro-v2-regression.mjs
 *   (opcional) PEDRO_FN_URL=https://<ref>.supabase.co/functions/v1/pedro-webhook-v2
 *   (opcional) PEDRO_INSTANCE=whatsapp-carvalho-4yae
 *
 * Sai com codigo 1 se qualquer caso falhar (serve em CI). NUNCA grava nada — dry_run=true.
 */
const KEY = process.env.PEDRO_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const FN = process.env.PEDRO_FN_URL || 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-webhook-v2';
const INSTANCE = process.env.PEDRO_INSTANCE || 'whatsapp-carvalho-4yae';
if (!KEY) {
  console.error('ERRO: defina PEDRO_SERVICE_KEY (service_role JWT) no ambiente.');
  process.exit(2);
}
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
let idc = 0;
async function dry(text) {
  const id = 'REG' + (idc++);
  const body = {
    dry_run: true, instanceName: INSTANCE, instance: INSTANCE,
    messages: [{
      key: { remoteJid: '5599009' + String(idc).padStart(5, '0') + '@s.whatsapp.net', fromMe: false, id },
      message: { conversation: text }, pushName: 't', messageType: 'conversation',
    }],
  };
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY, apikey: KEY }, body: JSON.stringify(body) });
  const j = await r.json();
  const sr = j.stock_result || {};
  const items = (sr.items || []).map(v => ({
    txt: norm((v.marca || '') + ' ' + (v.modelo || '') + ' ' + (v.versao || '') + ' ' + v.ano),
    preco: v.preco, pac: !!v.preco_a_confirmar,
  }));
  return { build: j.build, action: j.brain_plan?.action, n: items.length, alt: !!sr.is_alternatives, items };
}
// classifica carroceria pelo texto do item (aproxima getVehicleSubcategory — uso so no teste)
function bodyOf(txt) {
  if (/\b(sedan|seda|virtus|voyage|prisma|cronos|plus)\b/.test(txt)) return 'sedan';
  if (/\b(suv|compass|renegade|creta|kicks|tracker|tcross|t cross|nivus|fastback|pulse|duster|asx)\b/.test(txt)) return 'suv';
  if (/\b(hatch|polo|argo|mobi|kwid|c3|gol|hb20|onix)\b/.test(txt)) return 'hatch';
  return '?';
}
const PASS = [], FAIL = [];
const ok = (name, cond, detail) => { (cond ? PASS : FAIL).push({ name, detail }); process.stdout.write(cond ? '.' : 'X'); };

// Modelos do estoque (ajuste se o estoque mudar). Presenca nao pode regredir.
const MODELS = ['asx', 'onix', 'cruze', 'hilux', 'hb20', 'renegade', 'creta', '208', 'toro', 'tracker', 'compass', 'fastback', 'argo', 'polo', 't-cross', 'cronos', 'pulse', 'ranger', 'kwid', 'pajero', '2008', '207', 'mini cooper', 'frontier', 'nivus', 'virtus', 'c3', 'kicks', 'honda city'];

async function main() {
  let build = '';
  for (const m of MODELS) {
    const r = await dry('tem ' + m + '?'); build = r.build;
    const needle = norm(m.replace('mini ', '').replace('honda ', ''));
    ok('presenca:' + m, r.n > 0 && r.items.some(it => it.txt.includes(needle)), `n=${r.n} got=${JSON.stringify(r.items.slice(0, 2).map(i => i.txt))}`);
  }
  {
    const r = await dry('tem cruze?');
    const cruze = r.items.find(it => it.txt.includes('cruze'));
    ok('cruze:aparece', !!cruze, `n=${r.n}`);
    ok('cruze:preco_a_confirmar', !!cruze && cruze.pac === true && cruze.preco == null, `pac=${cruze?.pac} preco=${cruze?.preco}`);
  }
  for (const [q, want, other] of [
    ['quero um polo hatch', 'hatch', 'sedan'],
    ['quero um polo sedan', 'sedan', 'hatch'],
    ['quero um onix sedan', 'sedan', 'hatch'],
    ['quero um onix hatch', 'hatch', 'sedan'],
  ]) {
    const r = await dry(q);
    const bodies = r.items.map(i => bodyOf(i.txt));
    ok(`carroceria:1o=${want} (${q})`, bodies[0] === want, `bodies=${JSON.stringify(bodies)} items=${JSON.stringify(r.items.map(i => i.txt))}`);
    ok(`carroceria:nao elimina (${q})`, r.n > 0, `n=${r.n}`);
  }
  {
    const r = await dry('quero um polo 2013');
    ok('v61:polo 2013 aparece', r.n > 0 && r.items.some(it => it.txt.includes('polo')), `n=${r.n} got=${JSON.stringify(r.items.slice(0, 3).map(i => i.txt))}`);
  }
  {
    const r = await dry('voces tem algum sedan?');
    ok('categoria:sem R$0 (sedan puro)', !r.items.some(it => it.pac === true), `pac_items=${r.items.filter(i => i.pac).length} n=${r.n}`);
  }

  console.log(`\n\n=== BUILD: ${build} ===`);
  console.log(`PASS=${PASS.length}  FAIL=${FAIL.length}`);
  if (FAIL.length) {
    console.log('\n----- FALHAS -----');
    for (const f of FAIL) console.log(`X ${f.name} :: ${f.detail}`);
  } else {
    console.log('TODOS OS TESTES PASSARAM');
  }
  process.exit(FAIL.length ? 1 : 0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
