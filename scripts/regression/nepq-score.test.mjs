// Valida a lógica PURA do score NEPQ (cópia verbatim das funções de analista.ts).
// Não importa o módulo Deno; prova o algoritmo com casos conhecidos.
const clampNota04 = (v) => { const n = Math.round(Number(v)); return isNaN(n) ? 0 : Math.max(0, Math.min(4, n)); };

function calcScoreNepq(dimsSaida, rubrica) {
  const defs = rubrica?.definicao?.dimensoes || [];
  if (!defs.length) return 0;
  const notaPorCod = new Map();
  for (const d of Array.isArray(dimsSaida) ? dimsSaida : []) if (d && d.cod) notaPorCod.set(String(d.cod), clampNota04(d.nota));
  let soma = 0, totalPeso = 0;
  for (const def of defs) {
    const peso = Number(def?.peso) || 0; if (peso <= 0) continue;
    const nota = notaPorCod.get(String(def.cod)) ?? 0;
    soma += (nota / 4) * peso; totalPeso += peso;
  }
  return totalPeso > 0 ? Math.round(soma * (100 / totalPeso)) : 0;
}
function semaforoNepq(score, rubrica) {
  const f = rubrica?.definicao?.faixas_semaforo || {};
  const dentro = (par) => Array.isArray(par) && score >= Number(par[0]) && score <= Number(par[1]);
  if (dentro(f.verde)) return 'verde';
  if (dentro(f.vermelho)) return 'vermelho';
  return 'amarelo';
}
function montarLinhasDimensoes(dimsSaida, rubrica, t, a, v) {
  const cods = new Set((rubrica?.definicao?.dimensoes || []).map((d) => String(d.cod)));
  const out = [];
  for (const d of Array.isArray(dimsSaida) ? dimsSaida : []) {
    const cod = String(d?.cod || ''); if (!cods.has(cod)) continue;
    out.push({ tenant_id: t, analise_id: a, vendedor_id: v, dimensao_cod: cod, nota: clampNota04(d?.nota) });
  }
  return out;
}

// Rubrica de teste espelhando a seed (12 dims, pesos somam 100).
const rubrica = { definicao: {
  faixas_semaforo: { verde: [70,100], amarelo: [45,69], vermelho: [0,44] },
  dimensoes: [
    {cod:'A',peso:8},{cod:'B1',peso:10},{cod:'B2',peso:12},{cod:'B3',peso:8},{cod:'B4',peso:10},
    {cod:'B5',peso:12},{cod:'C',peso:8},{cod:'D',peso:10},{cod:'E1',peso:4},{cod:'E2',peso:6},
    {cod:'E3',peso:8},{cod:'E4',peso:4},
  ],
}};
const cods = rubrica.definicao.dimensoes.map((d) => d.cod);
const todas = (n) => cods.map((cod) => ({ cod, nota: n }));

let falhas = 0;
const eq = (nome, got, exp) => { const ok = got === exp; if (!ok) falhas++; console.log(`${ok?'PASS':'FAIL'} ${nome}: got=${got} exp=${exp}`); };

eq('todas nota 4 -> 100', calcScoreNepq(todas(4), rubrica), 100);
eq('todas nota 0 -> 0', calcScoreNepq(todas(0), rubrica), 0);
eq('todas nota 2 -> 50', calcScoreNepq(todas(2), rubrica), 50);
// só B2 (peso 12) nota 4 = (4/4)*12 * (100/100) = 12
eq('so B2=4 -> 12', calcScoreNepq([{cod:'B2',nota:4}], rubrica), 12);
// nota fora de faixa -> clamp
eq('clamp nota 9 -> 4 (todas)=100', calcScoreNepq(todas(9), rubrica), 100);
eq('clamp nota -3 -> 0', calcScoreNepq(todas(-3), rubrica), 0);
// cód inventado é ignorado no rollup
eq('cod invalido ignorado', montarLinhasDimensoes([{cod:'Z',nota:4},{cod:'A',nota:3}], rubrica,'t','a','v').length, 1);
eq('linhas todas dims', montarLinhasDimensoes(todas(4), rubrica,'t','a','v').length, 12);
// semáforo
eq('semaforo 100 verde', semaforoNepq(100, rubrica), 'verde');
eq('semaforo 60 amarelo', semaforoNepq(60, rubrica), 'amarelo');
eq('semaforo 44 vermelho', semaforoNepq(44, rubrica), 'vermelho');
eq('semaforo 45 amarelo (borda)', semaforoNepq(45, rubrica), 'amarelo');
eq('semaforo 70 verde (borda)', semaforoNepq(70, rubrica), 'verde');

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
