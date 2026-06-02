import {
  createServiceClient,
  corsHeaders,
  isPedroV2EnabledForUser,
  isPedroV2MutationEnabled,
  jsonResponse,
  parseJson,
} from "../_shared/pedro-v2/server.ts";
import { processPedroV2Turn } from "../_shared/pedro-v2/orchestrator_20260525_photo_flow.ts";

const PEDRO_V2_BUILD = "2026-06-02-ad-stock-transfer-v29";

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

// ── Connection/status event helpers ──────────────────────────────────────────
// UaZapi (and the legacy Evolution format) report connection state via a
// dedicated event, NOT a chat message. The v1 webhook (uazapi-webhook) handled
// this; v2 never did. Mirror v1 so a brand-new instance gets flipped to
// connected once the seller scans the QR.
function getEventType(payload: any): string {
  return String(
    payload?.EventType ||
    payload?.eventType ||
    payload?.event ||
    payload?.type ||
    "",
  ).toLowerCase();
}

function isConnectionEvent(payload: any): boolean {
  const eventType = getEventType(payload);
  if (!eventType) return false;
  return (
    eventType === "connection" ||
    eventType === "status" ||
    eventType.includes("connect") // covers "connection.update" / "connection_update"
  );
}

function extractConnectionState(payload: any): string {
  const data =
    payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
      ? payload.data
      : {};
  return String(
    payload?.state ||
    payload?.status ||
    data?.state ||
    data?.status ||
    "",
  ).toLowerCase();
}

function extractConnectionInstanceName(payload: any): string | null {
  const candidates = [
    payload?.instance,
    payload?.instanceName,
    payload?.instance_name,
    payload?.InstanceId,
    payload?.instanceId,
    payload?.data?.instance,
    payload?.data?.instanceName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = createServiceClient();
  const payload = await parseJson(req);

  // ── Connection/status events ──────────────────────────────────────────────
  // Must be handled BEFORE the message path: a brand-new instance is created
  // with is_active=false, so the message lookup (which requires is_active=true)
  // would 404 and the instance would never be marked connected. Here we look up
  // by instance_name WITHOUT the is_active filter and flip it on open/connected.
  if (isConnectionEvent(payload)) {
    const connInstanceName = extractConnectionInstanceName(payload);
    const state = extractConnectionState(payload);
    if (connInstanceName && (state === "open" || state === "connected")) {
      const { error: connError } = await supabase
        .from("wa_instances")
        .update({ is_active: true, status: "connected", updated_at: new Date().toISOString() })
        .eq("instance_name", connInstanceName);
      console.log(
        `[pedro-webhook-v2] connection event instance=${connInstanceName} state=${state} -> ${connError ? "ERROR " + connError.message : "marked connected"}`,
      );
    } else {
      console.log(
        `[pedro-webhook-v2] connection event instance=${connInstanceName ?? "?"} state=${state || "?"} -> no-op`,
      );
    }
    return jsonResponse({ ok: true, event: "connection", state: state || null });
  }

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

  // ── HARD RULE: a seller's number is NEVER answered by the AI ────────────────
  // Only the master's configured number (the instance linked inside the AI agent)
  // may run Pedro. Seller instances always carry seller_member_id: they connect
  // and show "connected" for the seller's own manual use, but must NEVER be
  // hijacked by the AI. Without this guard the agent lookup below falls back to
  // the master's Pedro agent (agentLooksLikePedro / activeAgents[0]) and answers
  // on the seller's line. The v1 webhook (uazapi-webhook) avoids this by REQUIRING
  // .contains('instance_ids', [instance.id]); v2 lost that guard.
  if (waInstance.seller_member_id) {
    return jsonResponse({ ok: true, ignored: "seller_instance_no_ai", instance: instanceName });
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
