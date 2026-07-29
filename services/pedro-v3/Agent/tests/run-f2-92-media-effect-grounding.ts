import type { ProposedEffectPlan, QueryResult } from "../src/domain/decision.ts";
import { groundProposedMediaEffects } from "../src/engine/media-effect-grounding.ts";
import { COMPACT_OPERATIONAL_PROMPT, OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import { OpenAiRuntimeSecret } from "../src/engine/openai-canary-root.ts";
import { createInitialPersistedWorkingMemory, type TurnFrame } from "../src/domain/agent-brain.ts";
import type { ModelHttpRequest, ModelHttpResponse, ModelHttpTransport } from "../src/adapters/llm/structured-json-model.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { ok++; console.log(`OK  ${name}`); return; }
  fail++; failures.push(`${name}${detail ? ` :: ${detail}` : ""}`); console.error(`FALHA ${name}${detail ? ` :: ${detail}` : ""}`);
}

const message = (): ProposedEffectPlan => ({ kind: "send_message", planId: "reply", order: 0, onSuccess: [] });
const media = (vehicleKey = "car:1", photoIds = ["invented"]): ProposedEffectPlan => ({
  kind: "send_media", planId: "media", order: 1, vehicleKey, photoIds,
  onSuccess: [{ op: "mark_photos_sent", effectId: "pending", vehicleKey: "wrong", photoIds: ["wrong"] }],
});
const photos = (overrides: Partial<Extract<QueryResult, { ok: true; tool: "vehicle_photos_resolve" }>["data"]> = {}): QueryResult => ({
  ok: true,
  tool: "vehicle_photos_resolve",
  source: "test",
  data: {
    vehicleKey: "car:1",
    ambiguous: false,
    photoIds: ["p1", "p2"],
    media: [{ id: "p1", url: "https://cdn.test/p1.jpg" }, { id: "p2", url: "https://cdn.test/p2.jpg" }],
    ...overrides,
  },
});

class SchemaCaptureTransport implements ModelHttpTransport {
  request: ModelHttpRequest | null = null;
  async postJson(_url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    this.request = request;
    const content = JSON.stringify({
      kind: "final",
      understanding: {
        primaryIntent: "smalltalk", requestedCapabilities: [], subject: "none", subjectValue: null,
        subjectSource: "current_turn", evidence: [], isTopicChange: false, monetaryMentions: [],
        answeredLeadQuestions: [], policyDecision: null,
      },
      call: null, reasonCode: "reply", confidence: 1, guidance: "responder",
      draft: { parts: [{ type: "text", content: "Certo." }] }, effects: [{ kind: "send_message" }],
    });
    return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content } }] }) };
  }
}

function frame(): TurnFrame {
  return {
    turnId: "f2-92-schema", now: "2026-07-28T12:00:00.000Z", block: "manda fotos dele",
    portalPromptSha256: "sha", workingMemory: {
      ...createInitialPersistedWorkingMemory(),
      funnel: { known: [], declined: [], deferred: [], suggestedObjective: null },
      selectedVehicle: null,
      lastOffer: null,
    }, recentTranscript: [],
    conversationContext: { lastAgentMessage: null, pendingAgentQuestion: null, selectedVehicle: null, lastVisibleOffer: null, lastResolvedSlotAnswer: null, conversationSummary: null },
    currentTurnFacts: { expectedAnswer: { slot: null, lastAgentQuestion: null }, extracted: [], offerReference: null },
    signals: { mentionsPhoto: true, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "answers_pending" },
  };
}

async function main(): Promise<void> {
  console.log("== F2.92: grounding factual de send_media ==");

  check("[P0] protocolo descreve a cadeia inteira de fotos sem atalho", COMPACT_OPERATIONAL_PROMPT.includes("cadeia factual de tres estados")
    && COMPACT_OPERATIONAL_PROMPT.includes("use stock_search com a identidade atual para aterrar o veiculo e NAO finalize")
    && COMPACT_OPERATIONAL_PROMPT.includes("query vehicle_photos_resolve e NAO um FINAL")
    && COMPACT_OPERATIONAL_PROMPT.includes("Nunca forneca photoIds"));
  check("[P1] exemplos raiz seguem o schema estrito real", COMPACT_OPERATIONAL_PROMPT.includes('"reasonCode":null,"confidence":null,"guidance":null,"draft":null,"effects":[]')
    && COMPACT_OPERATIONAL_PROMPT.includes('"call":null,"reasonCode":"..."')
    && !COMPACT_OPERATIONAL_PROMPT.includes('"stateMutations":[],"memoryMutations":[],"knowledgeGaps":[]'));

  const transport = new SchemaCaptureTransport();
  const brain = new OpenAiAgentBrain(OpenAiRuntimeSecret.fromString("sk-test-f2-92"), transport, "portal", { model: "gpt-4.1-mini" });
  await brain.proposeNextStep(frame(), []);
  const body = JSON.parse(transport.request?.body ?? "{}") as {
    response_format?: { json_schema?: { schema?: { properties?: { effects?: { items?: { anyOf?: Array<{ properties?: Record<string, unknown>; required?: string[] }> } } } } } };
  };
  const effectBranches = body.response_format?.json_schema?.schema?.properties?.effects?.items?.anyOf ?? [];
  const mediaSchema = effectBranches.find((branch) => {
    const kind = branch.properties?.kind as { enum?: string[] } | undefined;
    return kind?.enum?.includes("send_media");
  });
  check("[P2] schema pede alvo da LLM, mas IDs continuam autoridade da tool", JSON.stringify(mediaSchema?.required) === JSON.stringify(["kind", "vehicleKey"])
    && mediaSchema?.properties?.photoIds === undefined);

  await brain.proposeNextStep(frame(), [{
    tool: "stock_search", ok: true, source: "test",
    data: { items: [], familyCandidates: [], matchKind: "none", filtersUsed: {}, scope: "global" },
  } as never]);
  const requestAfterTool = JSON.parse(transport.request?.body ?? "{}") as {
    messages?: Array<{ role?: string; content?: unknown }>;
  };
  const contextMessage = requestAfterTool.messages?.find((entry) =>
    entry.role === "system" && typeof entry.content === "string" && entry.content.startsWith('{"context"'));
  const contextEnvelope = JSON.parse(typeof contextMessage?.content === "string" ? contextMessage.content : "{}") as {
    context?: { toolControl?: Record<string, unknown> };
  };
  check("[P3] contexto informa fatos resolvidos sem mandar a LLM finalizar", Array.isArray(contextEnvelope.context?.toolControl?.resolvedTools)
    && !("nextStep" in (contextEnvelope.context?.toolControl ?? {})));

  const noMedia = groundProposedMediaEffects([message()], []);
  check("[A1] efeito sem mídia passa sem alteração", noMedia.ok && noMedia.effects.length === 1 && noMedia.effects[0]?.kind === "send_message");

  const noFact = groundProposedMediaEffects([message(), media()], []);
  check("[B1] send_media sem resultado real é rejeitado", !noFact.ok && noFact.feedback.includes("vehicle_photos_resolve"));
  const failedFact: QueryResult = { ok: false, tool: "vehicle_photos_resolve", error: { code: "UPSTREAM", message: "offline", retryable: false } };
  check("[B2] falha da tool não autoriza mídia", !groundProposedMediaEffects([media()], [failedFact]).ok);
  check("[B3] resultado ambíguo não autoriza mídia", !groundProposedMediaEffects([media()], [photos({ ambiguous: true })]).ok);
  check("[B4] resultado de outro veículo não autoriza mídia", !groundProposedMediaEffects([media("car:2")], [photos()]).ok);
  check("[B5] resultado vazio não autoriza mídia", !groundProposedMediaEffects([media()], [photos({ photoIds: [], media: [] })]).ok);

  const grounded = groundProposedMediaEffects([message(), media()], [photos()]);
  const groundedMedia = grounded.ok ? grounded.effects.find((effect) => effect.kind === "send_media") : undefined;
  check("[C1] decisão da LLM é preservada quando o efeito é executável", grounded.ok && grounded.effects.some((effect) => effect.kind === "send_message"));
  check("[C2] IDs inventados são substituídos pelos IDs reais", groundedMedia?.kind === "send_media" && groundedMedia.photoIds.join(",") === "p1,p2");
  check("[C3] snapshot segue a ordem factual da tool", groundedMedia?.kind === "send_media" && groundedMedia.media?.map((item) => item.id).join(",") === "p1,p2");
  const mark = groundedMedia?.kind === "send_media" ? groundedMedia.onSuccess.find((mutation) => mutation.op === "mark_photos_sent") : undefined;
  check("[C4] ledger usa a mesma chave e os mesmos IDs reais", mark?.op === "mark_photos_sent" && mark.vehicleKey === "car:1" && mark.photoIds.join(",") === "p1,p2");

  const reordered = groundProposedMediaEffects([media()], [photos({
    photoIds: ["p2", "p1", "p2"],
    media: [{ id: "p1", url: "https://cdn.test/p1.jpg" }, { id: "p2", url: "https://cdn.test/p2.jpg" }],
  })]);
  const reorderedMedia = reordered.ok ? reordered.effects[0] : undefined;
  check("[C5] IDs duplicados são removidos sem perder a ordem da tool", reorderedMedia?.kind === "send_media" && reorderedMedia.photoIds.join(",") === "p2,p1");
  check("[C6] snapshot é reordenado para acompanhar photoIds", reorderedMedia?.kind === "send_media" && reorderedMedia.media?.map((item) => item.id).join(",") === "p2,p1");

  const partial = groundProposedMediaEffects([media()], [photos({
    media: [{ id: "p1", url: "https://cdn.test/p1.jpg" }],
  })]);
  check("[D1] snapshot parcial falha fechado em vez de perder foto no dispatcher", !partial.ok && partial.feedback.includes("incompleto"));

  const legacy = groundProposedMediaEffects([media()], [photos({ media: undefined })]);
  const legacyMedia = legacy.ok ? legacy.effects[0] : undefined;
  const proposedWithUntrustedSnapshot = {
    ...media(),
    media: [{ id: "invented", url: "https://attacker.invalid/invented.jpg" }],
  } as ProposedEffectPlan;
  const legacyWithUntrustedProposal = groundProposedMediaEffects(
    [proposedWithUntrustedSnapshot],
    [photos({ media: undefined })],
  );
  const safeLegacyMedia = legacyWithUntrustedProposal.ok ? legacyWithUntrustedProposal.effects[0] : undefined;
  check("[D2] fato legado sem snapshot permanece compatível", legacyMedia?.kind === "send_media" && legacyMedia.media == null && legacyMedia.photoIds.length === 2);

  check(
    "[D3] snapshot proposto pela LLM nunca sobrevive sem snapshot factual",
    safeLegacyMedia?.kind === "send_media" && safeLegacyMedia.media == null && safeLegacyMedia.photoIds.join(",") === "p1,p2",
  );

  console.log(`\nF2.92: ${ok} OK / ${fail} FALHA`);
  if (fail) { console.error(failures.join("\n")); process.exit(1); }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
