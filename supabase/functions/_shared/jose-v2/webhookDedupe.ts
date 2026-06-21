/**
 * webhookDedupe.ts — José v3.1 / Fase 0
 *
 * Idempotência de webhook: grava (provider, event_id) em jose_webhook_events
 * ANTES de processar. Se o event_id já existe, é repetição -> ignora. Resolve o
 * caso do Meta/WhatsApp reenviar o mesmo evento (retry) e processar 2x.
 *
 * USO (no topo do handler, com SERVICE ROLE):
 *   const seen = await alreadyHandled(admin, 'meta', eventId, payload);
 *   if (seen) return ok();   // já processado, não repete
 *   ... processa ...
 *   await markProcessed(admin, 'meta', eventId);
 */

// Retorna true se o evento JÁ tinha sido registrado (repetição). Em caso novo,
// insere e retorna false. Best-effort: em erro de banco, retorna false (processa)
// — melhor processar 2x do que perder um evento.
export async function alreadyHandled(
  admin: any,
  provider: string,
  eventId: string | null | undefined,
  payload?: unknown,
): Promise<boolean> {
  if (!eventId) return false; // sem id estável não há como deduplicar
  try {
    const { error } = await admin
      .from("jose_webhook_events")
      .insert({ provider, event_id: eventId, payload: payload ?? null, processado: false });
    if (!error) return false;                 // inseriu agora = evento novo
    // 23505 = unique_violation -> já existia = repetição
    if (String(error.code) === "23505") return true;
    return false;                             // outro erro: não bloqueia o processamento
  } catch (_e) {
    return false;
  }
}

export async function markProcessed(admin: any, provider: string, eventId: string | null | undefined): Promise<void> {
  if (!eventId) return;
  try {
    await admin.from("jose_webhook_events").update({ processado: true }).eq("provider", provider).eq("event_id", eventId);
  } catch (_e) { /* observabilidade nunca quebra o fluxo */ }
}
