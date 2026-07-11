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
    recentTranscript: [], signals: { mentionsPhoto: false, mentionsStore: false, mentionsMoreOptions: false, mentionsVehicleType: "suv", isMemoryQuestion: false, relation: "direction_change" },
  };
}
function brainWith(content: string, status = 200): { brain: OpenAiAgentBrain; transport: CannedTransport } {
  const transport = new CannedTransport(content, status);
  const brain = new OpenAiAgentBrain(SECRET, transport, PORTAL_PROMPT, { model: "gpt-4.1-mini" });
  return { brain, transport };
}

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
  // [10] QUALQUER part inválida invalida o DRAFT INTEIRO (não descarta parcialmente e envia o resto).
  {
    const { brain } = brainWith(JSON.stringify({ kind: "final", guidance: "x", draft: { parts: [{ type: "text", content: "ok" }, { type: "vehicle_ref", vehicleKey: "rm:2", field: "PLACA_INVALIDA" }] } }));
    const step = await brain.proposeNextStep(frame("x"), []);
    check("[10] part inválida invalida o DRAFT inteiro (rejeição integral)", step.kind === "final" && step.decision.responsePlan.draft === null);
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

  console.log(`\n== F2.14: ${ok} OK | ${fail} FALHA ==`);
  if (fail > 0) { console.error("FALHAS:\n- " + fails.join("\n- ")); process.exit(1); }
}
main().catch((e) => { console.error("ERRO FATAL:", (e as Error)?.message ?? e); process.exit(1); });
