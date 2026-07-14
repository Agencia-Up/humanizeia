// ============================================================================
// pilot-ingest.ts — F2.7.6. INGESTAO rapida (sem processar): grava a mensagem no
// v3_inbox (dedupe atomico) + o roteamento da conversa (p/ o poller despachar async).
// NAO precisa do modelo/estoque/instancia (barato) — o processamento real fica p/
// o poller quando a conversa "assenta" (debounce). Mantem a logica de dedupe que
// estava no runTurn: retry do webhook em evento ainda 'pending' = idempotente (sem 2o turno).
// ============================================================================
import type { Clock, ConversationRoutingStore, Persistence } from "../domain/ports.ts";
import type { JsonValue } from "../domain/types.ts";
import { redact } from "../domain/effect-intent.ts";
import { extractSensitiveSpans, materializeSensitiveTokens } from "../domain/sensitive-data.ts";
import type { SensitiveVaultPort } from "../adapters/persistence/sensitive-vault.ts";

export type PilotIngestInput = {
  readonly eventId: string;
  readonly conversationId: string;
  readonly agentId: string;
  readonly leadId: string | null;
  readonly toAddr: string;
  readonly messageText: string;
  readonly receivedAt?: string;
  // F2.32 (CTWA): contexto de anúncio SANITIZADO (do bridge). Guardado no raw do inbox; o engine resolve o veículo e
  // persiste no state (herda em rajada). CONTEXTO, não resposta do lead. Opaco aqui (o engine valida o shape).
  readonly adContext?: unknown;
  readonly mediaContext?: unknown;
  // ⭐SEM inv.7: hint de nome do WhatsApp (pushName sanitizado no bridge). Viaja no raw; o engine valida (isRealLeadName).
  readonly leadNameHint?: string | null;
  readonly tenantId?: string;
  readonly sensitiveVault?: SensitiveVaultPort | null;
};

// "proceed" = mensagem nova OU retry de evento ainda pendente (entra/segue na fila do poller).
// "duplicate" = evento ja done/claimed/error (nao reprocessa, nao gera 2o turno).
export type PilotIngestResult = { readonly decision: "proceed" | "duplicate" };

export async function ingestPilotMessage(
  persistence: Persistence & ConversationRoutingStore,
  clock: Clock,
  input: PilotIngestInput,
): Promise<PilotIngestResult> {
  // Roteamento ANTES do insert: garante que nunca exista evento no inbox SEM roteamento
  // (orfao que o poller nunca acharia). Se isto falhar, nada foi ingerido -> ingested:false
  // -> o bridge faz fallback p/ o v2. Idempotente (upsert).
  await persistence.upsertRouting(input.conversationId, input.agentId, input.leadId, input.toAddr);

  // ── MISSÃO PII (2026-07-11, causa-raiz provada): o CHECK `v3_inbox_redacted_ck` REJEITA qualquer texto com
  //    run de 11 dígitos em formato CPF — o INSERT falhava, ingested=false e a MENSAGEM DO LEAD SUMIA (sticky
  //    bloqueia o v2). Sanitização TIPADA no chokepoint do ingest: CPF/data de nascimento viram tokens
  //    com referencias opacas. O valor integral existe somente em memoria ate a gravacao AES-GCM no cofre;
  //    inbox/state/eventos/outbox recebem apenas tokens e refs. Se o cofre falhar, o token declara NAO ARMAZENADO
  //    e a LLM nao pode fingir que registrou o dado. O engine/extrator leem apenas o tipo e a referencia.
  const receivedYear = new Date(input.receivedAt ?? clock.now()).getUTCFullYear();
  let snapshot = null;
  try { snapshot = await persistence.load(input.conversationId); } catch { snapshot = null; }
  const lastAgentText = [...(snapshot?.state.recentTurns ?? [])].reverse().find((t) => t.role === "agent")?.text ?? "";
  const currentText = String(input.messageText ?? "");
  const expectsCpf = /\bcpf\b/i.test(currentText) || /\bcpf\b/i.test(lastAgentText);
  const expectsBirthDate = /\b(?:data\s+de\s+nascimento|nascimento)\b/i.test(currentText)
    || /\b(?:data\s+de\s+nascimento|nascimento)\b/i.test(lastAgentText);
  const sensitive = extractSensitiveSpans(input.messageText, Number.isFinite(receivedYear) ? receivedYear : 2026, { expectsCpf, expectsBirthDate });
  const refs = new Map<string, string>();
  if (input.sensitiveVault && input.tenantId) {
    for (let index = 0; index < sensitive.secrets.length; index += 1) {
      const candidate = sensitive.secrets[index];
      try {
        const stored = await input.sensitiveVault.store({ tenantId: input.tenantId, conversationId: input.conversationId, eventId: input.eventId, candidate, index });
        refs.set(candidate.placeholder, stored.ref);
      } catch { /* mensagem segue com token explicito de dado nao armazenado */ }
    }
  }
  const sanitizedText = materializeSensitiveTokens(sensitive, refs);
  const inserted = await persistence.tryInsert({
    eventId: input.eventId,
    conversationId: input.conversationId,
    // F2.32: adContext viaja no raw (só quando presente) -> o engine o lê da rajada e persiste no state.
    raw: redact(({
      text: sanitizedText,
      ...(sensitive.findings.length > 0 ? { sensitive: sensitive.findings.map((f) => ({ kind: f.kind, valid: f.valid, ...(f.kind !== "birth_date" ? { last4: f.last4 } : {}) })) } : {}),
      ...(input.adContext != null ? { adContext: input.adContext } : {}),
      ...(input.mediaContext != null ? { mediaContext: input.mediaContext } : {}),
      ...(input.leadNameHint ? { leadNameHint: input.leadNameHint } : {}),
    }) as unknown as Record<string, JsonValue>),
    receivedAt: input.receivedAt ?? clock.now(),
  });
  if (!inserted) {
    const existing = await persistence.get(input.eventId);
    if (!existing || existing.status !== "pending") {
      return { decision: "duplicate" };
    }
    // ainda 'pending': ja esta na fila do poller -> segue (idempotente, sem 2o turno).
  }
  return { decision: "proceed" };
}
