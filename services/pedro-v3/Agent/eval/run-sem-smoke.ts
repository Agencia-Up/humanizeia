// ============================================================================
// eval/run-sem-smoke.ts — SMOKE REAL da missão SEM (2026-07-10): reproduz a
// CONVERSA REAL do incidente (Aircross → fotos → financiamento → "Não" →
// "Quero financiar ele mesmo / Mas não tenho entrada" → "Até 1200" → "Douglas")
// com gpt-4.1-mini REAL + prompt/estoque reais do piloto. Efeitos OFF (zero
// WhatsApp/CRM). PASS automático pelos invariantes da missão; exit 1 em FAIL.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npx tsx eval/run-sem-smoke.ts
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize, PILOT_MODEL } from "./real-harness.ts";
import { buildCentralStack, runCentralConversation } from "./central-real-harness.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import type { TurnFrame } from "../src/domain/agent-brain.ts";

// Roteiro SEMÂNTICO do incidente por ORDINAL (o estoque real muda; "Gostei do segundo" preserva a
// semântica seleção→"Sim" ambíguo→fotos→financiamento→negações sem depender de um modelo específico).
const STEPS: readonly (readonly string[])[] = [
  ["Boa tarde"],
  ["tem SUV automático?"],
  ["Gostei do segundo"],
  ["Sim"],
  ["Do segundo, quero fotos dele"],
  ["Vocês financiam?"],
  ["Não"],
  ["Quero financiar ele mesmo", "Mas não tenho entrada"],
  ["Até 1200"],
  ["Douglas"],
  ["obrigado!"],
];

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1 (custo + rede OpenAI)."); process.exit(2); }
  loadServiceEnv();
  const maxLlmCalls = Number(process.env.EVAL_MAX_LLM_CALLS ?? "70");
  const startedAt = new Date().toISOString();
  console.log(`== Pedro v3 — SMOKE SEM (conversa real do incidente, teto=${maxLlmCalls}) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  console.log(`config: promptLen=${assembly.runtimeConfig.promptText.length} promptSha=${assembly.promptSha.slice(0, 16)}… modelo=${PILOT_MODEL}`);

  // Probe de quota (padrão do smoke central): sem 2xx não executa.
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

  const runId = `wa:sem-${Date.now().toString(36)}`;
  const steps = process.env.SEM_SMOKE_FAREWELL_ONLY === "1" ? [["obrigado!"]] as const : STEPS;
  const turns = await runCentralConversation(assembly, stack, runId, steps, { maxLlmCalls, singleAuthor: true, llmFirst: true });

  // ── PASS automático (invariantes da missão) ──────────────────────────────
  const problems: string[] = [];
  const acc: Record<string, string> = {};
  for (const t of turns) for (const d of (t.slotsDelta ?? []) as { slot: string; to: string }[]) acc[d.slot] = d.to;
  const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const badSources = turns.filter((t) => t.responseSource === "technical_fallback"
    || (t.responseSource === "deterministic_recovery" && t.turnIndex >= 3));
  if (badSources.length > 0) problems.push(`technical_fallback/recovery em T${badSources.map((t) => t.turnIndex).join(",T")}`);
  const t6 = turns.find((t) => t.turnIndex === 6);
  const askedTradeBeforeNo = !!t6 && /\b(?:carro|veiculo)\b.{0,30}\btroca\b/i.test(norm(t6.response));
  const t7 = turns.find((t) => t.turnIndex === 7);
  if (askedTradeBeforeNo) {
    if (t7?.possuiTrocaAfter !== "false") problems.push(`'Não' não resolveu a pergunta explícita de troca em T7 (veio ${t7?.possuiTrocaAfter ?? "ausente"})`);
  } else {
    const trocaKnown = turns.filter((t) => t.possuiTrocaAfter !== "unknown");
    if (trocaKnown.length > 0) problems.push(`possuiTroca alterada SEM pergunta/resposta de troca em T${trocaKnown.map((t) => t.turnIndex).join(",T")}`);
  }
  const val = (k: string): string => String(acc[k] ?? "");
  if (!/0/.test(val("entrada")) || !val("entrada").includes("known")) problems.push(`entrada esperada known:0, veio ${JSON.stringify(acc.entrada)}`);
  if (!val("parcelaDesejada").includes("1200")) problems.push(`parcela esperada 1200, veio ${JSON.stringify(acc.parcelaDesejada)}`);
  const parcelTurn = turns.find((t) => t.turnIndex === 9);
  if (!parcelTurn || !/\bparcela\w*\b/i.test(norm(parcelTurn.response))) problems.push("T9 não acolheu verbalmente a parcela informada pelo lead");
  if (!norm(val("nome")).includes("douglas")) problems.push(`nome esperado Douglas, veio ${JSON.stringify(acc.nome)}`);
  if (acc.faixaPreco !== undefined) problems.push(`faixaPreco contaminada: ${JSON.stringify(acc.faixaPreco)}`);
  const genericAsk = turns.filter((t) => t.turnIndex >= 3 && /me conta um pouco mais do que/i.test(t.response));
  if (genericAsk.length > 0) problems.push(`resposta genérica de descoberta em T${genericAsk.map((t) => t.turnIndex).join(",T")}`);
  if (stack.composeTransport.count > 0) problems.push(`compose=${stack.composeTransport.count} (esperado 0 em singleAuthor)`);
  // ⭐Codex rodada 2: zero pergunta DUPLA de ação e zero promessa de consultor/transferência sem efeito real.
  const doubleQ = turns.filter((t) => {
    for (const sentence of t.response.split(/(?<=[.!?\n])/)) {
      if (!sentence.trim().endsWith("?")) continue;
      const n = norm(sentence);
      if (!/\bou\b/.test(n)) continue;
      const terms = new Set((n.match(/\bfotos?\b|\bimagens?\b|\bdetalhes?\b|\bcondic\w*\b|\bsimulac\w*\b|\bvalores\b|\bprecos?\b|\bvisita\b|\bagendar\b|\bproposta\b|\bconsultor\b|\bvendedor\b/g) ?? []).map((x) => x.replace(/s$/, "")));
      if (terms.size >= 2) return true;
    }
    return false;
  });
  if (doubleQ.length > 0) problems.push(`pergunta DUPLA de ação em T${doubleQ.map((t) => t.turnIndex).join(",T")}`);
  const handoffPromise = turns.filter((t) => {
    const n = norm(t.response);
    return /\b(?:consultor|vendedor|especialista|atendente|equipe)\b/.test(n)
      && (/\b(?:chamar|chamo|chamando|acionar|encaminh\w*|transferir|direcionar|repassar)\b/.test(n) || /\bvai\s+(?:te\s+)?(?:atender|chamar|entrar\s+em\s+contato)\b/.test(n))
      && !t.effects.some((e) => e.kind === "handoff" || e.kind === "notify_seller");
  });
  if (handoffPromise.length > 0) problems.push(`promessa de consultor SEM efeito em T${handoffPromise.map((t) => t.turnIndex).join(",T")}`);
  const farewellTurns = turns.filter((t) => /\b(?:obrigad[oa]|valeu)\b/i.test(norm(t.leadBlock)));
  const badFarewell = farewellTurns.filter((t) => t.response.includes("?")
    || /\b(?:troca|entrada|parcela|telefone|cpf|whatsapp|qual\s+(?:seu\s+)?nome|modelo|tipo\s+de\s+carro|agendar|visita)\b/i.test(norm(t.response))
    || !/^brain_(?:final|retry)$/.test(t.responseSource ?? ""));
  if (badFarewell.length > 0) problems.push(`despedida reabriu funil/não foi autorada pela LLM em T${badFarewell.map((t) => t.turnIndex).join(",T")}`);
  const duplicatePhotoExecutions = turns.filter((t) => t.observations.filter((o) => o.tool === "vehicle_photos_resolve" && o.ok).length > 1);
  if (duplicatePhotoExecutions.length > 0) problems.push(`vehicle_photos_resolve EXECUTADA mais de uma vez no turno T${duplicatePhotoExecutions.map((t) => t.turnIndex).join(",T")}`);
  const photoRequestLoops = turns.filter((t) => t.toolsRequested.filter((x) => x === "vehicle_photos_resolve").length > 3);
  if (photoRequestLoops.length > 0) problems.push(`cérebro insistiu em vehicle_photos_resolve (>3 pedidos) em T${photoRequestLoops.map((t) => t.turnIndex).join(",T")}`);
  const acceptedPhotoTurn = turns.find((t) => t.turnIndex === 4);
  if (!acceptedPhotoTurn || !/^brain_(?:final|retry)$/.test(acceptedPhotoTurn.responseSource ?? "")
      || !acceptedPhotoTurn.effects.some((e) => e.kind === "send_media")) {
    problems.push(`aceite curto de fotos não foi decidido pela LLM com send_media em T4 (source=${acceptedPhotoTurn?.responseSource ?? "ausente"})`);
  }
  const wrongEntryAck = turns.filter((t) => /^nao$/i.test(norm(t.leadBlock).trim())
    && (/\b(?:anotei|anotad[oa]|registrei|entendi)\b.{0,45}\bentrada\b/i.test(norm(t.response)) || /\bvoce\b.{0,40}\btem\b.{0,20}\bentrada\b/i.test(norm(t.response)))
    && !/\b(?:nao|sem|zero)\b.{0,20}\bentrada\b/i.test(norm(t.response)));
  if (wrongEntryAck.length > 0) problems.push(`resposta contradiz entrada=0 em T${wrongEntryAck.map((t) => t.turnIndex).join(",T")}`);
  const inventedTradeText = turns.filter((t) => {
    if (t.possuiTrocaAfter !== "unknown") return false;
    return norm(t.response).split(/[.!?\n]+/).some((clause) =>
      /\b(?:sem|nao\s+(?:tem|possui))\b.{0,25}\b(?:carro|veiculo)\b.{0,20}\btroca\b/i.test(clause));
  });
  if (inventedTradeText.length > 0) problems.push(`resposta afirmou troca inexistente sem fato em T${inventedTradeText.map((t) => t.turnIndex).join(",T")}`);
  const focusOk = turns.some((t) => t.turnIndex >= 3 && (t.resolvedVehicleKey != null || (t.slotsDelta ?? []).some((d: { slot: string }) => d.slot === "interesse")))
    || acc.interesse !== undefined;
  if (!focusOk) problems.push("seleção por ordinal não registrou foco/interesse em nenhum turno");
  const verdict = problems.length === 0 ? "PASS" : "FAIL";

  // ── Relatório (tabela pedida pela missão) ──
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const L: string[] = [
    `# Pedro v3 — SMOKE SEM (conversa real do incidente) — ${verdict}`,
    `\n> ${startedAt} · modelo ${PILOT_MODEL} · BRAIN ${stack.brainTransport.count} chamadas (2xx=${stack.brainTransport.okCount}) · COMPOSE ${stack.composeTransport.count} · prompt integral=${stack.brainTransport.allPromptExact}`,
    `\n| T | Lead | Resposta | Intent | Tools | Effects | possuiTroca | responseSource |`,
    `|---|---|---|---|---|---|---|---|`,
  ];
  for (const t of turns) {
    L.push(`| ${t.turnIndex} | ${sanitize(t.leadBlock).slice(0, 60)} | ${sanitize(t.response).replace(/\|/g, "\\|").slice(0, 110)} | ${t.primaryIntent ?? "-"} | ${t.toolsRequested.join(",") || "-"} | ${t.effects.map((e) => e.kind).join(",") || "-"} | ${t.possuiTrocaBefore}→${t.possuiTrocaAfter} | ${t.responseSource ?? t.status} |`);
  }
  L.push(`\n**Slots acumulados:** ${sanitize(JSON.stringify(acc)).slice(0, 400)}`);
  L.push(`\n**Veredito: ${verdict}**${problems.length ? `\n\nProblemas:\n${problems.map((p) => `- ${p}`).join("\n")}` : " — todos os invariantes da missão atendidos."}`);
  const file = resolve(outDir, `sem-smoke-${stamp}.md`);
  writeFileSync(file, L.join("\n"), "utf8");
  console.log(`\nrelatorio: eval/reports/sem-smoke-${stamp}.md`);
  console.log(`BRAIN=${stack.brainTransport.count} COMPOSE=${stack.composeTransport.count} veredito=${verdict}`);
  for (const t of turns) console.log(`T${t.turnIndex} [${t.responseSource ?? t.status}] troca=${t.possuiTrocaAfter} selected=${t.selectedVehicleKeyAfter ?? "-"} :: ${sanitize(t.response).slice(0, 100)}`);
  for (const t of turns) if ((t.policyFeedback ?? []).length > 0) console.log(`T${t.turnIndex} FEEDBACKS: ${(t.policyFeedback ?? []).map((f) => f.slice(0, 90)).join(" || ")}`);
  if (problems.length) { for (const p of problems) console.error(`PROBLEMA: ${p}`); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
