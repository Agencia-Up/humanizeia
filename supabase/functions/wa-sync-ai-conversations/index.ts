// deno-lint-ignore-file no-explicit-any
// ============================================================================
// wa-sync-ai-conversations — importa a caixa da UAZAPI para "Conversas IA".
//
// SOMENTE LEITURA/IMPORTACAO. NUNCA: responde ao cliente, chama o V3, cria lead,
// altera CRM, dispara follow-up/transferencia, consome tokens de IA.
// Escopo (regras do dono): linha de IA -> TODAS as conversas (o numero da IA
// existe para atender lead de trafego pago); linha de VENDEDOR -> SOMENTE as
// conversas com leads dele cadastrados na Logos (o resto da agenda pessoal
// nunca e lido). Exclui grupo/status/broadcast/internos. Idempotente pelo messageid REAL do provedor. Autoria por EVIDENCIA
// (fromMe + correspondencia com v3_effect_outbox), nunca pela instancia.
//
// Contrato UAZAPI validado (read-only) na instancia piloto:
//   POST /chat/find     { limit, offset, sort:'-wa_lastMsgTimestamp' } -> chats[]
//   POST /message/find  { where:{chatid}, limit, sort:'-messageTimestamp' } -> msgs[]
//   auth: header token (= token da instancia). Campos: wa_chatid, wa_isGroup, phone,
//   wa_name; messageid, fromMe, messageTimestamp(ms), messageType, text, fileURL.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyActor, digits, isGroupOrSpecial, logosPhoneKey, mapMessageType, msgTs, type V3Sig } from "../_shared/wa-sync/classify.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OWNER_EMAILS = ["wandercarvalho31@gmail.com", "douglasaloan@gmail.com"];
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Espelha public.logos_phone_canonical: identidade nacional estavel, nunca last-8.
const phoneCanonical = (jidOrPhone: unknown) => {
  const value = digits(String(jidOrPhone ?? "").split("@")[0]);
  if (value.length >= 12 && value.startsWith("55")) return value;
  if (value.length === 10 || value.length === 11) return `55${value}`;
  return value;
};

async function uaFetch(baseUrl: string, token: string, path: string, body: any) {
  const r = await fetch(baseUrl.replace(/\/+$/, "") + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", token, apikey: token },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`uazapi ${path} HTTP ${r.status}: ${String(await r.text().catch(() => "")).slice(0, 160)}`);
  const j = await r.json().catch(() => null);
  return Array.isArray(j) ? j : (j?.chats || j?.messages || j?.data || []);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  const admin = createClient(SUPA_URL, SERVICE);

  // ── AUTH: service_role (cron/infra) ou superadmin/dono ──────────────────────
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let role = "";
  try { role = String(JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")))?.role || ""); } catch { /* */ }
  let allowed = role === "service_role" || (!!token && token === SERVICE);
  if (!allowed && token) {
    try {
      const { data: u } = await admin.auth.getUser(token);
      const uid = u?.user?.id; const email = (u?.user?.email || "").toLowerCase();
      if (uid) {
        const { data: prof } = await admin.from("profiles").select("is_superadmin").eq("id", uid).maybeSingle();
        allowed = prof?.is_superadmin === true || OWNER_EMAILS.includes(email);
      }
    } catch { /* */ }
  }
  if (!allowed) return json({ ok: false, error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({} as any));
  const tenantId = String(body?.tenant_id || "").trim();
  const instanceId = String(body?.instance_id || "").trim();
  const windowDays = Math.min(Math.max(Number(body?.window_days ?? 30), 1), 180);
  const maxChats = Math.min(Math.max(Number(body?.max_chats ?? 150), 1), 400);
  const maxMsgs = Math.min(Math.max(Number(body?.max_msgs_per_chat ?? 400), 1), 1000);
  const dryRun = body?.dry_run === true;
  const triggerSource = String(body?.trigger_source || "manual");
  if (!tenantId || !instanceId) return json({ ok: false, error: "tenant_id_and_instance_id_required" }, 400);

  // ── ALLOWLIST DO PILOTO (fail-closed) ───────────────────────────────────────
  // O dispatcher ja respeita WA_SYNC_TENANT_IDS, mas o worker tambem precisa: sem
  // isto, uma chamada direta (service_role/superadmin) sincronizaria qualquer
  // tenant. Vazia/ausente => NENHUM tenant e sincronizado.
  const allowlist = (Deno.env.get("WA_SYNC_TENANT_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowlist.includes(tenantId)) {
    return json({ ok: false, error: "tenant_fora_da_allowlist", tenant_id: tenantId, allowlist_size: allowlist.length }, 403);
  }

  // ── Instancia: validar tenant + NAO-vendedor + vinculada a agente de IA ─────
  const { data: inst } = await admin.from("wa_instances")
    .select("id, user_id, instance_name, api_url, api_key_encrypted, provider, seller_member_id, status")
    .eq("id", instanceId).maybeSingle();
  if (!inst) return json({ ok: false, error: "instance_not_found" }, 404);
  if (String(inst.user_id) !== tenantId) return json({ ok: false, error: "tenant_instance_mismatch" }, 403);

  // ── MODO DA INSTANCIA (regras 1 e 2 do dono) ────────────────────────────────
  // Linha de IA (seller_member_id IS NULL) = MESMA definicao usada pelos gatilhos
  // da projecao e pelas RPCs. Regra 2: TODA conversa dela entra (o numero da IA
  // existe para atender lead de trafego pago), com ou sem lead no CRM.
  //   -> nao exigimos vinculo com wa_ai_agents: na WA o agente aponta para uma
  //      instancia que nao existe mais, e isso nao pode esconder a conversa real.
  // Linha de VENDEDOR = so as conversas com leads DELE cadastrados na Logos
  // (regra 1). Qualquer outro numero do WhatsApp pessoal fica de fora.
  const sellerMemberId: string | null = inst.seller_member_id ? String(inst.seller_member_id) : null;
  const mode: "ia" | "vendedor" = sellerMemberId ? "vendedor" : "ia";
  if (inst.provider === "meta") return json({ ok: false, error: "meta_instance_uses_cloud_api_not_supported_here" }, 400);
  const baseUrl = String(inst.api_url || ""); const uaToken = String(inst.api_key_encrypted || "");
  if (!baseUrl || !uaToken) return json({ ok: false, error: "instance_missing_url_or_token" }, 400);

  // ── LOCK por (tenant, instancia): impede execucoes concorrentes ─────────────
  const nowIso = new Date().toISOString();
  const lockCut = new Date(Date.now() - 20 * 60000).toISOString(); // lock expira em 20min
  const { data: ck } = await admin.from("wa_sync_checkpoint")
    .select("*").eq("tenant_id", tenantId).eq("instance_id", instanceId).maybeSingle();
  if (ck?.status === "running" && ck?.locked_at && ck.locked_at > lockCut) {
    return json({ ok: false, error: "already_running", locked_at: ck.locked_at });
  }
  await admin.from("wa_sync_checkpoint").upsert({
    tenant_id: tenantId, instance_id: instanceId, status: "running", locked_at: nowIso, updated_at: nowIso,
    window_start: ck?.window_start ?? new Date(Date.now() - windowDays * 86400e3).toISOString(),
  }, { onConflict: "tenant_id,instance_id" });

  const { data: runRow } = await admin.from("wa_sync_run").insert({
    tenant_id: tenantId, instance_id: instanceId, status: "running", trigger_source: triggerSource,
  }).select("id").maybeSingle();
  const runId = runRow?.id;

  const sinceMs = Date.now() - windowDays * 86400e3;
  const counters = { chats_found: 0, messages_found: 0, messages_imported: 0, duplicates: 0, failures: 0 };
  let status = "ok"; let errText: string | null = null;

  try {
    // Internos do tenant (nunca sao "lead"): excluir da sync.
    const { data: internalRows } = await admin.rpc("logos_internal_keys", { p_tenant: tenantId }).then(
      (x: any) => x, () => ({ data: [] }));
    const internalKeys = new Set<string>((Array.isArray(internalRows) ? internalRows : []).map((k: any) => String(k)));

    // ── REGRA 1: numeros permitidos numa linha de VENDEDOR ────────────────────
    // Só entram conversas com leads DELE cadastrados na Logos (Pedro + Marcos).
    // Sem lead atribuido => nada a sincronizar (nunca varre a agenda pessoal).
    let allowedKeys: Set<string> | null = null;
    if (mode === "vendedor") {
      const keys = new Set<string>();
      const { data: pedroLeads } = await admin.from("ai_crm_leads")
        .select("remote_jid").eq("user_id", tenantId).eq("assigned_to_id", sellerMemberId);
      for (const l of (pedroLeads || []) as any[]) keys.add(logosPhoneKey(String(l.remote_jid || "").split("@")[0]));
      const { data: marcosLeads } = await admin.from("crm_leads")
        .select("phone").eq("user_id", tenantId).eq("assigned_to", sellerMemberId);
      for (const l of (marcosLeads || []) as any[]) keys.add(logosPhoneKey(String(l.phone || "")));
      keys.delete("");
      allowedKeys = keys;
      if (!keys.size) {
        await admin.from("wa_sync_checkpoint").update({ status: "idle", locked_at: null }).eq("tenant_id", tenantId).eq("instance_id", instanceId);
        if (runId) await admin.from("wa_sync_run").update({ finished_at: new Date().toISOString(), status: "ok", error: "vendedor_sem_lead_atribuido" }).eq("id", runId);
        return json({ ok: true, dry_run: dryRun, run_id: runId, mode, ...counters, note: "vendedor_sem_lead_atribuido_nada_a_sincronizar" });
      }
    }

    // Assinaturas do que o V3 ENVIOU (para autoria ia_v3) — 1 query.
    const v3map = new Map<string, V3Sig[]>();
    try {
      const { data: sigs } = await admin.rpc("get_v3_sent_signatures_bulk", { p_tenant: tenantId, p_since: new Date(sinceMs).toISOString() });
      for (const s of (sigs || []) as any[]) {
        const k = String(s.phone_key || "");
        if (!v3map.has(k)) v3map.set(k, []);
        v3map.get(k)!.push({ b: Number(s.minute_bucket), t: String(s.sig || "") });
      }
    } catch { /* sem V3 -> tudo fromMe vira humano_manual */ }

    let offset = Number(ck?.last_chat_offset || 0);
    let processedChats = 0; let maxTsSeen = Number(ck?.last_synced_ts ? new Date(ck.last_synced_ts).getTime() : 0);

    while (processedChats < maxChats) {
      const page = await uaFetch(baseUrl, uaToken, "/chat/find", { limit: 50, offset, sort: "-wa_lastMsgTimestamp" });
      if (!page.length) break;
      for (const chat of page) {
        if (processedChats >= maxChats) break;
        offset++;
        if (isGroupOrSpecial(chat)) continue;
        const jid = String(chat.wa_chatid || chat.id || "");
        const pc = phoneCanonical(chat.phone || jid);
        const pkey = logosPhoneKey(chat.phone || jid);
        if (!pc || pkey.length < 8) continue;
        if (internalKeys.has(pkey)) continue; // numero interno do tenant
        if (allowedKeys && !allowedKeys.has(pkey)) continue; // regra 1: so lead do vendedor
        counters.chats_found++;
        processedChats++;

        // Mensagens do chat (paginadas, dentro da janela)
        const rows: any[] = [];
        let mOff = 0; let lastForConv: any = null;
        while (rows.length < maxMsgs) {
          const msgs = await uaFetch(baseUrl, uaToken, "/message/find", { where: { chatid: jid }, limit: 50, offset: mOff, sort: "-messageTimestamp" });
          if (!msgs.length) break;
          let stop = false;
          for (const m of msgs) {
            const ts = msgTs(m);
            if (ts < sinceMs) { stop = true; break; } // fora da janela -> para (ordenado desc)
            const mid = String(m.messageid || m.id || "");
            if (!mid) { counters.failures++; continue; }
            const { actor, dir } = classifyActor(m, pkey, mode === "vendedor" ? new Map() : v3map);
            const type = mapMessageType(m.messageType || m.type);
            const row = {
              tenant_id: tenantId, instance_id: instanceId, chatid: jid,
              provider_message_id: mid, phone_canonical: pc, phone_raw: digits(chat.phone || jid),
              contact_name: chat.wa_name || chat.lead_name || null,
              from_me: m.fromMe === true, direction: dir,
              actor_source: actor, ingestion_source: "sincronizacao_uazapi",
              message_type: type, content: (m.text || m.content || null),
              media_url: (m.fileURL || null), wa_timestamp: new Date(ts).toISOString(),
              sender_raw: (m.sender || m.participant || null),
              raw: { messageid: mid, messageType: m.messageType, source: m.source ?? null },
            };
            rows.push(row);
            if (ts > maxTsSeen) maxTsSeen = ts;
            if (!lastForConv || ts > msgTs({ messageTimestamp: new Date(lastForConv.wa_timestamp).getTime() })) lastForConv = row;
          }
          if (stop || msgs.length < 50) break;
          mOff += 50;
          await sleep(120); // rate limit
        }
        counters.messages_found += rows.length;

        if (!dryRun && rows.length) {
          // Idempotente por (tenant, instance, provider_message_id).
          for (let i = 0; i < rows.length; i += 200) {
            const chunk = rows.slice(i, i + 200);
            const { data: ins, error } = await admin.from("wa_synced_messages")
              .upsert(chunk, { onConflict: "tenant_id,instance_id,provider_message_id", ignoreDuplicates: true })
              .select("id");
            if (error) { counters.failures += chunk.length; continue; }
            const importedNow = (ins || []).length;
            counters.messages_imported += importedNow;
            counters.duplicates += chunk.length - importedNow;
          }
          // ai_conversation_index SEM depender do CRM (best-effort, nunca cria lead).
          const last = lastForConv;
          if (last) {
            await admin.from("ai_conversation_index").upsert({
              user_id: tenantId, instance_id: instanceId, phone_canonical: pc, phone_raw: digits(chat.phone || jid),
              contact_name: last.contact_name, last_message: last.content, last_message_type: last.message_type,
              last_message_direction: last.direction, last_message_at: last.wa_timestamp,
              ai_line: mode === "ia", updated_at: nowIso,
            }, { onConflict: "user_id,instance_id,phone_canonical", ignoreDuplicates: false }).then(() => {}, () => {});
          }
          // checkpoint apos cada chat
          await admin.from("wa_sync_checkpoint").update({
            last_chat_offset: offset, last_synced_ts: new Date(maxTsSeen).toISOString(), updated_at: new Date().toISOString(),
          }).eq("tenant_id", tenantId).eq("instance_id", instanceId);
        }
        await sleep(150); // rate limit entre chats
      }
      if (page.length < 50) break;
    }
    // Se varreu tudo, reinicia o offset para a proxima rodada pegar novidades do topo.
    if (processedChats < maxChats) offset = 0;
    await admin.from("wa_sync_checkpoint").update({ last_chat_offset: offset }).eq("tenant_id", tenantId).eq("instance_id", instanceId);
  } catch (e: any) {
    status = "error"; errText = String(e?.message || e).slice(0, 500); counters.failures++;
  } finally {
    await admin.from("wa_sync_checkpoint").update({ status: "idle", locked_at: null, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("instance_id", instanceId);
    if (runId) {
      await admin.from("wa_sync_run").update({
        finished_at: new Date().toISOString(),
        status: status === "ok" ? (counters.failures ? "partial" : "ok") : "error",
        ...counters, error: errText,
      }).eq("id", runId);
    }
  }

  return json({ ok: status !== "error", dry_run: dryRun, run_id: runId, tenant_id: tenantId, instance_id: instanceId, mode, ...counters, error: errText });
});
