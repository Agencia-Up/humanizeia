import { createClient } from "npm:@supabase/supabase-js@2";
import {
  callPedroV3Bridge,
  type PedroV3BridgeTurn,
} from "../_shared/pedro-v2/pedroV3Bridge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

type QueueRow = {
  event_id: string;
  tenant_id: string;
  agent_id: string;
  instance_id: string;
  lead_id: string;
  payload: PedroV3BridgeTurn;
  attempt_count: number;
  processing_token: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearer(req: Request): string {
  return String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function validTurn(value: unknown): value is PedroV3BridgeTurn {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const turn = value as Record<string, unknown>;
  return ["tenantId", "agentId", "instanceId", "conversationId", "turnId", "eventId", "to", "messageText", "receivedAt"]
    .every((key) => typeof turn[key] === "string" && String(turn[key]).trim().length > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceRoleKey || bearer(req) !== serviceRoleKey) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceUrl = Deno.env.get("PEDRO_V3_SERVICE_URL") || "";
  const bridgeSecret = Deno.env.get("PEDRO_V3_BRIDGE_SECRET") || "";
  if (!supabaseUrl || !serviceUrl || !bridgeSecret) {
    return json({ ok: false, error: "replay_config_missing" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const worker = `edge-replay:${crypto.randomUUID()}`;
  const { data, error } = await supabase.rpc("pedro_v3_claim_ingress_v1", {
    p_worker: worker,
    // Cinco bridges em paralelo mantêm a execução abaixo do timeout do cron,
    // sem criar uma rajada grande contra o serviço do Pedro.
    p_limit: 5,
    p_now: new Date().toISOString(),
  });
  if (error) {
    console.error("[pedro-v3-ingress-replay] claim_failed", error.message);
    return json({ ok: false, error: "claim_failed" }, 500);
  }

  const rows = (Array.isArray(data) ? data : []) as QueueRow[];
  const result = { claimed: rows.length, delivered: 0, retried: 0, cancelled: 0, invalid: 0 };

  await Promise.all(rows.map(async (row) => {
    const settle = async (outcome: "delivered" | "retry" | "cancelled", reason: string | null, httpStatus: number | null) => {
      const { data: settled, error: settleError } = await supabase.rpc("pedro_v3_record_ingress_result_v1", {
        p_event_id: row.event_id,
        p_processing_token: row.processing_token,
        p_outcome: outcome,
        p_error: reason,
        p_http_status: httpStatus,
        p_now: new Date().toISOString(),
      });
      if (settleError || settled !== true) {
        console.error(`[pedro-v3-ingress-replay] settle_failed event=${row.event_id} outcome=${outcome} error=${settleError?.message || "claim_lost"}`);
      }
    };

    if (!validTurn(row.payload) || row.payload.eventId !== row.event_id) {
      result.invalid += 1;
      result.cancelled += 1;
      await settle("cancelled", "invalid_queued_turn", null);
      return;
    }

    // A fila garante entrega, nao autoridade eterna. Se um humano pausou a
    // conversa ou o agente foi desligado durante a indisponibilidade, o replay
    // nao pode ressuscitar a IA horas depois.
    const { data: allowed, error: gateError } = await supabase.rpc("is_ai_automation_allowed_v2", {
      p_tenant: row.tenant_id,
      p_agent_id: row.agent_id,
      p_lead_id: row.lead_id,
      p_v3_conversation_id: row.payload.conversationId,
      p_instance_id: row.instance_id,
      p_phone: row.payload.to,
      p_action_kind: "v3_effect",
      p_origin: "ai",
    });
    if (gateError) {
      result.retried += 1;
      await settle("retry", `automation_gate_unavailable:${gateError.message}`, null);
      return;
    }
    if (allowed?.allowed === false) {
      result.cancelled += 1;
      await settle("cancelled", `automation_blocked:${String(allowed?.reason || "blocked")}`, null);
      return;
    }

    const bridge = await callPedroV3Bridge({
      serviceUrl,
      secret: bridgeSecret,
      turn: row.payload,
      timeoutMs: 12_000,
    });
    if (bridge.kind === "accepted") {
      result.delivered += 1;
      await settle("delivered", null, bridge.httpStatus);
      console.log(`[pedro-v3-ingress-replay] delivered event=${row.event_id} attempts=${row.attempt_count}`);
    } else {
      result.retried += 1;
      const reason = bridge.serviceStatus || bridge.kind;
      await settle("retry", reason, bridge.httpStatus);
      console.warn(`[pedro-v3-ingress-replay] retry event=${row.event_id} attempts=${row.attempt_count} reason=${reason}`);
    }
  }));

  // Higiene sem tocar pendencias: eventos confirmados ficam 7 dias para prova.
  await supabase
    .from("pedro_v3_ingress_queue")
    .delete()
    .eq("status", "delivered")
    .lt("delivered_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  return json({ ok: true, ...result });
});
