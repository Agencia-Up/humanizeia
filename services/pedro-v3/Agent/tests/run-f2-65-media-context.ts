// ============================================================================
// F2.65 — FASE 6 (mídia em TODOS os caminhos de ingestão): a transcrição de áudio / legenda de imagem vive em
// mediaContext e PRECISA chegar ao bloco do cérebro. Sem isso, o incidente P4: áudio -> "instabilidade". Testa o
// chokepoint textFromInbox via a engine real (o bloco que o cérebro recebe).
//   npx tsx tests/run-f2-65-media-context.ts
// ============================================================================
import { runCentralConversationTurn, type CentralTurnResult } from "../src/engine/central-engine.ts";
import { InMemoryPersistence, FakeClock, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import { ScriptedAgentBrain } from "../src/adapters/llm/fake-agent-brain.ts";
import { buildTenantCatalog } from "../src/engine/catalog-utils.ts";
import { CatalogClaimExtractor } from "../src/engine/turn-context-preparer.ts";
import { createInitialState } from "../src/domain/conversation-state.ts";
import { deriveFallbackUnderstanding } from "../src/engine/turn-understanding.ts";
import { redact } from "../src/domain/effect-intent.ts";
import type { TurnContextPreparer } from "../src/domain/context.ts";
import type { DecisionLlm } from "../src/domain/llm.ts";
import type { AgentBrainStep, AgentBrainDecision, TurnFrame } from "../src/domain/agent-brain.ts";
import type { ProposedEffectPlan, QueryCall, QueryResult, ResponsePart, ResponseDraft, TurnRelation } from "../src/domain/decision.ts";
import type { TenantBusinessInfoSource } from "../src/engine/tenant-business-info.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); } else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TENANT = "ecb26258", AGENT = "d4fd5c38", NOW = "2026-07-17T12:00:00.000Z", SHA = "sha-65";
const catalog = buildTenantCatalog([]);
const extractor = new CatalogClaimExtractor(catalog);
const reply: ProposedEffectPlan = { kind: "send_message", planId: "reply", order: 0, onSuccess: [] } as ProposedEffectPlan;
const txt = (content: string): ResponsePart => ({ type: "text", content });
class RelPreparer implements TurnContextPreparer {
  async prepare(): Promise<{ interpretation: { relation: TurnRelation }; tenantCatalog: typeof catalog; claimExtractor: typeof extractor }> {
    return { interpretation: { relation: "ambiguous" }, tenantCatalog: catalog, claimExtractor: extractor };
  }
}
class ComposeSpyLlm implements DecisionLlm { async proposeNextQueryOrFinal(): Promise<never> { throw new Error("no compose"); } async compose(): Promise<ResponseDraft> { return { parts: [txt("x")] }; } }
const runQuery = async (call: QueryCall): Promise<QueryResult> => ({ ok: false, tool: call.tool, error: { code: "NOT_FOUND", message: "n/a", retryable: false } } as QueryResult);
const bi: TenantBusinessInfoSource = { async getBusinessInfo() { return { address: null, hours: null, unit: "Icom", source: "test" }; } };

let convSeq = 0;
async function runWithRaw(raw: Record<string, unknown>, replyText: string): Promise<{ block: string; src: string; degraded: boolean; outbox: string }> {
  const clock = new FakeClock(NOW);
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const conv = `conv-m-${convSeq++}`;
  const state = createInitialState({ conversationId: conv, tenantId: TENANT, agentId: AGENT, leadId: null, now: NOW });
  { const uow = persistence.begin(); uow.casState(conv, 0, state); await uow.commit(); }
  await persistence.tryInsert({ eventId: `${conv}-e1`, conversationId: conv, raw: redact(raw as Record<string, never>), receivedAt: clock.now() });
  clock.advance(1000);
  const brain = new ScriptedAgentBrain();
  let capturedBlock = "";
  brain.setResponder((frame: TurnFrame) => {
    capturedBlock = frame.block;
    const decision: AgentBrainDecision = {
      reasonCode: "reply", reasonSummary: "r", confidence: 0.9,
      responsePlan: { guidance: "g", draft: { parts: [txt(replyText)] } }, proposedEffects: [reply], memoryMutations: [], stateMutations: [],
    };
    return { kind: "final", decision, understanding: deriveFallbackUnderstanding(frame.block, frame.signals, extractor) } as AgentBrainStep;
  });
  const r: CentralTurnResult = await runCentralConversationTurn({
    persistence, clock, brain, llm: new ComposeSpyLlm(), runQuery, businessInfo: bi, contextPreparer: new RelPreparer(),
    conversationId: conv, tenantId: TENANT, agentId: AGENT, leadId: null, workerId: "w", turnId: `${conv}-t1`, leaseTtlMs: 60_000, portalPromptSha256: SHA,
    limits: { maxSteps: 6, totalTimeoutMs: 8000, proposeTimeoutMs: 3000, queryTimeoutMs: 3000, composeTimeoutMs: 3000 },
    maxValidationAttempts: 2, brainMaxSteps: 6, allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"],
    providerCapability: { send_message: "none", send_media: "none" }, singleAuthor: true, llmFirst: true,
  });
  const outbox = (await persistence.listOutbox(conv)).find((o) => o.kind === "send_message");
  return { block: capturedBlock, src: r.status === "committed" ? r.responseSource : r.status, degraded: r.status === "committed" && r.degraded, outbox: (outbox?.payload as { text?: string } | undefined)?.text ?? "" };
}

async function main(): Promise<void> {
  console.log("== F2.65 mídia no contexto do cérebro (FASE 6) ==");

  // A) Áudio COM transcrição em mediaContext.text (texto primário vazio) -> o bloco É a transcrição (turno simples,
  //    sem exigir tool). Prova que a transcrição chega ao cérebro e o turno completa normal (não "instabilidade").
  {
    const r = await runWithRaw({ mediaContext: { kind: "audio", text: "oi, bom dia, tudo bem com você?", has_media_context: true } }, "Bom dia! Tudo ótimo por aqui, e você? 😊");
    check("[A] transcrição de áudio (mediaContext.text) vira o bloco do cérebro", r.block === "oi, bom dia, tudo bem com você?", `block="${r.block}"`);
    check("[A] turno normal, sem technical_fallback", r.src !== "technical_fallback" && !r.degraded, `src=${r.src}`);
  }
  // B) Áudio SEM transcrição (falhou) -> bloco = marcador HONESTO -> o cérebro autora resposta natural (não instabilidade).
  {
    const r = await runWithRaw({ mediaContext: { kind: "audio", has_media_context: true } }, "Não consegui ouvir seu áudio, pode me mandar por escrito? 😊");
    check("[B] transcrição falha -> bloco tem marcador honesto de áudio", /áudio|audio/i.test(r.block) && /transcrever|não consegui/i.test(r.block), `block="${r.block}"`);
    check("[B] cérebro autora resposta natural, NUNCA 'instabilidade'/technical_fallback", r.src !== "technical_fallback" && !r.degraded && !/instabilidade/i.test(r.outbox), `src=${r.src} out="${r.outbox}"`);
  }
  // C) Imagem com legenda/descrição em mediaContext.text -> vira o bloco.
  {
    const r = await runWithRaw({ mediaContext: { kind: "image", text: "esse é o carro que eu quero, tem parecido?", has_media_context: true } }, "Deixa eu ver!");
    check("[C] legenda/descrição de imagem (mediaContext.text) vira o bloco", r.block === "esse é o carro que eu quero, tem parecido?", `block="${r.block}"`);
  }
  // D) Texto primário presente + mediaContext -> o texto primário VENCE (compatibilidade; não altera o caminho de texto).
  {
    const r = await runWithRaw({ text: "boa tarde, tudo bem?", mediaContext: { kind: "audio", text: "ignora isso", has_media_context: true } }, "Boa tarde! Tudo ótimo. 😊");
    check("[D] texto primário presente vence o mediaContext (backward-compat)", r.block === "boa tarde, tudo bem?", `block="${r.block}"`);
  }
  // E) Imagem sem texto -> marcador honesto de imagem (o cérebro pode pedir contexto).
  {
    const r = await runWithRaw({ mediaContext: { kind: "image", has_media_context: true } }, "Recebi sua imagem! Me conta o que você procura?");
    check("[E] imagem sem texto -> marcador honesto de imagem no bloco", /imagem/i.test(r.block), `block="${r.block}"`);
    check("[E] sem technical_fallback", r.src !== "technical_fallback" && !r.degraded, `src=${r.src}`);
  }

  console.log(`\n== F2.65: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
