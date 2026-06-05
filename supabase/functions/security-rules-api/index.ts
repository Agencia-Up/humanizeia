// ============================================================================
// security-rules-api — CRUD das Regras de Segurança (FASE 2)
// ----------------------------------------------------------------------------
// Só a conta MASTER gerencia. Isolamento por master_account_id em toda query.
// Erros padronizados em português. Usa service role; a posse é validada aqui.
// ============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Faixas dos campos numéricos (mesmo do banco/tipos) — sanitiza pra nunca violar o CHECK.
const RANGES: Record<string, [number, number]> = {
  bulk_send_daily_limit: [1, 200],
  bulk_send_min_interval_sec: [1, 60],
  bulk_send_max_batch: [10, 500],
  manual_followup_daily_limit: [1, 100],
  manual_followup_min_interval_min: [30, 1440],
  individual_msg_daily_limit: [50, 1000],
  individual_msg_min_interval_sec: [1, 30],
  automation_daily_limit: [50, 500],
  antispam_max_identical_per_hour: [1, 20],
};
const BOOL_FIELDS = [
  "is_active", "bulk_send_enabled", "manual_followup_enabled",
  "automation_enabled", "antispam_block_on_limit", "block_weekends",
];

function clamp(v: any, min: number, max: number): number {
  let n = Math.round(Number(v));
  if (Number.isNaN(n)) n = min;
  return Math.max(min, Math.min(max, n));
}
function sanitizeTime(t: any, fallback: string): string {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  return `${m[1].padStart(2, "0")}:${m[2]}:00`;
}
function sanitizeProfile(body: any) {
  const out: any = {};
  out.name = (String(body.name || "").trim().slice(0, 80)) || "Perfil de regras";
  for (const f of BOOL_FIELDS) out[f] = body[f] === true || body[f] === "true";
  for (const f of Object.keys(RANGES)) out[f] = clamp(body[f] ?? RANGES[f][0], RANGES[f][0], RANGES[f][1]);
  out.allowed_send_start_time = sanitizeTime(body.allowed_send_start_time, "08:00:00");
  out.allowed_send_end_time = sanitizeTime(body.allowed_send_end_time, "20:00:00");
  return out;
}

const jhead = { ...corsHeaders, "Content-Type": "application/json" };
const err = (msg: string, status = 400) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: jhead });
const ok = (data: any) =>
  new Response(JSON.stringify({ data }), { status: 200, headers: jhead });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("Método não permitido.", 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return err("Não autorizado.", 401);
  const { data: userData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !userData?.user) return err("Sessão inválida. Faça login novamente.", 401);
  const user = userData.user;

  // Gate: vendedor/colaborador tem linha em ai_team_members (auth_user_id). Master não.
  const { data: sellerRow } = await supabase
    .from("ai_team_members").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (sellerRow) return err("Apenas o administrador da conta pode gerenciar as regras de segurança.", 403);
  const masterId = user.id;

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = String(body.action || "");

  try {
    switch (action) {
      case "list_profiles": {
        const { data, error } = await supabase.from("security_rule_profiles")
          .select("*").eq("master_account_id", masterId).order("created_at", { ascending: false });
        if (error) throw error;
        const ids = (data || []).map((p: any) => p.id);
        const assignBy: Record<string, any[]> = {};
        if (ids.length) {
          const { data: asg } = await supabase.from("security_rule_assignments").select("*").in("profile_id", ids);
          for (const a of (asg || [])) (assignBy[a.profile_id] ||= []).push(a);
        }
        return ok((data || []).map((p: any) => ({ ...p, assignments: assignBy[p.id] || [] })));
      }
      case "get_profile": {
        if (!body.id) return err("Perfil não informado.");
        const { data, error } = await supabase.from("security_rule_profiles")
          .select("*").eq("master_account_id", masterId).eq("id", body.id).maybeSingle();
        if (error) throw error;
        if (!data) return err("Perfil não encontrado.", 404);
        const { data: asg } = await supabase.from("security_rule_assignments")
          .select("*").eq("profile_id", body.id).eq("master_account_id", masterId);
        return ok({ ...data, assignments: asg || [] });
      }
      case "create_profile": {
        const payload = sanitizeProfile(body.profile || body);
        const { data, error } = await supabase.from("security_rule_profiles")
          .insert({ ...payload, master_account_id: masterId }).select("*").single();
        if (error) throw error;
        return ok(data);
      }
      case "update_profile": {
        if (!body.id) return err("Perfil não informado.");
        const payload = sanitizeProfile(body.profile || body);
        const { data, error } = await supabase.from("security_rule_profiles")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", body.id).eq("master_account_id", masterId).select("*").maybeSingle();
        if (error) throw error;
        if (!data) return err("Perfil não encontrado.", 404);
        return ok(data);
      }
      case "toggle_profile": {
        if (!body.id) return err("Perfil não informado.");
        const { data, error } = await supabase.from("security_rule_profiles")
          .update({ is_active: body.is_active === true, updated_at: new Date().toISOString() })
          .eq("id", body.id).eq("master_account_id", masterId).select("*").maybeSingle();
        if (error) throw error;
        if (!data) return err("Perfil não encontrado.", 404);
        return ok(data);
      }
      case "duplicate_profile": {
        if (!body.id) return err("Perfil não informado.");
        const { data: src } = await supabase.from("security_rule_profiles")
          .select("*").eq("id", body.id).eq("master_account_id", masterId).maybeSingle();
        if (!src) return err("Perfil não encontrado.", 404);
        const clone: any = { ...src };
        delete clone.id; delete clone.created_at; delete clone.updated_at;
        clone.name = `${src.name} (cópia)`;
        clone.is_active = false;
        const { data, error } = await supabase.from("security_rule_profiles")
          .insert({ ...clone, master_account_id: masterId }).select("*").single();
        if (error) throw error;
        return ok(data);
      }
      case "delete_profile": {
        if (!body.id) return err("Perfil não informado.");
        const { error } = await supabase.from("security_rule_profiles")
          .delete().eq("id", body.id).eq("master_account_id", masterId);
        if (error) throw error;
        return ok({ deleted: true });
      }
      case "save_assignment": {
        const pid = body.profile_id;
        if (!pid) return err("Perfil não informado.");
        const { data: prof } = await supabase.from("security_rule_profiles")
          .select("id").eq("id", pid).eq("master_account_id", masterId).maybeSingle();
        if (!prof) return err("Perfil não encontrado.", 404);
        const targetType = body.target_type === "all"
          ? "all" : (body.target_type === "collaborator" ? "collaborator" : "seller");
        const memberIds: string[] = Array.isArray(body.member_ids) ? body.member_ids.filter(Boolean) : [];
        await supabase.from("security_rule_assignments")
          .delete().eq("profile_id", pid).eq("master_account_id", masterId);
        const rows = targetType === "all"
          ? [{ profile_id: pid, master_account_id: masterId, target_type: "all", target_member_id: null }]
          : memberIds.map((mid) => ({ profile_id: pid, master_account_id: masterId, target_type: targetType, target_member_id: mid }));
        if (rows.length) {
          const { error } = await supabase.from("security_rule_assignments").insert(rows);
          if (error) throw error;
        }
        return ok({ saved: true, count: rows.length });
      }
      case "list_members": {
        const { data, error } = await supabase.from("ai_team_members")
          .select("id, name, email, active_in_system").eq("user_id", masterId).order("name");
        if (error) throw error;
        return ok((data || []).filter((m: any) => m.active_in_system !== false));
      }
      case "list_violations": {
        const { data, error } = await supabase.from("security_rule_violations")
          .select("*").eq("master_account_id", masterId)
          .order("attempted_at", { ascending: false }).limit(Number(body.limit) || 100);
        if (error) throw error;
        return ok(data || []);
      }
      default:
        return err("Ação inválida.", 400);
    }
  } catch (e: any) {
    console.error("[security-rules-api] erro:", e?.message || e);
    return err("Não foi possível processar a solicitação. Tente novamente.", 500);
  }
});
