// =============================================================================
// pedro-recover-dropped — RECUPERADOR anti-sumiço (decisão do dono, 2026-06-25).
// -----------------------------------------------------------------------------
// O turno do Pedro v2 roda em background (EdgeRuntime.waitUntil) e inclui um
// DEBOUNCE de até ~45s. Se a plataforma reciclar o isolate (ou um deploy
// acontecer) nesse meio, a tarefa MORRE: a msg do lead fica salva no histórico
// mas SEM resposta (o agente "some"). Casos reais: Gilda (v175), "foto e vídeo".
//
// Este cron (cada ~2min) acha leads cuja ÚLTIMA mensagem é do LEAD, já passou a
// janela do debounce (>=90s) e NÃO teve turno -> REPROCESSA com recovery:true
// (o orchestrator pula o save+debounce e responde direto). Idempotente: assim que
// reprocessa, vira um turno + resposta no histórico -> o lead deixa de ser
// candidato. Pula despedida/agradecimento/reação e lead pausado.
// =============================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { processPedroV2Turn } from "../_shared/pedro-v2/orchestrator_20260525_photo_flow.ts";
import {
  isPedroV3ExclusiveScope,
  parsePedroV3ActiveScopes,
  PEDRO_V3_ONLY,
} from "../_shared/pedro-v2/pedroV3PilotGate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MIN_AGE_MS = 90 * 1000;        // espera o debounce+processamento original terminar (morto se nada veio)
const MAX_AGE_MS = 25 * 60 * 1000;   // não ressuscita drop velho (lead já seguiu a vida)
const MAX_PER_RUN = 12;              // teto por execução (não estoura custo num pico)

// Despedida / agradecimento / "ok" / reação solta: o agente NÃO deve responder -> não recuperar.
function isGoodbyeOrAck(content: string): boolean {
  const t = String(content || "").trim().toLowerCase();
  if (!t) return true;
  // só emoji/pontuação (sem letras/dígitos) = ack/reação
  if (!/[\p{L}\d]/u.test(t)) return true;
  if (t.length <= 24 && /^(obrigad|valeu|vlw|tchau|at[eé]( mais| logo)?|falou|abra[cç]|ok\b|okay|blz|beleza|j[oó]ia|tranquil|de nada|show|perfeito|combinado|isso mesmo|👍|🙏)/i.test(t)) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (PEDRO_V3_ONLY) {
    return new Response(JSON.stringify({ ok: true, skipped: "pedro_v2_disabled_v3_only" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Guard opcional: se CRON_SECRET estiver setado no ambiente, exige o header.
  const expected = Deno.env.get("CRON_SECRET");
  if (expected && req.headers.get("x-cron-secret") !== expected) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
  }

  // dry=1 -> só escaneia e LISTA quem seria reprocessado (não manda mensagem). Pra validar com segurança.
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const v3Scopes = parsePedroV3ActiveScopes(Deno.env.get("PEDRO_V3_ACTIVE_SCOPES"));
  const v3Mode = Deno.env.get("PEDRO_V3_PILOT_MODE");
  const result = { dry, scanned: 0, candidates: 0, recovered: 0, would_recover: [] as string[], skipped: [] as string[], errors: 0 };

  try {
    const sinceIso = new Date(Date.now() - MAX_AGE_MS).toISOString();
    // Mensagens recentes (ambos papéis) -> a ÚLTIMA por remote_jid define se o lead ficou sem resposta.
    const { data: rows } = await supabase
      .from("wa_chat_history")
      .select("remote_jid, agent_id, instance_id, role, content, created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(800);
    result.scanned = (rows || []).length;

    // última mensagem por lead (ascending -> a última iteração vence)
    const latestByJid = new Map<string, any>();
    for (const r of rows || []) latestByJid.set(r.remote_jid, r);

    const now = Date.now();
    const candidates = [...latestByJid.values()].filter((r) => {
      if (r.role !== "user") return false;                       // último foi resposta do agente -> ok
      const age = now - new Date(r.created_at).getTime();
      if (age < MIN_AGE_MS || age > MAX_AGE_MS) return false;     // jovem demais (original ainda rodando) ou velho demais
      if (!r.agent_id || !r.instance_id || !r.content) return false;
      if (isGoodbyeOrAck(r.content)) return false;                // não responder despedida/ack
      return true;
    });
    result.candidates = candidates.length;

    for (const c of candidates.slice(0, MAX_PER_RUN)) {
      try {
        // já teve turno depois da msg? (processou -> não duplicar)
        const turnSince = new Date(new Date(c.created_at).getTime() - 8000).toISOString();
        const { data: turn } = await supabase
          .from("pedro_v2_turn_logs").select("id")
          .eq("remote_jid", c.remote_jid).gte("created_at", turnSince).limit(1).maybeSingle();
        if (turn) { result.skipped.push("has_turn"); continue; }

        const { data: lead } = await supabase
          .from("ai_crm_leads").select("ai_paused").eq("remote_jid", c.remote_jid).maybeSingle();
        if (lead?.ai_paused) { result.skipped.push("paused"); continue; }

        const { data: agent } = await supabase
          .from("wa_ai_agents").select("*").eq("id", c.agent_id).maybeSingle();
        if (!agent) { result.skipped.push("no_agent"); continue; }
        if (isPedroV3ExclusiveScope({
          tenantId: agent.user_id,
          agentId: agent.id,
          mode: v3Mode,
          activeScopes: v3Scopes,
        })) {
          result.skipped.push("v3_exclusive_scope");
          continue;
        }

        const { data: waInstance } = await supabase
          .from("wa_instances").select("*").eq("instance_name", c.instance_id).eq("is_active", true).maybeSingle();
        if (!waInstance) { result.skipped.push("no_instance"); continue; }

        // Funil estruturado (mesmo que o webhook anexa) — pra o funil-force funcionar no reprocessamento.
        try {
          const { data: fc } = await supabase.from("agent_funnel_config")
            .select("bloco4_qualificacao").eq("agent_id", agent.id).maybeSingle();
          if (fc?.bloco4_qualificacao) (agent as any).funnel_bloco4 = fc.bloco4_qualificacao;
        } catch (_e) { /* opcional */ }

        const jid = c.remote_jid;
        if (dry) { result.would_recover.push(`${jid.slice(-8)} :: "${String(c.content).slice(0, 40)}"`); continue; }
        const payload = {
          instanceName: c.instance_id,
          messages: [{ text: c.content, chatid: jid, from: jid, key: { remoteJid: jid, fromMe: false }, fromMe: false }],
        };
        await processPedroV2Turn(supabase, { payload, agent, wa_instance: waInstance, dry_run: false, recovery: true } as any);
        result.recovered++;
        console.log(`[recover] reprocessou ${jid} :: "${String(c.content).slice(0, 50)}"`);
      } catch (e: any) {
        result.errors++;
        console.warn(`[recover] erro em ${c.remote_jid}:`, e?.message || e);
      }
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true, ...result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
