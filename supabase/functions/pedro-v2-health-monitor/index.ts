/**
 * pedro-v2-health-monitor — varre pedro_v2_turn_logs REAIS e GRAVA um relatorio de "saude"
 * em pedro_v2_health_reports, flagrando assinaturas de regressao que viemos corrigindo:
 *  - unsolicited_photos    : fotos enviadas sem o lead pedir (e sem ser aceite curto de oferta)
 *  - ctwa_ad_lost          : lead de anuncio (rajada) cujo ad_context se perdeu (corrigido v120)
 *  - ad_vehicle_unresolved : anuncio presente mas veiculo NAO resolvido
 *  - byok_block            : conta nova sem chave de IA (nao respondeu)
 *  - provider_error        : falha de provedor de IA (sem credito / chave invalida)
 *  - grounding_corrected   : o validador pegou uma alucinacao e corrigiu (metrica, NAO problema)
 *
 * AGREGADO + POR AGENTE: grava 1 linha agregada (agent_id null) e 1 por agente (agent_id), pra
 * alimentar o painel de Administracao (saude por agente de cliente + tendencia).
 *
 * Registro-only (decisao do dono): NAO envia WhatsApp.
 * Chamadas: cron diario (service_role) E painel admin (JWT de superadmin/dono) — validado abaixo.
 *   body.hours (default 24) | body.dry_run=true -> calcula e retorna SEM gravar | body.per_agent
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Donos da plataforma (fallback ao is_superadmin). Mesma lista do front (useIsAdmin).
const OWNER_EMAILS = ["wandercarvalho31@gmail.com", "douglasaloan@gmail.com"];

const SIGS = ["unsolicited_photos", "ctwa_ad_lost", "ad_vehicle_unresolved", "byok_block", "provider_error", "grounding_corrected"] as const;
type Sig = typeof SIGS[number];
const emptyFlags = (): Record<Sig, any[]> =>
  ({ unsolicited_photos: [], ctwa_ad_lost: [], ad_vehicle_unresolved: [], byok_block: [], provider_error: [], grounding_corrected: [] });

const stripPlaceholders = (s: string) => String(s || "").replace(/\[[^\]]*\]/g, " ");
const asksPhoto = (t: string) => /\b(foto|fotos|imagem|imagens|mostra|me mostra|ver o carro|manda (a|as|uma|umas)? ?foto|catalogo|album)\b/i.test(stripPlaceholders(t));
const shortAffirm = (t: string) => /^\s*(sim|pode|pode sim|isso|claro|quero|ok|blz|manda|pode mandar|aham|positivo)[\s.!]*$/i.test(stripPlaceholders(t).trim());
const adInterest = (t: string) => /\b(tenho interesse|interessei|vim do an[uú]ncio|do an[uú]ncio|mais informa|quero saber|esse carro|esse ve[ií]culo|esse an[uú]ncio)\b/i.test(stripPlaceholders(t));

function summarize(flags: Record<Sig, any[]>) {
  const counts: Record<string, number> = {};
  const samples: Record<string, any[]> = {};
  for (const k of SIGS) { counts[k] = flags[k].length; samples[k] = flags[k].slice(0, 10); }
  // grounding_corrected NAO conta como "problema" (rede de seguranca funcionando).
  const hasFindings = SIGS.some((k) => k !== "grounding_corrected" && counts[k] > 0);
  return { counts, samples, hasFindings };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* sem body (cron) */ }
  const hours = Number(body?.hours) > 0 ? Number(body.hours) : 24;
  const dryRun = body?.dry_run === true;
  const perAgent = body?.per_agent === true;
  const sinceIso = new Date(Date.now() - hours * 3600e3).toISOString();

  // ── AUTH: cron/infra (service_role) sempre; usuario PRECISA ser superadmin/dono. ──
  // O gateway (verify_jwt) valida a ASSINATURA antes de chegar aqui, entao o claim `role`
  // do JWT e confiavel. service_role/supabase_admin = cron; authenticated = checa superadmin.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let role = "";
  try { role = String(JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")))?.role || ""); } catch { /* nao-jwt */ }
  let allowed = role === "service_role" || role === "supabase_admin" || (!!token && token === serviceKey);
  if (!allowed && token) {
    try {
      const { data: ures } = await supabase.auth.getUser(token);
      const uid = ures?.user?.id;
      const email = (ures?.user?.email || "").toLowerCase();
      if (uid) {
        const { data: prof } = await supabase.from("profiles").select("is_superadmin").eq("id", uid).maybeSingle();
        allowed = prof?.is_superadmin === true || OWNER_EMAILS.includes(email);
      }
    } catch { /* nao e jwt de usuario valido */ }
  }
  if (!allowed) return json({ ok: false, error: "forbidden: admin only" }, 403);

  const { data, error } = await supabase.from("pedro_v2_turn_logs")
    .select("created_at,remote_jid,next_action,payload,result,agent_id,user_id")
    .eq("dry_run", false).gte("created_at", sinceIso)
    .order("created_at", { ascending: false }).limit(5000);
  if (error) return json({ ok: false, error: error.message }, 500);

  const globalFlags = emptyFlags();
  const perAgentMap = new Map<string, { agent_id: string | null; user_id: string | null; flags: Record<Sig, any[]>; total: number; last: string }>();
  let total = 0;

  for (const r of data || []) {
    total++;
    const res: any = r.result || {}, pl: any = r.payload || {};
    const text = String(pl.text || ""), ad: any = pl.ad_context || {}, bp: any = pl.brain_plan || {};
    const mc = Number(res.media_count || 0);
    const jid = "****" + String(r.remote_jid || "").replace(/\D/g, "").slice(-4); // telefone MASCARADO
    const samp = (extra: any) => ({ at: r.created_at, jid, in: text.slice(0, 70), ...extra });

    const hits: Array<[Sig, any]> = [];
    if (mc > 0 && !asksPhoto(text) && !shortAffirm(text)) hits.push(["unsolicited_photos", samp({ mc, src: res.reply_source })]);
    if (ad.has_ad_context === false && adInterest(text) && !bp.search_query && ["reply_only", "clarify"].includes(String(bp.action)))
      hits.push(["ctwa_ad_lost", samp({ action: bp.action })]);
    if (ad.has_ad_context === true && !ad.vehicle_query && !bp.search_query) hits.push(["ad_vehicle_unresolved", samp({ ad_conf: ad.confidence })]);
    if (res.ai_key_source === "none" || r.next_action === "no_ai_key_configured") hits.push(["byok_block", samp({})]);
    const perr = Array.isArray(res.ai_provider_errors) ? res.ai_provider_errors : [];
    if (perr.some((e: any) => e?.kind === "quota" || e?.kind === "auth")) hits.push(["provider_error", samp({ errs: perr.map((e: any) => e.kind) })]);
    if (res.grounding_corrected === true) hits.push(["grounding_corrected", samp({ src: res.reply_source })]);

    for (const [k, s] of hits) globalFlags[k].push(s);

    const aid = r.agent_id || "__none__";
    let pa = perAgentMap.get(aid);
    if (!pa) { pa = { agent_id: r.agent_id || null, user_id: r.user_id || null, flags: emptyFlags(), total: 0, last: r.created_at }; perAgentMap.set(aid, pa); }
    pa.total++;
    if (String(r.created_at) > String(pa.last)) pa.last = r.created_at;
    for (const [k, s] of hits) pa.flags[k].push(s);
  }

  const g = summarize(globalFlags);
  const report = { window_hours: hours, total_turns: total, since: sinceIso, counts: g.counts, samples: g.samples, has_findings: g.hasFindings };

  // ── BREAKDOWN POR AGENTE (+ nomes do agente e do cliente) ──
  let agents: any[] = [];
  if (perAgent || !dryRun) {
    const ids = [...perAgentMap.values()].map((p) => p.agent_id).filter(Boolean) as string[];
    const uids = [...perAgentMap.values()].map((p) => p.user_id).filter(Boolean) as string[];
    const nameById = new Map<string, string>();
    const clientByUid = new Map<string, string | null>();
    if (ids.length) {
      const { data: ags } = await supabase.from("wa_ai_agents").select("id,name,user_id").in("id", ids);
      for (const a of ags || []) nameById.set(a.id, a.name);
    }
    if (uids.length) {
      const { data: profs } = await supabase.from("profiles").select("id,company_name,full_name").in("id", uids);
      for (const p of profs || []) clientByUid.set(p.id, (p as any).company_name || (p as any).full_name || null);
    }
    const problemCount = (counts: Record<string, number>) =>
      SIGS.filter((k) => k !== "grounding_corrected").reduce((n, k) => n + (counts[k] || 0), 0);
    agents = [...perAgentMap.values()].map((pa) => {
      const s = summarize(pa.flags);
      return {
        agent_id: pa.agent_id,
        agent_name: pa.agent_id ? (nameById.get(pa.agent_id) || "Agente") : "(sem agente)",
        client_name: pa.user_id ? (clientByUid.get(pa.user_id) || null) : null,
        total_turns: pa.total,
        last_activity: pa.last,
        counts: s.counts,
        samples: s.samples,
        has_findings: s.hasFindings,
      };
    }).sort((a, b) => {
      const pb = problemCount(b.counts), pa2 = problemCount(a.counts);
      if (pb !== pa2) return pb - pa2;          // mais problemas primeiro
      return b.total_turns - a.total_turns;     // depois mais volume
    });
  }

  // ── PERSISTE (cron / botao "Atualizar"): linha agregada (agent_id null) + 1 por agente ──
  let persisted = false;
  if (!dryRun) {
    try {
      const rows: any[] = [{ window_hours: hours, total_turns: total, counts: g.counts, samples: g.samples, has_findings: g.hasFindings, agent_id: null }];
      for (const a of agents) {
        if (!a.agent_id) continue;
        rows.push({ window_hours: hours, total_turns: a.total_turns, counts: a.counts, samples: a.samples, has_findings: a.has_findings, agent_id: a.agent_id });
      }
      await supabase.from("pedro_v2_health_reports").insert(rows);
      persisted = true;
    } catch (e) {
      return json({ ok: true, persisted: false, persist_error: String((e as any)?.message || e), report, agents });
    }
  }

  return json({ ok: true, persisted, report, agents });
});
