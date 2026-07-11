// ============================================================================
// eval/run-pii-smoke.ts — SMOKE REAL da MISSÃO PII (2026-07-11): reproduz o
// incidente (CPF/data → parcela corrompida + "só transfiro com CPF") com
// gpt-4.1-mini REAL + prompt/estoque reais. EFEITOS OFF (zero WhatsApp/CRM;
// handoff plannable FAKE — NENHUM vendedor real é notificado). CPF/data
// SINTÉTICOS (111.444.777-35 / 01/10/1990) — o relatório mascara qualquer run
// de dígitos por precaução.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npx tsx eval/run-pii-smoke.ts
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, PILOT_MODEL } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import type { TurnFrame } from "../src/domain/agent-brain.ts";

const STEPS: readonly (readonly string[])[] = [
  ["Quero um popular até 80 mil"],
  ["Gostei do segundo"],
  ["Tenho um Palio 2012, 70 mil km"],
  ["Não tenho entrada"],
  ["Parcela até 1200"],
  ["Douglas"],
  ["CPF 111.444.777-35"],      // T7: CPF SINTETICO valido, explicitamente tipado pelo lead
  ["data de nascimento: 01/10/1990"], // T8: nascimento SINTETICO explicitamente tipado
  ["Quero falar com um atendente"],  // T9: pedido explícito de humano
];
const FAKE_LEAD_ID = "33333333-3333-4333-8333-333333333333";
const maskDigits = (s: string): string => String(s ?? "").replace(/(\d{2})\d{2,}/g, "$1**");

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1 (custo + rede OpenAI)."); process.exit(2); }
  loadServiceEnv();
  const maxLlmCalls = Number(process.env.EVAL_MAX_LLM_CALLS ?? "60");
  const startedAt = new Date().toISOString();
  console.log(`== Pedro v3 — SMOKE PII (CPF/data + atendente, teto=${maxLlmCalls}) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  console.log(`config: promptLen=${assembly.runtimeConfig.promptText.length} promptSha=${assembly.promptSha.slice(0, 16)}… modelo=${PILOT_MODEL}`);

  const probeFrame: TurnFrame = {
    turnId: "probe", now: startedAt, block: "oi", portalPromptSha256: assembly.promptSha,
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [], signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous" },
  } as TurnFrame;
  try { await stack.brain.proposeNextStep(probeFrame, []); } catch { /* prova é o 2xx no transporte */ }
  if (stack.brainTransport.okCount === 0) {
    console.error("BLOQUEIO EXTERNO: sem quota OpenAI (probe 2xx=0). Não executando.");
    process.exit(3);
  }

  const runId = `wa:pii-${Date.now().toString(36)}`;
  const turns = await runCentralConversation(assembly, stack, runId, STEPS, {
    maxLlmCalls, singleAuthor: true, llmFirst: true,
    // handoff FAKE plannable (efeitos OFF — nunca notifica vendedor real) + lead sintético p/ o gate.
    crmLeadId: FAKE_LEAD_ID,
    handoff: {
      enabled: true, available: true,
      precheck: { flagEnabled: true, crmEnabled: true, leadBound: true, configLoaded: true, portalTransferEnabled: true, scopedSellerCount: 0, tenantFallbackSellerCount: 1, validPhoneSellerCount: 1, available: true, unavailableReason: null, stepError: null },
    },
  });

  // ── PASS automático (critérios da missão) ────────────────────────────────
  const problems: string[] = [];
  const acc: Record<string, string> = {};
  for (const t of turns) for (const d of (t.slotsDelta ?? []) as { slot: string; to: string }[]) acc[d.slot] = d.to;

  if (!/1200/.test(acc.parcelaDesejada ?? "")) problems.push(`parcelaDesejada final != 1200 (=${acc.parcelaDesejada ?? "∅"})`);
  const parcelaCorrupted = turns.some((t) => (t.slotsDelta ?? []).some((d) => d.slot === "parcelaDesejada" && !/1200/.test(d.to)));
  if (parcelaCorrupted) problems.push("parcelaDesejada foi sobrescrita por valor != 1200 em algum turno (data->parcela?)");
  if (!/known/.test(acc.cpf ?? "")) problems.push(`cpf não reconhecido como ref (=${acc.cpf ?? "∅"})`);
  if (/douglas/i.test(acc.interesse ?? "")) problems.push("nome do lead contaminou o interesse comercial");
  for (const idx of [7, 8]) {
    const turn = turns.find((t) => t.turnIndex === idx);
    if (!/receb|anot|registr|confirm/i.test(turn?.response ?? "")) problems.push(`T${idx} ignorou o dado sensivel recebido`);
  }

  const badSources = turns.filter((t) => t.responseSource === "technical_fallback" || t.responseSource === "deterministic_recovery");
  if (badSources.length > 0) problems.push(`technical_fallback/recovery em T${badSources.map((t) => t.turnIndex).join(",T")}`);
  const compose = turns.reduce((n, t) => n + (t.llmCallsInTurn ?? 0), 0) - turns.reduce((n, t) => n + (t.brainSteps > 0 ? t.llmCallsInTurn : 0), 0);
  const commercialLate = turns.filter((t) => t.turnIndex >= 7 && (t.toolsRequested ?? []).some((x) => x === "stock_search" || x === "vehicle_details" || x === "vehicle_photos_resolve"));
  if (commercialLate.length > 0) problems.push(`tool comercial em turno de CPF/data/handoff: T${commercialLate.map((t) => t.turnIndex).join(",T")}`);

  const t9 = turns.find((t) => t.turnIndex === 9);
  const handoffPlanned = (t9?.effects ?? []).some((e) => e.kind === "handoff") && (t9?.effects ?? []).some((e) => e.kind === "notify_seller");
  if (!handoffPlanned) problems.push(`T9 NÃO planejou handoff+notify (effects=${JSON.stringify(t9?.effects ?? [])})`);
  if (t9?.handoffReason !== "explicit_human_request") problems.push(`T9 reason != explicit_human_request (=${t9?.handoffReason ?? "∅"})`);
  const cpfHostage = turns.some((t) => /s[óo] consigo te (passar|transferir)|depois que voc[êe] me passar o cpf/i.test(t.response ?? ""));
  if (cpfHostage) problems.push("resposta condicionou a transferência a CPF (invariante 9 violado)");
  const leak = turns.some((t) => /\d{5,}/.test(t.response ?? "") && /11144477735|444777|1990/.test(t.response ?? ""));
  if (leak) problems.push("resposta vazou dígitos de CPF/nascimento");
  const badFinal = turns.filter((t) => t.status !== "committed");
  if (badFinal.length > 0) problems.push(`turnos não commitados: T${badFinal.map((t) => t.turnIndex).join(",T")}`);
  const nonBrain = turns.filter((t) => t.responseSource && !/^brain_(final|retry)$|^deterministic_(institutional|photo)$/.test(t.responseSource));
  if (nonBrain.length > 0) problems.push(`responseSource fora de brain_final/brain_retry: ${nonBrain.map((t) => `T${t.turnIndex}=${t.responseSource}`).join(", ")}`);

  // ── Relatório integral por turno (dígitos mascarados) ────────────────────
  const lines: string[] = [];
  lines.push(`# SMOKE PII — ${startedAt}`);
  lines.push(`modelo=${PILOT_MODEL} promptSha=${assembly.promptSha.slice(0, 16)}… llmCalls=${stack.brainTransport.count + stack.composeTransport.count} (brain=${stack.brainTransport.count}, compose=${stack.composeTransport.count})`);
  lines.push("");
  for (const t of turns) {
    lines.push(`## T${t.turnIndex} — lead: ${maskDigits(t.leadBlock)}`);
    lines.push(`resposta: ${maskDigits(t.response)}`);
    lines.push(`status=${t.status} source=${t.responseSource ?? "∅"} intent=${t.primaryIntent ?? "∅"} tools=[${(t.toolsRequested ?? []).join(",")}] effects=${JSON.stringify(t.effects ?? [])}`);
    lines.push(`slotsDelta=${JSON.stringify((t.slotsDelta ?? []).map((d: { slot: string; from: string; to: string }) => ({ ...d, from: maskDigits(d.from), to: maskDigits(d.to) })))}`);
    if (t.policyFeedback?.length) lines.push(`policyFeedback=${t.policyFeedback.map((f) => maskDigits(f)).join(" | ")}`);
    if (t.handoffBriefing) lines.push(`briefing:\n${maskDigits(t.handoffBriefing)}`);
    lines.push("");
  }
  lines.push(`## Slots finais: ${maskDigits(JSON.stringify(acc))}`);
  lines.push(problems.length === 0 ? "## VEREDITO: PASS" : `## VEREDITO: FAIL\n- ${problems.join("\n- ")}`);

  const dir = resolve(dirname(fileURLToPath(import.meta.url)), "reports");
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `pii-smoke-${startedAt.replace(/[:.]/g, "-")}.md`);
  writeFileSync(file, lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
  console.log(`\nrelatório: ${file}`);
  process.exit(problems.length === 0 ? 0 : 1);
}

void main();
