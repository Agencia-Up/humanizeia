// ============================================================================
// F2.77 — FASE 5 (custo): NENHUMA escalada SILENCIOSA de modelo.
//
// INCIDENTE (smoke real da Wa, 24/07): as metricas acusaram `gpt-4.1-2025-04-14`
// mesmo com o modelo principal cravado em `gpt-4.1-mini`. Causa: `ai-provider.ts`
// tinha `retryModel` com default LITERAL `gpt-4.1` — TODO retry do cerebro
// escalava p/ o modelo 5x mais caro sem ninguem pedir. O mesmo padrao existia no
// critico semantico (default `gpt-4.1` no adapter + literal no server e no eval).
//
// CONTRATO: escalar de modelo e decisao EXPLICITA (env/config). Sem isso, retry e
// critico usam o MESMO modelo principal. Provado por comportamento (A-D) e por
// varredura estatica que impede a regressao voltar por qualquer arquivo (E).
//   npx tsx tests/run-f2-77-model-pinning.ts
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAiProviderRuntime } from "../src/runtime/ai-provider.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}
const MINI = "gpt-4.1-mini";
const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { if (entry !== "node_modules") walk(p, out); }
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function main(): void {
  console.log("== F2.77: modelo cravado, zero escalada silenciosa ==");

  // ── A) principal mini + retry NAO configurado -> retry TAMBEM mini ─────────────────────────────
  const a = resolveAiProviderRuntime(env({ PEDRO_V3_AI_PROVIDER: "openai", PEDRO_V3_OPENAI_MODEL: MINI }));
  check("[A] principal=mini e retry ausente -> model=mini", a.model === MINI, a.model);
  check("[A] principal=mini e retry ausente -> retryModel=mini (NUNCA gpt-4.1)", a.retryModel === MINI, a.retryModel);

  // ── B) retry EXPLICITO -> respeitado (escalar continua possivel, mas so de proposito) ─────────
  const b = resolveAiProviderRuntime(env({ PEDRO_V3_AI_PROVIDER: "openai", PEDRO_V3_OPENAI_MODEL: MINI, PEDRO_V3_OPENAI_RETRY_MODEL: "gpt-4.1" }));
  check("[B] retry explicito e respeitado", b.model === MINI && b.retryModel === "gpt-4.1", `${b.model}/${b.retryModel}`);

  // ── C) regra GENERICA: qualquer principal propaga p/ o retry (nao e um if p/ mini) ────────────
  const c = resolveAiProviderRuntime(env({ PEDRO_V3_AI_PROVIDER: "openai", PEDRO_V3_OPENAI_MODEL: "gpt-5-nano" }));
  check("[C] retry segue o principal, seja qual for (gpt-5-nano)", c.retryModel === "gpt-5-nano", c.retryModel);

  // ── D) DeepSeek mantem o comportamento correto que ja tinha ───────────────────────────────────
  const d = resolveAiProviderRuntime(env({ PEDRO_V3_AI_PROVIDER: "deepseek", PEDRO_V3_DEEPSEEK_MODEL: "deepseek-chat" }));
  check("[D] deepseek: retry segue o principal", d.model === "deepseek-chat" && d.retryModel === "deepseek-chat", `${d.model}/${d.retryModel}`);

  // ── E) VARREDURA: nenhum DEFAULT literal `gpt-4.1` em src/ (retry, critico, rewriter, compose) ─
  // Pega a regressao voltando por QUALQUER arquivo. Um literal só é aceito quando NÃO é default
  // (ex.: comparação em teste), por isso miramos os dois padrões de default: `|| "gpt-4.1"` e `: "gpt-4.1"`.
  const srcDir = join(fileURLToPath(new URL("../src/", import.meta.url)));
  const offenders: string[] = [];
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.trimStart().startsWith("//")) return;                 // comentario explicando o fix nao conta
      const m = /(\|\||:)\s*"gpt-4\.1"/.exec(line);
      if (m) offenders.push(`${file.slice(srcDir.length)}:${i + 1} ${line.trim().slice(0, 90)}`);
    });
  }
  check("[E] nenhum default literal \"gpt-4.1\" em src/ (retry/critico/rewriter/compose)", offenders.length === 0, offenders.join(" | "));

  // ── F) o modelo PRINCIPAL default segue existindo (não quebramos a resolucao sem env) ─────────
  const f = resolveAiProviderRuntime(env({ PEDRO_V3_AI_PROVIDER: "openai" }));
  check("[F] sem env o provider ainda resolve e retry == principal (sem divergir)", f.model === f.retryModel, `${f.model}/${f.retryModel}`);

  console.log(`\n== F2.77: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n - " + fails.join("\n - ")); process.exit(1); }
}
main();
