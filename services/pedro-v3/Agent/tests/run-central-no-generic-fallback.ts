// ============================================================================
// Gate arquitetural da autoria única. Prova no código que a saída de falha do central_active NUNCA promove um autor
// COMERCIAL (o engine não vira atendente quando a LLM não conclui): nada de recuperação comercial, foto, condução,
// desengajamento, "mais opções" ou oferta relaxada no ramo de falha llm_first. Os renderers comerciais continuam
// disponíveis exclusivamente para o legado.
// ⭐FASE 3 (fallback contextual factual): a ÚNICA exceção autorizada é buildInstitutionalResponse — um FATO
// institucional (endereço/horário/contato) é retrieval de fato do prompt/tool, NÃO condução comercial (não vende,
// não lista carro, não escolhe assunto). O terminal continua sendo buildBrainUnavailableResponse (degradação
// operacional honesta) para todo turno que não seja resolvível por fato institucional.
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

  // Boundary robusto: F7-6 fundiu "produção llmFirst" + "não-llmFirst sem opt-in de replay" num único ramo de falha
  // `} else if (!legacyReplayEnabled) {` cujo ÚNICO desfecho é buildBrainUnavailableResponse (nota de outage). O ramo
  // legado (deterministic_*) fica no `} else {` seguinte, cuja PRIMEIRA chamada é builddeterministicphotoresponse(.
  // A janela do ramo de falha vai do `else if (!legacyreplayenabled)` até essa 1ª chamada legada.
  const llmFailureStart = code.indexOf("} else if (!legacyreplayenabled) {");
  const legacyStart = llmFailureStart >= 0 ? code.indexOf("builddeterministicphotoresponse(", llmFailureStart + 1) : -1;
  const centralFailureBranch = llmFailureStart >= 0 && legacyStart > llmFailureStart
    ? code.slice(llmFailureStart, legacyStart)
    : "";
  check("ramo de falha do central_active foi localizado", centralFailureBranch.length > 0);
  check("central_active tem o terminal operacional brain_unavailable", centralFailureBranch.includes("buildbrainunavailableresponse"));
  // ⭐Itens 2/3/4 (Codex): o INSTITUCIONAL é decidido+redigido pela LLM (chama tenant_business_info). A engine NÃO
  // escreve mais endereço/horário -> buildInstitutionalResponse voltou a ser PROIBIDO no ramo de falha llm_first.
  // central_active tem só DOIS desfechos: resposta autorada pela LLM OU a nota de outage (buildBrainUnavailableResponse).
  const forbiddenCommercialAuthors = [
    "buildinstitutionalresponse(",
    "buildcontextualrecovery(", "builddisengagementresponse(", "buildmoreoptionsscopequestion(",
    "buildemptysearchconductingrecovery(", "buildrelaxedofferresponse(",
    "deterministic_institutional", "deterministic_recovery", "deterministic_photo", "deterministic_conduct",
  ];
  for (const author of forbiddenCommercialAuthors) {
    check(`central_active não promove autor comercial: ${author}`, !centralFailureBranch.includes(author));
  }
  check("passagem final de autoria da LLM existe", code.includes("final_authorship_required") && code.includes("finalauthorshipattempts"));
  // F7-6: a edição silenciosa trimToOneQuestion agora é gateada em legacyReplayEnabled (subconjunto ESTRITO de !llmFirst):
  // nunca roda em produção (llmFirst) NEM em não-llmFirst sem opt-in de replay. Garantia mais forte que antes.
  check(
    "edição silenciosa trimToOneQuestion só no replay legado (fora do llmFirst)",
    /if\s*\(legacyreplayenabled\)\s*\{\s*const\s+trimmedtext\s*=\s*trimtoonequestion/.test(code),
  );
  // F7-6: a invariante de SAÍDA existe e é chamada — deterministic_* comercial só sob replay autorizado (fail-closed).
  check("invariante de saída F7-6 chamada (assertLegacyAuthoringAuthorized)", code.includes("assertlegacyauthoringauthorized("));
  // F7-6: o ramo determinístico legado é gateado por legacyReplayEnabled (opt-in explícito), não mais pelo default.
  check("ramo legado gateado por legacyReplayEnabled (opt-in explícito)", code.includes("islegacyreplayenabled(") && code.includes("legacyreplayenabled"));

  console.log(`\n== SCAN anti-fallback: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
