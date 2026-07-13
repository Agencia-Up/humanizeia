// ============================================================================
// Gate arquitetural da autoria única. Além de proibir o fallback genérico antigo, prova no código que a saída de
// falha do central_active é somente operacional: nenhum renderer comercial determinístico pode ser promovido a
// atendente quando a LLM não conclui. Os renderers antigos continuam disponíveis exclusivamente para o legado.
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

  const llmFailureStart = code.indexOf("} else if (llmfirst) {");
  const legacyStart = llmFailureStart >= 0 ? code.indexOf("} else {", llmFailureStart + 1) : -1;
  const centralFailureBranch = llmFailureStart >= 0 && legacyStart > llmFailureStart
    ? code.slice(llmFailureStart, legacyStart)
    : "";
  check("ramo de falha do central_active foi localizado", centralFailureBranch.length > 0);
  check("central_active usa somente brain_unavailable quando a LLM não autora", centralFailureBranch.includes("buildbrainunavailableresponse"));
  const forbiddenCommercialAuthors = [
    "buildcontextualrecovery(", "builddeterministicphotoresponse(", "buildinstitutionalresponse(",
    "builddisengagementresponse(", "buildmoreoptionsscopequestion(", "buildemptysearchconductingrecovery(",
    "buildrelaxedofferresponse(", "deterministic_recovery", "deterministic_photo", "deterministic_conduct",
  ];
  for (const author of forbiddenCommercialAuthors) {
    check(`central_active não promove autor comercial: ${author}`, !centralFailureBranch.includes(author));
  }
  check("passagem final de autoria da LLM existe", code.includes("final_authorship_required") && code.includes("finalauthorshipattempts"));
  check(
    "edição silenciosa trimToOneQuestion fica fora do llmFirst",
    /if\s*\(!llmfirst\)\s*\{\s*const\s+trimmedtext\s*=\s*trimtoonequestion/.test(code),
  );

  console.log(`\n== SCAN anti-fallback: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
