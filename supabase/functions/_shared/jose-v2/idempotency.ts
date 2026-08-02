/**
 * idempotency.ts — José / Fase 1
 *
 * Toda ação que MUTA algo na Meta (e portanto gasta dinheiro) precisa de uma
 * `idempotency_key`. Sem isso, um duplo clique, um retry do navegador ou um
 * replay de requisição dobra o orçamento ou clona a campanha duas vezes.
 *
 * Contrato:
 *   - chave nova            -> reserva 'in_progress' e executa
 *   - chave repetida OK     -> devolve a MESMA resposta, sem tocar na Meta
 *   - chave repetida em voo -> 409 (não executa em paralelo)
 *   - chave repetida falha  -> devolve a falha registrada; para tentar de novo
 *                              é preciso chave NOVA (evita repetir um gasto que
 *                              pode ter sido aplicado antes do timeout)
 *   - mesma chave, corpo diferente -> 422 (uso indevido da chave)
 *
 * A reserva é atômica: a unicidade (user_id, idempotency_key) é garantida por
 * índice no banco, então duas requisições simultâneas não passam as duas.
 * Requer a migration 20260802120000_jose_fase1_idempotencia_e_cron.sql.
 */

export type IdempotencyOutcome =
  | { estado: "novo"; registroId: string }
  | { estado: "repetido"; resposta: unknown; status: number }
  | { estado: "em_voo" }
  | { estado: "conflito_de_payload" }
  | { estado: "indisponivel"; detalhe: string };

/** Hash estável do payload, para detectar reuso de chave com corpo diferente. */
export async function hashPayload(payload: unknown): Promise<string> {
  const canon = JSON.stringify(payload ?? null, Object.keys(payload ?? {}).sort());
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function begin(
  admin: any,
  args: {
    tenantId: string;
    key: string;
    actionType: string;
    resourceRef?: string | null;
    payload: unknown;
  },
): Promise<IdempotencyOutcome> {
  const requestHash = await hashPayload(args.payload);

  try {
    const { data, error } = await admin
      .from("jose_action_idempotency")
      .insert({
        user_id: args.tenantId,
        idempotency_key: args.key,
        action_type: args.actionType,
        resource_ref: args.resourceRef ?? null,
        request_hash: requestHash,
        status: "in_progress",
      })
      .select("id")
      .maybeSingle();

    if (!error && data?.id) return { estado: "novo", registroId: data.id };

    if (error && String(error.code) !== "23505") {
      // Sem conseguir garantir unicidade, NÃO executamos: melhor recusar do que
      // arriscar cobrar duas vezes.
      return { estado: "indisponivel", detalhe: String(error.message || error.code) };
    }

    // 23505 -> já existe: decide pelo estado do registro anterior.
    const { data: prev } = await admin
      .from("jose_action_idempotency")
      .select("id, status, response, request_hash")
      .eq("user_id", args.tenantId)
      .eq("idempotency_key", args.key)
      .maybeSingle();

    if (!prev) return { estado: "indisponivel", detalhe: "registro_anterior_ilegivel" };
    if (prev.request_hash !== requestHash) return { estado: "conflito_de_payload" };
    if (prev.status === "in_progress") return { estado: "em_voo" };

    return {
      estado: "repetido",
      resposta: prev.response ?? { ok: prev.status === "succeeded" },
      status: prev.status === "succeeded" ? 200 : 409,
    };
  } catch (e) {
    return { estado: "indisponivel", detalhe: String((e as any)?.message || e) };
  }
}

export async function complete(
  admin: any,
  registroId: string,
  status: "succeeded" | "failed",
  resposta: unknown,
): Promise<void> {
  try {
    await admin
      .from("jose_action_idempotency")
      .update({ status, response: resposta ?? null, completed_at: new Date().toISOString() })
      .eq("id", registroId);
  } catch (_e) {
    // Não deixa a gravação do resultado derrubar a resposta ao cliente; o
    // registro fica 'in_progress' e a chave permanece queimada (fail-closed).
  }
}
