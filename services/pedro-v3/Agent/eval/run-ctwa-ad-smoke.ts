// ============================================================================
// eval/run-ctwa-ad-smoke.ts
//
// Cheap real-LLM smoke for CTWA/Facebook ad context.
// It injects raw.adContext into the first inbox event exactly like the bridge,
// then lets central_active (singleAuthor + llmFirst) talk with tools/effects OFF.
//
// Usage:
//   PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm run smoke:ctwa
//   CTWA_SMOKE_SCENARIO=compass PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 npm run smoke:ctwa
// ============================================================================
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PromptTenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";
import { runCentralConversationTurn, applyAcceptedPhotoActionOutcome } from "../src/engine/central-engine.ts";
import { commitEffectOutcome } from "../src/engine/effect-outcome-commit.ts";
import { InMemoryPersistence, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { createInitialState, type AdContext } from "../src/domain/conversation-state.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { AgentBrainPort, AgentBrainStep, AgentToolObservation, TurnFrame, CentralQueryCall } from "../src/domain/agent-brain.ts";
import type { EffectReceipt, EffectResult, QueryCall, QueryResult } from "../src/domain/decision.ts";
import { RealClock } from "../src/runtime/real-clock.ts";
import {
  buildRealAssembly,
  loadServiceEnv,
  PILOT_AGENT,
  PILOT_MODEL,
  PILOT_TENANT,
  sanitize,
} from "./real-harness.ts";
import { buildCentralStack, CENTRAL_ALLOWED_TOOLS, CENTRAL_LIMITS } from "./central-real-harness.ts";

type Step = readonly string[];
type Scenario = {
  readonly id: string;
  readonly title: string;
  readonly ad: AdContext;
  readonly steps: readonly Step[];
  readonly maxCalls: number;
  readonly assert: (turns: readonly TurnCapture[]) => readonly string[];
};

type ToolReq = { readonly tool: string; readonly input: Record<string, unknown> };
type ExecutedTool = { readonly tool: string; readonly input: Record<string, unknown>; readonly ok: boolean; readonly itemCount?: number; readonly keys?: readonly string[] };
type EffectLog = { readonly kind: string; readonly vehicleKey?: string; readonly photoCount?: number; readonly photoIds?: readonly string[]; readonly status: string };
type TurnCapture = {
  readonly turn: number;
  readonly lead: string;
  readonly response: string;
  readonly status: string;
  readonly reasonCode: string | null;
  readonly responseSource: string | null;
  readonly terminalSafe: boolean;
  readonly degraded: boolean;
  readonly adVehicle: string | null;
  readonly toolsRequested: readonly ToolReq[];
  readonly toolsExecuted: readonly ExecutedTool[];
  readonly effects: readonly EffectLog[];
  readonly llmCalls: number;
};

const MAX_TOTAL_CALLS = Number(process.env.CTWA_SMOKE_MAX_CALLS ?? "44");
const norm = (s: string): string => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const has = (s: string, needle: string): boolean => norm(s).includes(norm(needle));
const genericFallbackRx = /nao consegui confirmar|não consegui confirmar|consegue reformular|technical_fallback/i;
const phoneAskRx = /\b(telefone|celular|numero para contato|número para contato|whatsapp para contato)\b/i;
const v2IntroRx = /pra eu te indicar certinho|voce ja tem algum modelo em mente|você ja tem algum modelo em mente|oi!\s*aqui e o aloan|oi!\s*aqui é o aloan/i;

const adCompass: AdContext = {
  adId: "120253981641730460",
  source: "FB_Ads",
  sourceUrl: "https://fb.me/c9tWuhhGL",
  title: "Anuncio do Facebook",
  body: "Fale com nossos consultores",
  greeting: "Ola! Posso ter mais informacoes sobre isso?",
  imageUrls: ["https://scontent.fbcdn.net/full.jpg", "https://scontent.fbcdn.net/s540.jpg"],
  vehicleQuery: "Jeep Compass 2019",
  vehicleType: "suv",
  summary: "A arte do anuncio identifica um Jeep Compass 2019.",
  confidence: 0.98,
  semanticSource: "image",
  capturedAtTurn: 0,
};

const adRanger: AdContext = {
  adId: "120253981641730461",
  source: "FB_Ads",
  sourceUrl: "https://fb.me/ranger-xlt",
  title: "Ranger XLT TD 3.2 2016",
  body: "Picape diesel automatica com fotos no anuncio",
  greeting: "Ola! Quer saber mais sobre a Ford Ranger XLT TD 3.2 2016?",
  imageUrls: ["https://scontent.fbcdn.net/ranger-full.jpg"],
  capturedAtTurn: 0,
};

const adGenericSuv: AdContext = {
  adId: "120253981641730462",
  source: "instagram",
  sourceUrl: "https://instagram.com/p/suvs",
  title: "SUVs a partir de R$ 40 mil",
  body: "Encontre o SUV ideal na Avant Motors",
  greeting: "Ola! Quer saber mais sobre nossos SUVs?",
  imageUrls: [],
  capturedAtTurn: 0,
};

class RecordingBrain implements AgentBrainPort {
  requestedTools: ToolReq[] = [];
  lastAdVehicle: string | null = null;
  constructor(private readonly inner: AgentBrainPort) {}
  reset(): void {
    this.requestedTools = [];
    this.lastAdVehicle = null;
  }
  async proposeNextStep(frame: TurnFrame, obs: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    this.lastAdVehicle = frame.signals.adVehicle ?? null;
    const step = await this.inner.proposeNextStep(frame, obs);
    if (step.kind === "query") {
      const call = step.call as CentralQueryCall;
      this.requestedTools.push({ tool: call.tool, input: { ...(call.input as Record<string, unknown>) } });
    }
    return step;
  }
}

function recordingRunner(inner: (call: QueryCall) => Promise<QueryResult>, log: ExecutedTool[]): (call: QueryCall) => Promise<QueryResult> {
  return async (call: QueryCall): Promise<QueryResult> => {
    const res = await inner(call);
    const rec: ExecutedTool = { tool: call.tool, input: { ...(call.input as Record<string, unknown>) }, ok: res.ok };
    if (res.ok && res.tool === "stock_search") {
      log.push({ ...rec, itemCount: res.data.items.length, keys: res.data.items.slice(0, 10).map((v) => v.vehicleKey) });
    } else if (res.ok && res.tool === "vehicle_photos_resolve") {
      log.push({ ...rec, itemCount: res.data.photoIds.length, keys: [res.data.vehicleKey] });
    } else if (res.ok && res.tool === "vehicle_details") {
      log.push({ ...rec, keys: [res.data.vehicle.vehicleKey] });
    } else {
      log.push(rec);
    }
    return res;
  };
}

function baseViolations(turns: readonly TurnCapture[]): string[] {
  const out: string[] = [];
  for (const t of turns) {
    if (t.status !== "committed") out.push(`T${t.turn}: status=${t.status}`);
    if (t.responseSource === "technical_fallback") out.push(`T${t.turn}: technical_fallback (${t.reasonCode ?? "sem reason"})`);
    if (genericFallbackRx.test(t.response)) out.push(`T${t.turn}: texto generico de fallback no lead`);
    if (phoneAskRx.test(t.response)) out.push(`T${t.turn}: pediu telefone em conversa WhatsApp`);
    if (t.response.includes("\uFFFD")) out.push(`T${t.turn}: U+FFFD/mojibake`);
    if (t.turn > 1 && v2IntroRx.test(t.response)) out.push(`T${t.turn}: reintroducao/reset parecido com v2`);
    // PARTE B (missao): curadoria de fotos \u2014 NUNCA enviar mais de 5 fotos num lote (send_media com photoCount>5).
    for (const e of t.effects) {
      if (e.kind === "send_media" && typeof e.photoCount === "number" && e.photoCount > 5) out.push(`T${t.turn}: send_media com ${e.photoCount} fotos (>5) \u2014 sem curadoria`);
    }
  }
  return out;
}
const nameAskRx = /\bqual\s+(?:e\s+)?(?:o\s+)?(?:seu|teu)\s+nome\b|\bseu\s+nome\b\s*\??|\bsobrenome\b|\bcomo\s+(?:voce|vc|o\s+senhor|a\s+senhora)\s+se\s+chama/i;

const scenarios: readonly Scenario[] = [
  {
    id: "compass",
    title: "Anuncio Compass: saudacao/ref -> estoque, foto, correcao para Onix, loja",
    ad: adCompass,
    maxCalls: 24,
    steps: [["Boa tarde"], ["esse ainda tem?"], ["me manda fotos dele"], ["na verdade quero Onix"], ["onde fica a loja?"]],
    assert(turns) {
      const v = baseViolations(turns);
      const t12 = turns.slice(0, 2);
      const firstStock = t12.some((t) => t.toolsExecuted.some((tool) => tool.tool === "stock_search"));
      const compassMentioned = t12.some((t) => has(t.response, "compass"));
      if (!firstStock) v.push("T1/T2: entrada por anuncio nao chamou stock_search");
      if (!compassMentioned) v.push("T1/T2: resposta nao tratou o Compass do anuncio");
      // PARTE A (missão P0): T1 vem de anuncio ESPECIFICO (Jeep Compass 2019). A ABERTURA precisa reconhecer/conduzir o
      // veiculo do anuncio — reprova se for saudacao generica que NAO cita Compass/Jeep nem mostra/conduz sobre o veiculo.
      const t1 = turns[0];
      const t1TalksAd = !!t1 && (has(t1.response, "compass") || has(t1.response, "jeep")
        || t1.effects.some((e) => e.kind === "send_media" || e.kind === "vehicle_offer_list")
        || /\bfoto|\bimagem|\bdetalhe|\bcondi[cç]|\bdispon|\bfinanc|\bvalor|\bpre[cç]o|pronta?\s+entrega/i.test(t1.response));
      if (t1 && !t1TalksAd) v.push(`T1: abertura de anuncio ESPECIFICO (Compass 2019) foi saudacao generica, sem reconhecer/conduzir o veiculo do anuncio (resp="${sanitize(t1.response).slice(0, 80)}")`);
      const t3 = turns[2];
      if (t3 && !t3.effects.some((e) => e.kind === "send_media")) {
        v.push("T3: anuncio cita Compass 2019 disponivel, mas pedido 'fotos dele' nao gerou send_media do alvo do anuncio");
      }
      const t4 = turns[3];
      if (t4 && !t4.toolsExecuted.some((tool) => tool.tool === "stock_search" && has(JSON.stringify(tool.input), "onix"))) v.push("T4: correcao para Onix nao acionou stock_search de Onix");
      if (t4 && has(t4.response, "compass") && !has(t4.response, "onix")) v.push("T4: anuncio Compass venceu a correcao do lead para Onix");
      const t5 = turns[4];
      if (t5 && !t5.toolsExecuted.some((tool) => tool.tool === "tenant_business_info") && !/loja|avenida|rua|taubate|taubat[eé]|shopping|horario|horário/i.test(t5.response)) {
        v.push("T5: pergunta de loja nao acionou tenant_business_info nem respondeu pelo prompt");
      }
      return v;
    },
  },
  {
    id: "ranger",
    title: "Anuncio Ranger: veiculo do anuncio guia busca; se nao tiver, resposta honesta e refino",
    ad: adRanger,
    maxCalls: 16,
    steps: [["tem esse?"], ["tem algo parecido ate 100 mil?"]],
    assert(turns) {
      const v = baseViolations(turns);
      const t1 = turns[0];
      if (!t1?.toolsExecuted.some((tool) => tool.tool === "stock_search")) v.push("T1: pergunta sobre anuncio Ranger nao acionou stock_search");
      if (t1 && /qual modelo|qual tipo/i.test(t1.response)) v.push("T1: perguntou modelo apesar do anuncio conter Ranger");
      const t2 = turns[1];
      if (t2 && !t2.toolsExecuted.some((tool) => tool.tool === "stock_search")) v.push("T2: pedido de parecido ate 100 mil nao acionou stock_search");
      const t2Stock = t2?.toolsExecuted.find((tool) => tool.tool === "stock_search");
      if (t2Stock && has(JSON.stringify(t2Stock.input), "ranger")) {
        v.push(`T2: 'algo parecido' continuou buscando Ranger em vez de abrir para alternativas (input=${JSON.stringify(t2Stock.input)})`);
      }
      if (t2 && /quer que eu veja|posso procurar|veja outras/i.test(t2.response) && !/(1\.|2\.|3\.|picape|strada|toro|hilux|s10|montana)/i.test(t2.response)) {
        v.push("T2: prometeu/verbalizou procurar alternativas, mas nao retornou alternativas nem informou ausencia de picapes");
      }
      return v;
    },
  },
  {
    id: "generic-suv",
    title: "Anuncio generico SUV: refino de preco/cambio deve buscar SUV, nao perguntar tipo",
    ad: adGenericSuv,
    maxCalls: 14,
    steps: [["ate 100k automatico"], ["tem mais?"]],
    assert(turns) {
      const v = baseViolations(turns);
      const t1 = turns[0];
      const stock = t1?.toolsExecuted.find((tool) => tool.tool === "stock_search");
      const input = JSON.stringify(stock?.input ?? {});
      if (!stock) v.push("T1: anuncio SUV + filtro do lead nao acionou stock_search");
      if (!has(input, "suv")) v.push(`T1: stock_search nao preservou tipo=suv do anuncio (input=${input})`);
      if (!/100000|100 mil|100k/i.test(input + " " + t1?.response)) v.push("T1: filtro ate 100k nao apareceu na busca/resposta");
      if (t1 && /qual modelo|qual tipo/i.test(t1.response)) v.push("T1: perguntou tipo/modelo apesar do anuncio SUV + filtro");
      const t2 = turns[1];
      if (t2 && !t2.toolsExecuted.some((tool) => tool.tool === "stock_search")) v.push("T2: 'tem mais?' nao acionou stock_search mantendo escopo do anuncio");
      return v;
    },
  },
  {
    id: "ad-visual-entry",
    title: "Anuncio identificado pela arte: apresenta, consulta o carro e aceita mudanca explicita",
    ad: adCompass,
    maxCalls: 14,
    steps: [["Ola! Tenho interesse e queria mais informacoes, por favor."], ["Na verdade prefiro um Onix"]],
    assert(turns) {
      const v = baseViolations(turns);
      const t1 = turns[0];
      if (t1 && (!has(t1.response, "carvalho") || !has(t1.response, "icom"))) v.push("T1: abertura nao se apresentou como Carvalho da Icom Motors");
      if (t1 && !has(t1.response, "compass")) v.push("T1: abertura nao tratou o Compass identificado na arte");
      const t1Stock = t1?.toolsExecuted.find((tool) => tool.tool === "stock_search");
      if (!t1Stock || !has(JSON.stringify(t1Stock.input), "compass") || !/2019/.test(JSON.stringify(t1Stock.input))) {
        v.push(`T1: nao confirmou o Compass 2019 do anuncio no estoque (input=${JSON.stringify(t1Stock?.input ?? null)})`);
      }
      const t2 = turns[1];
      const t2Stock = t2?.toolsExecuted.find((tool) => tool.tool === "stock_search");
      if (!t2Stock || !has(JSON.stringify(t2Stock.input), "onix")) v.push("T2: mudanca explicita nao buscou Onix");
      if (t2 && (!has(t2.response, "onix") || (has(t2.response, "compass") && !has(t2.response, "onix")))) {
        v.push("T2: anuncio antigo venceu a mudanca explicita para Onix");
      }
      return v;
    },
  },
  {
    // Missao P0 (Conversa A): anuncio ESPECIFICO Compass 2019 = FOCO no veiculo exato. T1 fala do 2019 (nao lista 2017);
    // T2 fotos do 2019 (<=5); T3 "tem outro compass?" -> ai sim lista outros; T4 "quero Onix" -> anuncio nao prende.
    id: "ad-exact-focus",
    title: "Anuncio Compass 2019: foco exato, fotos, alternativa so quando pedida, troca para Onix",
    ad: adCompass,
    maxCalls: 26,
    steps: [["Ola"], ["me manda fotos dele"], ["tem outro compass?"], ["na verdade quero Onix"]],
    assert(turns) {
      const v = baseViolations(turns);
      const t1 = turns[0];
      if (t1 && !has(t1.response, "compass")) v.push("T1: abertura do anuncio especifico nao falou do Compass do anuncio");
      if (t1 && (!has(t1.response, "carvalho") || !has(t1.response, "icom"))) v.push("T1: abertura nao se apresentou como Carvalho da Icom Motors");
      if (t1 && nameAskRx.test(t1.response)) v.push("T1: abertura pediu o NOME antes de conduzir o veiculo do anuncio");
      const t1Stock = t1?.toolsExecuted.find((x) => x.tool === "stock_search");
      if (t1Stock && !/\banos?\b|"anos"|2019/i.test(JSON.stringify(t1Stock.input))) v.push(`T1: busca do anuncio NAO focou o ano exato (esperado anos=[2019]) input=${JSON.stringify(t1Stock.input)}`);
      const t2 = turns[1];
      if (t2 && !t2.effects.some((e) => e.kind === "send_media")) v.push("T2: 'fotos dele' nao enviou send_media do Compass do anuncio");
      const t3 = turns[2];
      if (t3 && !t3.toolsExecuted.some((x) => x.tool === "stock_search")) v.push("T3: 'tem outro compass?' nao acionou stock_search de alternativas");
      const t3Stock = t3?.toolsExecuted.find((x) => x.tool === "stock_search");
      if (t3Stock && /2019/.test(JSON.stringify(t3Stock.input)) && /"anos"/.test(JSON.stringify(t3Stock.input))) v.push(`T3: 'outro compass' ainda ficou preso no ano 2019 (deveria relaxar) input=${JSON.stringify(t3Stock.input)}`);
      const t4 = turns[3];
      if (t4 && !t4.toolsExecuted.some((x) => x.tool === "stock_search" && has(JSON.stringify(x.input), "onix"))) v.push("T4: correcao para Onix nao acionou stock_search de Onix");
      if (t4 && has(t4.response, "compass") && !has(t4.response, "onix")) v.push("T4: anuncio Compass venceu a correcao do lead para Onix");
      return v;
    },
  },
  {
    // PARTE C (missao abertura+fotos): abertura sem alvo -> discovery (nao nome); busca; foto com curadoria (<=5); "manda
    // mais" -> proximo lote sem repetir. Anuncio generico (adGenericEntry) representa a abertura de descoberta.
    id: "opening-photos",
    title: "Abertura generica -> discovery, SUV ate 100k, fotos do 2o (<=5), manda mais sem repetir",
    ad: adGenericSuv,
    maxCalls: 22,
    steps: [["Ola, tenho interesse"], ["Quero SUV ate 100 mil"], ["me manda fotos do segundo"], ["manda mais fotos"]],
    assert(turns) {
      const v = baseViolations(turns);
      const t1 = turns[0];
      if (t1 && nameAskRx.test(t1.response)) v.push("T1: abertura pediu o NOME antes de descobrir a intencao comercial");
      const t2 = turns[1];
      const t2stock = t2?.toolsExecuted.find((x) => x.tool === "stock_search");
      if (!t2stock) v.push("T2: 'SUV ate 100 mil' nao acionou stock_search");
      if (t2stock && !has(JSON.stringify(t2stock.input), "suv")) v.push(`T2: stock_search nao preservou tipo=suv (input=${JSON.stringify(t2stock.input)})`);
      const t3 = turns[2];
      const t3media = t3?.effects.find((e) => e.kind === "send_media");
      if (t3 && !t3media) v.push("T3: 'fotos do segundo' nao gerou send_media (nem candidato/ausencia honesta)");
      if (t3media && typeof t3media.photoCount === "number" && t3media.photoCount > 5) v.push(`T3: enviou ${t3media.photoCount} fotos (>5) no 1o lote`);
      const t4 = turns[3];
      const t4media = t4?.effects.find((e) => e.kind === "send_media");
      if (t3media?.photoIds && t4media?.photoIds) {
        const overlap = t4media.photoIds.filter((id) => t3media.photoIds!.includes(id));
        if (overlap.length > 0) v.push(`T4: 'manda mais' repetiu ${overlap.length} foto(s) do lote de T3`);
      }
      return v;
    },
  },
];

function selectScenarios(): readonly Scenario[] {
  const requested = process.env.CTWA_SMOKE_SCENARIO?.trim();
  if (!requested) return scenarios;
  const selected = scenarios.filter((s) => s.id === requested);
  if (selected.length === 0) throw new Error(`CTWA_SMOKE_SCENARIO invalido: ${requested}. Opcoes: ${scenarios.map((s) => s.id).join(", ")}`);
  return selected;
}

function renderRows(turns: readonly TurnCapture[]): string[] {
  return turns.map((t) => {
    const tools = t.toolsExecuted.map((tool) => `${tool.tool}${tool.itemCount != null ? `(${tool.itemCount})` : ""}`).join(",") || "-";
    const effects = t.effects.map((e) => `${e.kind}${e.vehicleKey ? `(${e.vehicleKey})` : ""}${e.photoCount != null ? `[${e.photoCount}]` : ""}`).join(",") || "-";
    return `| ${t.turn} | ${sanitize(t.lead).replace(/\|/g, "\\|")} | ${sanitize(t.response).replace(/\|/g, "\\|").slice(0, 180)} | ${tools} | ${effects} | ${t.adVehicle ?? "-"} | ${t.responseSource ?? t.reasonCode ?? t.status} |`;
  });
}

async function runScenario(assembly: Awaited<ReturnType<typeof buildRealAssembly>>, stack: ReturnType<typeof buildCentralStack>, scenario: Scenario): Promise<TurnCapture[]> {
  const base = { ms: Date.parse("2026-07-07T12:00:00.000Z") };
  const clock = { now: () => new Date(base.ms).toISOString() };
  const persistence = new InMemoryPersistence(clock as never, new FakeIdGen());
  const businessInfo = new PromptTenantBusinessInfoSource(assembly.runtimeConfig);
  const convId = `ctwa-${scenario.id}-${Date.now()}`;
  const seed = persistence.begin();
  seed.casState(convId, 0, createInitialState({ conversationId: convId, tenantId: PILOT_TENANT, agentId: PILOT_AGENT, leadId: null, now: clock.now() }));
  const seeded = seed.commit();
  if (!seeded.ok) throw new Error(`seed_failed:${seeded.reason}`);

  const recordingBrain = new RecordingBrain(stack.brain);
  const captures: TurnCapture[] = [];
  let eventSeq = 0;

  for (let turnIndex = 0; turnIndex < scenario.steps.length; turnIndex++) {
    if (stack.brainTransport.count + stack.composeTransport.count >= Math.min(MAX_TOTAL_CALLS, scenario.maxCalls)) break;
    const burst = scenario.steps[turnIndex];
    for (const msg of burst) {
      eventSeq += 1;
      const raw = turnIndex === 0
        ? redact({ text: msg, adContext: scenario.ad } as never)
        : redact({ text: msg } as never);
      await persistence.tryInsert({ eventId: `${convId}-e${eventSeq}`, conversationId: convId, raw, receivedAt: clock.now() });
    }
    base.ms += 1_000;
    const turnId = `${convId}-t${turnIndex + 1}`;
    recordingBrain.reset();
    const toolLog: ExecutedTool[] = [];
    const brainBefore = stack.brainTransport.count;
    const composeBefore = stack.composeTransport.count;
    const r = await runCentralConversationTurn({
      persistence,
      clock: clock as never,
      brain: recordingBrain,
      llm: stack.composeLlm,
      runQuery: recordingRunner(assembly.runQuery, toolLog),
      businessInfo,
      contextPreparer: assembly.contextPreparer,
      conversationId: convId,
      tenantId: PILOT_TENANT,
      agentId: PILOT_AGENT,
      leadId: null,
      workerId: "ctwa-smoke",
      turnId,
      leaseTtlMs: 120_000,
      portalPromptSha256: assembly.promptSha,
      limits: CENTRAL_LIMITS,
      maxValidationAttempts: 3,
      brainMaxSteps: 6,
      allowedTools: [...CENTRAL_ALLOWED_TOOLS],
      providerCapability: { send_message: "none", send_media: "none" },
      singleAuthor: true,
      llmFirst: true,
    });

    while (true) {
      const claimed = await persistence.claimOutbox(convId, "ctwa-smoke", 120_000, 25);
      if (claimed.length === 0) break;
      for (const rec of claimed as unknown as { effectId: string; kind: string }[]) {
        const receipt: EffectReceipt = { effectId: rec.effectId, level: "accepted", providerMessageId: `ev-${rec.effectId}`, at: clock.now() };
        const result: EffectResult = { status: "succeeded", effectId: rec.effectId, receipt };
        await commitEffectOutcome({ persistence, clock: clock as never, conversationId: convId, effectId: rec.effectId, result });
        if (rec.kind === "send_media") await applyAcceptedPhotoActionOutcome({ persistence, conversationId: convId, effectId: rec.effectId, result });
      }
    }

    const outbox = (await persistence.listOutbox(convId)).filter((o) => o.turnId === turnId) as unknown as { kind: string; status: string; payload?: { text?: string; vehicleKey?: string; photoIds?: string[] } }[];
    captures.push({
      turn: turnIndex + 1,
      lead: burst.join(" | "),
      response: sanitize(r.status === "committed" ? r.composedText : ""),
      status: r.status,
      reasonCode: r.status === "committed" ? r.decision.reasonCode : null,
      responseSource: r.status === "committed" ? r.responseSource : null,
      terminalSafe: r.status === "committed" ? r.terminalSafe : true,
      degraded: r.status === "committed" ? r.degraded : true,
      adVehicle: recordingBrain.lastAdVehicle,
      toolsRequested: [...recordingBrain.requestedTools],
      toolsExecuted: toolLog,
      effects: outbox.map((o) => ({ kind: o.kind, status: o.status, vehicleKey: o.payload?.vehicleKey, photoCount: Array.isArray(o.payload?.photoIds) ? o.payload.photoIds.length : undefined, photoIds: Array.isArray(o.payload?.photoIds) ? o.payload.photoIds : undefined })),
      llmCalls: (stack.brainTransport.count - brainBefore) + (stack.composeTransport.count - composeBefore),
    });
    base.ms += 30_000;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 1200));
  }
  return captures;
}

async function main(): Promise<void> {
  if (process.env.PEDRO_V3_REAL_EVAL !== "1") {
    console.error("BLOQUEADO: defina PEDRO_V3_REAL_EVAL=1. Este smoke usa LLM real, efeitos OFF e sem judge.");
    process.exit(2);
  }
  loadServiceEnv();
  const selected = selectScenarios();
  const startedAt = new Date().toISOString();
  console.log(`== CTWA AD SMOKE (${selected.map((s) => s.id).join(", ")}) ==`);
  const assembly = await buildRealAssembly(new RealClock());
  const stack = buildCentralStack(assembly);

  const probeFrame: TurnFrame = {
    turnId: "ctwa-probe",
    now: startedAt,
    block: "oi",
    portalPromptSha256: assembly.promptSha,
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [],
    conversationContext: {
      lastAgentMessage: null,
      pendingAgentQuestion: null,
      selectedVehicle: null,
      lastVisibleOffer: null,
      lastResolvedSlotAnswer: null,
      conversationSummary: null,
    },
    currentTurnFacts: {
      expectedAnswer: { slot: null, lastAgentQuestion: null },
      extracted: [],
      offerReference: null,
    },
    signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous" },
  };
  let probeError = "";
  try {
    await stack.brain.proposeNextStep(probeFrame, []);
  } catch (error) {
    probeError = sanitize(String((error as Error)?.message ?? error)).slice(0, 160);
  }
  if (stack.brainTransport.okCount === 0) {
    const probeStatuses = stack.brainTransport.calls.map((call) => call.status || call.error || "unknown").join(",");
    console.error(`BLOQUEIO EXTERNO: probe OpenAI sem 2xx (status=${probeStatuses || "sem chamada"}; erro=${probeError || "nenhum"}). Nao executando smoke CTWA.`);
    process.exit(3);
  }

  const lines: string[] = [
    `# CTWA Ad Smoke - ${startedAt}`,
    "",
    `Modelo: ${PILOT_MODEL}`,
    `Prompt SHA: ${assembly.promptSha}`,
    `Cenarios: ${selected.map((s) => s.id).join(", ")}`,
    "",
  ];
  const allViolations: string[] = [];

  for (const scenario of selected) {
    const before = stack.brainTransport.count + stack.composeTransport.count;
    const turns = await runScenario(assembly, stack, scenario);
    const violations = scenario.assert(turns).map((v) => `${scenario.id}: ${v}`);
    allViolations.push(...violations);

    lines.push(`## ${scenario.id} - ${scenario.title}`);
    lines.push("");
    lines.push(`Ad: ${sanitize(JSON.stringify(scenario.ad))}`);
    lines.push(`Chamadas LLM: ${(stack.brainTransport.count + stack.composeTransport.count) - before}`);
    lines.push("");
    lines.push("| T | lead | resposta | tools | effects | adVehicle | source |");
    lines.push("|---|---|---|---|---|---|---|");
    lines.push(...renderRows(turns));
    lines.push("");
    if (violations.length) {
      lines.push("Violacoes:");
      for (const v of violations) lines.push(`- ${sanitize(v)}`);
    } else {
      lines.push("Violacoes: nenhuma");
    }
    lines.push("");
  }

  const promptTokens = stack.brainTransport.calls.reduce((sum, call) => sum + (call.promptTokens ?? 0), 0);
  const completionTokens = stack.brainTransport.calls.reduce((sum, call) => sum + (call.completionTokens ?? 0), 0);
  const cost = (promptTokens * 0.4 + completionTokens * 1.6) / 1_000_000;
  lines.push("## Totais");
  lines.push("");
  lines.push(`BRAIN calls: ${stack.brainTransport.count} (2xx=${stack.brainTransport.okCount})`);
  lines.push(`COMPOSE calls: ${stack.composeTransport.count} (esperado 0)`);
  lines.push(`Prompt integral: ${stack.brainTransport.allPromptExact}`);
  lines.push(`Custo estimado: US$${cost.toFixed(4)}`);
  lines.push(`Violacoes: ${allViolations.length}`);

  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "reports");
  mkdirSync(outDir, { recursive: true });
  const reportPath = resolve(outDir, `ctwa-ad-smoke-${startedAt.replace(/[:.]/g, "-")}.md`);
  writeFileSync(reportPath, lines.join("\n"), "utf8");

  console.log(`relatorio: ${reportPath}`);
  console.log(`BRAIN=${stack.brainTransport.count} 2xx=${stack.brainTransport.okCount} COMPOSE=${stack.composeTransport.count} custo~=US$${cost.toFixed(4)}`);
  if (allViolations.length > 0) {
    console.log(`RESULTADO: FAIL (${allViolations.length} violacao/violacoes)`);
    for (const v of allViolations) console.log(`- ${sanitize(v)}`);
    process.exit(1);
  }
  console.log("RESULTADO: PASS (0 violacoes deterministicas)");
}

main().catch((err) => {
  console.error(`ERRO FATAL: ${sanitize(String((err as Error)?.message ?? err))}`);
  process.exit(1);
});
