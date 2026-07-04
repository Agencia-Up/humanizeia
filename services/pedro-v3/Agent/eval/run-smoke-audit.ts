// ============================================================================
// eval/run-smoke-audit.ts — SMOKE conversacional REAL da AUTORIA ÚNICA (audit Codex 3ª rodada).
// UMA conversa (11 turnos), UMA execução, gpt-4.1-mini REAL, prompt/estoque/config REAIS (read-only), central engine
// + WorkingMemory REAIS, EffectGate OFF (zero WhatsApp/CRM/handoff/mídia real), singleAuthor=true, SEM judge.
// Teto ABSOLUTO de 30 chamadas OpenAI (aborta ao atingir). Assertivas determinísticas por turno.
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm run smoke:audit
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RealClock } from "../src/runtime/real-clock.ts";
import { loadServiceEnv, buildRealAssembly, sanitize, PILOT_MODEL, PILOT_TENANT, PILOT_AGENT } from "./real-harness.ts";
import { buildCentralStack, CENTRAL_LIMITS, CENTRAL_ALLOWED_TOOLS } from "./central-real-harness.ts";
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome } from "../src/engine/central-engine.ts";
import { PromptTenantBusinessInfoSource, extractTenantBusinessFacts } from "../src/engine/tenant-business-info.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { loadPersistedWorkingMemory } from "../src/engine/working-memory.ts";
import { InMemoryPersistence, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { AgentBrainPort, AgentBrainStep, AgentToolObservation, TurnFrame, CentralQueryCall } from "../src/domain/agent-brain.ts";
import type { EffectReceipt, EffectResult, QueryCall } from "../src/domain/decision.ts";
import type { VehicleFact } from "../src/domain/types.ts";

const CONVERSATION = [
  "Bom dia",
  "Ele tem quantos km?",
  "Quero um SUV automático até 90 mil",
  "Gostei do segundo",
  "Ele tem quantos km e qual é a cor?",
  "Manda as fotos dele",
  "Qual carro eu pedi as fotos?",
  "Onde fica a loja e qual o horário?",
  "Tem outras opções automáticas até 90 mil?",
  "Meu nome é Douglas e não tenho carro para troca",
  "Quero visitar sábado",
];
const MAX_LLM_CALLS = 30;

type ToolReq = { tool: string; input: Record<string, unknown> };
type Cap = {
  i: number; lead: string; outboxText: string;
  toolReqs: ToolReq[]; observations: { tool: string; ok: boolean; vehicle?: VehicleFact; storeTopic?: string; storeValue?: string | null; itemKeys?: string[] }[];
  institutional: { topic: string; status: string }[];
  selectedKey: string | null; offerItems: { ordinal: number; vehicleKey: string }[]; offerFresh: boolean;
  responseSource: string; degraded: boolean; terminalSafe: boolean; reasonCode: string; status: string;
  slots: Record<string, string>; hasSendMedia: boolean; brainCallsInTurn: number; composeCallsInTurn: number;
};

class RecordingBrain implements AgentBrainPort {
  reqs: ToolReq[] = [];
  constructor(private readonly inner: AgentBrainPort) {}
  reset(): void { this.reqs = []; }
  async proposeNextStep(frame: TurnFrame, obs: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    const step = await this.inner.proposeNextStep(frame, obs);
    if (step.kind === "query") { const c = step.call as CentralQueryCall; this.reqs.push({ tool: c.tool, input: { ...(c as { input?: Record<string, unknown> }).input } }); }
    return step;
  }
}
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function slotSummary(state: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const slots = (state as { slots?: Record<string, { status?: string; value?: unknown }> })?.slots ?? {};
  for (const k of Object.keys(slots)) { const s = slots[k]; if (s?.status && s.status !== "unknown") out[k] = `${s.status}:${JSON.stringify(s.value ?? null)}`; }
  return out;
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") { console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1 (custo + rede OpenAI)."); process.exit(2); }
  loadServiceEnv();
  const startedAt = new Date().toISOString();
  console.log(`== SMOKE AUTORIA ÚNICA (11 turnos, 1 execução, teto=${MAX_LLM_CALLS} chamadas, singleAuthor) ${startedAt} ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);
  console.log(`config: promptLen=${assembly.runtimeConfig.promptText.length} promptSha=${assembly.promptSha.slice(0, 16)}… modelo=${PILOT_MODEL}`);
  const promptFacts = extractTenantBusinessFacts(assembly.runtimeConfig);
  console.log(`business facts do prompt: address=${promptFacts.address.value ? "presente" : "ausente"} hours=${promptFacts.hours.value ? "presente" : "ausente"} (fonte=PromptTenantBusinessInfoSource, = produção)`);

  // ── Probe de quota (1 chamada mínima). Sem 2xx -> bloqueio externo, NÃO executa. ──
  const probeFrame: TurnFrame = {
    turnId: "probe", now: startedAt, block: "oi", portalPromptSha256: assembly.promptSha,
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [], signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous" },
  };
  try { await stack.brain.proposeNextStep(probeFrame, []); } catch { /* o adapter cai em final seguro; a prova é o 2xx no transporte */ }
  if (stack.brainTransport.okCount === 0) {
    console.error(`\nBLOQUEIO EXTERNO: sem quota OpenAI (probe ${stack.brainTransport.count} chamada(s), 2xx=0). NÃO executando.`);
    console.error(`Ação do dono: usar chave OpenAI com saldo (EVAL_OPENAI_API_KEY ou EVAL_USE_PLATFORM_KEY=1) e re-rodar.`);
    process.exit(3);
  }
  console.log(`probe OK: brain 2xx (${stack.brainTransport.okCount}/${stack.brainTransport.count}). Executando o smoke (a probe conta no teto)…`);

  // ── Driver: singleAuthor=true; efeitos OFF; simula receipt accepted (SEM dispatch real). ──
  const base = { ms: Date.parse("2026-07-01T09:00:00.000Z") };
  const clock = { now: () => new Date(base.ms).toISOString() };
  const persistence = new InMemoryPersistence(clock as never, new FakeIdGen());
  // FIDELIDADE (correção pós-smoke): usa a MESMA fonte da produção (pilot-active-root) — extrai endereço/horário do
  // prompt do portal (PromptTenantBusinessInfoSource), não o RuntimeConfigBusinessInfoSource (que devolve sempre null).
  const businessInfo = new PromptTenantBusinessInfoSource(assembly.runtimeConfig);
  const convId = "smoke-audit";
  { const seed = persistence.begin(); seed.casState(convId, 0, createInitialState({ conversationId: convId, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, leadId: null, now: clock.now() })); if (!(await seed.commit()).ok) throw new Error("seed_failed"); }
  const recordingBrain = new RecordingBrain(stack.brain);
  const caps: Cap[] = [];
  let stoppedByCap = false;

  for (let i = 0; i < CONVERSATION.length; i++) {
    const total = stack.brainTransport.count + stack.composeTransport.count;
    if (total >= MAX_LLM_CALLS) { console.log(`[smoke] teto de ${MAX_LLM_CALLS} chamadas atingido (${total}); abortando antes do turno ${i + 1}.`); stoppedByCap = true; break; }
    const lead = CONVERSATION[i];
    await persistence.tryInsert({ eventId: `${convId}-e${i + 1}`, conversationId: convId, raw: redact({ text: lead }) as never, receivedAt: clock.now() });
    base.ms += 1_000;
    const turnId = `${convId}-t${i + 1}`;
    recordingBrain.reset();
    const brainBefore = stack.brainTransport.count, composeBefore = stack.composeTransport.count;
    const r = await runCentralConversationTurn({
      persistence, clock: clock as never, brain: recordingBrain, llm: stack.composeLlm, runQuery: assembly.runQuery, businessInfo,
      contextPreparer: assembly.contextPreparer, conversationId: convId, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, leadId: null,
      workerId: "smoke-audit", turnId, leaseTtlMs: 120_000, portalPromptSha256: assembly.promptSha,
      limits: CENTRAL_LIMITS, maxValidationAttempts: 3, brainMaxSteps: 4, allowedTools: [...CENTRAL_ALLOWED_TOOLS],
      providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true,
    });
    // Simula receipt accepted (commitEffectOutcome REAL + promoção accepted-safe da WM). SEM dispatch externo.
    while (true) {
      const claimed = await persistence.claimOutbox(convId, "smoke-audit", 120_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock: clock as never, conversationId: convId, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
      }
    }
    const after = (await persistence.load(convId))?.state;
    const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; payload?: { text?: string; vehicleKey?: string } }[];
    const outboxText = outbox.find((o) => o.kind === "send_message")?.payload?.text ?? "";
    const obs = (r.status === "committed" ? r.toolObservations : []).map((o) => ({
      tool: o.tool, ok: o.ok,
      vehicle: o.ok && o.tool === "vehicle_details" ? o.data.vehicle : undefined,
      storeTopic: o.ok && o.tool === "tenant_business_info" ? o.data.topic : undefined,
      storeValue: o.ok && o.tool === "tenant_business_info" ? o.data.value : undefined,
      itemKeys: o.ok && o.tool === "stock_search" ? o.data.items.map((v) => v.vehicleKey) : undefined,
    }));
    caps.push({
      i: i + 1, lead, outboxText,
      toolReqs: [...recordingBrain.reqs], observations: obs,
      institutional: r.status === "committed" ? [...r.institutionalResolved] : [],
      selectedKey: (after as { vehicleContext?: { selected?: { key?: string } } } | undefined)?.vehicleContext?.selected?.key ?? null,
      offerItems: (after?.lastRenderedOfferContext?.items ?? []).map((it) => ({ ordinal: it.ordinal, vehicleKey: it.vehicleKey })),
      offerFresh: (after?.lastRenderedOfferContext as { sourceTurnId?: string } | undefined)?.sourceTurnId === turnId,
      responseSource: r.status === "committed" ? r.responseSource : r.status,
      degraded: r.status === "committed" ? r.degraded : false,
      terminalSafe: r.status === "committed" ? r.terminalSafe : false,
      reasonCode: r.status === "committed" ? r.decision.reasonCode : r.status,
      status: r.status, slots: slotSummary(after),
      hasSendMedia: outbox.some((o) => o.kind === "send_media"),
      brainCallsInTurn: stack.brainTransport.count - brainBefore, composeCallsInTurn: stack.composeTransport.count - composeBefore,
    });
    base.ms += 30_000;
    await new Promise((res) => setTimeout(res, 1500)); // pacing anti rate-limit
  }

  // ── ASSERTIVAS ────────────────────────────────────────────────────────────────────────────────────────────
  const V: string[] = [];
  const fail = (turn: number, msg: string): void => { V.push(`T${turn}: ${msg}`); };
  const has = (s: string, needle: string): boolean => norm(s).includes(norm(needle));
  const qCount = (s: string): number => (s.match(/\?/g) ?? []).length;
  const c = (n: number): Cap | undefined => caps.find((x) => x.i === n);
  const stockReq = (cap: Cap | undefined): ToolReq | undefined => cap?.toolReqs.find((t) => t.tool === "stock_search");

  if (!stoppedByCap && caps.length === 11) {
    // Globais
    if (stack.composeTransport.count !== 0) fail(0, `DecisionLlm.compose foi chamado ${stack.composeTransport.count}x (esperado 0)`);
    if (!stack.brainTransport.allPromptExact) fail(0, "prompt do portal NÃO integral em toda chamada do brain (SHA/match)");
    for (const cap of caps) {
      if (cap.degraded || cap.responseSource === "technical_fallback") fail(cap.i, `technical_fallback/degraded (${cap.responseSource})`);
      if (cap.terminalSafe) fail(cap.i, "terminal_safe");
      if (cap.status !== "committed") fail(cap.i, `status=${cap.status}`);
      if ((cap.outboxText || "").includes("�")) fail(cap.i, "U+FFFD na resposta");
      if (qCount(cap.outboxText) > 1) fail(cap.i, `${qCount(cap.outboxText)} perguntas (>1)`);
    }
    // T2: sem veículo selecionado -> zero vehicle_details arbitrário.
    if (c(2)?.toolReqs.some((t) => t.tool === "vehicle_details")) fail(2, "consultou vehicle_details sem veículo selecionado (arbitrário)");
    if (c(2)?.selectedKey) fail(2, `selecionou um veículo (${c(2)!.selectedKey}) sem o lead pedir`);
    // T3: stock_search com tipo=suv, cambio=automatic, precoMax<=90000.
    { const sr = stockReq(c(3)); const inp = sr?.input ?? {};
      if (!sr) fail(3, "não chamou stock_search");
      else { if (norm(String(inp.tipo ?? "")) !== "suv") fail(3, `tipo != suv (${JSON.stringify(inp.tipo)})`);
        if (norm(String(inp.cambio ?? "")) !== "automatic") fail(3, `cambio != automatic (${JSON.stringify(inp.cambio)})`);
        if (typeof inp.precoMax !== "number" || inp.precoMax > 90000) fail(3, `precoMax != <=90000 (${JSON.stringify(inp.precoMax)})`); } }
    // T4: seleciona EXATAMENTE o segundo item ofertado no T3.
    { const offer = c(3)?.offerItems ?? []; const second = offer[1]?.vehicleKey;
      if (!second) fail(4, "T3 não ofertou 2 itens");
      else if (c(4)?.selectedKey !== second) fail(4, `selecionou ${c(4)?.selectedKey} != 2º ofertado ${second}`); }
    // T5: vehicle_details do MESMO selecionado + responde km/cor reais.
    { const sel = c(4)?.selectedKey ?? c(5)?.selectedKey; const vd = c(5)?.toolReqs.find((t) => t.tool === "vehicle_details");
      const veh = c(5)?.observations.find((o) => o.tool === "vehicle_details" && o.ok)?.vehicle;
      if (!vd || (vd.input as { vehicleKey?: string }).vehicleKey !== sel) fail(5, `vehicle_details não foi do selecionado (${JSON.stringify(vd?.input)} vs ${sel})`);
      if (veh) { if (veh.km != null && !has(c(5)!.outboxText, veh.km.toLocaleString("pt-BR"))) fail(5, `km real ${veh.km} ausente na resposta`);
        if (veh.cor && !has(c(5)!.outboxText, String(veh.cor).split(/\s+/)[0])) fail(5, `cor real ${veh.cor} ausente na resposta`); }
      else fail(5, "sem fato vehicle_details real p/ conferir km/cor"); }
    // T6: resolve fotos do selecionado + send_media materializado (nunca despachado — harness sem dispatcher).
    { const sel = c(5)?.selectedKey; const ph = c(6)?.toolReqs.find((t) => t.tool === "vehicle_photos_resolve");
      const phKey = (ph?.input as { vehicleKey?: string; vehicleRef?: { key?: string } })?.vehicleKey ?? (ph?.input as { vehicleRef?: { key?: string } })?.vehicleRef?.key;
      if (!ph) fail(6, "não resolveu fotos");
      else if (phKey !== sel) fail(6, `fotos de ${phKey} != selecionado ${sel}`);
      if (!c(6)?.hasSendMedia) fail(6, "não materializou send_media"); }
    // T7: nomeia o veículo, SEM tool e SEM send_media.
    { const veh = c(5)?.observations.find((o) => o.tool === "vehicle_details" && o.ok)?.vehicle;
      if (c(7)?.toolReqs.length) fail(7, `chamou tool(s): ${c(7)!.toolReqs.map((t) => t.tool).join(",")}`);
      if (c(7)?.hasSendMedia) fail(7, "reenviou send_media");
      if (veh && !has(c(7)!.outboxText, veh.modelo)) fail(7, `não nomeou o veículo (${veh.marca} ${veh.modelo}) na resposta`); }
    // T8 (endurecida): resolve address E hours (terminal); se ambos existem no prompt -> texto com AMBOS; ausente ->
    // declaração honesta SÓ daquele tópico; resposta só-com-endereço NÃO passa; sem degradado.
    { const inst = c(8)?.institutional ?? [];
      const addrStatus = inst.find((x) => x.topic === "address")?.status;
      const hoursStatus = inst.find((x) => x.topic === "hours")?.status;
      if (!addrStatus) fail(8, "não resolveu tenant_business_info(address) [observação terminal ausente]");
      if (!hoursStatus) fail(8, "não resolveu tenant_business_info(hours) [observação terminal ausente]");
      const text = c(8)?.outboxText ?? "";
      const honestAbout = (kw: string): boolean => new RegExp(`(nao|não|sem)[^.]{0,40}${kw}|${kw}[^.]{0,40}(nao|não|confirm|verific|indispon)`).test(norm(text));
      const promptAddr = promptFacts.address.value, promptHours = promptFacts.hours.value;
      const addrTok = promptAddr ? norm(promptAddr).split(/[\s,]+/).filter((w) => w.length >= 4)[0] : null;
      const hoursTok = promptHours ? (norm(promptHours).match(/\d{1,2}\s*h/)?.[0] ?? norm(promptHours).split(/[\s,]+/).filter((w) => w.length >= 3)[0]) : null;
      if (promptAddr) { if (addrTok && !has(text, addrTok)) fail(8, `endereço existe no prompt mas não está na resposta (${promptAddr})`); }
      else if (!honestAbout("endereco")) fail(8, "endereço ausente sem declaração honesta");
      if (promptHours) { if (hoursTok && !has(text, hoursTok)) fail(8, `horário existe no prompt mas não está na resposta (${promptHours})`); }
      else if (!honestAbout("horario")) fail(8, "horário ausente sem declaração honesta");
      if (c(8)?.degraded) fail(8, "institucional NÃO deve degradar (NOT_CONFIGURED é terminal, responde honesto)"); }
    // T9: mantém filtros + excludeKeys dos ofertados + não repete lista.
    { const sr = stockReq(c(9)); const inp = (sr?.input ?? {}) as { tipo?: string; cambio?: string; precoMax?: number; excludeKeys?: string[] };
      const prevKeys = new Set((c(3)?.offerItems ?? []).map((o) => o.vehicleKey));
      if (!sr) fail(9, "não chamou stock_search");
      else { if (norm(String(inp.cambio ?? "")) !== "automatic") fail(9, "não manteve cambio=automatic");
        if (typeof inp.precoMax !== "number" || inp.precoMax > 90000) fail(9, "não manteve precoMax<=90000");
        if (!Array.isArray(inp.excludeKeys) || ![...prevKeys].some((k) => inp.excludeKeys!.includes(k))) fail(9, `não excluiu os ofertados (excludeKeys=${JSON.stringify(inp.excludeKeys)})`);
        // "não repetir": só falha se ESTE turno renderou uma NOVA lista (offerFresh) cujos itens já foram ofertados.
        // Se não há novos itens (honesto "não temos mais") o contexto de oferta anterior fica no estado -> não conta.
        const newOffer = c(9)?.offerFresh ? (c(9)?.offerItems ?? []) : []; if (newOffer.length && newOffer.every((o) => prevKeys.has(o.vehicleKey))) fail(9, "repetiu a MESMA lista"); } }
    // T10: persiste nome=Douglas + possuiTroca=false.
    { const s = c(10)?.slots ?? {}; if (!has(JSON.stringify(s.nome ?? ""), "douglas")) fail(10, `nome não persistido (${s.nome})`);
      if (!/false/.test(s.possuiTroca ?? "")) fail(10, `possuiTroca != false (${s.possuiTroca})`); }
    // T11: reconhece intenção de visita + sábado.
    { const s = c(11)?.slots ?? {}; const blob = norm(JSON.stringify(s) + " " + (c(11)?.reasonCode ?? ""));
      if (!/visit|agend|diahorario|interessevisita/.test(blob) && !has(c(11)?.outboxText ?? "", "sábado")) fail(11, `não reconheceu visita/sábado (slots=${JSON.stringify(s)})`);
      if (!/sab/.test(blob) && !has(c(11)?.outboxText ?? "", "sáb")) fail(11, "não registrou sábado"); }
  } else {
    fail(0, stoppedByCap ? `smoke incompleto: parou no teto de ${MAX_LLM_CALLS} chamadas (${caps.length}/11 turnos)` : `smoke incompleto (${caps.length}/11 turnos)`);
  }

  // ── Relatório ─────────────────────────────────────────────────────────────────────────────────────────────
  const brainCalls = stack.brainTransport.count, composeCalls = stack.composeTransport.count;
  const promptTok = stack.brainTransport.calls.reduce((s, x) => s + (x.promptTokens ?? 0), 0);
  const compTok = stack.brainTransport.calls.reduce((s, x) => s + (x.completionTokens ?? 0), 0);
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-");
  const L: string[] = [`# SMOKE Autoria Única (audit) — ${startedAt}`,
    `\n> modelo ${PILOT_MODEL} · singleAuthor · efeitos OFF · sem judge · teto ${MAX_LLM_CALLS}`,
    `> BRAIN ${brainCalls} (2xx=${stack.brainTransport.okCount}) · COMPOSE ${composeCalls} · prompt-integral=${stack.brainTransport.allPromptExact} · promptSha=${assembly.promptSha.slice(0, 16)}…`,
    `> tokens: prompt≈${promptTok} completion≈${compTok} · críticas=${V.length}\n`,
    `| T | lead | resposta (outbox) | tools(req) | selKey | responseSource | degraded | terminalSafe | slotsΔ |`,
    `|---|---|---|---|---|---|---|---|---|`];
  for (const cap of caps) {
    L.push(`| ${cap.i} | ${sanitize(cap.lead)} | ${sanitize(cap.outboxText).replace(/\|/g, "\\|").slice(0, 120)} | ${cap.toolReqs.map((t) => `${t.tool}(${sanitize(JSON.stringify(t.input)).slice(0, 40)})`).join(" ")} | ${cap.selectedKey ?? "-"} | ${cap.responseSource} | ${cap.degraded} | ${cap.terminalSafe} | ${sanitize(JSON.stringify(cap.slots)).slice(0, 60)} |`);
  }
  if (V.length) { L.push(`\n**Violações:**`); for (const v of V) L.push(`- ${sanitize(v)}`); }
  writeFileSync(resolve(outDir, `smoke-audit-${stamp}.md`), L.join("\n"), "utf8");

  // ── Console: tabela + veredito ────────────────────────────────────────────────────────────────────────────
  console.log(`\n== TABELA POR TURNO ==`);
  for (const cap of caps) {
    console.log(`T${cap.i} [${sanitize(cap.lead)}]`);
    console.log(`   outbox: ${sanitize(cap.outboxText).slice(0, 160)}`);
    console.log(`   tools=${cap.toolReqs.map((t) => `${t.tool}${sanitize(JSON.stringify(t.input))}`).join(" ") || "-"} | selKey=${cap.selectedKey ?? "-"} | src=${cap.responseSource} | degraded=${cap.degraded} | TS=${cap.terminalSafe} | media=${cap.hasSendMedia} | brainCalls=${cap.brainCallsInTurn}`);
    if (Object.keys(cap.slots).length) console.log(`   slots=${sanitize(JSON.stringify(cap.slots))}`);
  }
  const totalCalls = brainCalls + composeCalls;
  console.log(`\n== TOTAIS ==`);
  console.log(`OpenAI: ${totalCalls} chamadas (BRAIN ${brainCalls} 2xx=${stack.brainTransport.okCount} · COMPOSE ${composeCalls}) · tokens prompt≈${promptTok} completion≈${compTok}`);
  console.log(`prompt-integral(SHA)=${stack.brainTransport.allPromptExact} · efeitos OFF (0 dispatcher) · turnos=${caps.length}/11`);
  console.log(`relatorio: eval/reports/smoke-audit-${stamp}.md`);
  const passed = V.length === 0 && !stoppedByCap && caps.length === 11;
  if (!passed) { console.log(`\nSMOKE: FAIL — ${V.length} violação(ões):`); for (const v of V) console.log(`  ${sanitize(v)}`); }
  else console.log(`\nSMOKE: PASS (0 violações; LLM real; compose=0; efeitos OFF; ${totalCalls} chamadas <= ${MAX_LLM_CALLS})`);
  process.exit(passed ? 0 : 1);
}
main().catch((e) => { console.error("ERRO FATAL:", sanitize(String((e as Error)?.message ?? e))); process.exit(1); });
