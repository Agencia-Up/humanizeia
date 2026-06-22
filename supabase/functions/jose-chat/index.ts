import { createClient } from "npm:@supabase/supabase-js@2";
import { joseChatTurn } from "../_shared/jose-v2/joseBrain.ts";
import { isFeatureEnabled } from "../_shared/jose-v2/flags.ts";
import { resolveAiKey } from "../_shared/aiKeys.ts";

/**
 * jose-chat — José Cabine de Comando / Bloco B (transporte PAINEL).
 *
 * Recebe a mensagem do chat da UI (JWT do usuário), roda o joseBrain (loop de
 * ferramentas, mesmo cérebro do WhatsApp), devolve a resposta. As ferramentas usam
 * as MESMAS funções dos cards -> painel e chat nunca divergem. Atrás do flag jose_chat.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({} as any));
    const flagOn = await isFeatureEnabled(admin, user.id, "jose_chat");
    if (body?.ping) {
      // Só "ligado" se o flag está on E há chave de IA resolvível (grandfathered ou BYOK).
      // Assim o box do chat só aparece onde REALMENTE funciona (conta nova sem chave -> some).
      let temChave = false;
      try { const { key } = await resolveAiKey(admin, user.id, "anthropic"); temChave = !!key; } catch { /* */ }
      return json({ enabled: flagOn && temChave });
    }
    if (!flagOn) return json({ enabled: false, reason: "flag_off" });

    const message = String(body?.message || "").trim();
    if (!message) return json({ error: "message obrigatório" }, 400);
    const session_id: string = body?.session_id || crypto.randomUUID();

    // Histórico (turnos de texto) da sessão, p/ continuidade.
    const { data: hist } = await admin.from("jose_chat_messages")
      .select("role, content")
      .eq("user_id", user.id).eq("session_id", session_id)
      .not("content", "is", null)
      .order("created_at", { ascending: true }).limit(20);
    const history = (hist || []).map((m: any) => ({
      role: m.role === "assistant" ? "assistant" as const : "user" as const,
      content: String(m.content),
    }));

    const r = await joseChatTurn(admin, {
      user_id: user.id,
      ad_account_id: body?.ad_account_id ?? null,
      session_id,
      canal: "painel",
      userMessage: message,
      history,
    });
    return json({ enabled: true, ...r });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
