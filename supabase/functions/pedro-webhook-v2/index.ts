import {
  createServiceClient,
  corsHeaders,
  isPedroV2Enabled,
  isPedroV2MutationEnabled,
  jsonResponse,
  parseJson,
} from "../_shared/pedro-v2/server.ts";
import { processPedroV2Turn } from "../_shared/pedro-v2/orchestrator.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!isPedroV2Enabled()) {
    return jsonResponse({
      ok: false,
      disabled: true,
      message: "Pedro v2 is scaffolded but disabled. Set PEDRO_V2_ENABLED=true to test.",
    }, 423);
  }

  const supabase = createServiceClient();
  const payload = await parseJson(req);
  const instanceName =
    payload?.instanceName ||
    payload?.instance_name ||
    payload?.instance ||
    payload?.data?.instanceName ||
    payload?.data?.instance ||
    null;

  if (!instanceName) return jsonResponse({ ok: false, error: "instance_missing" }, 400);

  const { data: waInstance, error: instanceError } = await supabase
    .from("wa_instances")
    .select("*")
    .eq("instance_name", instanceName)
    .eq("is_active", true)
    .maybeSingle();

  if (instanceError || !waInstance) {
    return jsonResponse({ ok: false, error: "active_instance_not_found" }, 404);
  }

  const { data: agent, error: agentError } = await supabase
    .from("wa_ai_agents")
    .select("*")
    .eq("user_id", waInstance.user_id)
    .eq("is_active", true)
    .maybeSingle();

  if (agentError || !agent) {
    return jsonResponse({ ok: false, error: "active_agent_not_found" }, 404);
  }

  const result = await processPedroV2Turn(supabase, {
    payload,
    agent,
    wa_instance: waInstance,
    dry_run: payload?.dry_run === false ? !isPedroV2MutationEnabled() : true,
  });

  return jsonResponse(result, result.ok ? 200 : 400);
});
