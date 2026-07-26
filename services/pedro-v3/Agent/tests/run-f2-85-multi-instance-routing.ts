// ============================================================================
// F2.85 — ROTEAMENTO MULTI-INSTANCIA FIM A FIM.
//
// A instancia que recebeu a mensagem e parte da identidade da conversa. Um
// mesmo telefone pode falar com dois numeros do mesmo agente sem misturar
// estado. Agentes com um unico numero preservam os IDs historicos.
// ============================================================================
import { FakeClock, FakeIdGen, InMemoryPersistence } from "../src/adapters/persistence/in-memory-store.ts";
import { createPilotWhatsAppDispatcher, type WhatsAppInstanceSource } from "../src/adapters/effects/pilot-whatsapp-runtime.ts";
import type { UazapiHttpTransport } from "../src/adapters/effects/uazapi-whatsapp-sender.ts";
import { FakeCredentialProvider } from "../src/adapters/read/fakes/fake-credential-provider.ts";
import { makeSecretRef } from "../src/domain/credential-provider.ts";
import type { TenantAgentRef, TenantConfigSource, TenantRuntimeConfig, VehiclePhotoSource } from "../src/domain/read-ports.ts";
import {
  configuredWhatsAppInstanceIds,
  resolveConversationWhatsAppInstance,
} from "../src/domain/whatsapp-instance-binding.ts";
import { ingestPilotMessage } from "../src/engine/pilot-ingest.ts";
import { PilotHttpApp, type PilotTurnPayload, type PilotTurnRunner } from "../src/runtime/pilot-http-app.ts";
import { buildPedroV3BridgeTurn } from "../../../../supabase/functions/_shared/pedro-v2/pedroV3Bridge.ts";
import { agentInstanceIds, selectActiveAgent, shouldNamespaceConversationByInstance } from "../../../../supabase/functions/_shared/pedro-v2/webhookRouting.ts";

let ok = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); return; }
  fail += 1;
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`);
}

const TENANT = "tenant-multi";
const AGENT = "agent-multi";
const WA1 = "wa-instance-1";
const WA2 = "wa-instance-2";
const PHONE = "5512988887777";

function payload(messageId: string): Record<string, unknown> {
  return {
    EventType: "messages",
    message: {
      messageid: messageId,
      sender_pn: `${PHONE}@s.whatsapp.net`,
      chatid: `${PHONE}@s.whatsapp.net`,
      text: "Oi, quero atendimento",
      pushName: "Lead Teste",
      messageTimestamp: 1783784230,
    },
  };
}

async function bridge(args: { readonly messageId: string; readonly instanceId?: string | null; readonly separate?: boolean }) {
  return buildPedroV3BridgeTurn({
    payload: payload(args.messageId), tenantId: TENANT, agentId: AGENT,
    instanceId: args.instanceId, separateConversationByInstance: args.separate, build: "f2-85",
  });
}

async function main(): Promise<void> {
  console.log("== F2.85: roteamento multi-instancia ==");

  check("[A1] vinculos legado e novo sao unidos sem duplicata",
    JSON.stringify(configuredWhatsAppInstanceIds({ instanceId: WA1, instanceIds: [WA1, WA2, " "] })) === JSON.stringify([WA1, WA2]));
  const exact = resolveConversationWhatsAppInstance({ instanceId: WA1, instanceIds: [WA2] }, WA2);
  check("[A2] origem explicita vinculada vence fallback legado", exact.ok && exact.instanceId === WA2, JSON.stringify(exact));
  const missing = resolveConversationWhatsAppInstance({ instanceIds: [WA1, WA2] });
  check("[A3] agente multi sem origem falha fechado", !missing.ok && missing.error === "INSTANCE_CONTEXT_REQUIRED", JSON.stringify(missing));
  const foreign = resolveConversationWhatsAppInstance({ instanceIds: [WA1, WA2] }, "wa-foreign");
  check("[A4] origem nao vinculada nunca e aceita", !foreign.ok && foreign.error === "INSTANCE_NOT_BOUND_TO_AGENT", JSON.stringify(foreign));
  const legacy = resolveConversationWhatsAppInstance({ instanceId: WA1 });
  check("[A5] agente com um numero preserva fallback legado", legacy.ok && legacy.instanceId === WA1, JSON.stringify(legacy));
  const none = resolveConversationWhatsAppInstance({});
  check("[A6] agente sem numero continua bloqueado", !none.ok && none.error === "AGENT_WITHOUT_INSTANCE", JSON.stringify(none));

  const oldSingle = await bridge({ messageId: "same-message" });
  const newSingle = await bridge({ messageId: "same-message", instanceId: WA1, separate: false });
  check("[B1] single-instance preserva conversationId e eventId historicos",
    oldSingle.ok && newSingle.ok && oldSingle.turn.conversationId === newSingle.turn.conversationId && oldSingle.turn.eventId === newSingle.turn.eventId,
    JSON.stringify({ oldSingle, newSingle }));
  check("[B2] origem viaja no payload single-instance", newSingle.ok && newSingle.turn.instanceId === WA1, JSON.stringify(newSingle));
  const multi1 = await bridge({ messageId: "same-message", instanceId: WA1, separate: true });
  const multi2 = await bridge({ messageId: "same-message", instanceId: WA2, separate: true });
  check("[B3] mesmo lead em dois numeros produz conversas distintas",
    multi1.ok && multi2.ok && multi1.turn.conversationId !== multi2.turn.conversationId, JSON.stringify({ multi1, multi2 }));
  check("[B4] mesmo messageId em dois numeros nao colide no dedup",
    multi1.ok && multi2.ok && multi1.turn.eventId !== multi2.turn.eventId, JSON.stringify({ multi1, multi2 }));
  check("[B5] cada turno conserva a instancia de entrada",
    multi1.ok && multi2.ok && multi1.turn.instanceId === WA1 && multi2.turn.instanceId === WA2);
  const multiNoInstance = await bridge({ messageId: "missing-instance", separate: true });
  check("[B6] bridge multi sem instanceId falha antes do ingest",
    !multiNoInstance.ok && multiNoInstance.reason === "instance_id_missing", JSON.stringify(multiNoInstance));

  const agents = [
    { id: "agent-a", is_active: true, instance_id: WA1, instance_ids: [] },
    { id: "agent-b", is_active: true, instance_id: null, instance_ids: [WA2] },
  ];
  check("[C1] aliases de binding sao normalizados", JSON.stringify(agentInstanceIds(agents[1])) === JSON.stringify([WA2]));
  check("[C2] webhook escolhe o agente vinculado ao numero exato", selectActiveAgent(agents, WA2)?.id === "agent-b");
  check("[C3] numero desconhecido nao cai no primeiro agente", selectActiveAgent(agents, "wa-foreign") === null);
  check("[C4] binding inativo bloqueia roteamento",
    selectActiveAgent([{ id: "off", is_active: false, instance_ids: [WA1] }, { id: "fallback", is_active: true }], WA1) === null);
  check("[C5] tenant inteiramente legado mantem fallback anterior",
    selectActiveAgent([{ id: "legacy", is_active: true, name: "Pedro SDR" }], WA1)?.id === "legacy");
  const expandedAgent = { id: AGENT, is_active: true, instance_id: WA1, instance_ids: [WA1, WA2] };
  check("[C6] adicionar segundo numero preserva a conversa historica da instancia principal",
    !shouldNamespaceConversationByInstance(expandedAgent, WA1));
  check("[C7] numero adicional recebe namespace proprio",
    shouldNamespaceConversationByInstance(expandedAgent, WA2));
  check("[C8] sem primaria legada nenhuma instancia e escolhida como historica por palpite",
    shouldNamespaceConversationByInstance({ id: AGENT, instance_ids: [WA1, WA2] }, WA1));
  const historicalPrimary = await bridge({
    messageId: "same-message",
    instanceId: WA1,
    separate: shouldNamespaceConversationByInstance(expandedAgent, WA1),
  });
  check("[C9] primaria de agente expandido conserva o conversationId anterior",
    oldSingle.ok && historicalPrimary.ok && oldSingle.turn.conversationId === historicalPrimary.turn.conversationId,
    JSON.stringify({ oldSingle, historicalPrimary }));

  const clock = new FakeClock("2026-07-25T12:00:00.000Z");
  const persistence = new InMemoryPersistence(clock, new FakeIdGen());
  const conversationId = multi2.ok ? multi2.turn.conversationId : "conversation-fallback";
  await ingestPilotMessage(persistence, clock, {
    eventId: "event-route-1", conversationId, agentId: AGENT, leadId: null,
    toAddr: PHONE, instanceId: WA2, messageText: "Oi", receivedAt: clock.now(),
  });
  clock.advance(1_000);
  const settled = persistence.findSettledConversations(clock.now(), 500, 5_000, 10);
  check("[D1] debounce devolve a instancia de entrada",
    settled.length === 1 && settled[0]?.instanceId === WA2, JSON.stringify(settled));
  await persistence.upsertRouting(conversationId, AGENT, "lead-1", PHONE, null);
  const preserved = persistence.findSettledConversations(clock.now(), 500, 5_000, 10);
  check("[D2] atualizacao legada preserva origem conhecida",
    preserved[0]?.instanceId === WA2 && preserved[0]?.leadId === "lead-1", JSON.stringify(preserved));
  let conflict = "";
  try { await persistence.upsertRouting(conversationId, AGENT, null, PHONE, WA1); }
  catch (error) { conflict = error instanceof Error ? error.message : String(error); }
  check("[D3] conversa nunca migra silenciosamente entre numeros", conflict === "V3_ROUTING_INSTANCE_CONFLICT", conflict);

  // E) A borda HTTP nao pode apagar a instancia recebida da Edge Function.
  const calls: PilotTurnPayload[] = [];
  const runner: PilotTurnRunner = {
    async run(input) {
      calls.push(input);
      return { status: "duplicate", inserted: false, turnId: input.turnId, dispatched: 0 };
    },
  };
  const app = new PilotHttpApp("f2-85-bridge-secret-with-more-than-32-characters", runner);
  const httpPayload = {
    tenantId: TENANT, agentId: AGENT, instanceId: WA2,
    conversationId, turnId: "turn-http", eventId: "event-http", workerId: "edge:f2-85",
    to: PHONE, messageText: "Oi", receivedAt: "2026-07-25T12:00:00.000Z", leadId: null,
  };
  const response = await app.handle({
    method: "POST", pathname: "/v1/pilot/turn",
    authorization: "Bearer f2-85-bridge-secret-with-more-than-32-characters",
    contentType: "application/json", bodyText: JSON.stringify(httpPayload),
  });
  check("[E1] HTTP preserva instanceId ate o runner",
    response.status === 200 && calls.length === 1 && calls[0]?.instanceId === WA2,
    JSON.stringify({ response, call: calls[0] }));

  // F) O dispatcher real deve carregar a mesma instancia persistida, nao a
  // primeira da configuracao do agente.
  const ref: TenantAgentRef = { tenantId: TENANT, agentId: AGENT };
  const runtimeConfig: TenantRuntimeConfig = Object.freeze({
    tenantId: TENANT, agentId: AGENT, agentName: "Agente", companyName: "Empresa",
    instanceId: WA1, instanceIds: [WA1, WA2], promptText: "Prompt", promptSource: "raw_system_prompt",
    model: "openai/gpt-4.1-mini", temperature: 0.3, sdrGoal: null, qualificationQuestions: null,
    sellsMotorcycles: false, blockedCategories: [], ragRestricted: false,
    stockProvider: "none", stockSecretRef: null, versionStamp: "f2-85",
  });
  const loadedInstances: string[] = [];
  const tokenRef = makeSecretRef({ tenantId: TENANT, integrationId: WA2, provider: "uazapi", purpose: "whatsapp_instance" });
  const instanceSource: WhatsAppInstanceSource = {
    async loadOwnedInstance(_ref, instanceId) {
      loadedInstances.push(instanceId);
      return instanceId === WA2
        ? { tenantId: TENANT, instanceId: WA2, provider: "uazapi", apiUrl: "https://uazapi.example", instanceName: "wa-2", tokenRef }
        : null;
    },
  };
  const configSource: TenantConfigSource = { async load() { return { ok: true, config: runtimeConfig }; } };
  const photoSource: VehiclePhotoSource = {
    async resolvePhotos(_ref, vehicleKey) { return { vehicleKey, ambiguous: false, photoIds: [] }; },
    async resolveUrls() { return []; },
  };
  const transport = { async postJson() { return { ok: true, status: 200, json: {} }; } } as UazapiHttpTransport;
  const dispatcher = await createPilotWhatsAppDispatcher({
    ref, conversationId, instanceId: WA2, to: PHONE, allowedUazapiHosts: ["uazapi.example"],
  }, {
    configSource, instanceSource,
    credentialProvider: new FakeCredentialProvider({ [WA2]: { tenantId: TENANT, provider: "uazapi", material: "token" } }),
    httpTransport: transport, photoSource, clock,
  });
  check("[F1] dispatcher usa a instancia de origem, nao a primeira configurada",
    dispatcher.ok && dispatcher.instanceId === WA2 && JSON.stringify(loadedInstances) === JSON.stringify([WA2]),
    JSON.stringify({ dispatcher: dispatcher.ok ? dispatcher.instanceId : dispatcher, loadedInstances }));
  const dispatcherMissing = await createPilotWhatsAppDispatcher({
    ref, conversationId, to: PHONE, allowedUazapiHosts: ["uazapi.example"],
  }, {
    configSource, instanceSource,
    credentialProvider: new FakeCredentialProvider({}), httpTransport: transport, photoSource, clock,
  });
  check("[F2] dispatcher multi sem origem falha antes de escolher numero",
    !dispatcherMissing.ok && dispatcherMissing.error === "INSTANCE_CONTEXT_REQUIRED", JSON.stringify(dispatcherMissing));

  console.log(`\nF2.85: ${ok} OK / ${fail} FALHA`);
  if (fail > 0) { console.error(failures.join("\n")); process.exit(1); }
}

main().catch((error) => { console.error(error); process.exit(1); });
