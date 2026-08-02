/**
 * internalAuth.ts — José / Fase 1 (segurança crítica)
 *
 * Autenticação de chamadas INTERNAS (pg_cron, função->função). Substitui o
 * padrão inseguro que existia no jose-cron-runner:
 *
 *     // ANTES (forjável): decodifica o payload e confia no claim
 *     const payload = JSON.parse(atob(token.split(".")[1]));
 *     authOk = payload.role === "service_role";
 *
 * `atob` NÃO verifica assinatura — qualquer um forja `{"role":"service_role"}`.
 * Aqui não há decodificação de JWT: comparamos o segredo apresentado com o
 * segredo real, em tempo constante. Ou o chamador tem a chave, ou não passa.
 *
 * Dois caminhos aceitos (ambos exigem posse de um segredo do servidor):
 *   1) Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>   (padrão dos crons)
 *   2) x-jose-internal-secret: <JOSE_INTERNAL_SECRET>      (segredo dedicado)
 *
 * PROTEÇÃO CONTRA REPLAY (opcional, ligada por env):
 *   Com JOSE_REQUIRE_REPLAY_GUARD=1, a chamada precisa trazer:
 *     x-jose-ts    -> epoch em MILISSEGUNDOS (janela de +/- 5 min)
 *     x-jose-nonce -> valor único por chamada (UUID)
 *   O nonce é consumido em jose_webhook_events (provider='jose_internal_nonce'),
 *   reusando a tabela de dedupe que já existe — sem criar estrutura nova.
 *   Diferente do dedupe de webhook, aqui a falha é FECHADA: se não der para
 *   confirmar que o nonce é inédito, a requisição é RECUSADA.
 *
 * A env fica DESLIGADA por padrão de propósito: os jobs do pg_cron ainda não
 * enviam esses headers. Ligar antes de atualizar os jobs derrubaria os crons.
 * Sequência correta: atualizar jobs (Vault + headers) -> ligar a env.
 */

export type InternalAuthResult =
  | { ok: true; via: "service_role" | "internal_secret" }
  | { ok: false; status: number; error: string };

/**
 * Comparação em tempo constante. `a === b` vaza o tamanho do prefixo comum pelo
 * tempo de execução; com muitas tentativas dá para reconstruir o segredo.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // Compara SEMPRE o mesmo número de bytes; diferença de tamanho vira mismatch
  // sem short-circuit.
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Consome o nonce de forma ATÔMICA e FAIL-CLOSED.
 * Retorna true somente se o nonce era inédito e foi gravado agora.
 */
async function consumeNonce(admin: any, nonce: string): Promise<boolean> {
  try {
    const { error } = await admin
      .from("jose_webhook_events")
      .insert({ provider: "jose_internal_nonce", event_id: nonce, payload: null, processado: true });
    if (!error) return true;              // inédito
    if (String(error.code) === "23505") return false; // replay
    return false;                          // erro desconhecido -> FECHA
  } catch (_e) {
    return false;                          // sem banco -> FECHA
  }
}

/**
 * Exige que o chamador seja interno. NUNCA aceita tenant/identidade vinda do
 * corpo da requisição — quem chama isto deve derivar o escopo do banco.
 */
export async function requireInternalCaller(
  req: Request,
  opts?: { admin?: any },
): Promise<InternalAuthResult> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const internalSecret = Deno.env.get("JOSE_INTERNAL_SECRET") || "";

  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const presented = (req.headers.get("x-jose-internal-secret") || "").trim();

  let via: "service_role" | "internal_secret" | null = null;
  if (serviceKey && bearer && timingSafeEqual(bearer, serviceKey)) via = "service_role";
  else if (internalSecret && presented && timingSafeEqual(presented, internalSecret)) via = "internal_secret";

  if (!via) {
    return { ok: false, status: 401, error: "chamada_interna_nao_autenticada" };
  }

  // ── proteção contra replay (opt-in) ──
  if ((Deno.env.get("JOSE_REQUIRE_REPLAY_GUARD") || "") === "1") {
    const tsRaw = req.headers.get("x-jose-ts") || "";
    const nonce = (req.headers.get("x-jose-nonce") || "").trim();
    const ts = Number(tsRaw);
    if (!tsRaw || !Number.isFinite(ts) || !nonce) {
      return { ok: false, status: 401, error: "replay_guard_headers_ausentes" };
    }
    if (Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) {
      return { ok: false, status: 401, error: "replay_guard_timestamp_fora_da_janela" };
    }
    if (!opts?.admin) {
      return { ok: false, status: 500, error: "replay_guard_sem_client_admin" };
    }
    const fresh = await consumeNonce(opts.admin, nonce);
    if (!fresh) {
      return { ok: false, status: 401, error: "replay_guard_nonce_repetido_ou_indisponivel" };
    }
  }

  return { ok: true, via };
}

/** Resposta padrão de recusa, já com CORS. */
export function internalAuthDenied(
  result: Extract<InternalAuthResult, { ok: false }>,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ ok: false, error: result.error }), {
    status: result.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
