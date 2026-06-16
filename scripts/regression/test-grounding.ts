// Unit test do validador de grounding (rodar: npx tsx scripts/regression/test-grounding.ts)
import { validateGrounding, groundedFallback } from "../../supabase/functions/_shared/pedro-v2/grounding.ts";

const FIAT_PICKUPS = [{ marca: "Fiat", modelo: "Toro", versao: "Volcano", ano: 2024, preco: 159990 }, { marca: "Nissan", modelo: "Frontier", versao: "LE 4x4", ano: 2012, preco: 84990 }, { marca: "Fiat", modelo: "Strada", versao: "Volcano CD", ano: 2025, preco: 120000 }];
const ONIX = [{ marca: "Chevrolet", modelo: "Onix", versao: "LT 1.0", ano: 2017, preco: 64990 }];
const SUVS = [{ marca: "Jeep", modelo: "Compass", ano: 2022, preco: 130000 }, { marca: "Hyundai", modelo: "Creta", ano: 2021, preco: 95000 }, { marca: "Chevrolet", modelo: "Tracker", ano: 2018, preco: 80000 }];

const cases: Array<{ n: string; text: string; facts: any[]; expectViol: boolean; rule?: string }> = [
  { n: "R3 falso 'não temos picape Fiat' (José)", text: "Atualmente, não temos uma picape Fiat cabine dupla em nosso estoque. Temos outras opções.", facts: FIAT_PICKUPS, expectViol: true, rule: "R3" },
  { n: "R1 falso 'não temos picape'", text: "Não temos picape no estoque no momento.", facts: FIAT_PICKUPS, expectViol: true, rule: "R1" },
  { n: "R2 falso 'não temos Onix'", text: "Infelizmente não temos Onix disponível.", facts: ONIX, expectViol: true, rule: "R2" },
  { n: "OK negação com ANO (legítima)", text: "Não temos o Onix 2015.", facts: ONIX, expectViol: false },
  { n: "R5 inventado 'temos o Compass'", text: "Temos o Compass por R$ 90.000. Quer ver?", facts: ONIX, expectViol: true, rule: "R5" },
  { n: "OK 'temos SUV (Creta/Tracker)' reais", text: "Temos opções de SUV, como o Creta e o Tracker. Quer ver fotos?", facts: SUVS, expectViol: false },
  { n: "OK 'não temos esse modelo' (modelo ausente)", text: "Não temos esse modelo, mas temos picapes parecidas.", facts: FIAT_PICKUPS, expectViol: false },
  { n: "OK 'temos ASX' real", text: "Temos um Mitsubishi ASX 2016 por R$ 76.990.", facts: [{ marca: "Mitsubishi", modelo: "ASX", ano: 2016, preco: 76990 }], expectViol: false },
  { n: "OK facts vazio (não valida)", text: "Não temos picape Fiat.", facts: [], expectViol: false },
  { n: "OK negação com motor (legítima)", text: "Não temos picape 2.0 diesel.", facts: FIAT_PICKUPS, expectViol: false },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const { ok, violations } = validateGrounding(c.text, c.facts);
  const gotViol = !ok;
  const ruleOk = !c.rule || violations.some((v) => v.rule === c.rule);
  if (gotViol === c.expectViol && ruleOk) { pass++; console.log(`  ✅ ${c.n}${gotViol ? ` (${violations.map((v) => v.rule).join(",")})` : ""}`); }
  else { fail++; console.log(`  ❌ ${c.n} | esperava viol=${c.expectViol}${c.rule ? `/${c.rule}` : ""}, veio viol=${gotViol} [${violations.map((v) => v.rule + ":" + v.detail).join(", ")}]`); }
}
console.log(`\nfallback exemplo: ${groundedFallback(FIAT_PICKUPS)}`);
console.log(`\n${pass} OK | ${fail} FALHARAM`);
if (fail) (globalThis as any).process?.exit?.(1);
