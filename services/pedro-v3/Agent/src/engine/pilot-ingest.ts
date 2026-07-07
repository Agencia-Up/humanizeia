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

  const inserted = await persistence.tryInsert({
    eventId: input.eventId,
    conversationId: input.conversationId,
    // F2.32: adContext viaja no raw (só quando presente) -> o engine o lê da rajada e persiste no state.
    raw: redact((input.adContext != null ? { text: input.messageText, adContext: input.adContext } : { text: input.messageText }) as Record<string, JsonValue>),
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
