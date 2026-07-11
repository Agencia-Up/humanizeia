// ============================================================================
// F2.50 — MISSÃO PII (2026-07-11): verdade semântica de dados sensíveis +
// transferência humana imediata. Reproduz os DOIS incidentes reais provados no
// banco (conversa wa:8ed137…) e fixa os invariantes:
//  (1) "01/10/1997" NUNCA vira parcela/preço/ano — precedência lexical
//      sensível/data > km/ano > dinheiro; parcela=1200 fica intacta.
//  (2) CPF NUNCA vira telefone/km/parcela; o VALOR nunca persiste (token+ref).
//  (3) Mensagem numérica NÃO desaparece bridge→inbox: o texto sanitizado passa
//      na RÉPLICA do CHECK v3_payload_is_redacted (que rejeitava o INSERT).
//  (4) request_human é ato autônomo (autoridade = cérebro, evidence no bloco).
//  (5) O precheck de handoff é ESTRUTURADO (P0-C): produção-shape (vendedor
//      tenant-wide agent_id=null) => available=true; falha => unavailableReason
//      tipado + stepError sanitizado (catch silencioso abolido).
// Sem OpenAI, sem rede. PII sintética apenas (111.444.777-35 é CPF de teste).
// ============================================================================
import { createInitialState } from "../src/domain/conversation-state.ts";
import type { ClaimExtractor } from "../src/domain/decision.ts";
import {
  BIRTH_DATE_INVALID_TOKEN_RX, BIRTH_DATE_VALID_TOKEN_RX, CPF_INVALID_TOKEN_RX, CPF_VALID_TOKEN_RX,
  containsCpfShapedRun, extractSensitiveSpans, findingsFromSanitizedText, isValidCpfDigits,
  materializeSensitiveTokens, GENERIC_11_TOKEN_RX, reserveSensitiveNumericSpans,
} from "../src/domain/sensitive-data.ts";
import { extractLeadSlots, leadStatedMoneyValues, questionSlotFromAgentText } from "../src/engine/lead-extraction.ts";
import { evaluateHandoffPrecheck } from "../src/engine/handoff-precheck.ts";
import { requestsHuman, humanRequestDecisionFeedback, commercialToolAllowedForHumanRequest, sensitiveAnswerCompletenessFeedback, type ValidatedUnderstanding } from "../src/engine/turn-understanding.ts";
import type { TurnUnderstanding } from "../src/domain/agent-brain.ts";
import { ingestPilotMessage } from "../src/engine/pilot-ingest.ts";
import { InMemoryPersistence, FakeIdGen } from "../src/adapters/persistence/in-memory-store.ts";
import type { TransferAgentConfig, TransferSagaStore } from "../src/adapters/effects/transfer-store.ts";
import type { SellerCandidate } from "../src/engine/transfer-templates.ts";
import { resolveAutomationRules } from "../src/engine/automation-rules.ts";
import { SupabaseSensitiveVault, decodeSensitiveVaultKey, type SensitiveVaultPort } from "../src/adapters/persistence/sensitive-vault.ts";

let ok = 0; let bad = 0;
function check(name: string, pass: boolean, extra?: string): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { bad++; console.error(`  RED ${name}${extra ? ` — ${extra}` : ""}`); }
}

// CPF SINTÉTICO válido (dígitos verificadores corretos): 111.444.777-35. Nunca o real do incidente.
const CPF_OK = "11144477735";
const CPF_BAD = "12345678901";
const REF_YEAR = 2026;
// Réplica TS do CHECK do banco (v3_payload_is_redacted rejeita run CPF-shaped) — \y aproximado por borda de dígito.
const DB_CPF_REJECT_RX = /(?<![0-9])[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}(?![0-9])/;

const REF_CPF = "a".repeat(64);
const REF_BIRTH = "b".repeat(64);
function storedText(extraction: ReturnType<typeof extractSensitiveSpans>): string {
  const refs = new Map<string, string>();
  for (const secret of extraction.secrets) refs.set(secret.placeholder, secret.kind === "cpf" ? REF_CPF : REF_BIRTH);
  return materializeSensitiveTokens(extraction, refs);
}
class MemorySensitiveVault implements SensitiveVaultPort {
  readonly values = new Map<string, string>();
  async store(input: Parameters<SensitiveVaultPort["store"]>[0]) {
    const ref = input.candidate.kind === "cpf" ? REF_CPF : REF_BIRTH;
    this.values.set(ref, input.candidate.value);
    return { ref, kind: input.candidate.kind, last4: input.candidate.last4 };
  }
  async resolve(input: Parameters<SensitiveVaultPort["resolve"]>[0]) { return this.values.get(input.ref) ?? null; }
}
const memoryVault = new MemorySensitiveVault();
console.log("== F2.50 Verdade semântica de dados sensíveis + transferência humana ==");

// ── S: classificação tipada (formato+matemática, nunca frase) ────────────────
check("[S1] checksum CPF real valida", isValidCpfDigits(CPF_OK) && !isValidCpfDigits(CPF_BAD) && !isValidCpfDigits("11111111111"));
const s1 = extractSensitiveSpans(CPF_OK, REF_YEAR, { expectsCpf: true });
const s1Text = storedText(s1);
check("[S2] CPF em contexto vira token com ref", CPF_VALID_TOKEN_RX.test(s1Text) && s1.findings[0]?.kind === "cpf");
check("[S3] sanitizado passa no CHECK", !DB_CPF_REJECT_RX.test(s1Text) && !containsCpfShapedRun(s1Text));
const s2 = extractSensitiveSpans("CPF 111.444.777-35 data de nascimento: 01/10/1997", REF_YEAR, { expectsCpf: true, expectsBirthDate: true });
const s2Text = storedText(s2);
check("[S4] CPF+nascimento geram duas refs", CPF_VALID_TOKEN_RX.test(s2Text) && BIRTH_DATE_VALID_TOKEN_RX.test(s2Text) && s2.secrets.length === 2);
check("[S5] texto persistivel nao contem valores", !s2Text.includes("1997") && !s2Text.includes("444"));
const s3 = extractSensitiveSpans(CPF_BAD, REF_YEAR, { expectsCpf: true });
check("[S6] CPF invalido em contexto pede correcao", CPF_INVALID_TOKEN_RX.test(s3.sanitized) && s3.secrets.length === 0);
check("[S7] data impossivel tipada", BIRTH_DATE_INVALID_TOKEN_RX.test(extractSensitiveSpans("31/02/1990", REF_YEAR, { expectsBirthDate: true }).sanitized));
check("[S8] data de visita fica intacta", extractSensitiveSpans("15/08/2026", REF_YEAR, { expectsBirthDate: true }).sanitized === "15/08/2026");
check("[S9] telefone 13 digitos fica intacto", extractSensitiveSpans("5512988887777", REF_YEAR).sanitized === "5512988887777");
check("[S10] findings recuperaveis", findingsFromSanitizedText(s2Text).length === 2);
check("[S11] telefone brasileiro de 11 digitos e generico", GENERIC_11_TOKEN_RX.test(extractSensitiveSpans("11987654321", REF_YEAR).sanitized));

let encryptedRow: Record<string, unknown> | null = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (String(init?.method ?? "GET").toUpperCase() === "POST") {
    encryptedRow = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(null, { status: 201 });
  }
  const belongs = url.includes("tenant_id=eq.11111111-1111-4111-8111-111111111111")
    && url.includes("conversation_id=eq.wa%3At") && encryptedRow != null;
  return new Response(JSON.stringify(belongs ? [encryptedRow] : []), { status: 200, headers: { "content-type": "application/json" } });
};
try {
  const cryptoVault = new SupabaseSensitiveVault({
    url: "https://example.supabase.co", serviceRoleKey: "test-service-role",
    allowedHosts: ["example.supabase.co"], encryptionKey: decodeSensitiveVaultKey("11".repeat(32)), keyVersion: "test-v1",
  });
  const stored = await cryptoVault.store({
    tenantId: "11111111-1111-4111-8111-111111111111", conversationId: "wa:t", eventId: "uazapi:crypto",
    candidate: s1.secrets[0]!, index: 0,
  });
  check("[S12] cofre usa ref opaca deterministica", /^[a-f0-9]{64}$/.test(stored.ref));
  check("[S13] payload do banco nao contem CPF plaintext", encryptedRow != null && !JSON.stringify(encryptedRow).includes(CPF_OK));
  check("[S14] AES-GCM resolve somente no tenant/conversa autorizados",
    await cryptoVault.resolve({ tenantId: "11111111-1111-4111-8111-111111111111", conversationId: "wa:t", ref: stored.ref, kind: "cpf" }) === CPF_OK);
  check("[S15] cross-tenant nao resolve segredo",
    await cryptoVault.resolve({ tenantId: "99999999-9999-4999-8999-999999999999", conversationId: "wa:t", ref: stored.ref, kind: "cpf" }) === null);
} finally { globalThis.fetch = originalFetch; }

check("[E1] pergunta de CPF mapeia slot cpf (não parcela)",
  questionSlotFromAgentText("Vou seguir com a simulação considerando seu Palio 2012 na troca e parcela até 1200. Preciso do seu CPF e data de nascimento para avançar com a análise do financiamento.", { legacyFallback: true }) === "cpf");
check("[E2] data crua nunca é dinheiro", leadStatedMoneyValues("01/10/1997").length === 0);
check("[E3] token de nascimento nunca é dinheiro", leadStatedMoneyValues("[DATA_NASCIMENTO_VALIDA]").length === 0);
check("[E4] CPF cru nunca é dinheiro", leadStatedMoneyValues(CPF_OK).length === 0);
check("[E5] parcela legítima segue funcionando", leadStatedMoneyValues("acho que até 1200").includes(1200));
check("[E6] spans reservados removem data e CPF", !/1997|444/.test(reserveSensitiveNumericSpans("01/10/1997 e 111.444.777-35")));
check("[E6b] final4 de token generico nunca vira dinheiro", leadStatedMoneyValues("[NUMERO_11_DIGITOS_FINAL_7735]").length === 0);
check("[E6c] final4 de token CPF nunca vira dinheiro", leadStatedMoneyValues("[CPF_VALIDO_REF_" + REF_CPF + "_FINAL_7735]").length === 0);

const claimExtractor = { extractClaims: () => [] } as unknown as ClaimExtractor;
function stateWithPendingCpf() {
  const st = createInitialState({ conversationId: "wa:t", tenantId: "11111111-1111-4111-8111-111111111111", agentId: "22222222-2222-4222-8222-222222222222", leadId: "33333333-3333-4333-8333-333333333333", now: "2026-07-11T14:36:00.000Z" });
  st.slots.parcelaDesejada = { status: "known", value: 1200, confidence: 0.9, updatedAt: "2026-07-11T14:36:00.000Z", sourceTurnId: "poll-8" };
  st.slots.entrada = { status: "known", value: 0, confidence: 0.9, updatedAt: "2026-07-11T14:35:00.000Z", sourceTurnId: "poll-7" };
  st.recentTurns.push({ role: "agent", text: "Douglas, vou seguir com a simulação do Peugeot 208 2015 considerando seu Palio 2012 na troca e parcela até 1200. Preciso do seu CPF e data de nascimento para avançar com a análise do financiamento.", at: "2026-07-11T14:36:30.000Z" });
  return st;
}
const rawDateMuts = extractLeadSlots({ leadMessage: "01/10/1997", state: stateWithPendingCpf(), interpretation: null, claimExtractor, turnId: "poll-10" });
check("[E7] REPLAY do incidente: data crua NÃO altera parcela nem entrada",
  !rawDateMuts.some((m) => m.op === "set_slot" && (m.slot === "parcelaDesejada" || m.slot === "entrada" || m.slot === "faixaPreco")),
  JSON.stringify(rawDateMuts));
const birthText = "[DATA_NASCIMENTO_VALIDA_REF_" + REF_BIRTH + "]";
const cpfText = "[CPF_VALIDO_REF_" + REF_CPF + "_FINAL_7735]";
const tokenDateMuts = extractLeadSlots({ leadMessage: birthText, state: stateWithPendingCpf(), interpretation: null, claimExtractor, turnId: "poll-10" });
check("[E8] nascimento cria ref e nao gera dinheiro", tokenDateMuts.some((m) => m.op === "set_slot_ref" && m.slot === "birthDate") && !tokenDateMuts.some((m) => m.op === "set_slot" && (m.slot === "parcelaDesejada" || m.slot === "entrada")));
const cpfMuts = extractLeadSlots({ leadMessage: cpfText, state: stateWithPendingCpf(), interpretation: null, claimExtractor, turnId: "poll-11" });
const cpfRef = cpfMuts.find((m) => m.op === "set_slot_ref");
check("[E9] CPF grava ref real", cpfRef?.op === "set_slot_ref" && cpfRef.slot === "cpf" && cpfRef.ref.ref === REF_CPF && cpfRef.ref.last4 === "7735");
check("[E10] CPF nao vira dinheiro/estoque", !cpfMuts.some((m) => m.op === "set_slot" && (m.slot === "parcelaDesejada" || m.slot === "entrada" || m.slot === "faixaPreco" || m.slot === "interesse")));
const invalidCpfMuts = extractLeadSlots({ leadMessage: "[CPF_INVALIDO_FINAL_8901]", state: stateWithPendingCpf(), interpretation: null, claimExtractor, turnId: "poll-11" });
check("[E11] CPF invalido nao grava slot", !invalidCpfMuts.some((m) => m.op === "set_slot_ref"));
const burstMuts = extractLeadSlots({ leadMessage: cpfText + "\n" + birthText, state: stateWithPendingCpf(), interpretation: null, claimExtractor, turnId: "poll-11" });
check("[E12] burst cria CPF e nascimento", burstMuts.some((m) => m.op === "set_slot_ref" && m.slot === "cpf") && burstMuts.some((m) => m.op === "set_slot_ref" && m.slot === "birthDate"));

// I: entrega numerica ingest -> inbox
const clock = { now: () => "2026-07-11T14:37:10.000Z" };
async function ingestInto(store: InMemoryPersistence, text: string, eventId: string) {
  const res = await ingestPilotMessage(store, clock, {
    eventId, conversationId: "wa:t", agentId: "22222222-2222-4222-8222-222222222222",
    leadId: null, toAddr: "5512988887777", messageText: text, tenantId: "11111111-1111-4111-8111-111111111111", sensitiveVault: memoryVault,
  });
  return { res, rec: store.get(eventId) };
}
{
  const store = new InMemoryPersistence(clock as never, new FakeIdGen());
  const { res, rec } = await ingestInto(store, `meu cpf é ${CPF_OK}`, "uazapi:e1");
  const raw = rec?.raw as unknown as { text?: string; sensitive?: Array<{ kind: string; valid: boolean }> };
  check("[I1] mensagem com CPF é INGERIDA (não some)", res.decision === "proceed" && rec != null);
  check("[I2] raw.text sanitizado passa no CHECK do banco", typeof raw?.text === "string" && !DB_CPF_REJECT_RX.test(raw.text) && CPF_VALID_TOKEN_RX.test(raw.text));
  check("[I3] finding tipado viaja no raw (sem valor)", raw?.sensitive?.[0]?.kind === "cpf" && raw.sensitive[0].valid === true && !JSON.stringify(raw).includes(CPF_OK));
}
{
  const store = new InMemoryPersistence(clock as never, new FakeIdGen());
  const { rec } = await ingestInto(store, "data de nascimento: 01/10/1997", "uazapi:e2");
  const raw = rec?.raw as unknown as { text?: string };
  check("[I4] data de nascimento vira token no inbox", typeof raw?.text === "string" && BIRTH_DATE_VALID_TOKEN_RX.test(raw.text) && !raw.text.includes("1997"));
}
{
  const store = new InMemoryPersistence(clock as never, new FakeIdGen());
  const base = { conversationId: "wa:t", agentId: "22222222-2222-4222-8222-222222222222", leadId: null, toAddr: "5512988887777" };
  const sensitiveInput = { tenantId: "11111111-1111-4111-8111-111111111111", sensitiveVault: memoryVault };
  const a = await ingestPilotMessage(store, clock, { ...base, ...sensitiveInput, eventId: "uazapi:m1", messageText: CPF_OK });
  const b = await ingestPilotMessage(store, clock, { ...base, ...sensitiveInput, eventId: "uazapi:m2", messageText: "01/10/1997" });
  check("[I5] ids DIFERENTES nunca dedupam entre si", a.decision === "proceed" && b.decision === "proceed" && store.get("uazapi:m1") != null && store.get("uazapi:m2") != null);
  const dup = await ingestPilotMessage(store, clock, { ...base, ...sensitiveInput, eventId: "uazapi:m1", messageText: CPF_OK });
  check("[I6] dedupe LEGÍTIMO continua (mesmo id pendente segue idempotente)", dup.decision === "proceed" && store.get("uazapi:m1") != null);
}
{
  const store = new InMemoryPersistence(clock as never, new FakeIdGen());
  const res = await ingestPilotMessage(store, clock, {
    eventId: "uazapi:no-vault", conversationId: "wa:t2", agentId: "22222222-2222-4222-8222-222222222222",
    leadId: null, toAddr: "5512988887777", messageText: "CPF " + CPF_OK,
    tenantId: "11111111-1111-4111-8111-111111111111", sensitiveVault: null,
  });
  const raw = store.get("uazapi:no-vault")?.raw as unknown as { text?: string };
  check("[I7] ausencia de cofre nao some mensagem", res.decision === "proceed" && raw?.text?.includes("[CPF_RECEBIDO_NAO_ARMAZENADO]") === true);
  check("[I8] sem cofre nunca persiste CPF plaintext", raw != null && !JSON.stringify(raw).includes(CPF_OK));
}


// ── H: request_human é ato autônomo (autoridade = cérebro validado) ──────────
function vu(partial: Partial<TurnUnderstanding>, opts: { fromBrain?: boolean; trusted?: boolean; evidence?: Array<{ capability?: "handoff"; quote: string }> } = {}): ValidatedUnderstanding {
  const understanding: TurnUnderstanding = {
    primaryIntent: "other", requestedCapabilities: [], subject: "none", subjectValue: null,
    subjectSource: "none", evidence: [], isTopicChange: false, answeredLeadQuestions: [], ...partial,
  };
  return { understanding, trusted: opts.trusted ?? true, fromBrain: opts.fromBrain ?? true, validEvidence: opts.evidence ?? [] } as ValidatedUnderstanding;
}
check("[H1] primaryIntent request_human confiável => ato autônomo", requestsHuman(vu({ primaryIntent: "request_human" }, { evidence: [{ quote: "quero falar com o atendente" }] })));
check("[H2] capability handoff com evidência própria => ato autônomo", requestsHuman(vu({ requestedCapabilities: ["handoff"] }, { evidence: [{ capability: "handoff", quote: "me transfira pra um vendedor" }] })));
check("[H3] fallback/regex NUNCA é autoridade", !requestsHuman(vu({ primaryIntent: "request_human" }, { fromBrain: false })));
check("[H4] evidência inválida (untrusted) não autoriza", !requestsHuman(vu({ primaryIntent: "request_human" }, { trusted: false })));
check("[H5] humano disponivel exige effect real", humanRequestDecisionFeedback({ requested: true, handoffPlannable: true, proposedEffectKinds: [], composedText: "Vou chamar o vendedor." }) != null);
check("[H6] humano disponivel com handoff passa", humanRequestDecisionFeedback({ requested: true, handoffPlannable: true, proposedEffectKinds: ["handoff"], composedText: "Vou transferir voce." }) === null);
check("[H7] indisponivel aceita transparencia sem coleta", humanRequestDecisionFeedback({ requested: true, handoffPlannable: false, proposedEffectKinds: [], composedText: "Nao consigo transferir agora; posso continuar ajudando ou registrar retorno da equipe." }) === null);
check("[H8] indisponivel bloqueia handoff falso", humanRequestDecisionFeedback({ requested: true, handoffPlannable: false, proposedEffectKinds: ["handoff"], composedText: "Vou transferir voce." }) != null);
check("[H9] pedido humano nunca volta a coletar CPF", humanRequestDecisionFeedback({ requested: true, handoffPlannable: false, proposedEffectKinds: [], composedText: "Antes me passe seu CPF." }) != null);
check("[H10] pedido humano bloqueia todas as tools comerciais",
  !commercialToolAllowedForHumanRequest(vu({ primaryIntent: "request_human" }, { evidence: [{ quote: "quero falar com atendente" }] }), "stock_search")
  && !commercialToolAllowedForHumanRequest(vu({ primaryIntent: "request_human" }, { evidence: [{ quote: "quero falar com atendente" }] }), "vehicle_details")
  && !commercialToolAllowedForHumanRequest(vu({ primaryIntent: "request_human" }, { evidence: [{ quote: "quero falar com atendente" }] }), "vehicle_photos_resolve"));
check("[H11] dado sensivel ignorado exige reautoria", sensitiveAnswerCompletenessFeedback(["cpf"], "Voce conhece nossa loja?") != null);
check("[H12] reconhecimento natural passa", sensitiveAnswerCompletenessFeedback(["birthDate"], "Data recebida, obrigado. Voce quer falar com o vendedor?") === null);
check("[H13] ref interna nunca pode aparecer", sensitiveAnswerCompletenessFeedback(["cpf"], "CPF_VALIDO_REF_" + REF_CPF) != null);

// ── C: precheck estruturado (P0-C) — produção-shape e falhas tipadas ─────────
const RULES_ON = resolveAutomationRules({ transfer: { enabled: true, seller_response_min: 10 } });
const REGIA: SellerCandidate = { id: "44444444-4444-4444-8444-444444444444", name: "Regia", whatsappNumber: "12999999999", isActive: true, agentId: null, lastLeadReceivedAt: "2026-06-29T05:20:04.161Z", totalLeadsReceived: 0 };
function fakeStore(overrides: Partial<{ scoped: SellerCandidate[]; tenant: SellerCandidate[]; config: TransferAgentConfig | null; throwConfig: boolean; throwRoster: boolean }> = {}): TransferSagaStore {
  const config: TransferAgentConfig | null = overrides.config !== undefined ? overrides.config
    : { agentName: "Aloan", rules: RULES_ON, briefingTemplateVendedor: null, briefingTemplateGerente: null, mensagensSemEmoji: false, gerenteFeedbackCompleto: false, gerentePhones: [] };
  return {
    async loadAgentConfig() { if (overrides.throwConfig) throw new Error("HTTP_500"); return config; },
    async fetchOwnedLeadForTransfer() { return null; },
    async fetchSellerById() { return null; },
    async findPreviousSellerId() { return null; },
    async listActiveSellers(_t: string, agentId: string | null) {
      if (overrides.throwRoster) throw new Error("HTTP_500");
      return agentId === null ? (overrides.tenant ?? [REGIA]) : (overrides.scoped ?? []);
    },
    async latestTransferForLead() { return null; },
    async transferForCorrelation() { return null; },
    async activePendingForLead() { return null; },
    async claimLeadForTransfer() { return false; },
    async revertLeadClaim() {},
    async insertTransfer() { return null; },
    async updateLeadSummaryGuarded() {},
    async markSellerReceivedLead() {},
    async releaseLeadAssignment() {},
  } as TransferSagaStore;
}
const REF = { tenantId: "11111111-1111-4111-8111-111111111111", agentId: "22222222-2222-4222-8222-222222222222" };
const baseIn = { flagEnabled: true, crmEnabled: true, leadBound: true, ref: REF };
const prod = await evaluateHandoffPrecheck({ ...baseIn, store: fakeStore() });
check("[C1] PRODUÇÃO-SHAPE: Regia tenant-wide agent_id=null => plannable", prod.available && prod.unavailableReason === null, JSON.stringify(prod));
check("[C2] contagens do fallback ficam visíveis", prod.scopedSellerCount === 0 && prod.tenantFallbackSellerCount === 1 && prod.validPhoneSellerCount === 1);
check("[C3] flag off => flag_disabled", (await evaluateHandoffPrecheck({ ...baseIn, flagEnabled: false, store: fakeStore() })).unavailableReason === "flag_disabled");
check("[C4] crm off => crm_disabled", (await evaluateHandoffPrecheck({ ...baseIn, crmEnabled: false, store: fakeStore() })).unavailableReason === "crm_disabled");
check("[C5] lead sem vínculo => lead_unbound", (await evaluateHandoffPrecheck({ ...baseIn, leadBound: false, store: fakeStore() })).unavailableReason === "lead_unbound");
const cfgFail = await evaluateHandoffPrecheck({ ...baseIn, store: fakeStore({ throwConfig: true }) });
check("[C6] erro de config NÃO é silencioso", cfgFail.unavailableReason === "config_load_failed" && typeof cfgFail.stepError === "string" && cfgFail.stepError.length > 0);
const rosterFail = await evaluateHandoffPrecheck({ ...baseIn, store: fakeStore({ throwRoster: true }) });
check("[C7] erro de roster NÃO é silencioso", rosterFail.unavailableReason === "roster_query_failed" && rosterFail.stepError != null);
check("[C8] portal transfer off => portal_transfer_disabled", (await evaluateHandoffPrecheck({ ...baseIn, store: fakeStore({ config: { agentName: "Aloan", rules: resolveAutomationRules({ transfer: { enabled: false } }), briefingTemplateVendedor: null, briefingTemplateGerente: null, mensagensSemEmoji: false, gerenteFeedbackCompleto: false, gerentePhones: [] } }) })).unavailableReason === "portal_transfer_disabled");
check("[C9] sem vendedor => no_active_seller (sem promessa falsa)", (await evaluateHandoffPrecheck({ ...baseIn, store: fakeStore({ tenant: [] }) })).unavailableReason === "no_active_seller");
check("[C10] vendedor sem fone => no_seller_with_valid_phone", (await evaluateHandoffPrecheck({ ...baseIn, store: fakeStore({ tenant: [{ ...REGIA, whatsappNumber: null }] }) })).unavailableReason === "no_seller_with_valid_phone");
check("[C11] diagnóstico não vaza PII/segredo", !JSON.stringify(prod).match(/\d{7,}/));

console.log(`\n== F2.50: ${ok} OK | ${bad} FALHA ==`);
if (bad) process.exit(1);
