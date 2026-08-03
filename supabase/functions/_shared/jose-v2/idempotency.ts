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

/**
 * Serialização CANÔNICA recursiva.
 *
 * A versão anterior usava `JSON.stringify(payload, Object.keys(payload).sort())`.
 * O segundo argumento do stringify é um REPLACER ARRAY, e ele filtra chaves em
 * TODOS os níveis — não apenas no topo. Consequência real: com o payload
 * { campaignId, actionType, actionParams }, as chaves internas de actionParams
 * (budget, daily_budget, ...) NÃO estavam na lista e eram DESCARTADAS do hash.
 * Ou seja, `budget=100` e `budget=200` geravam a MESMA chave — a idempotência
 * deixava passar como "repetição" duas ordens de gasto diferentes.
 *
 * Regras desta canonicalização:
 *   - objetos: chaves ordenadas, recursivamente;
 *   - arrays: ORDEM PRESERVADA (ordem é semântica em lista de anúncios/públicos);
 *   - escalares preservados, com distinção de tipo (o número 1 != a string "1");
 *   - undefined em objeto é omitido; em array vira null (igual ao JSON);
 *   - ciclos viram marcador explícito em vez de estourar.
 */
function canonicalize(valor: unknown, vistos = new WeakSet<object>()): string {
  if (valor === null) return "null";
  const t = typeof valor;

  if (t === "number") return Number.isFinite(valor as number) ? JSON.stringify(valor) : '"__nao_finito__"';
  if (t === "boolean") return valor ? "true" : "false";
  if (t === "string") return JSON.stringify(valor);
  if (t === "bigint") return `"__bigint__${String(valor)}"`;
  if (t === "undefined" || t === "function" || t === "symbol") return "null";

  const obj = valor as object;
  if (vistos.has(obj)) return '"__ciclo__"';
  vistos.add(obj);

  try {
    if (Array.isArray(valor)) {
      // Ordem preservada de propósito.
      return `[${valor.map((v) => canonicalize(v, vistos)).join(",")}]`;
    }
    if (valor instanceof Date) return JSON.stringify(valor.toISOString());

    const entradas = Object.keys(valor as Record<string, unknown>)
      .filter((k) => (valor as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize((valor as Record<string, unknown>)[k], vistos)}`);
    return `{${entradas.join(",")}}`;
  } finally {
    vistos.delete(obj);
  }
}

/** Hash estável do payload, para detectar reuso de chave com corpo diferente. */
export async function hashPayload(payload: unknown): Promise<string> {
  const canon = canonicalize(payload ?? null);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Exposto só para teste: permite verificar a forma canônica diretamente. */
export const _canonicalizeParaTeste = canonicalize;

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

export type CompleteResultado =
  | { ok: true }
  | { ok: false; motivo: "erro_banco" | "nenhuma_linha" | "excecao"; detalhe: string };

/**
 * Finaliza a reserva. NÃO pode falhar em silêncio: se a persistência do
 * resultado não confirmar, quem chamou precisa saber — senão o registro fica
 * eternamente 'in_progress' e toda repetição daquela chave passa a devolver
 * 409 "em andamento", travando a ação para sempre sem ninguém perceber.
 *
 * A atualização é CONDICIONAL a `status='in_progress'`: só quem reservou
 * finaliza. Um retorno atrasado não sobrescreve um desfecho já gravado.
 */
export async function complete(
  admin: any,
  registroId: string,
  status: "succeeded" | "failed",
  resposta: unknown,
): Promise<CompleteResultado> {
  try {
    const { data, error } = await admin
      .from("jose_action_idempotency")
      .update({ status, response: resposta ?? null, completed_at: new Date().toISOString() })
      .eq("id", registroId)
      .eq("status", "in_progress")   // transição única
      .select("id");

    if (error) {
      console.error(`[idempotency] FALHA ao finalizar ${registroId}: ${error.message ?? error.code}`);
      return { ok: false, motivo: "erro_banco", detalhe: String(error.message ?? error.code) };
    }
    if (!data || (data as any[]).length === 0) {
      // Já finalizado por outro caminho, ou id inexistente.
      console.warn(`[idempotency] finalizacao de ${registroId} nao alterou nenhuma linha (ja finalizada?)`);
      return { ok: false, motivo: "nenhuma_linha", detalhe: "registro ja finalizado ou inexistente" };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[idempotency] EXCECAO ao finalizar ${registroId}: ${String((e as any)?.message || e)}`);
    return { ok: false, motivo: "excecao", detalhe: String((e as any)?.message || e) };
  }
}
