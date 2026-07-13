// redistribute-job
// Repasse PROGRAMADO dos leads de um vendedor que saiu -> distribui pro time aos poucos,
// no ritmo do gestor (X por vendedor a cada Y min). Uma RODADA por vez (nao dispara tudo).
// Ações (JWT do gestor): start | pause | resume | cancel | status | preview.
// Ação do robô (service-role, via cron): run_round.
// Repassa TODOS os leads que dao pra trabalhar (exclui fechado/perdido/transferido/vendido),
// cada um com a mensagem de contexto pro vendedor (ativo="continue"; frio="reative").
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildConversationBriefing } from "../_shared/transfer/buildBriefing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

const DONE_STATUS = ["fechado", "perdido", "transferido", "vendido"];       // nunca tocados
const ACTIVE_STATUS = ["novo", "em_atendimento", "negociacao", "agendamento", "qualificado"]; // "continue"
const MAX_ROUND = 50; // teto de leads por rodada (protege o numero e o tempo da edge)

function isServiceRole(bearer: string, serviceKey: string): boolean {
  if (bearer === serviceKey) return true;
  try {
    const pp = (bearer.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const pad = pp.padEnd(pp.length + ((4 - pp.length % 4) % 4), "=");
    return JSON.parse(atob(pad))?.role === "service_role";
  } catch { return false; }
}
function phoneKey(n?: string): string {
  const d = String(n || "").replace(/\D/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11 && local[2] === "9") return `${local.slice(0, 2)}${local.slice(3)}`;
  return local.slice(-10);
}
async function sendWA(instance: any, phone: string, text: string): Promise<boolean> {
  if (!instance?.api_url || !phone) return false;
  let dest = String(phone).replace(/\D/g, "");
  if (dest.length === 10 || dest.length === 11) dest = `55${dest}`;
  const base = String(instance.api_url).replace(/\/+$/, "");
  const key = instance.api_key_encrypted || "";
  if (!key) return false;
  const attempts = [
    { url: `${base}/send/text`, body: { number: dest, text } },
    { url: `${base}/send/text`, body: { remoteJid: `${dest}@s.whatsapp.net`, text } },
    { url: `${base}/message/sendText/${instance.instance_name}`, body: { number: dest, text } },
  ];
  for (const a of attempts) {
    try {
      const r = await fetch(a.url, { method: "POST", headers: { "Content-Type": "application/json", token: key, apikey: key }, body: JSON.stringify(a.body) });
      if (r.ok) return true;
    } catch { /* proximo */ }
  }
  return false;
}
async function resolveInstance(admin: any, lead: any): Promise<any | null> {
  if (lead.agent_id) {
    const { data: agent } = await admin.from("wa_ai_agents").select("instance_ids,instance_id").eq("id", lead.agent_id).maybeSingle();
    const ids: string[] = [...(agent?.instance_ids || [])];
    if (agent?.instance_id) ids.push(agent.instance_id);
    if (ids.length) {
      const { data } = await admin.from("wa_instances").select("*").in("id", ids).eq("status", "connected").limit(1);
      if (data?.[0]) return data[0];
    }
  }
  const { data: fb } = await admin.from("wa_instances").select("*").eq("user_id", lead.user_id).eq("is_active", true).eq("status", "connected").limit(1);
  return fb?.[0] || null;
}
async function resolveTenant(admin: any, uid: string): Promise<string> {
  const { data } = await admin.rpc("resolve_billing_owner_user_id", { p_user_id: uid });
  return (data as string) || uid;
}

// conta quantos leads do vendedor ainda dao pra trabalhar (nao fechado/perdido/transf/vendido)
async function contarTrabalhaveis(admin: any, tenant: string, fromMember: string): Promise<number> {
  const { count } = await admin.from("ai_crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", tenant).eq("assigned_to_id", fromMember)
    .not("status_crm", "in", `(${DONE_STATUS.join(",")})`);
  return count || 0;
}
async function vendedoresElegiveis(admin: any, tenant: string, fromMember: string, sellerIds: string[] | null): Promise<any[]> {
  let q = admin.from("ai_team_members").select("*")
    .eq("user_id", tenant).eq("is_active", true)
    .order("last_lead_received_at", { ascending: true, nullsFirst: true }).limit(100);
  const { data } = await q;
  const seen = new Set<string>();
  return (data || []).filter((s: any) => {
    if (s.id === fromMember || s.is_manager) return false;
    if (sellerIds && sellerIds.length && !sellerIds.includes(s.id)) return false;
    const pk = phoneKey(s.whatsapp_number);
    if (pk && seen.has(pk)) return false;
    if (pk) seen.add(pk);
    return true;
  });
}

// ── Uma RODADA (chamada pelo robô) ────────────────────────────────────────────
async function runRound(admin: any, jobId: string) {
  const { data: job } = await admin.from("lead_redistribution_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job || job.status !== "ativo") return { ok: true, skipped: true };
  const tenant = job.tenant_id;

  const eligible = await vendedoresElegiveis(admin, tenant, job.from_member_id, job.seller_ids);
  if (!eligible.length) {
    // sem vendedor pra receber agora: reagenda e espera (nao trava o job)
    await admin.from("lead_redistribution_jobs").update({
      last_run_at: new Date().toISOString(),
      next_run_at: new Date(Date.now() + Math.max(job.intervalo_min, 5) * 60000).toISOString(),
      ultimo_lote: 0,
    }).eq("id", jobId);
    return { ok: true, moved: 0, motivo: "sem_vendedor" };
  }

  const roundCap = Math.min((job.por_vendedor || 5) * eligible.length, MAX_ROUND);
  const { data: leads } = await admin.from("ai_crm_leads")
    .select("id,user_id,agent_id,lead_name,summary,remote_jid,status,status_crm,vehicle_interest")
    .eq("user_id", tenant).eq("assigned_to_id", job.from_member_id)
    .not("status_crm", "in", `(${DONE_STATUS.join(",")})`)
    .order("last_interaction_at", { ascending: false })
    .limit(roundCap);

  if (!leads || leads.length === 0) {
    await admin.from("lead_redistribution_jobs").update({ status: "concluido", last_run_at: new Date().toISOString(), ultimo_lote: 0 }).eq("id", jobId);
    return { ok: true, concluido: true };
  }

  const perSeller = new Map<string, number>();
  let si = 0, moved = 0;
  for (const lead of leads) {
    // acha o proximo vendedor com vaga na rodada
    let seller: any = null, tries = 0;
    while (tries < eligible.length) {
      const cand = eligible[si % eligible.length]; si++;
      if ((perSeller.get(cand.id) || 0) < (job.por_vendedor || 5)) { seller = cand; break; }
      tries++;
    }
    if (!seller) break; // todos bateram o teto da rodada

    // idempotencia: pula se ja tem transfer pendente
    const { data: pend } = await admin.from("ai_lead_transfers").select("id")
      .eq("lead_id", lead.id).eq("transfer_status", "pending").eq("is_confirmed", false).limit(1);
    if (pend && pend.length) continue;

    const instance = await resolveInstance(admin, lead);
    if (!instance) continue; // sem WhatsApp conectado -> nao move (tenta na proxima rodada)

    const phone = String(lead.remote_jid || "").replace(/\D/g, "");
    const briefing = await buildConversationBriefing(admin, lead);
    const carro = lead.vehicle_interest
      || (String(lead.summary || "").match(/ve[íi]culo de interesse:?\*?\s*([^\n*]{2,80})/i)?.[1]?.trim())
      || "não informado";
    const ativo = ACTIVE_STATUS.includes(String(lead.status_crm || ""));
    const cabecalho = ativo
      ? `🔄 *LEAD REPASSADO — CONTINUE O ATENDIMENTO*\nO vendedor *${job.from_member_name || "anterior"}* saiu. Este cliente já estava sendo atendido — *continue de onde parou.*`
      : `🔄 *LEAD REPASSADO — REATIVE ESSE CLIENTE*\nO vendedor *${job.from_member_name || "anterior"}* saiu. Este lead esfriou — *chame de novo e reative.*`;
    const msg = `${cabecalho}\n\n👤 *Nome:* ${lead.lead_name || "Não informado"}\n` +
      (phone ? `📱 *Telefone:* wa.me/${phone}\n` : "") +
      `🚗 *Carro de interesse:* ${carro}\n\n📝 *Conversa / contexto:*\n${briefing}\n` +
      (phone ? `\n👉 *Continuar agora:* https://wa.me/${phone}` : "") +
      `\n\n⚡ *Atenda o quanto antes!*`;

    const sent = await sendWA(instance, seller.whatsapp_number, msg);
    if (!sent) continue;

    await admin.from("ai_lead_transfers").insert({
      user_id: tenant, lead_id: lead.id, from_member_id: job.from_member_id, to_member_id: seller.id,
      transfer_reason: "repasse_programado", transfer_status: "confirmed", is_confirmed: true,
      notes: `Repasse programado: vendedor ${job.from_member_name || ""} saiu.`,
    });
    await admin.from("ai_crm_leads").update({
      assigned_to_id: seller.id, status: "em_atendimento", last_interaction_at: new Date().toISOString(),
    }).eq("id", lead.id);
    await admin.from("ai_team_members").update({ last_lead_received_at: new Date().toISOString() }).eq("id", seller.id);
    perSeller.set(seller.id, (perSeller.get(seller.id) || 0) + 1);
    moved++;
  }

  const restam = await contarTrabalhaveis(admin, tenant, job.from_member_id);
  const novoStatus = restam <= 0 ? "concluido" : "ativo";
  await admin.from("lead_redistribution_jobs").update({
    total_repassados: (job.total_repassados || 0) + moved,
    ultimo_lote: moved,
    last_run_at: new Date().toISOString(),
    next_run_at: new Date(Date.now() + Math.max(job.intervalo_min, 5) * 60000).toISOString(),
    status: novoStatus,
  }).eq("id", jobId);
  return { ok: true, moved, restam, status: novoStatus };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, serviceKey);
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const body = await req.json().catch(() => ({} as any));
    const action = String(body?.action || "");

    // ── Robô (cron): roda uma rodada ──
    if (action === "run_round") {
      if (!isServiceRole(bearer, serviceKey)) return json({ error: "Unauthorized" }, 401);
      if (!body?.job_id) return json({ error: "job_id obrigatório" }, 400);
      return json(await runRound(admin, String(body.job_id)));
    }

    // ── Gestor (JWT) ──
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    const tenant = await resolveTenant(admin, user.id);

    if (action === "preview") {
      const fromMember = String(body?.from_member_id || "");
      if (!fromMember) return json({ error: "from_member_id obrigatório" }, 400);
      const { data: fm } = await admin.from("ai_team_members").select("id,user_id,name").eq("id", fromMember).maybeSingle();
      if (!fm || fm.user_id !== tenant) return json({ error: "Vendedor não encontrado nesta conta" }, 404);
      const total = await contarTrabalhaveis(admin, tenant, fromMember);
      const eligible = await vendedoresElegiveis(admin, tenant, fromMember, null);
      return json({ ok: true, from_member_name: fm.name, total_trabalhaveis: total, vendedores: eligible.length, nomes: eligible.map((s: any) => s.name) });
    }

    if (action === "start") {
      const fromMember = String(body?.from_member_id || "");
      if (!fromMember) return json({ error: "from_member_id obrigatório" }, 400);
      const { data: fm } = await admin.from("ai_team_members").select("id,user_id,name").eq("id", fromMember).maybeSingle();
      if (!fm || fm.user_id !== tenant) return json({ error: "Vendedor não encontrado nesta conta" }, 404);
      const porVendedor = Math.max(1, Math.min(Number(body?.por_vendedor) || 5, 20));
      const intervalo = Math.max(5, Math.min(Number(body?.intervalo_min) || 30, 720));
      const sellerIds = Array.isArray(body?.seller_ids) && body.seller_ids.length ? body.seller_ids.map((x: any) => String(x)) : null;
      const total = await contarTrabalhaveis(admin, tenant, fromMember);
      const { data: job, error } = await admin.from("lead_redistribution_jobs").insert({
        tenant_id: tenant, from_member_id: fromMember, from_member_name: fm.name,
        por_vendedor: porVendedor, intervalo_min: intervalo, seller_ids: sellerIds,
        status: "ativo", total_alvo: total, next_run_at: new Date().toISOString(), created_by: user.id,
      }).select().single();
      if (error) {
        if (String(error.message || "").includes("uq_lrj_um_vivo")) return json({ error: "Já existe um repasse em andamento para esse vendedor. Pause ou cancele o atual antes de começar outro." }, 409);
        throw error;
      }
      return json({ ok: true, job });
    }

    if (["pause", "resume", "cancel"].includes(action)) {
      const jobId = String(body?.job_id || "");
      if (!jobId) return json({ error: "job_id obrigatório" }, 400);
      const { data: job } = await admin.from("lead_redistribution_jobs").select("id,tenant_id,status").eq("id", jobId).maybeSingle();
      if (!job || job.tenant_id !== tenant) return json({ error: "Repasse não encontrado" }, 404);
      const novo = action === "pause" ? "pausado" : action === "resume" ? "ativo" : "cancelado";
      const patch: any = { status: novo };
      if (action === "resume") patch.next_run_at = new Date().toISOString();
      await admin.from("lead_redistribution_jobs").update(patch).eq("id", jobId);
      return json({ ok: true, status: novo });
    }

    if (action === "status") {
      const fromMember = body?.from_member_id ? String(body.from_member_id) : null;
      let q = admin.from("lead_redistribution_jobs").select("*").eq("tenant_id", tenant).order("created_at", { ascending: false }).limit(10);
      if (fromMember) q = q.eq("from_member_id", fromMember);
      const { data: jobs } = await q;
      // enriquece o job vivo com quantos ainda restam
      const enriched = [] as any[];
      for (const j of (jobs || [])) {
        const restam = (j.status === "ativo" || j.status === "pausado") ? await contarTrabalhaveis(admin, tenant, j.from_member_id) : 0;
        enriched.push({ ...j, restam });
      }
      return json({ ok: true, jobs: enriched });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
