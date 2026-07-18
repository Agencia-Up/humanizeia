import { OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import { OpenAiRuntimeSecret } from "../src/engine/openai-canary-root.ts";
import type { ModelHttpRequest, ModelHttpResponse, ModelHttpTransport } from "../src/adapters/llm/structured-json-model.ts";
import { createInitialPersistedWorkingMemory, type TurnFrame } from "../src/domain/agent-brain.ts";

let ok = 0;
const check = (name: string, pass: boolean): void => { if (pass) { ok++; console.log(`  OK  ${name}`); } else throw new Error(`F2.68: ${name}`); };

class StableTransport implements ModelHttpTransport {
  readonly requests: ModelHttpRequest[] = [];
  async postJson(_url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    this.requests.push(request);
    const content = {
      kind: "final",
      understanding: { primaryIntent: "smalltalk", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [{ capability: null, quote: "Olá" }], isTopicChange: false, answeredLeadQuestions: [] },
      reasonCode: "reply", confidence: 0.9, guidance: "responder ao lead",
      draft: { parts: [{ type: "text", content: "Olá! Como posso ajudar?" }] }, effects: [{ kind: "send_message" }],
    };
    return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }) };
  }
}

function frame(): TurnFrame {
  return {
    turnId: "f2-68-turn", now: "2026-07-18T15:00:00.000Z", block: "Olá! Posso ter mais informações sobre isso?", portalPromptSha256: "sha",
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [],
    conversationContext: { lastAgentMessage: null, pendingAgentQuestion: null, selectedVehicle: null, lastVisibleOffer: null, lastResolvedSlotAnswer: null, conversationSummary: null },
    currentTurnFacts: { expectedAnswer: { slot: null, lastAgentQuestion: null }, extracted: [], offerReference: null },
    signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: null, isMemoryQuestion: false, relation: "ambiguous", adGenericEntry: true, adImageUrls: ["https://facebook.com/ad-page", "https://cdn.fbcdn.net/creative.jpg"] },
  };
}

async function main(): Promise<void> {
  const transport = new StableTransport();
  const imageFetcher = async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    if (String(input).includes("ad-page")) return new Response("<html>not an image</html>", { status: 200, headers: { "content-type": "text/html" } });
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  const brain = new OpenAiAgentBrain(OpenAiRuntimeSecret.fromString("sk-test-f2-68"), transport, "portal", { model: "gpt-4.1-mini", imageFetcher });
  const step = await brain.proposeNextStep(frame(), []);
  const body = transport.requests[0].body;
  const request = JSON.parse(body) as { messages: { content: unknown }[] };
  const content = request.messages.at(-1)?.content;
  check("uma chamada ao provider", transport.requests.length === 1);
  check("LLM continua autora", step.kind === "final" && step.decision.responsePlan.draft != null);
  check("usa bytes da imagem válida", Array.isArray(content) && JSON.stringify(content).includes("data:image/jpeg;base64,AQIDBA=="));
  check("não envia URL Meta bruta", !body.includes("ad-page") && !body.includes("cdn.fbcdn.net/creative.jpg"));
  console.log(`== F2.68: ${ok} OK | 0 FALHA ==`);
}

await main();
