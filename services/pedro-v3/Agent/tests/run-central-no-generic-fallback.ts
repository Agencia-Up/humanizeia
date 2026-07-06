// ============================================================================
// SCAN anti-fallback genérico (gate da missão fonte única): garante que NENHUMA fala genérica de fallback
// ("não consegui confirmar", "reformule/reformular") possa chegar ao outbox do central_active. Lê central-engine.ts,
// remove COMENTÁRIOS (onde as frases aparecem só como documentação) e falha se sobrar a frase em código/string literal.
//   npx tsx tests/run-central-no-generic-fallback.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Remove comentários de linha (//...) e de bloco (/* */). Suficiente p/ este scan (não há // dentro de strings no engine).
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")           // blocos
    .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");   // linha
}
const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function main(): Promise<void> {
  console.log("== SCAN anti-fallback genérico no central_active ==");
  const here = dirname(fileURLToPath(import.meta.url));
  const engine = readFileSync(join(here, "../src/engine/central-engine.ts"), "utf8");
  const code = norm(stripComments(engine));

  // Frases GENÉRICAS proibidas no outbox (fora de comentário). A recuperação contextual (T5) as substituiu.
  const FORBIDDEN = ["nao consegui confirmar essa informacao", "consegue reformular", "reformular pra eu"];
  for (const phrase of FORBIDDEN) {
    check(`central-engine não contém a fala genérica: "${phrase}"`, !code.includes(norm(phrase)), "encontrada em código/string (fora de comentário)");
  }
  // A função buildTechnicalFallback (fala genérica) foi REMOVIDA — não deve mais existir como definição.
  check("buildTechnicalFallback (fala genérica) foi removida", !/function\s+buildtechnicalfallback/.test(norm(engine)), "definição ainda presente");
  // A recuperação contextual existe e é a fonte do texto de degradação.
  check("buildContextualRecovery presente (substitui o fallback genérico)", /function\s+buildcontextualrecovery/.test(norm(engine)));

  console.log(`\n== SCAN anti-fallback: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
