// ============================================================================
// F2.45 - contrato de estilo SDR no cerebro LLM-first.
// Garante que a apresentacao de estoque continue consultiva, sem voltar para
// menu fixo, sem pedir cadastro cedo, e preservando o prompt do portal como
// autoridade de personalidade/funil.
//   npx tsx tests/run-f2-45-sdr-style-contract.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let ok = 0, fail = 0;
const failures: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); return; }
  fail++; failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
  console.error(`  RED ${name}${detail ? ` - ${detail}` : ""}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, "../src/adapters/llm/openai-agent-brain.ts"), "utf8");

function containsAll(...parts: readonly string[]): boolean {
  return parts.every((part) => source.includes(part));
}

function main(): void {
  console.log("== F2.45: contrato de estilo SDR ==");

  check("[SDR-1] prompt do portal segue como autoridade de personalidade/funil",
    containsAll("o prompt do portal manda na personalidade", "substituem esse prompt"));

  check("[SDR-2] lista de estoque deve ter contexto + vehicle_offer_list + CTA",
    containsAll("Toda resposta de estoque precisa ter 3 camadas", "contexto curto", "vehicle_offer_list", "UM CTA curto"));

  check("[SDR-3] proibe CTA generico de menu fixo",
    containsAll("Nao use CTA generico de menu", "Varie conforme a conversa"));

  check("[SDR-4] lista nova nao deve pedir cadastro cedo",
    containsAll("NUNCA peca nome, sobrenome, telefone, troca ou entrada", "apresentando uma lista nova"));

  check("[SDR-5] poucos itens devem soar como vendedor consultivo",
    containsAll("Quando a lista tem poucos itens", "Achei duas opcoes que fazem sentido"));

  check("[SDR-6] sem item novo nao relista nem use vehicle_offer_list",
    containsAll("Quando nao houver item novo", "nao use vehicle_offer_list", "nao re-liste"));

  check("[SDR-7] exemplo de lista nao voltou ao menu antigo",
    !source.includes("Quer ver as fotos de algum deles?"));

  check("[SDR-8] exemplo novo conduz por escolha do lead",
    source.includes("Alguma delas te chamou mais atenção?"));

  if (fail > 0) {
    console.error(`\nF2.45 falhou: ${fail}`);
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log(`\nF2.45 OK: ${ok} OK / 0 FALHA`);
}

main();