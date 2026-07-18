// F2.67 — uma falha 4xx da imagem do anúncio não deve matar o primeiro turno.
// A mesma LLM é chamada novamente com o bloco/contexto textual; a engine não redige conteúdo.
import { OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import { OpenAiRuntimeSecret } from "../src/engine/openai-canary-root.ts";
import type { ModelHttpRequest, ModelHttpResponse, ModelHttpTransport } from "../src/adapters/llm/structured-json-model.ts";
import { createInitialPersistedWorkingMemory, type TurnFrame } from "../src/domain/agent-brain.ts";

let ok = 0;
const check = (name: string, pass: boolean): void => { if (pass) { ok++; console.log(`  OK  ${name}`); } else throw new Error(`F2.67: ${name}`); };

class ImageRejectingTransport implements ModelHttpTransport {
  readonly requests: ModelHttpRequest[] = [];
  async postJson(_url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    this.requests.push(request);
    if (this.requests.length === 1) return { status: 400, contentType: "application/json", bodyText: "image_url rejected" };
    return {
      status: 200,
      contentType: "application/json",
      bodyText: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        kind: "final",
        understanding: { primaryIntent: "smalltalk", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [{ capability: null, quote: "Olá" }], isTopicChange: false, answeredLeadQuestions: [] },
        reasonCode: "reply", confidence: 0.9, guidance: "responder ao lead", draft: { parts: [{ type: "text", content: "Olá! Como posso ajudar?" }] },
        effects: [{ kind: "send_message" }],
      }) } }] }),
    };
  }
}

function frame(): TurnFrame {
  return {
    turnId: "f2-67-turn", now: "2026-07-18T15:00:00.000Z", block: "Olá! Posso ter mais informações sobre isso?", portalPromptSha256: "sha",
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [],
    conversationContext: { lastAgentMessage: null, pendingAgentQuestion: null, selectedVehicle: null, lastVisibleOffer: null, lastResolvedSlotAnswer: null, conversationSummary: null },
    currentTurnFacts: { expectedAnswer: { slot: null, lastAgentQuestion: null }, extracted: [], offerReference: null },
    signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous", adGenericEntry: true, adImageUrls: ["https://facebook.com/ad.jpg"] },
  };
}

async function main(): Promise<void> {
  const transport = new ImageRejectingTransport();
  const brain = new OpenAiAgentBrain(OpenAiRuntimeSecret.fromString("sk-test-f2-67"), transport, "Você é Carvalho da Icom Motors.", { model: "gpt-4.1-mini" });
  const step = await brain.proposeNextStep(frame(), []);
  const first = JSON.parse(transport.requests[0].body) as { messages: { role: string; content: unknown }[] };
  const second = JSON.parse(transport.requests[1].body) as { messages: { role: string; content: unknown }[] };
  const firstUser = first.messages.at(-1)?.content;
  const secondUser = second.messages.at(-1)?.content;
  check("segunda tentativa permanece na LLM", step.kind === "final" && step.decision.responsePlan.draft != null);
  check("primeira tentativa carregou a imagem", Array.isArray(firstUser));
  check("retry remove somente a imagem", typeof secondUser === "string" && secondUser === frame().block);
  check("não cria resposta comercial na engine", step.kind === "final" && step.decision.responsePlan.draft?.parts.some((part) => part.type === "text" && part.content.includes("Como posso ajudar")) === true);
  console.log(`== F2.67: ${ok} OK | 0 FALHA ==`);
}

await main();
