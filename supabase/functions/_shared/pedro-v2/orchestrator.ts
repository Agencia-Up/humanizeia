import { makeTurnLogger, newTraceId } from "../observability/structuredLog.ts";
import { identifyPedroContact } from "./contactIdentity.ts";
import { ensurePedroV2Lead, findPedroV2Lead, loadPedroMemory, updatePedroMemoryFromIntent } from "./leadMemory.ts";
import { routePedroIntent } from "./intentRouter.ts";
import { confirmSellerAck } from "./transferRouter.ts";
import { remoteJidToPhone } from "./phone.ts";
import { generatePedroSalesReply } from "./replyGenerator.ts";
import { searchPedroStock } from "./stockSearch.ts";
import { resolvePedroInstance, sendPedroText } from "./uazapiSender.ts";
import { PedroV2TurnInput, PedroV2TurnResult } from "./types.ts";
import { isPedroV2SendingEnabled } from "./server.ts";

async function recordPedroV2TurnLog(supabase: any, entry: Record<string, any>) {
  try {
    await supabase.from("pedro_v2_turn_logs").insert(entry);
  } catch (error) {
    console.warn("[PedroV2] Failed to record turn log", error);
  }
}

function pickRemoteJid(payload: any): string {
  return (
    payload?.remoteJid ||
    payload?.remote_jid ||
    payload?.chatId ||
    payload?.jid ||
    payload?.message?.chatId ||
    payload?.data?.key?.remoteJid ||
    payload?.data?.remoteJid ||
    ""
  );
}

function pickText(payload: any): string {
  return (
    payload?.text ||
    payload?.body ||
    payload?.message?.text ||
    payload?.message?.body ||
    payload?.data?.message?.conversation ||
    payload?.data?.message?.extendedTextMessage?.text ||
    payload?.data?.body ||
    ""
  );
}

function pickPushName(payload: any): string {
  return payload?.pushName || payload?.senderName || payload?.data?.pushName || payload?.data?.senderName || "Lead";
}

function buildStockFilters(intent: any, memory: any, text: string) {
  return {
    ...(memory?.interesse || {}),
    ...(intent?.extracted?.interesse || {}),
    query:
      intent?.extracted?.interesse?.modelo_desejado ||
      memory?.interesse?.modelo_desejado ||
      memory?.referencia?.veiculo_citado ||
      text,
    ad_context:
      intent?.extracted?.referencia?.texto_referencia ||
      memory?.referencia?.texto_referencia ||
      "",
  };
}

export async function processPedroV2Turn(
  supabase: any,
  input: PedroV2TurnInput & { agent: any; wa_instance: any },
): Promise<PedroV2TurnResult> {
  const correlationId = newTraceId();
  const dryRun = input.dry_run !== false;
  const log = makeTurnLogger(correlationId, {
    agent_id: input.agent?.id,
    instance_id: input.wa_instance?.id,
  });

  const remoteJid = pickRemoteJid(input.payload);
  const text = pickText(input.payload);
  const pushName = pickPushName(input.payload);
  if (!remoteJid) {
    return { ok: false, dry_run: dryRun, correlation_id: correlationId, error: "remote_jid_missing" };
  }

  log("info", "pedro_v2_turn_start", { remote_jid: remoteJid, dry_run: dryRun });

  const identity = await identifyPedroContact(supabase, {
    user_id: input.agent.user_id,
    agent_id: input.agent.id,
    remote_jid: remoteJid,
  });

  if (identity.kind === "seller") {
    const ack = await confirmSellerAck(supabase, {
      user_id: input.agent.user_id,
      agent_id: input.agent.id,
      seller_phone: identity.phone,
      commit: !dryRun,
    });
    log("info", "pedro_v2_seller_message", { seller_id: identity.seller?.id, ack });
    if (!dryRun) {
      await recordPedroV2TurnLog(supabase, {
        user_id: input.agent.user_id,
        agent_id: input.agent.id,
        remote_jid: remoteJid,
        correlation_id: correlationId,
        intent: "seller_ack",
        next_action: ack.confirmed ? "seller_ack_confirmed" : "seller_message_ignored_by_ai",
        dry_run: dryRun,
        payload: { identity_kind: identity.kind },
        result: ack,
      });
    }
    return {
      ok: true,
      dry_run: dryRun,
      correlation_id: correlationId,
      identity,
      next_action: ack.confirmed ? "seller_ack_confirmed" : "seller_message_ignored_by_ai",
    };
  }

  const lead = dryRun
    ? await findPedroV2Lead(supabase, { agent_id: input.agent.id, remote_jid: remoteJid })
    : await ensurePedroV2Lead(supabase, {
        user_id: input.agent.user_id,
        agent_id: input.agent.id,
        instance_id: input.wa_instance?.id,
        remote_jid: remoteJid,
        lead_name: pushName,
      });

  const currentMemory = lead?.id
    ? await loadPedroMemory(supabase, {
        lead_id: lead.id,
        agent_id: input.agent.id,
      })
    : {};

  const intent = routePedroIntent({ message: text, current_memory: currentMemory });
  const nextMemory = !dryRun && lead?.id
    ? await updatePedroMemoryFromIntent(supabase, {
        lead_id: lead.id,
        agent_id: input.agent.id,
        user_id: input.agent.user_id,
        current: currentMemory,
        intent,
        lead_phone: remoteJidToPhone(remoteJid),
        lead_name: pushName,
      })
    : currentMemory;

  log("info", "pedro_v2_turn_routed", {
    lead_id: lead?.id || null,
    intent: intent.intent,
    needs_stock_search: intent.needs_stock_search,
    needs_handoff: intent.needs_handoff,
    memory_stage: nextMemory?.atendimento?.etapa,
  });

  const stockResult = intent.needs_stock_search
    ? await searchPedroStock(supabase, {
        user_id: input.agent.user_id,
        query: buildStockFilters(intent, nextMemory, text).query,
        filters: buildStockFilters(intent, nextMemory, text),
        limit: 6,
      })
    : null;

  const reply = generatePedroSalesReply({
    memory: nextMemory,
    intent,
    stock_result: stockResult,
    message: text,
  });

  let sendResult: any = null;
  if (!dryRun && reply.ok && isPedroV2SendingEnabled()) {
    const instance = input.wa_instance || await resolvePedroInstance(supabase, {
      user_id: input.agent.user_id,
      agent_id: input.agent.id,
      instance_id: input.wa_instance?.id,
    });
    sendResult = await sendPedroText(instance, {
      to: remoteJidToPhone(remoteJid),
      text: reply.text,
    });
  } else if (!dryRun && reply.ok) {
    sendResult = { ok: true, dry_run: true, reason: "PEDRO_V2_SEND_ENABLED_disabled" };
  }

  if (!dryRun) {
    await recordPedroV2TurnLog(supabase, {
      user_id: input.agent.user_id,
      agent_id: input.agent.id,
      lead_id: lead?.id || null,
      remote_jid: remoteJid,
      correlation_id: correlationId,
      intent: intent.intent,
      next_action: intent.needs_stock_search ? "stock_search_required" : intent.needs_handoff ? "handoff_required" : "reply_generation_required",
      dry_run: dryRun,
      payload: {
        text,
        identity_kind: identity.kind,
      },
      result: {
        confidence: intent.confidence,
        reason: intent.reason,
        needs_stock_search: intent.needs_stock_search,
        needs_handoff: intent.needs_handoff,
        stock_result_count: stockResult?.total || 0,
        reply_source: reply.source,
        send_result: sendResult,
      },
    });
  }

  return {
    ok: true,
    dry_run: dryRun,
    correlation_id: correlationId,
    identity,
    lead_id: lead?.id || null,
    intent,
    stock_result: stockResult,
    reply,
    send_result: sendResult,
    next_action: sendResult?.ok ? "reply_sent" : dryRun ? "dry_run_reply_planned" : "reply_generated",
  };
}
