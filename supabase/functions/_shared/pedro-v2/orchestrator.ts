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
import { adContextToMemory, buildMessageWithAdContext, resolvePedroAdContext } from "./adContext.ts";

async function recordPedroV2TurnLog(supabase: any, entry: Record<string, any>) {
  try {
    await supabase.from("pedro_v2_turn_logs").insert(entry);
  } catch (error) {
    console.warn("[PedroV2] Failed to record turn log", error);
  }
}

function pickRemoteJid(payload: any): string {
  const message = pickIncomingMessage(payload);
  return (
    message?.chatId ||
    message?.chatid ||
    message?.from ||
    message?.key?.remoteJid ||
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

function pickIncomingMessage(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload;
}

function pickText(payload: any): string {
  const message = pickIncomingMessage(payload);
  const content = message?.content || payload?.content || payload?.message?.content || payload?.data?.content || payload?.data?.message?.content;
  const contentText = typeof content === "string" ? content : "";
  return (
    message?.body ||
    message?.text ||
    message?.caption ||
    message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    payload?.text ||
    payload?.body ||
    payload?.caption ||
    payload?.message?.text ||
    payload?.message?.body ||
    payload?.message?.caption ||
    payload?.data?.message?.conversation ||
    payload?.data?.message?.extendedTextMessage?.text ||
    payload?.data?.body ||
    payload?.data?.text ||
    payload?.data?.caption ||
    contentText ||
    ""
  );
}

function pickPushName(payload: any): string {
  const message = pickIncomingMessage(payload);
  return message?.senderName ||
    message?.notifyName ||
    message?.pushName ||
    payload?.chat?.name ||
    payload?.pushName ||
    payload?.senderName ||
    payload?.data?.pushName ||
    payload?.data?.senderName ||
    "Lead";
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
  const adContext = await resolvePedroAdContext(input.payload, text);
  const enrichedText = buildMessageWithAdContext(text, adContext);
  const adMemory = adContextToMemory(adContext);
  const adNeedsVehicleConfirmation = adContext.has_ad_context && !adContext.vehicle_query;
  const enrichedIntent = adContext.has_ad_context
    ? routePedroIntent({ message: enrichedText, current_memory: currentMemory })
    : intent;
  const contextualIntent = adContext.has_ad_context
    ? {
        ...enrichedIntent,
        intent: adNeedsVehicleConfirmation ? "vehicle_reference" : enrichedIntent.intent,
        extracted: {
          ...enrichedIntent.extracted,
          ...adMemory,
          interesse: {
            ...(enrichedIntent.extracted?.interesse || {}),
            ...(adMemory.interesse || {}),
          },
          referencia: {
            ...(enrichedIntent.extracted?.referencia || {}),
            ...(adMemory.referencia || {}),
          },
        },
        needs_stock_search: adNeedsVehicleConfirmation ? false : enrichedIntent.needs_stock_search,
        needs_handoff: enrichedIntent.needs_handoff,
        reason: adNeedsVehicleConfirmation
          ? `ad_context_missing_vehicle:${adContext.source || "unknown"}`
          : `ad_context:${adContext.source || "unknown"}`,
      }
    : intent;
  const nextMemory = !dryRun && lead?.id
    ? await updatePedroMemoryFromIntent(supabase, {
        lead_id: lead.id,
        agent_id: input.agent.id,
        user_id: input.agent.user_id,
        current: currentMemory,
        intent: contextualIntent,
        lead_phone: remoteJidToPhone(remoteJid),
        lead_name: pushName,
      })
    : currentMemory;

  log("info", "pedro_v2_turn_routed", {
    lead_id: lead?.id || null,
    intent: contextualIntent.intent,
    needs_stock_search: contextualIntent.needs_stock_search,
    needs_handoff: contextualIntent.needs_handoff,
    ad_context: adContext,
    memory_stage: nextMemory?.atendimento?.etapa,
  });

  const stockResult = contextualIntent.needs_stock_search
    ? await searchPedroStock(supabase, {
        user_id: input.agent.user_id,
        query: buildStockFilters(contextualIntent, nextMemory, enrichedText).query,
        filters: buildStockFilters(contextualIntent, nextMemory, enrichedText),
        limit: 6,
      })
    : null;

  const reply = generatePedroSalesReply({
    memory: nextMemory,
    intent: contextualIntent,
    stock_result: stockResult,
    message: enrichedText,
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
      intent: contextualIntent.intent,
      next_action: contextualIntent.needs_stock_search ? "stock_search_required" : contextualIntent.needs_handoff ? "handoff_required" : "reply_generation_required",
      dry_run: dryRun,
      payload: {
        text,
        enriched_text: enrichedText,
        ad_context: adContext,
        identity_kind: identity.kind,
      },
      result: {
        confidence: contextualIntent.confidence,
        reason: contextualIntent.reason,
        needs_stock_search: contextualIntent.needs_stock_search,
        needs_handoff: contextualIntent.needs_handoff,
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
    intent: contextualIntent,
    stock_result: stockResult,
    reply,
    send_result: sendResult,
    next_action: sendResult?.ok ? "reply_sent" : dryRun ? "dry_run_reply_planned" : "reply_generated",
  };
}
