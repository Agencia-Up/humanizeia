import { authorizeToolRequest, createServiceClient, corsHeaders, isPedroV2MutationEnabled, jsonResponse, parseJson } from "../_shared/pedro-v2/server.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await authorizeToolRequest(req);
  if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);

  const body = await parseJson(req);
  if (!body.lead_id) return jsonResponse({ ok: false, error: "lead_id_required" }, 400);

  const allowedPatch: Record<string, any> = {};
  if (body.assigned_to_id !== undefined) allowedPatch.assigned_to_id = body.assigned_to_id;
  if (body.status !== undefined) allowedPatch.status = body.status;
  if (body.summary !== undefined) allowedPatch.summary = body.summary;
  if (body.last_interaction_at !== undefined) allowedPatch.last_interaction_at = body.last_interaction_at;

  if (body.status_crm !== undefined || body.funnel_stage !== undefined) {
    return jsonResponse({
      ok: false,
      error: "crm_stage_mutation_blocked",
      message: "Pedro v2 cannot move commercial CRM columns. Seller or manager must move the lead manually.",
    }, 409);
  }

  const commit = body.commit === true && isPedroV2MutationEnabled();
  if (!commit) {
    return jsonResponse({
      ok: true,
      dry_run: true,
      planned_patch: allowedPatch,
      message: "CRM sync is dry-run. Set PEDRO_V2_MUTATIONS_ENABLED=true and commit=true only in controlled tests.",
    });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ai_crm_leads")
    .update(allowedPatch)
    .eq("id", body.lead_id)
    .select("id, assigned_to_id, status, status_crm, summary")
    .maybeSingle();

  if (error) return jsonResponse({ ok: false, error: error.message }, 400);
  return jsonResponse({ ok: true, lead: data });
});

