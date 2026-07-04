// ============================================================================
// eval/run-llm-first-sdr.ts — VALIDAÇÃO REAL da missão SDR LLM-first (2 conversas curtas, gpt-4.1-mini REAL,
// prompt/estoque/config REAIS, central engine singleAuthor + llmFirst = PRODUÇÃO central_active, EffectGate OFF,
// businessInfo do PROMPT). Sem judge pesado — assertivas heurísticas por conversa + relatório por turno.
// Teto de custo (aborta ao atingir). Probe de quota (não executa sem 2xx).
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm run eval:llm-first
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize, PILOT_MODEL } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import { PromptTenantBusinessInfoSource, extractTenantBusinessFacts } from "../src/engine/tenant-business-info.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import type { TurnFrame } from "../src/domain/agent-brain.ts";
import type { CentralTurnCapture } from "./central-assertions.ts";

const MAX_LLM_CALLS = 80;   // 2 conversas × ~10 turnos × ~2 chamadas + probe

// Conversa 1 — financiamento SEM entrada (o agente não pode repetir entrada nem encerrar).
const CONV1 = ["Bom dia", "Douglas", "Gostei desse carro", "Quero financiar", "não tenho entrada", "tenho não",
  "mas quero financiar", "Quanto ficaria mais ou menos?", "Onde fica a loja?", "Quero visitar sábado"];
// Conversa 2 — estoque/foto/mudança de assunto.
const CONV2 = ["Bom dia", "Douglas", "vocês tem SUV?", "gostei do segundo", "manda foto dele",
  "qual carro eu pedi foto?", "onde fica a loja?", "tem Onix?", "queria um popular até 50k", "não quero foto agora"];

const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const has = (s: string, n: string): boolean => norm(s).includes(norm(n));
const qCount = (s: string): number => (s.match(/\?/g) ?? []).length;
const hasMedia = (c: CentralTurnCapture): boolean => c.effects.some((e) => e.kind === "send_media");
const tools = (c: CentralTurnCapture): string[] => c.toolsRequested;
const promisesPhoto = (s: string): boolean => /aqui\s+est[aã]o?\s+as\s+fotos|te\s+(envio|mando|enviei|mandei)\s+(as\s+)?fotos|segue[m]?\s+as\s+fotos/.test(norm(s));

function tableRows(caps: CentralTurnCapture[]): string[] {
  return caps.map((c) => `| ${c.turnIndex} | ${sanitize(c.leadBlock).slice(0, 24)} | ${sanitize(c.response).replace(/\|/g, "\\|").slice(0, 90)} | ${c.toolsRequested.join(",") || "-"} | ${c.effects.map((e) => e.kind).join(",") || "-"} | ${c.reasonCode ?? c.status} | ${c.terminalSafe} | ${c.slotsDelta.map((d) => `${d.slot}=${d.to}`).join(" ").slice(0, 44)} |`);
}
function printConv(title: string, caps: CentralTurnCapture[]): void {
  console.log(`\n== ${title} ==`);
  for (const c of caps) {
    console.log(`T${c.turnIndex} [${sanitize(c.leadBlock)}]`);
    console.log(`   resp: ${sanitize(c.response).slice(0, 170)}`);
    console.log(`   tools=${c.toolsRequested.join(",") || "-"} | effects=${c.effects.map((e) => `${e.kind}${e.vehicleKey ? `(${e.vehicleKey})` : ""}`).join(",") || "-"} | src=${c.responseSource ?? c.reasonCode ?? c.status} | TS=${c.terminalSafe} | steps=${c.brainSteps}`);
    if (c.slotsDelta.length) console.log(`   slotsΔ=${c.slotsDelta.map((d) => `${d.slot}:${d.from}->${d.to}`).join(" ")}`);
    if (c.terminalSafe && c.policyFeedback?.length) console.log(`   ⚠ policyFeedback (por que degradou): ${c.policyFeedback.map((f) => sanitize(f)).join(" || ").slice(0, 300)}`);
  }
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1 (custo + rede OpenAI)."); process.exit(2); }
  loadServiceEnv();
  const startedAt = new Date().toISOString();
  console.log(`== EVAL LLM-FIRST SDR (2 conversas, singleAuthor+llmFirst = central_active, efeitos OFF, teto=${MAX_LLM_CALLS}) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  const businessInfo = new PromptTenantBusinessInfoSource(assembly.runtimeConfig);
  const promptFacts = extractTenantBusinessFacts(assembly.runtimeConfig);
  console.log(`config: promptLen=${assembly.runtimeConfig.promptText.length} promptSha=${assembly.promptSha.slice(0, 16)}… modelo=${PILOT_MODEL} | address=${promptFacts.address.value ? "presente" : "ausente"} hours=${promptFacts.hours.value ? "presente" : "ausente"}`);

  // Probe de quota (1 chamada). Sem 2xx -> bloqueio externo, NÃO executa (custo zero de conversa).
  const probeFrame: TurnFrame = {
    turnId: "probe", now: startedAt, block: "oi", portalPromptSha256: assembly.promptSha,
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [], signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous" },
  };
  try { await stack.brain.proposeNextStep(probeFrame, []); } catch { /* adapter cai em final seguro; a prova é o 2xx */ }
  if (stack.brainTransport.okCount === 0) {
    console.error(`\nBLOQUEIO EXTERNO: sem quota/chave OpenAI (probe ${stack.brainTransport.count}, 2xx=0). NÃO executando.`);
    console.error(`Ação do dono: EVAL_OPENAI_API_KEY=... ou EVAL_USE_PLATFORM_KEY=1 e re-rodar.`);
    process.exit(3);
  }
  console.log(`probe OK: brain 2xx (${stack.brainTransport.okCount}/${stack.brainTransport.count}). Executando…`);

  const opts = { singleAuthor: true, llmFirst: true, businessInfo, maxLlmCalls: MAX_LLM_CALLS } as const;
  const only = process.env.EVAL_ONLY?.trim();   // "2" = re-roda SÓ a conversa que falhou (missão: sem matriz grande)
  const c1 = only === "2" ? [] : await runCentralConversation(assembly, stack, "llmfirst-1", CONV1.map((m) => [m]), opts);
  const c2 = only === "1" ? [] : await runCentralConversation(assembly, stack, "llmfirst-2", CONV2.map((m) => [m]), opts);

  // ── Critérios da missão (heurísticos; violações = observação, não crash) ──────────────────────────────────────
  const V: string[] = [];
  const at = (caps: CentralTurnCapture[], i: number): CentralTurnCapture | undefined => caps.find((c) => c.turnIndex === i);
  // globais
  for (const [tag, caps] of [["C1", c1], ["C2", c2]] as const) {
    for (const c of caps) {
      if (c.status !== "committed") V.push(`${tag} T${c.turnIndex}: status=${c.status}`);
      if (c.terminalSafe) V.push(`${tag} T${c.turnIndex}: technical_fallback/degradado (${c.reasonCode ?? "?"})`);
      if (qCount(c.response) > 1) V.push(`${tag} T${c.turnIndex}: ${qCount(c.response)} perguntas (>1)`);
      if ((c.response || "").includes("�")) V.push(`${tag} T${c.turnIndex}: U+FFFD`);
      if (/revendamais:\S|:\d{6,}/.test(c.response)) V.push(`${tag} T${c.turnIndex}: chave crua na resposta`);
      if (/\bcpf\b/i.test(c.response)) V.push(`${tag} T${c.turnIndex}: pediu CPF (cedo)`);
    }
  }
  // Conversa 1
  { const entradaTurns = [at(c1, 5), at(c1, 6)].filter(Boolean) as CentralTurnCapture[];
    for (const c of entradaTurns) { if (/valor de entrada|de entrada voce|quanto.*entrada/.test(norm(c.response))) V.push(`C1 T${c.turnIndex}: REPETIU pergunta de entrada`); if (c.terminalSafe) V.push(`C1 T${c.turnIndex}: encerrou/degradou em objeção de entrada`); }
    const fin = at(c1, 7); if (fin && !/financ|parcel|entrada zero|simul/.test(norm(fin.response))) V.push(`C1 T7: não continuou o financiamento naturalmente`);
    const loja = at(c1, 9); if (loja && promptFacts.address.value) { const tok = norm(promptFacts.address.value).split(/[\s,]+/).find((w) => w.length >= 4); if (tok && !has(loja.response, tok)) V.push(`C1 T9: não respondeu a loja (endereço do prompt ausente)`); }
    const visita = at(c1, 10); if (visita && !/visit|agend|sab|sáb/.test(norm(JSON.stringify(visita.slotsDelta) + " " + visita.response))) V.push(`C1 T10: não tratou a visita/sábado`);
  }
  // Conversa 2
  { const suv = at(c2, 3); if (suv && !tools(suv).includes("stock_search")) V.push(`C2 T3: não chamou stock_search p/ SUV`);
    const foto = at(c2, 5); if (foto && !hasMedia(foto)) V.push(`C2 T5: não enviou a foto do selecionado`);
    const recall = at(c2, 6); if (recall && hasMedia(recall)) V.push(`C2 T6: reenviou mídia no recall`);
    const loja2 = at(c2, 7); if (loja2 && (hasMedia(loja2) || promisesPhoto(loja2.response))) V.push(`C2 T7: ficou preso em foto na pergunta da loja`);
    const onix = at(c2, 8); if (onix && !tools(onix).includes("stock_search") && !has(onix.response, "onix")) V.push(`C2 T8: não mudou de assunto p/ Onix`);
    const pop = at(c2, 9); const sr = onix ? undefined : undefined; void sr; if (pop && !tools(pop).includes("stock_search")) V.push(`C2 T9: não buscou popular`);
    const neg = at(c2, 10); if (neg && (hasMedia(neg) || promisesPhoto(neg.response))) V.push(`C2 T10: mandou/prometeu foto após 'não quero foto agora'`);
  }

  // ── Relatório ─────────────────────────────────────────────────────────────────────────────────────────────
  const brainCalls = stack.brainTransport.count, composeCalls = stack.composeTransport.count;
  const promptTok = stack.brainTransport.calls.reduce((s, x) => s + (x.promptTokens ?? 0), 0);
  const compTok = stack.brainTransport.calls.reduce((s, x) => s + (x.completionTokens ?? 0), 0);
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const L: string[] = [`# EVAL LLM-first SDR — ${startedAt}`,
    `\n> modelo ${PILOT_MODEL} · singleAuthor+llmFirst (= central_active) · efeitos OFF · sem judge`,
    `> BRAIN ${brainCalls} (2xx=${stack.brainTransport.okCount}) · COMPOSE ${composeCalls} (esperado 0) · prompt-integral=${stack.brainTransport.allPromptExact}`,
    `> tokens: prompt≈${promptTok} completion≈${compTok} · violações=${V.length}`,
    `\n## Conversa 1 — financiamento sem entrada`,
    `| T | lead | resposta | tools | effects | src | TS | slotsΔ |`, `|---|---|---|---|---|---|---|---|`, ...tableRows(c1),
    `\n## Conversa 2 — estoque/foto/mudança de assunto`,
    `| T | lead | resposta | tools | effects | src | TS | slotsΔ |`, `|---|---|---|---|---|---|---|---|`, ...tableRows(c2)];
  if (V.length) { L.push(`\n## Violações`); for (const v of V) L.push(`- ${sanitize(v)}`); } else L.push(`\n## Violações\n- nenhuma`);
  const reportPath = resolve(outDir, `llm-first-sdr-${stamp}.md`);
  writeFileSync(reportPath, L.join("\n"), "utf8");

  printConv("Conversa 1 — financiamento sem entrada", c1);
  printConv("Conversa 2 — estoque/foto/mudança de assunto", c2);
  const totalCalls = brainCalls + composeCalls;
  console.log(`\n== TOTAIS ==`);
  console.log(`OpenAI: ${totalCalls} chamadas (BRAIN ${brainCalls} 2xx=${stack.brainTransport.okCount} · COMPOSE ${composeCalls}) · tokens prompt≈${promptTok} completion≈${compTok} · custo≈US$${((promptTok * 0.4 + compTok * 1.6) / 1e6).toFixed(4)}`);
  console.log(`compose=${composeCalls} (llm-first single-author -> esperado 0) · prompt-integral=${stack.brainTransport.allPromptExact} · turnos=${c1.length}+${c2.length}`);
  console.log(`relatório: eval/reports/llm-first-sdr-${stamp}.md`);
  if (V.length) { console.log(`\nRESULTADO: ${V.length} violação(ões):`); for (const v of V) console.log(`  - ${sanitize(v)}`); }
  else console.log(`\nRESULTADO: PASS (0 violações; LLM real; efeitos OFF)`);
  process.exit(V.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error("ERRO FATAL:", sanitize(String((e as Error)?.message ?? e))); process.exit(1); });
