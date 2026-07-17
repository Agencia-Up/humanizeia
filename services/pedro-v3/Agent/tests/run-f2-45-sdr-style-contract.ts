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
  console.log("== F2.45: contrato tecnico do protocolo ==");

  check("[SDR-1] prompt do portal segue como autoridade de personalidade/funil",
    containsAll("O prompt do portal define personalidade, negocio e funil", "historico real da conversa"));

  check("[SDR-2] protocolo separa contrato tecnico de conducao comercial",
    containsAll("A mensagem system com contexto contem apenas fatos atuais", "nunca escolhe assunto, pergunta ou resposta", "Nao contem proxima pergunta", "comercial paralelo"));

  check("[SDR-3] grounding de lista permanece ativo",
    containsAll("vehicle_offer_list", "Lista usa somente keys retornadas por stock_search"));

  check("[SDR-4] protocolo nao volta a conduzir o funil por fora do portal",
    !source.includes("Toda resposta de estoque precisa ter 3 camadas") && !source.includes("workingMemory.funnel (known/declined)"));

  check("[SDR-5] limite tecnico de perguntas permanece",
    source.includes("no maximo UMA pergunta curta e inequívoca"));

  check("[SDR-6] tool segue o ato e nao palavra-chave",
    containsAll("stock_search busca estoque atual", "Nao use para carro de troca"));

  check("[SDR-7] protocolo nao carrega CTA comercial fixo legado",
    !source.includes("Nao use CTA generico de menu") && !source.includes("Varie conforme a conversa"));

  check("[SDR-8] follow-up fica em contrato proprio",
    source.includes("FOLLOW-UP SISTEMICO") && source.includes("Nao cumprimente"));


  if (fail > 0) {
    console.error(`\nF2.45 falhou: ${fail}`);
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log(`\nF2.45 OK: ${ok} OK / 0 FALHA`);
}

main();
