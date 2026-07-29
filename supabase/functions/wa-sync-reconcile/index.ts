// deno-lint-ignore-file no-explicit-any
// ============================================================================
// wa-sync-reconcile — reconciliacao incremental da caixa UAZAPI (cron 10min).
//
// NAO importa nada por si: apenas DESPACHA wa-sync-ai-conversations (que faz a
// importacao idempotente/read-only) para cada instancia elegivel dos tenants na
// allowlist WA_SYNC_TENANT_IDS (piloto). Vazio/ausente => no-op (nenhum tenant).
// Cap por rodada. O lock por (tenant,instancia) vive no checkpoint do syncer, que
// impede execucoes concorrentes. Mensagens importadas vao para wa_synced_messages
// (tabela dedicada) -> nunca reprocessadas como novas, nunca acionam o V3.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(SUPA_URL, SERVICE);

  // Auth: service_role apenas (cron/infra).
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let role = "";
  try { role = String(JSON.parse(atob((token.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/")))?.role || ""); } catch { /* */ }
  if (!(role === "service_role" || token === SERVICE)) return json({ ok: false, error: "forbidden" }, 403);

  const allowlist = (Deno.env.get("WA_SYNC_TENANT_IDS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowlist.length) return json({ ok: true, dispatched: 0, note: "allowlist_vazia_noop" });

  const body = await req.json().catch(() => ({} as any));
  const maxInstances = Math.min(Math.max(Number(body?.max_instances ?? 6), 1), 30);
  const windowDays = Number(body?.window_days ?? 30);
  const maxChats = Number(body?.max_chats ?? 40); // incremental por rodada

  // Todas as linhas UAZAPI do tenant: linha de IA entra inteira; linha de
  // vendedor e filtrada pelo proprio syncer para somente leads atribuidos no CRM.
  // Nao depender de wa_ai_agents evita esconder a linha quando o agente esta
  // desligado, fora do horario ou com um vinculo antigo de instancia.
  const { data: insts } = await admin.from("wa_instances")
    .select("id, user_id, seller_member_id, status, provider")
    .in("user_id", allowlist);
  const eligible = (insts || []).filter((i: any) =>
    i.provider !== "meta" && String(i.status || "").toLowerCase() !== "disconnected");

  // O limite por rodada nao pode escolher sempre as primeiras instancias: isso
  // deixava as demais sem sincronizar para sempre. Priorizamos quem nunca rodou
  // e, depois, o checkpoint mais antigo (round-robin persistente no banco).
  const eligibleIds = eligible.map((i: any) => i.id);
  const { data: checkpoints } = eligibleIds.length
    ? await admin.from("wa_sync_checkpoint")
      .select("instance_id, updated_at")
      .in("instance_id", eligibleIds)
    : { data: [] as any[] };
  const checkpointTime = new Map<string, number>(
    (checkpoints || []).map((c: any) => [String(c.instance_id), new Date(c.updated_at || 0).getTime()]),
  );
  const scheduled = [...eligible].sort((a: any, b: any) => {
    const aTime = checkpointTime.get(String(a.id));
    const bTime = checkpointTime.get(String(b.id));
    if (aTime === undefined && bTime !== undefined) return -1;
    if (aTime !== undefined && bTime === undefined) return 1;
    return (aTime ?? 0) - (bTime ?? 0);
  });

  const results: any[] = [];
  let dispatched = 0;
  for (const inst of scheduled.slice(0, maxInstances)) {
    try {
      const r = await fetch(`${SUPA_URL}/functions/v1/wa-sync-ai-conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
        body: JSON.stringify({
          tenant_id: inst.user_id, instance_id: inst.id,
          window_days: windowDays, max_chats: maxChats, trigger_source: "reconcile",
        }),
      });
      const j = await r.json().catch(() => null);
      results.push({ instance: inst.id, http: r.status, ok: j?.ok, imported: j?.messages_imported, dup: j?.duplicates, err: j?.error });
      dispatched++;
    } catch (e: any) {
      results.push({ instance: inst.id, error: String(e?.message || e).slice(0, 160) });
    }
  }
  return json({
    ok: true,
    dispatched,
    eligible: eligible.length,
    remaining_for_next_round: Math.max(eligible.length - dispatched, 0),
    tenants: allowlist.length,
    results,
  });
});
