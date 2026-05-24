import {
  authorizeToolRequest,
  createServiceClient,
  corsHeaders,
  isPedroV2MutationEnabled,
  jsonResponse,
  parseJson,
} from "../_shared/pedro-v2/server.ts";
import {
  ensurePedroV2Lead,
  findPedroV2Lead,
  loadPedroMemory,
  updatePedroMemoryFromIntent,
} from "../_shared/pedro-v2/leadMemory.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await authorizeToolRequest(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const body = await parseJson(req);
  if (!body.user_id || !body.agent_id || !body.remote_jid) {
    return jsonResponse({ ok: false, error: "user_id_agent_id_remote_jid_required" }, 400);
  }

  const supabase = createServiceClient();
  const commit = body.commit === true && isPedroV2MutationEnabled();
  const lead = commit
    ? await ensurePedroV2Lead(supabase, body)
    : await findPedroV2Lead(supabase, { agent_id: body.agent_id, remote_jid: body.remote_jid });
  const current = lead?.id ? await loadPedroMemory(supabase, { lead_id: lead.id, agent_id: body.agent_id }) : {};
  if (!body.intent || !commit || !lead?.id) {
    return jsonResponse({
      ok: true,
      dry_run: !commit,
      lead,
      memory: current,
      message: commit ? undefined : "Memory tool is dry-run. Set PEDRO_V2_MUTATIONS_ENABLED=true and commit=true in controlled tests.",
    });
  }

  const memory = await updatePedroMemoryFromIntent(supabase, {
    lead_id: lead.id,
    agent_id: body.agent_id,
    user_id: body.user_id,
    current,
    intent: body.intent,
    lead_phone: body.lead_phone || body.remote_jid,
    lead_name: body.lead_name || null,
  });

  return jsonResponse({ ok: true, lead, memory });
});
