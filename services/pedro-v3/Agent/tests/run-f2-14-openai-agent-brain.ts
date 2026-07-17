// ============================================================================
// F2.14 — R13 Inc2/F: OpenAiAgentBrain (adapter REAL) validado OFFLINE via transporte FAKE ($0, sem rede).
// Prova: decode query|final, restrição de tool (allowlist), JSON malformado -> final seguro (sem crash/silêncio),
// prompt INTEGRAL do portal no system + promptSha256, segredo NUNCA no corpo/JSON, stateMutations estampam turnId.
//   npx tsx tests/run-f2-14-openai-agent-brain.ts
// ============================================================================
import { OpenAiAgentBrain } from "../src/adapters/llm/openai-agent-brain.ts";
import { OpenAiRuntimeSecret } from "../src/engine/openai-canary-root.ts";
import type { ModelHttpTransport, ModelHttpRequest, ModelHttpResponse } from "../src/adapters/llm/structured-json-model.ts";
import type { TurnFrame, AgentToolObservation } from "../src/domain/agent-brain.ts";
import { createInitialPersistedWorkingMemory } from "../src/domain/agent-brain.ts";
import type { VehicleFact } from "../src/domain/types.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

class CannedTransport implements ModelHttpTransport {
  lastRequest?: ModelHttpRequest;
  lastUrl = "";
  constructor(private readonly content: string, private readonly status = 200) {}
  async postJson(url: string, request: ModelHttpRequest): Promise<ModelHttpResponse> {
    this.lastUrl = url; this.lastRequest = request;
    return { status: this.status, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: this.content } }] }) };
  }
}
const PORTAL_PROMPT = "Você é a Aloan, atendente da Loja Piloto. Seja cordial e objetiva. PROMPT-INTEGRAL-MARKER-42.";
const SECRET = OpenAiRuntimeSecret.fromString("sk-test-CANARY-KEY-should-never-appear");
function frame(block: string): TurnFrame {
  return {
    turnId: "t-brain-1", now: "2026-07-03T12:00:00.000Z", block, portalPromptSha256: "sha",
    workingMemory: { ...createInitialPersistedWorkingMemory(), funnel: { known: [], declined: [], deferred: [], suggestedObjective: null }, selectedVehicle: null, lastOffer: null },
    recentTranscript: [],
    conversationContext: { lastAgentMessage: null, pendingAgentQuestion: null, selectedVehicle: null, lastVisibleOffer: null, lastResolvedSlotAnswer: null, conversationSummary: null },
    currentTurnFacts: { expectedAnswer: { slot: null, lastAgentQuestion: null }, extracted: [], offerReference: null },
    signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: "suv", isMemoryQuestion: false, relation: "direction_change" },
  };
}
function brainWith(content: string, status = 200): { brain: OpenAiAgentBrain; transport: CannedTransport } {
  const transport = new CannedTransport(content, status);
  const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, { model: "gpt-4.1-mini" });
  return { brain, transport };
}
const criticPass = (args: {
  readonly leadEvidence: string;
  readonly visibleEvidence: string;
  readonly portalIdentityEvidence?: string | null;
  readonly openingIdentityEvidence?: string | null;
  readonly effectClaimEvidence?: string | null;
}): string => JSON.stringify({
  pass: true,
  currentLeadAct: "ato atual corretamente identificado",
  candidateVisibleAct: "responde visivelmente ao ato atual",
  nextQuestionAct: null,
  currentLeadLane: "other",
  priorAssistantLane: null,
  nextQuestionLane: "other",
  nextQuestionIsQualificationField: false,
  portalQuestionSupportEvidence: null,
  currentLeadEvidence: args.leadEvidence,
  visibleCurrentActEvidence: args.visibleEvidence,
  effectClaimEvidence: args.effectClaimEvidence ?? null,
  checks: { currentAct: true, roleBinding: true, noRepetition: true, nameModeration: true, unambiguousQuestion: true, nextQuestionContinuity: true, effectCoherence: true, openingIdentity: true },
  portalIdentityEvidence: args.portalIdentityEvidence ?? null,
  openingIdentityEvidence: args.openingIdentityEvidence ?? null,
  feedback: "",
});

async function main(): Promise<void> {
  console.log("== F2.14 OpenAiAgentBrain (offline, fake transport) ==");

  // [1] query decode
  {
    const { brain } = brainWith(JSON.stringify({ kind: "query", call: { tool: "stock_search", input: { tipo: "suv", precoMax: 90000 } } }));
    const step = await brain.proposeNextStep(frame("quero uma suv"), []);
    check("[1] decode query stock_search (tipo+precoMax)", step.kind === "query" && step.call.tool === "stock_search" && (step.call.input as { tipo?: string; precoMax?: number }).tipo === "suv" && (step.call.input as { precoMax?: number }).precoMax === 90000);
  }
  // [2] final decode com send_media + guidance
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", reasonCode: "photo", confidence: 0.9, guidance: "Aqui estão as fotos que você pediu", effects: [{ kind: "send_message" }, { kind: "send_media", vehicleKey: "rm:1", photoIds: ["p1", "p2"] }] }));
    const step = await brain.proposeNextStep(frame("manda foto"), []);
    const media = step.kind === "final" && step.decision.proposedEffects.find((e) => e.kind === "send_media");
    check("[2] decode final + send_media aterrado", step.kind === "final" && !!media && (media as { vehicleKey?: string }).vehicleKey === "rm:1" && step.decision.responsePlan.guidance.includes("fotos"));
  }
  // [2a] A LLM decide o efeito; o adapter materializa argumentos opacos a
  // partir do unico resultado factual de fotos, como um node N8N faria.
  {
    const observations: AgentToolObservation[] = [{
      tool: "vehicle_photos_resolve",
      ok: true,
      data: { vehicleKey: "rm:2", ambiguous: false, photoIds: ["p3", "p4"] },
    }];
    const { brain } = brainWith(JSON.stringify({
      kind: "final",
      reasonCode: "photo",
      guidance: "Enviar as fotos pedidas",
      effects: [{ kind: "send_message" }, { kind: "send_media" }],
    }));
    const step = await brain.proposeNextStep(frame("manda foto do segundo"), observations);
    const media = step.kind === "final" && step.decision.proposedEffects.find((effect) => effect.kind === "send_media");
    check("[2a] send_media minimo usa vehicleKey/photoIds da tool deste turno",
      !!media
      && media.kind === "send_media"
      && media.vehicleKey === "rm:2"
      && JSON.stringify(media.photoIds) === JSON.stringify(["p3", "p4"]));
  }
  // [2b] Resultado de tool sozinho nunca cria envio: a decisao continua sendo
  // exclusivamente da LLM por meio do effect send_media.
  {
    const observations: AgentToolObservation[] = [{
      tool: "vehicle_photos_resolve",
      ok: true,
      data: { vehicleKey: "rm:2", ambiguous: false, photoIds: ["p3", "p4"] },
    }];
    const { brain } = brainWith(JSON.stringify({
      kind: "final",
      reasonCode: "reply",
      guidance: "Responder sem enviar midia",
      effects: [{ kind: "send_message" }],
    }));
    const step = await brain.proposeNextStep(frame("vamos falar de outra coisa"), observations);
    check("[2b] adapter nao sintetiza send_media sem decisao explicita da LLM",
      step.kind === "final" && !step.decision.proposedEffects.some((effect) => effect.kind === "send_media"));
  }
  // [3] tool proibida/desconhecida -> final seguro (não trava)
  {
    const { brain } = brainWith(JSON.stringify({ kind: "query", call: { tool: "delete_everything", input: {} } }));
    const step = await brain.proposeNextStep(frame("oi"), []);
    check("[3] tool desconhecida -> final seguro", step.kind === "final" && step.decision.reasonCode === "brain_fallback");
  }
  // [3b] allowlist restrita: crm_read fora do allowlist -> final seguro
  {
    const transport = new CannedTransport(JSON.stringify({ kind: "query", call: { tool: "crm_read", input: { leadId: "x" } } }));
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, { model: "gpt-4.1-mini", allowedTools: ["stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info"] });
    const step = await brain.proposeNextStep(frame("oi"), []);
    check("[3b] crm_read fora do allowlist -> final seguro", step.kind === "final");
  }
  // [4] JSON malformado -> final seguro (sem crash, sem silêncio)
  {
    const { brain } = brainWith("isto não é json {");
    const step = await brain.proposeNextStep(frame("oi"), []);
    check("[4] JSON malformado -> final seguro", step.kind === "final" && step.decision.responsePlan.guidance.length > 0);
  }
  // [4b] HTTP não-2xx -> final seguro
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", guidance: "x" }), 429);
    const step = await brain.proposeNextStep(frame("oi"), []);
    check("[4b] HTTP 429 -> final seguro", step.kind === "final" && step.decision.reasonCode === "brain_fallback");
  }
  // [5] prompt INTEGRAL do portal no system + promptSha256
  {
    const { brain, transport } = brainWith(JSON.stringify({ kind: "final", guidance: "ok" }));
    await brain.proposeNextStep(frame("oi"), []);
    const body = JSON.parse(transport.lastRequest!.body) as { messages: { role: string; content: string }[] };
    const sys = body.messages.find((m) => m.role === "system")?.content ?? "";
    const crypto = await import("node:crypto");
    const expectedSha = crypto.createHash("sha256").update(PORTAL_PROMPT, "utf8").digest("hex");
    check("[5] prompt do portal presente INTEGRALMENTE no system", sys.includes(PORTAL_PROMPT) && sys.includes("PROMPT-INTEGRAL-MARKER-42"));
    check("[5] promptSha256 correto", brain.promptSha256 === expectedSha);
    check("[5a] contrato nao exige autoauditoria paralela no JSON", !sys.includes("conversationCheck") && !sys.includes("AUTOAVALIACAO CONVERSACIONAL"));
    check("[5a] campos comerciais continuam sob autoridade fechada do portal", sys.includes("somente os que o prompt do portal nomeia") && sys.includes("nao realiza triagem mecanica"));
    check("[5a-photo] protocolo explica send_media minimo aterrado pela tool",
      sys.includes('inclua {"kind":"send_media"} em effects') && sys.includes("unico vehicleKey/photoIds aterrado"));
    check("[5a-ad] protocolo trata anuncio exato como foco singular, nao lista implicita",
      sys.includes("use o resultado como FOCO SINGULAR")
      && sys.includes("Nao use vehicle_offer_list e nao mostre alternativas nessa abertura")
      && sys.includes('use EXATAMENTE uma part {"type":"message_break"}'));

    const contextFrame: TurnFrame = {
      ...frame("mostra o azul"),
      recentTranscript: [
        { role: "lead", text: "Quero ver os carros" },
        { role: "agent", text: "Qual carro da lista voce quer ver as fotos?" },
      ],
      conversationContext: {
        lastAgentMessage: "Qual carro da lista voce quer ver as fotos?",
        pendingAgentQuestion: { slot: "possuiTroca", sinceTurnId: "old-turn" },
        selectedVehicle: null,
        lastVisibleOffer: {
          sourceTurnId: "offer-turn",
          items: [{ ordinal: 2, vehicleKey: "rm:corolla-2016", marca: "Toyota", modelo: "Corolla", ano: 2016, cor: "Azul", preco: 89990, cambio: "Automatico", tipo: "sedan" }],
        },
        lastResolvedSlotAnswer: null,
        conversationSummary: "Lead pediu fotos de um sedan.",
      },
      currentTurnFacts: {
        expectedAnswer: { slot: "possuiTroca", lastAgentQuestion: "Você tem carro para troca?" },
        extracted: [{ slot: "formaPagamento", kind: "value", value: "consorcio" }],
        offerReference: { status: "unique", candidateVehicleKeys: ["rm:corolla-2016"], matchedBy: ["cor"] },
      },
      signals: {
        ...frame("mostra o azul").signals,
        currentTurnIntent: "search",
        adVehicle: "Toyota Corolla 2016",
        firstContactNoCommercialTarget: true,
        specificAdEntry: true,
        disengagementOnly: true,
        selectedOfferThisTurn: true,
        acceptedPhotoOffer: true,
      },
    };
    await brain.proposeNextStep(contextFrame, []);
    const contextBody = JSON.parse(transport.lastRequest!.body) as { messages: { role: string; content: string }[] };
    const contextMessage = contextBody.messages.find((m, index) => index > 0 && m.role === "system" && m.content.includes('"context"'))?.content ?? "{}";
    const currentUser = contextBody.messages.at(-1);
    check("[5c] envelope factual unico chega ao cerebro", contextMessage.includes('"context"')
      && contextMessage.includes("Corolla") && contextMessage.includes("Azul")
      && contextMessage.includes("currentTurnFacts") && contextMessage.includes("consorcio"));
    check("[5c-n8n] historico viaja como papeis reais e bloco atual e o ultimo user", contextBody.messages.some((m) => m.role === "assistant" && m.content.includes("Qual carro"))
      && contextBody.messages.some((m) => m.role === "user" && m.content === "Quero ver os carros")
      && currentUser?.role === "user" && currentUser.content === "mostra o azul");
    const payload = JSON.parse(contextMessage) as { context?: { schemaVersion?: number; currentTurn?: { leadBlock?: unknown; openingContext?: Record<string, unknown>; sourceContext?: Record<string, unknown>; currentTurnFacts?: Record<string, unknown> }; memory?: { funnel?: Record<string, unknown>; openLoops?: unknown; suggestedObjective?: unknown }; assistant?: Record<string, unknown>; history?: Record<string, unknown>; conversation?: Record<string, unknown>; capabilities?: Record<string, unknown>; tools?: unknown }; runtimeContext?: unknown; signals?: unknown; leadBlock?: unknown; instruction?: unknown };
    check("[5e-envelope] schema unico sem instrucao top-level concorrente", payload.context?.schemaVersion === 1 && payload.instruction === undefined && payload.runtimeContext === undefined);
    check("[5e-context] bloco atual esta dentro do envelope", payload.context?.currentTurn?.leadBlock === "mostra o azul");
    check("[5e] contexto nao carrega proxima pergunta derivada nem sinais de condução", payload.leadBlock === undefined
      && payload.context?.memory?.funnel?.suggestedObjective === undefined
      && payload.signals === undefined
      && payload.context?.capabilities?.currentTurnIntent === undefined
      && payload.context?.capabilities?.firstContactNoCommercialTarget === undefined
      && payload.context?.capabilities?.disengagementOnly === undefined
      && payload.context?.capabilities?.selectedOfferThisTurn === undefined
      && payload.context?.capabilities?.acceptedPhotoOffer === undefined
      && Array.isArray(payload.context?.history?.recent)
      && payload.context?.conversation !== undefined
      && !contextMessage.includes("expectedAnswer")
      && payload.context?.assistant?.lastMessage === "Qual carro da lista voce quer ver as fotos?");
    check("[5e-opening] contexto factual do anuncio chega sem diagnostico comercial derivado",
      payload.context?.currentTurn?.openingContext?.specificAdEntry === true
      && payload.context?.currentTurn?.openingContext?.firstAssistantTurn === false
      && payload.context?.currentTurn?.openingContext?.firstContactNoCommercialTarget === undefined
      && payload.context?.currentTurn?.sourceContext?.kind === "paid_ad"
      && payload.context?.currentTurn?.sourceContext?.advertisedVehicle === "Toyota Corolla 2016"
      && payload.context?.capabilities?.adVehicle === undefined);
  }
  // [5b] retry pós-policy usa modelo mais forte sem encarecer o caminho normal
  {
    const transport = new CannedTransport(JSON.stringify({ kind: "final", guidance: "ok" }));
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, { model: "gpt-4.1-mini", retryModel: "gpt-4.1" });
    await brain.proposeNextStep(frame("obrigado"), []);
    const firstBody = JSON.parse(transport.lastRequest!.body) as { model: string };
    await brain.proposeNextStep(frame("obrigado"), [{ tool: "response", ok: false, error: { code: "POLICY", message: "reescreva" } }]);
    const retryBody = JSON.parse(transport.lastRequest!.body) as { model: string };
    check("[5b] caminho normal permanece no mini", firstBody.model === "gpt-4.1-mini");
    check("[5b] retry pós-policy escala para modelo forte", retryBody.model === "gpt-4.1");
  }
  // [5d] o modelo pode descrever "Corolla azul" como modelo, mas se ELE MESMO
  // escolheu a key que o fato único da lista aponta, o adapter só normaliza o
  // enum para offer_reference; não escolhe intenção, ferramenta ou veículo.
  {
    const { brain } = brainWith(JSON.stringify({
      kind: "query",
      call: { tool: "vehicle_photos_resolve", input: { vehicleKey: "rm:corolla-2016" } },
      understanding: {
        primaryIntent: "request_photos", requestedCapabilities: ["send_photos"],
        subject: "explicit_model", subjectValue: "Corolla azul", subjectSource: "current_turn",
        evidence: [{ capability: "send_photos", quote: "Mostra o azul" }], isTopicChange: false, answeredLeadQuestions: [],
      },
    }));
    const referenceFrame: TurnFrame = {
      ...frame("Mostra o azul"),
      currentTurnFacts: {
        expectedAnswer: { slot: null, lastAgentQuestion: "Qual carro da lista voce quer ver as fotos?" },
        extracted: [],
        offerReference: { status: "unique", candidateVehicleKeys: ["rm:corolla-2016"], matchedBy: ["cor"] },
      },
    };
    const step = await brain.proposeNextStep(referenceFrame, []);
    check("[5d] normaliza somente rotulo inconsistente com key ja escolhida pela LLM", step.kind === "query"
      && step.call.tool === "vehicle_photos_resolve" && step.call.input.vehicleRef.key === "rm:corolla-2016"
      && step.understanding?.subject === "offer_reference" && step.understanding.subjectSource === "memory");
  }
  // [6] segredo NUNCA no corpo/JSON serializável (só no header via materialize)
  {
    const { brain, transport } = brainWith(JSON.stringify({ kind: "final", guidance: "ok" }));
    await brain.proposeNextStep(frame("oi"), []);
    const bodyHasKey = transport.lastRequest!.body.includes("CANARY-KEY");
    const authHeader = (transport.lastRequest!.headers as Record<string, string>).authorization ?? "";
    check("[6] segredo fora do body", !bodyHasKey);
    check("[6] segredo só no header authorization", authHeader.includes("CANARY-KEY"));
    check("[6] segredo não vaza em JSON.stringify(secret)", !JSON.stringify(SECRET).includes("CANARY-KEY"));
  }
  // [7] stateMutations estampadas com turnId do frame (não do modelo)
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", guidance: "beleza", stateMutations: [{ op: "set_slot", slot: "possuiTroca", value: true }, { op: "set_slot", slot: "tipoVeiculo", value: "suv" }] }));
    const step = await brain.proposeNextStep(frame("tenho um gol na troca e quero uma suv"), []);
    const sm = step.kind === "final" ? step.decision.stateMutations ?? [] : [];
    const troca = sm.find((m) => m.op === "set_slot" && m.slot === "possuiTroca");
    check("[7] stateMutations set_slot estampam sourceTurnId=frame.turnId", !!troca && (troca as { sourceTurnId?: string }).sourceTurnId === "t-brain-1" && sm.length === 2);
  }
  // [8] memoryMutations curadas + turnId estampado
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", guidance: "oi", memoryMutations: [{ op: "set_lead_intent", intent: "discover_stock", confidence: 0.9, evidence: ["quer suv"] }, { op: "op_desconhecida" }] }));
    const step = await brain.proposeNextStep(frame("quero suv"), []);
    const mm = step.kind === "final" ? step.decision.memoryMutations : [];
    check("[8] memoryMutations: op válida mantida + turnId; desconhecida descartada", mm.length === 1 && mm[0].op === "set_lead_intent" && (mm[0] as { turnId?: string }).turnId === "t-brain-1");
  }

  // ── Autoria única (audit): decode de responsePlan.draft ────────────────────────────────────────────────────
  // [9] draft VÁLIDO completo decodifica em responsePlan.draft (parts estruturadas na ordem).
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", reasonCode: "answer", confidence: 0.9, guidance: "resumo", draft: { parts: [{ type: "text", content: "Ele tem" }, { type: "vehicle_ref", vehicleKey: "rm:2", field: "km" }, { type: "text", content: "km." }] }, effects: [{ kind: "send_message" }] }));
    const step = await brain.proposeNextStep(frame("quantos km"), []);
    const d = step.kind === "final" ? step.decision.responsePlan.draft : null;
    check("[9] draft válido completo decodifica em responsePlan.draft", step.kind === "final" && !!d && d.parts.length === 3 && d.parts[1].type === "vehicle_ref" && (d.parts[1] as { field?: string }).field === "km");
  }
  // [9a] a LLM escolhe explicitamente a fronteira entre balões.
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", reasonCode: "opening", confidence: 0.9, guidance: "dois baloes", draft: { parts: [{ type: "text", content: "Sou o Carvalho. Tudo bem?" }, { type: "message_break" }, { type: "text", content: "Vi que voce se interessou no carro." }] }, effects: [{ kind: "send_message" }] }));
    const step = await brain.proposeNextStep(frame("oi"), []);
    const d = step.kind === "final" ? step.decision.responsePlan.draft : null;
    check("[9a] message_break tipado e preservado no draft", !!d && d.parts.length === 3 && d.parts[1].type === "message_break");
  }
  // [9b] compatibilidade de transporte: a LLM pode ainda devolver o mesmo
  // contrato dentro de responsePlan; a borda aceita, sem criar decisão nova.
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", responsePlan: { guidance: "fotos prontas", draft: { parts: [{ type: "text", content: "Aqui estão as fotos." }] } }, effects: [{ kind: "send_message" }] }));
    const step = await brain.proposeNextStep(frame("me manda as fotos"), []);
    const d = step.kind === "final" ? step.decision.responsePlan.draft : null;
    check("[9b] draft legado aninhado em responsePlan é aceito na borda", step.kind === "final" && !!d && d.parts.length === 1 && step.decision.responsePlan.guidance === "fotos prontas");
  }
  // [10] QUALQUER part inválida invalida o DRAFT INTEIRO (não descarta parcialmente e envia o resto).
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", guidance: "x", draft: { parts: [{ type: "text", content: "ok" }, { type: "vehicle_ref", vehicleKey: "rm:2", field: "PLACA_INVALIDA" }] } }));
    const step = await brain.proposeNextStep(frame("x"), []);
    check("[10] part inválida invalida o DRAFT inteiro (rejeição integral)", step.kind === "final" && step.decision.responsePlan.draft === null);
  }
  // [10b] erro estrutural devolve feedback preciso ao mesmo cérebro, sem
  // consertar silenciosamente a autoria nem executar efeito por conta própria.
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", guidance: "fotos", draft: { parts: [{ type: "text", content: "Aqui estão." }, { type: "send_media", vehicleKey: "rm:2" }, { type: "vehicle_ref", vehicleKey: "rm:2" }] } }));
    const step = await brain.proposeNextStep(frame("me manda as fotos"), []);
    check("[10b] draft malformado informa tipos/fields inválidos para o retry", step.kind === "final" && step.decision.responsePlan.draft === null && step.decision.reasonSummary.startsWith("draft_invalid:") && step.decision.reasonSummary.includes("send_media"));
  }
  // [11] money_ref ESTRITO: role/source validados; source divergente invalida (sem correção silenciosa).
  {
    const bad1 = brainWith(JSON.stringify({ kind: "final", guidance: "x", draft: { parts: [{ type: "money_ref", role: "vehicle_price", source: { kind: "slot_value", slotName: "entrada" } }] } })).brain;
    const s1 = await bad1.proposeNextStep(frame("preco"), []);
    const bad2 = brainWith(JSON.stringify({ kind: "final", guidance: "x", draft: { parts: [{ type: "money_ref", role: "down_payment", source: { kind: "slot_value", slotName: "faixaPreco" } }] } })).brain;
    const s2 = await bad2.proposeNextStep(frame("entrada"), []);
    const good = brainWith(JSON.stringify({ kind: "final", guidance: "x", draft: { parts: [{ type: "money_ref", role: "vehicle_price", source: { kind: "vehicle_fact", vehicleKey: "rm:2" } }] } })).brain;
    const s3 = await good.proposeNextStep(frame("preco"), []);
    const d3 = s3.kind === "final" ? s3.decision.responsePlan.draft : null;
    check("[11] money_ref role/source estrito: source divergente invalida; válido decodifica",
      s1.kind === "final" && s1.decision.responsePlan.draft === null && s2.kind === "final" && s2.decision.responsePlan.draft === null && !!d3 && d3.parts[0].type === "money_ref");
  }
  // [12] query -> observação -> final CORRIGIDO com draft (loop de correção do MESMO cérebro).
  {
    const seq = [
      JSON.stringify({ kind: "query", call: { tool: "vehicle_details", input: { vehicleKey: "rm:2" } } }),
      JSON.stringify({ kind: "final", guidance: "ok", draft: { parts: [{ type: "text", content: "Tem" }, { type: "vehicle_ref", vehicleKey: "rm:2", field: "km" }, { type: "text", content: "km" }] } }),
    ];
    let i = 0;
    const transport: ModelHttpTransport = { async postJson(_url: string, _req: ModelHttpRequest): Promise<ModelHttpResponse> { return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) }; } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, { model: "gpt-4.1-mini" });
    const s1 = await brain.proposeNextStep(frame("quantos km"), []);
    const veh: VehicleFact = { vehicleKey: "rm:2", marca: "Chevrolet", modelo: "Onix", ano: 2014, preco: 42990, km: 132623, tipo: "hatch" };
    const obs: AgentToolObservation[] = [{ tool: "vehicle_details", ok: true, data: { vehicle: veh } }];
    const s2 = await brain.proposeNextStep(frame("quantos km"), obs);
    const d2 = s2.kind === "final" ? s2.decision.responsePlan.draft : null;
    check("[12] query -> observação -> final corrigido com draft", s1.kind === "query" && s1.call.tool === "vehicle_details" && s2.kind === "final" && !!d2 && d2.parts.some((p) => p.type === "vehicle_ref" && p.field === "km"));
  }

  // [13] O avaliador semantico nao escreve nem escolhe assunto: devolve
  // feedback e a mesma LLM reautora uma unica vez pelo caminho de retry.
  {
    const understanding = { primaryIntent: "trade_in", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] };
    const seq = [
      JSON.stringify({ kind: "final", understanding, guidance: "ruim", draft: { parts: [{ type: "text", content: "Veronica, qual e seu nome?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      JSON.stringify({ pass: false, feedback: "A pergunta repete um dado ja informado; trate o carro de troca." }),
      JSON.stringify({ kind: "final", understanding, guidance: "corrigida", draft: { parts: [{ type: "text", content: "Sou a Aloan da Loja Piloto. Qual a quilometragem do seu carro?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      criticPass({ leadEvidence: "Tenho um carro para troca", visibleEvidence: "Qual a quilometragem do seu carro?", portalIdentityEvidence: PORTAL_PROMPT, openingIdentityEvidence: "Sou a Aloan da Loja Piloto." }),
    ];
    let i = 0;
    const calls: ModelHttpRequest[] = [];
    const transport: ModelHttpTransport = { async postJson(_url: string, req: ModelHttpRequest): Promise<ModelHttpResponse> {
      calls.push(req);
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, {
      model: "gpt-4.1", retryModel: "gpt-4.1", semanticCriticEnabled: true, semanticCriticModel: "gpt-4.1-mini",
    });
    const step = await brain.proposeNextStep(frame("Meu nome e Veronica. Tenho um carro para troca"), []);
    const draft = step.kind === "final" ? step.decision.responsePlan.draft : null;
    const textPart = draft?.parts.find((part) => part.type === "text");
    const models = calls.map((call) => JSON.parse(call.body) as { model?: string }).map((body) => body.model);
    check("[13] critic semantico reprova e a mesma LLM reautora uma vez",
      calls.length === 4 && models[1] === "gpt-4.1-mini" && textPart?.type === "text" && textPart.content.includes("quilometragem"),
      `calls=${calls.length} models=${models.join(",")} text=${textPart?.type === "text" ? textPart.content : "<none>"}`);
  }

  // [14] O critic nao pode aprovar uma apresentacao inexistente: no primeiro
  // turno, a evidencia precisa estar literalmente no draft e conter a identidade
  // factual configurada. O adapter apenas valida essa prova; a LLM reescreve.
  {
    const understanding = { primaryIntent: "trade_in", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] };
    const seq = [
      JSON.stringify({ kind: "final", understanding, guidance: "sem apresentacao", draft: { parts: [{ type: "text", content: "Bom dia, Veronica! Qual a quilometragem do seu Sonic?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      JSON.stringify({ pass: true, currentLeadAct: "troca", candidateVisibleAct: "pergunta quilometragem", nextQuestionAct: "troca", currentLeadLane: "trade_vehicle", priorAssistantLane: null, nextQuestionLane: "trade_vehicle", nextQuestionIsQualificationField: false, portalQuestionSupportEvidence: null, currentLeadEvidence: "Tenho um Sonic para troca", visibleCurrentActEvidence: "Qual a quilometragem do seu Sonic?", effectClaimEvidence: null, checks: { currentAct: true, roleBinding: true, noRepetition: true, nameModeration: true, unambiguousQuestion: true, nextQuestionContinuity: true, effectCoherence: true, openingIdentity: true }, portalIdentityEvidence: "PROMPT-INTEGRAL-MARKER-42", openingIdentityEvidence: "Bom dia, Veronica!", feedback: "" }),
      JSON.stringify({ kind: "final", understanding, guidance: "com apresentacao", draft: { parts: [{ type: "text", content: "Bom dia! Sou a Aloan, atendente da Loja Piloto. Qual a quilometragem do seu Sonic?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      criticPass({ leadEvidence: "Tenho um Sonic para troca", visibleEvidence: "Qual a quilometragem do seu Sonic?", portalIdentityEvidence: PORTAL_PROMPT, openingIdentityEvidence: "Sou a Aloan, atendente da Loja Piloto." }),
    ];
    let i = 0;
    const transport: ModelHttpTransport = { async postJson(_url: string, _req: ModelHttpRequest): Promise<ModelHttpResponse> {
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, {
      model: "gpt-4.1", retryModel: "gpt-4.1", semanticCriticEnabled: true, semanticCriticModel: "gpt-4.1",
    });
    const step = await brain.proposeNextStep(frame("Meu nome e Veronica. Tenho um Sonic para troca"), []);
    const draft = step.kind === "final" ? step.decision.responsePlan.draft : null;
    const textPart = draft?.parts.find((part) => part.type === "text");
    check("[14] critic exige evidencia literal da identidade definida no portal no primeiro turno",
      i === 4 && textPart?.type === "text" && textPart.content.includes("Aloan") && textPart.content.includes("Loja Piloto"),
      `calls=${i} text=${textPart?.type === "text" ? textPart.content : "<none>"}`);
  }

  // [15] Uma oferta identica a ultima lista visivel nao e reenviada. A LLM
  // revisora pode remover apenas essa part repetida; nenhuma part factual nova
  // pode ser criada pela infraestrutura.
  {
    const understanding = { primaryIntent: "search_stock", requestedCapabilities: [], subject: "budget", subjectValue: "100 mil", subjectSource: "current_turn", evidence: [], isTopicChange: false, answeredLeadQuestions: [] };
    const seq = [
      JSON.stringify({ kind: "final", understanding, guidance: "relistar", draft: { parts: [{ type: "vehicle_offer_list", vehicleKeys: ["rm:1", "rm:2"] }, { type: "text", content: "Essas sao as opcoes ate 100 mil." }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      JSON.stringify({ draft: { parts: [{ type: "text", content: "As opcoes que enviei ja estao dentro do limite de R$ 100 mil. Quer detalhes de algum modelo?" }] } }),
      criticPass({ leadEvidence: "Ate 100 mil", visibleEvidence: "As opcoes que enviei ja estao dentro do limite de R$ 100 mil." }),
    ];
    let i = 0;
    const transport: ModelHttpTransport = { async postJson(_url: string, _req: ModelHttpRequest): Promise<ModelHttpResponse> {
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, {
      model: "gpt-4.1", retryModel: "gpt-4.1", semanticCriticEnabled: true, semanticCriticModel: "gpt-4.1",
    });
    const repeatedOfferFrame: TurnFrame = {
      ...frame("Ate 100 mil"),
      recentTranscript: [{ role: "agent", text: "1. Carro A\n2. Carro B" }, { role: "lead", text: "Ate 100 mil" }],
      conversationContext: {
        ...frame("x").conversationContext,
        lastVisibleOffer: {
          sourceTurnId: "previous",
          items: [
            { ordinal: 1, vehicleKey: "rm:1", marca: "A", modelo: "Um", ano: 2020, cor: null, preco: 80000, cambio: null, tipo: "suv" },
            { ordinal: 2, vehicleKey: "rm:2", marca: "B", modelo: "Dois", ano: 2021, cor: null, preco: 90000, cambio: null, tipo: "suv" },
          ],
        },
      },
    };
    const step = await brain.proposeNextStep(repeatedOfferFrame, []);
    const draft = step.kind === "final" ? step.decision.responsePlan.draft : null;
    check("[15] revisor LLM remove lista identica sem criar nova part factual",
      i === 3 && draft?.parts.length === 1 && draft.parts[0]?.type === "text" && draft.parts[0].content.includes("100 mil"));
  }

  // [15b] Defeito puramente formal usa uma revisao estreita do draft. A
  // intencao e os efeitos da autora principal permanecem intocados.
  {
    const understanding = { primaryIntent: "trade_in", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [{ quote: "HRV para troca" }], isTopicChange: true, answeredLeadQuestions: [] };
    const seq = [
      JSON.stringify({ kind: "final", understanding, guidance: "avancar pagamento", draft: { parts: [{ type: "text", content: "Entendi sua HR-V. Pretende financiar ou pagar a vista?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      JSON.stringify({ draft: { parts: [{ type: "text", content: "Entendi sua HR-V. Como pretende fazer o pagamento?" }] } }),
    ];
    let i = 0;
    const transport: ModelHttpTransport = { async postJson(): Promise<ModelHttpResponse> {
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, { model: "gpt-4.1", retryModel: "gpt-4.1" });
    const step = await brain.proposeNextStep(frame("HRV para troca"), []);
    const textPart = step.kind === "final" ? step.decision.responsePlan.draft?.parts.find((part) => part.type === "text") : null;
    check("[15b] revisao formal preserva a autoridade comercial da autora", i === 2 && step.kind === "final"
      && step.understanding?.primaryIntent === "trade_in" && step.decision.proposedEffects.some((effect) => effect.kind === "send_message")
      && textPart?.type === "text" && /como pretende/i.test(textPart.content) && !/ ou /i.test(textPart.content), `calls=${i}`);
  }

  // [16] O auditor recebe a fronteira local completa: fala atual, ultima fala
  // do agente e fatos extraidos. Ele nao escolhe o proximo assunto; quando
  // reprova currentAct, a mesma LLM replaneja a decisao inteira.
  {
    const tradeUnderstanding = { primaryIntent: "trade_in", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "memory", evidence: [], isTopicChange: false, answeredLeadQuestions: [] };
    const financingUnderstanding = { primaryIntent: "financing", requestedCapabilities: [], subject: "budget", subjectValue: "20 mil", subjectSource: "current_turn", evidence: [{ quote: "20 mil de entrada" }], isTopicChange: true, answeredLeadQuestions: [] };
    const seq = [
      JSON.stringify({ kind: "final", understanding: tradeUnderstanding, guidance: "volta ao ramo antigo", draft: { parts: [{ type: "text", content: "Seu carro esta quitado?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      JSON.stringify({ pass: false, checks: { currentAct: true, roleBinding: true, noRepetition: true, nameModeration: true, unambiguousQuestion: true, nextQuestionContinuity: false, effectCoherence: true, openingIdentity: true }, portalIdentityEvidence: null, openingIdentityEvidence: null, feedback: "O texto acolheu a entrada, mas a pergunta voltou ao ramo anterior." }),
      JSON.stringify({ kind: "final", understanding: financingUnderstanding, guidance: "segue o ato atual", draft: { parts: [{ type: "text", content: "Entendi os 20 mil de entrada. Qual valor de parcela cabe no seu orcamento?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      criticPass({ leadEvidence: "Tenho 20 mil de entrada", visibleEvidence: "Entendi os 20 mil de entrada" }),
    ];
    let i = 0;
    const calls: ModelHttpRequest[] = [];
    const transport: ModelHttpTransport = { async postJson(_url: string, req: ModelHttpRequest): Promise<ModelHttpResponse> {
      calls.push(req);
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, {
      model: "gpt-4.1", retryModel: "gpt-4.1", semanticCriticEnabled: true, semanticCriticModel: "gpt-4.1",
    });
    const currentFrame: TurnFrame = {
      ...frame("Tenho 20 mil de entrada"),
      recentTranscript: [{ role: "agent", text: "Sua HR-V EXL e automatica?" }],
      conversationContext: {
        ...frame("x").conversationContext,
        lastAgentMessage: "Sua HR-V EXL e automatica?",
        pendingAgentQuestion: { slot: "veiculoTroca", sinceTurnId: "t-anterior" },
      },
      currentTurnFacts: {
        expectedAnswer: { slot: "veiculoTroca", lastAgentQuestion: "Sua HR-V EXL e automatica?" },
        extracted: [{ slot: "entrada", kind: "value", value: 20000 }],
        offerReference: null,
      },
      signals: { ...frame("x").signals, adVehicle: "Toyota Corolla 2024" },
    };
    const step = await brain.proposeNextStep(currentFrame, []);
    const textPart = step.kind === "final" ? step.decision.responsePlan.draft?.parts.find((part) => part.type === "text") : null;
    const criticBody = JSON.parse(calls[1]!.body) as { messages: { role: string; content: string }[] };
    const criticPayload = JSON.parse(criticBody.messages.find((message) => message.role === "user")!.content) as { lastAssistantMessage?: string; currentLeadBlock?: string; currentTurnFacts?: { extracted?: unknown[] }; activeAdVehicle?: string };
    const criticSystem = criticBody.messages.find((message) => message.role === "system")?.content ?? "";
    check("[16] critic recebe fronteira local e a LLM replaneja sem voltar ao ramo antigo",
      calls.length === 4
      && criticPayload.lastAssistantMessage?.includes("automatica") === true
      && criticPayload.currentLeadBlock === "Tenho 20 mil de entrada"
      && criticPayload.currentTurnFacts?.extracted?.length === 1
      && criticPayload.activeAdVehicle === "Toyota Corolla 2024"
      && criticSystem.includes("TEXTO VISIVEL")
      && criticSystem.includes("activeAdVehicle")
      && textPart?.type === "text"
      && textPart.content.includes("20 mil de entrada"));
  }

  // [17] Repetir literalmente a ultima pergunta exige novo planejamento da
  // mesma LLM; nao e tratado como simples retoque textual da infraestrutura.
  {
    const badUnderstanding = { primaryIntent: "trade_in", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "memory", evidence: [], isTopicChange: false, answeredLeadQuestions: [] };
    const goodUnderstanding = { primaryIntent: "financing", requestedCapabilities: [], subject: "budget", subjectValue: "20 mil", subjectSource: "current_turn", evidence: [{ quote: "20 mil de entrada" }], isTopicChange: true, answeredLeadQuestions: [] };
    const seq = [
      JSON.stringify({ kind: "final", understanding: badUnderstanding, guidance: "repete", draft: { parts: [{ type: "text", content: "Sua HR-V EXL e automatica?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      JSON.stringify({ kind: "final", understanding: goodUnderstanding, guidance: "corrige", draft: { parts: [{ type: "text", content: "Certo, anotei os 20 mil de entrada. Qual parcela voce pretende pagar?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      criticPass({ leadEvidence: "Tenho 20 mil de entrada", visibleEvidence: "anotei os 20 mil de entrada" }),
    ];
    let i = 0;
    const calls: ModelHttpRequest[] = [];
    const transport: ModelHttpTransport = { async postJson(_url: string, req: ModelHttpRequest): Promise<ModelHttpResponse> {
      calls.push(req);
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, {
      model: "gpt-4.1", retryModel: "gpt-4.1", semanticCriticEnabled: true, semanticCriticModel: "gpt-4.1",
    });
    const repeatFrame: TurnFrame = {
      ...frame("Tenho 20 mil de entrada"),
      recentTranscript: [],
      conversationContext: { ...frame("x").conversationContext, lastAgentMessage: "Sua HR-V EXL e automatica?" },
      currentTurnFacts: { expectedAnswer: { slot: "veiculoTroca", lastAgentQuestion: "Sua HR-V EXL e automatica?" }, extracted: [{ slot: "entrada", kind: "value", value: 20000 }], offerReference: null },
    };
    const step = await brain.proposeNextStep(repeatFrame, []);
    const textPart = step.kind === "final" ? step.decision.responsePlan.draft?.parts.find((part) => part.type === "text") : null;
    check("[17] pergunta repetida volta ao planejamento da mesma LLM",
      calls.length === 3 && textPart?.type === "text" && textPart.content.includes("20 mil de entrada"),
      `calls=${calls.length} text=${textPart?.type === "text" ? textPart.content : "<none>"}`);
  }

  // [18] O auditor separa promessa operacional de estilo: dizer que o contato
  // sera passado a um vendedor exige o efeito correspondente, e a mesma LLM
  // remove ou materializa a promessa no novo planejamento.
  {
    const understanding = { primaryIntent: "financing", requestedCapabilities: [], subject: "budget", subjectValue: "2500", subjectSource: "current_turn", evidence: [{ quote: "2500" }], isTopicChange: false, answeredLeadQuestions: [] };
    const seq = [
      JSON.stringify({ kind: "final", understanding, guidance: "promessa sem efeito", draft: { parts: [{ type: "text", content: "Vou passar essas condicoes para o consultor calcular." }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      JSON.stringify({ pass: false, checks: { currentAct: true, roleBinding: true, noRepetition: true, nameModeration: true, unambiguousQuestion: true, nextQuestionContinuity: true, effectCoherence: false, openingIdentity: true }, portalIdentityEvidence: null, openingIdentityEvidence: null, feedback: "O texto promete encaminhamento sem handoff." }),
      JSON.stringify({ kind: "final", understanding, guidance: "sem promessa", draft: { parts: [{ type: "text", content: "Certo, considerei a parcela de ate 2.500 na sua condicao de financiamento." }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      criticPass({ leadEvidence: "2500", visibleEvidence: "parcela de ate 2.500" }),
    ];
    let i = 0;
    const calls: ModelHttpRequest[] = [];
    const transport: ModelHttpTransport = { async postJson(_url: string, req: ModelHttpRequest): Promise<ModelHttpResponse> {
      calls.push(req);
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, {
      model: "gpt-4.1", retryModel: "gpt-4.1", semanticCriticEnabled: true, semanticCriticModel: "gpt-4.1",
    });
    const effectFrame: TurnFrame = {
      ...frame("Ate 2500 de parcela"),
      recentTranscript: [{ role: "agent", text: "Qual parcela cabe no seu orcamento?" }],
      conversationContext: { ...frame("x").conversationContext, lastAgentMessage: "Qual parcela cabe no seu orcamento?" },
      currentTurnFacts: { expectedAnswer: { slot: "parcelaDesejada", lastAgentQuestion: "Qual parcela cabe no seu orcamento?" }, extracted: [{ slot: "parcelaDesejada", kind: "value", value: 2500 }], offerReference: null },
    };
    const step = await brain.proposeNextStep(effectFrame, []);
    const textPart = step.kind === "final" ? step.decision.responsePlan.draft?.parts.find((part) => part.type === "text") : null;
    check("[18] promessa sem efeito volta para a LLM e nao chega ao lead",
      calls.length === 4 && textPart?.type === "text" && !/consultor|vendedor/i.test(textPart.content));
  }

  // [19] Se a mesma LLM esgota as reescritas sem produzir um final coerente,
  // o adapter encerra a tentativa. O central transforma a falha em fallback
  // tecnico unico; nao reinicia silenciosamente outro ciclo caro.
  {
    const understanding = { primaryIntent: "financing", requestedCapabilities: [], subject: "budget", subjectValue: "2500", subjectSource: "current_turn", evidence: [{ quote: "2500" }], isTopicChange: false, answeredLeadQuestions: [] };
    const badFinal = JSON.stringify({ kind: "final", understanding, guidance: "promessa sem efeito", draft: { parts: [{ type: "text", content: "Vou passar para o consultor." }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] });
    const rejection = JSON.stringify({ pass: false, currentLeadAct: "parcela", candidateVisibleAct: "promete encaminhar", nextQuestionAct: null, currentLeadEvidence: "2500", visibleCurrentActEvidence: null, effectClaimEvidence: "Vou passar para o consultor.", checks: { currentAct: false, roleBinding: true, noRepetition: true, nameModeration: true, unambiguousQuestion: true, nextQuestionContinuity: true, effectCoherence: false, openingIdentity: true }, portalIdentityEvidence: null, openingIdentityEvidence: null, feedback: "Promessa sem handoff." });
    const seq = [badFinal, rejection, badFinal, rejection, badFinal, rejection];
    let i = 0;
    const transport: ModelHttpTransport = { async postJson(): Promise<ModelHttpResponse> {
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, {
      model: "gpt-4.1", retryModel: "gpt-4.1", semanticCriticEnabled: true, semanticCriticModel: "gpt-4.1",
    });
    const exhaustedFrame: TurnFrame = {
      ...frame("Ate 2500 de parcela"),
      recentTranscript: [{ role: "agent", text: "Qual parcela cabe no seu orcamento?" }],
      conversationContext: { ...frame("x").conversationContext, lastAgentMessage: "Qual parcela cabe no seu orcamento?" },
    };
    let exhausted = false;
    try { await brain.proposeNextStep(exhaustedFrame, []); }
    catch (error) { exhausted = (error as Error).message === "SEMANTIC_CRITIC_EXHAUSTED"; }
    check("[19] esgotamento semantico termina o ciclo sem liberar draft reprovado", exhausted && i === 4, `calls=${i}`);
  }

  // [20] Mesmo que o critic marque os checks como true, a propria classificacao
  // semantica dele nao pode contradizer a aprovacao: fala nova em pagamento e
  // pergunta seguinte voltando ao ramo anterior de troca exigem replanejamento.
  {
    const badUnderstanding = { primaryIntent: "financing", requestedCapabilities: [], subject: "budget", subjectValue: "20 mil", subjectSource: "current_turn", evidence: [{ quote: "20 mil de entrada" }], isTopicChange: true, answeredLeadQuestions: [] };
    const goodUnderstanding = { ...badUnderstanding };
    const seq = [
      JSON.stringify({ kind: "final", understanding: badUnderstanding, guidance: "volta ao ramo antigo", draft: { parts: [{ type: "text", content: "Entrada de 20 mil registrada. Sua HR-V esta revisada?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      JSON.stringify({ pass: true, currentLeadAct: "informa entrada", candidateVisibleAct: "aceita entrada e pergunta sobre troca", nextQuestionAct: "revisao do carro de troca", currentLeadLane: "payment_financing", priorAssistantLane: "trade_vehicle", nextQuestionLane: "trade_vehicle", nextQuestionIsQualificationField: true, portalQuestionSupportEvidence: null, currentLeadEvidence: "20 mil de entrada", visibleCurrentActEvidence: "Entrada de 20 mil registrada.", effectClaimEvidence: null, checks: { currentAct: true, roleBinding: true, noRepetition: true, nameModeration: true, unambiguousQuestion: true, nextQuestionContinuity: true, effectCoherence: true, openingIdentity: true }, portalIdentityEvidence: null, openingIdentityEvidence: null, feedback: "" }),
      JSON.stringify({ kind: "final", understanding: goodUnderstanding, guidance: "continua pagamento", draft: { parts: [{ type: "text", content: "Certo, considerei os 20 mil de entrada. Qual parcela cabe no seu orcamento?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      criticPass({ leadEvidence: "20 mil de entrada", visibleEvidence: "considerei os 20 mil de entrada" }),
    ];
    let i = 0;
    const transport: ModelHttpTransport = { async postJson(): Promise<ModelHttpResponse> {
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, {
      model: "gpt-4.1", retryModel: "gpt-4.1", semanticCriticEnabled: true, semanticCriticModel: "gpt-4.1",
    });
    const laneFrame: TurnFrame = {
      ...frame("Tenho 20 mil de entrada"),
      recentTranscript: [{ role: "agent", text: "Qual a cor da sua HR-V?" }],
      conversationContext: { ...frame("x").conversationContext, lastAgentMessage: "Qual a cor da sua HR-V?" },
      currentTurnFacts: { expectedAnswer: { slot: "veiculoTroca", lastAgentQuestion: "Qual a cor da sua HR-V?" }, extracted: [{ slot: "entrada", kind: "value", value: 20000 }], offerReference: null },
    };
    const step = await brain.proposeNextStep(laneFrame, []);
    const textPart = step.kind === "final" ? step.decision.responsePlan.draft?.parts.find((part) => part.type === "text") : null;
    check("[20] lanes do critic impedem retorno ao ramo anterior", i === 4 && textPart?.type === "text" && /parcela/i.test(textPart.content), `calls=${i}`);
  }

  // [21] O portal define o funil. Se o critic identificar que a proxima
  // pergunta inventa um campo de qualificacao sem trecho de suporte no prompt,
  // o adapter exige nova autoria sem conhecer o nome desse campo.
  {
    const understanding = { primaryIntent: "trade_in", requestedCapabilities: [], subject: "none", subjectValue: null, subjectSource: "current_turn", evidence: [{ quote: "HRV 2023 30 mil km para troca" }], isTopicChange: true, answeredLeadQuestions: [] };
    const seq = [
      JSON.stringify({ kind: "final", understanding, guidance: "campo inventado", draft: { parts: [{ type: "text", content: "Entendi sua HR-V 2023 com 30 mil km. Ela esta com as revisoes em dia?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      JSON.stringify({ pass: true, currentLeadAct: "informa troca", candidateVisibleAct: "acolhe troca e pergunta revisoes", nextQuestionAct: "revisoes", currentLeadLane: "trade_vehicle", priorAssistantLane: null, nextQuestionLane: "trade_vehicle", nextQuestionIsQualificationField: true, portalQuestionSupportEvidence: null, currentLeadEvidence: "HRV 2023 30 mil km para troca", visibleCurrentActEvidence: "Entendi sua HR-V 2023 com 30 mil km.", effectClaimEvidence: null, checks: { currentAct: true, roleBinding: true, noRepetition: true, nameModeration: true, unambiguousQuestion: true, nextQuestionContinuity: true, effectCoherence: true, openingIdentity: true }, portalIdentityEvidence: null, openingIdentityEvidence: null, feedback: "" }),
      JSON.stringify({ kind: "final", understanding, guidance: "segue o portal", draft: { parts: [{ type: "text", content: "Entendi sua HR-V 2023 com 30 mil km para troca. Qual forma de pagamento voce pretende usar?" }] }, effects: [{ kind: "send_message" }], stateMutations: [], memoryMutations: [] }),
      criticPass({ leadEvidence: "HRV 2023 30 mil km para troca", visibleEvidence: "Entendi sua HR-V 2023 com 30 mil km para troca." }),
    ];
    let i = 0;
    const transport: ModelHttpTransport = { async postJson(): Promise<ModelHttpResponse> {
      return { status: 200, contentType: "application/json", bodyText: JSON.stringify({ choices: [{ message: { content: seq[Math.min(i++, seq.length - 1)] } }] }) };
    } };
    const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, {
      model: "gpt-4.1", retryModel: "gpt-4.1", semanticCriticEnabled: true, semanticCriticModel: "gpt-4.1",
    });
    const step = await brain.proposeNextStep({
      ...frame("Tenho uma HRV 2023 30 mil km para troca"),
      recentTranscript: [{ role: "agent", text: "Voce tem carro para troca?" }],
      conversationContext: { ...frame("x").conversationContext, lastAgentMessage: "Voce tem carro para troca?" },
    }, []);
    const textPart = step.kind === "final" ? step.decision.responsePlan.draft?.parts.find((part) => part.type === "text") : null;
    check("[21] campo de qualificacao sem suporte no portal exige reautoria", i === 4 && textPart?.type === "text" && !/revis/i.test(textPart.content), `calls=${i}`);
  }

  console.log(`\n== F2.14: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
