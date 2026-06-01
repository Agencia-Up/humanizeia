import {
  createServiceClient,
  corsHeaders,
  isPedroV2EnabledForUser,
  isPedroV2MutationEnabled,
  jsonResponse,
  parseJson,
} from "../_shared/pedro-v2/server.ts";
import { processPedroV2Turn } from "../_shared/pedro-v2/orchestrator_20260525_photo_flow.ts";

const PEDRO_V2_BUILD = "2026-06-01-concise-reply-v24";

function agentUsesInstance(agent: any, instanceId: string): boolean {
  return agent?.instance_id === instanceId ||
    (Array.isArray(agent?.instance_ids) && agent.instance_ids.includes(instanceId)) ||
    agent?.wa_instance_id === instanceId ||
    agent?.whatsapp_instance_id === instanceId;
}

function agentLooksLikePedro(agent: any): boolean {
  const haystack = [
    agent?.name,
    agent?.agent_name,
    agent?.title,
    agent?.description,
    agent?.agent_type,
    agent?.type,
  ].filter(Boolean).join(" ").toLowerCase();

  return haystack.includes("pedro") ||
    haystack.includes("carvalho") ||
    haystack.includes("sdr") ||
    haystack.includes("pre-venda") ||
    haystack.includes("pré-venda");
}

function pickIncomingMessage(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload;
}

function isOutgoingMessage(payload: any): boolean {
  const message = pickIncomingMessage(payload);
  return message?.fromMe === true || message?.key?.fromMe === true || payload?.fromMe === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createServiceClient();
  const payload = await parseJson(req);
  if (isOutgoingMessage(payload)) {
    return jsonResponse({ ok: true, ignored: "from_me" });
  }

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

  const gate = await isPedroV2EnabledForUser(supabase, waInstance.user_id);
  if (!gate.enabled) {
    return jsonResponse({
      ok: false,
      disabled: true,
      reason: gate.reason,
      message:
        "Pedro v2 is disabled for this user. Use PEDRO_V2_ALLOWED_USER_EMAILS/IDS for controlled tests or PEDRO_V2_ENABLED for global rollout.",
    }, 423);
  }

  const { data: agents, error: agentError } = await supabase
    .from("wa_ai_agents")
    .select("*")
    .eq("user_id", waInstance.user_id)
    .eq("is_active", true);

  const activeAgents = Array.isArray(agents) ? agents : [];
  const agent =
    activeAgents.find((item) => agentUsesInstance(item, waInstance.id)) ||
    activeAgents.find(agentLooksLikePedro) ||
    activeAgents[0] ||
    null;

  if (agentError || !agent) {
    return jsonResponse({ ok: false, error: "active_agent_not_found" }, 404);
  }

  const result = await processPedroV2Turn(supabase, {
    payload,
    agent,
    wa_instance: waInstance,
    dry_run: payload?.dry_run === true || !isPedroV2MutationEnabled(),
  });

  return jsonResponse({ ...result, build: PEDRO_V2_BUILD, gate: { reason: gate.reason } }, result.ok ? 200 : 400);
});
