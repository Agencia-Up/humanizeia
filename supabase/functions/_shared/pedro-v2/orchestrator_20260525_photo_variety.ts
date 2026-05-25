import { makeTurnLogger, newTraceId } from "../observability/structuredLog.ts";
import { identifyPedroContact } from "./contactIdentity.ts";
import { ensurePedroV2Lead, findPedroV2Lead, loadPedroMemory, updatePedroMemoryFromIntent } from "./leadMemory.ts";
import { routePedroIntent } from "./intentRouter_20260525_sales.ts";
import { confirmSellerAck } from "./transferRouter.ts";
import { remoteJidToPhone } from "./phone.ts";
import { generatePedroSalesReply } from "./replyGenerator_20260525_sales.ts";
import { searchPedroStock } from "./stockSearch_20260525_sales.ts";
import { resolvePedroInstance, sendPedroMedia, sendPedroText } from "./uazapiSender_20260524.ts";
import { PedroV2TurnInput, PedroV2TurnResult } from "./types.ts";
import { isPedroV2SendingEnabled } from "./server.ts";
import { adContextToMemory, buildMessageWithAdContext, resolvePedroAdContext } from "./adContext_20260525.ts";
import { mediaContextToAdLikeContext, resolvePedroMediaContext, sanitizePedroMediaContext } from "./mediaContext_20260524.ts";

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

function mergeAdAndMediaContext(adContext: any, mediaContext: any) {
  const mediaAsAd = mediaContextToAdLikeContext(mediaContext);
  if (!mediaAsAd) return adContext;
  return {
    ...adContext,
    ...mediaAsAd,
    has_ad_context: true,
    source: mediaAsAd.source || adContext.source || "media",
    url: adContext.url || mediaAsAd.url || null,
    title: adContext.title || mediaAsAd.title || null,
    description: mediaAsAd.description || adContext.description || null,
    raw_text: [adContext.raw_text, mediaAsAd.raw_text].filter(Boolean).join("\n") || null,
    vehicle_query: mediaAsAd.vehicle_query || adContext.vehicle_query || null,
    vehicle_type: mediaAsAd.vehicle_type || adContext.vehicle_type || null,
    summary: [adContext.summary, mediaAsAd.summary].filter(Boolean).join("\n") || null,
    confidence: Math.max(Number(adContext.confidence || 0), Number(mediaAsAd.confidence || 0)),
  };
}

async function markAgentReplyForLead(supabase: any, leadId?: string | null) {
  if (!leadId) return;
  const now = new Date().toISOString();
  try {
    await supabase
      .from("ai_crm_leads")
      .update({
        last_agent_reply_at: now,
        last_interaction_at: now,
      })
      .eq("id", leadId);
  } catch (error) {
    console.warn("[PedroV2] Failed to mark agent reply for lead", error);
  }
}

function pickReferencedVehicleIndex(message: string) {
  const normalized = String(message || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/\b(segundo|segunda|2|dois|duas)\b/.test(normalized)) return 1;
  if (/\b(terceiro|terceira|3|tres)\b/.test(normalized)) return 2;
  if (/\b(quarto|quarta|4)\b/.test(normalized)) return 3;
  if (/\b(quinto|quinta|5)\b/.test(normalized)) return 4;
  return 0;
}

type PhotoTarget = "overview" | "front" | "side" | "rear" | "interior" | "dashboard" | "seats" | "trunk" | "wheel";

function normalizePhotoText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectPhotoTarget(message: string): PhotoTarget {
  const normalized = normalizePhotoText(message);
  if (/\b(roda|rodas|pneu|pneus|aro|calota)\b/.test(normalized)) return "wheel";
  if (/\b(painel|volante|multimidia|midia|cambio|console)\b/.test(normalized)) return "dashboard";
  if (/\b(banco|bancos|estofado|assento|assentos)\b/.test(normalized)) return "seats";
  if (/\b(interior|interno|interna|dentro|por dentro)\b/.test(normalized)) return "interior";
  if (/\b(porta malas|porta-malas|bagageiro|mala)\b/.test(normalized)) return "trunk";
  if (/\b(traseira|traseiro|atras|fundo)\b/.test(normalized)) return "rear";
  if (/\b(lado|lateral|laterais)\b/.test(normalized)) return "side";
  if (/\b(frente|dianteira|dianteiro)\b/.test(normalized)) return "front";
  return "overview";
}

function uniqueIndexes(indexes: number[], total: number) {
  const selected: number[] = [];
  for (const rawIndex of indexes) {
    const index = Math.max(0, Math.min(total - 1, Math.round(rawIndex)));
    if (!selected.includes(index)) selected.push(index);
  }
  return selected;
}

function fillIndexes(indexes: number[], total: number, max = 5) {
  const selected = uniqueIndexes(indexes, total);
  for (let index = 0; selected.length < Math.min(max, total) && index < total; index++) {
    if (!selected.includes(index)) selected.push(index);
  }
  return selected.slice(0, Math.min(max, total));
}

function selectVehiclePhotos(vehicle: any, message: string) {
  const photos = [
    ...(Array.isArray(vehicle?.fotos) ? vehicle.fotos : []),
    vehicle?.principal_image,
  ].filter(Boolean).filter((url, position, all) => all.indexOf(url) === position);

  const total = photos.length;
  const target = detectPhotoTarget(message);
  if (total <= 5) return { target, photos: photos.slice(0, 5) };

  const middle = Math.floor(total * 0.55);
  const late = Math.floor(total * 0.72);
  const strategies: Record<PhotoTarget, number[]> = {
    overview: [0, 2, middle, middle + 1, Math.min(total - 1, late)],
    front: [0, 1, 2, 3, middle],
    side: [2, 3, 1, 4, middle],
    rear: [4, 5, 3, 6, Math.min(total - 1, late)],
    wheel: [2, 3, 4, 5, 1],
    interior: [middle, middle + 1, late, late + 1, total - 1],
    dashboard: [late, late + 1, middle, middle + 1, total - 1],
    seats: [middle, middle + 1, late, late + 1, total - 1],
    trunk: [Math.max(0, total - 2), Math.max(0, total - 3), 4, 5, late],
  };

  const indexes = fillIndexes(strategies[target], total, 5);
  return { target, photos: indexes.map((index) => photos[index]) };
}

function buildPhotoReplyText(target: PhotoTarget) {
  if (target === "wheel") return "Mando sim. Separei as fotos mais proximas da roda pra voce.";
  if (target === "dashboard") return "Boa. Vou te mandar as fotos mais proximas do painel e comandos.";
  if (target === "seats" || target === "interior") return "Claro. Separei as fotos de dentro dele pra voce.";
  if (target === "trunk") return "Claro. Vou te mandar as fotos mais proximas do porta-malas.";
  if (target === "rear") return "Mando sim. Separei a traseira e alguns detalhes pra voce.";
  if (target === "side" || target === "front") return "Mando sim. Separei as fotos externas mais claras pra voce.";
  return "Olha so, separei fotos externas e internas pra voce.";
}

function buildPhotoCaption(target: PhotoTarget, vehicle: any, photoIndex: number) {
  const label = vehicle?.label || vehicle?.modelo || "Veiculo";
  if (photoIndex === 0 && target === "overview") return `${label} - visao geral`;
  if (target === "overview") return ["lateral/detalhe", "traseira", "interior", "painel/bancos"][photoIndex - 1] || `foto ${photoIndex + 1}`;
  if (target === "wheel") return "Detalhe da roda/pneu";
  if (target === "dashboard") return "Painel/interior";
  if (target === "seats" || target === "interior") return "Interior/bancos";
  if (target === "trunk") return "Porta-malas/detalhe traseiro";
  if (target === "rear") return "Traseira/detalhe";
  if (target === "side") return "Lateral/detalhe";
  if (target === "front") return "Frente/detalhe";
  return `Foto ${photoIndex + 1}`;
}

function buildVehiclePhotoReply(memory: any, message: string) {
  const vehicles = Array.isArray(memory?.veiculos_apresentados) ? memory.veiculos_apresentados : [];
  if (vehicles.length === 0) {
    return {
      ok: true,
      text: "Claro. Me diz qual carro voce quer ver melhor que eu mando as fotos certinhas.",
      source: "vehicle_photos_need_reference",
      media: [],
    };
  }

  const index = Math.min(pickReferencedVehicleIndex(message), Math.max(vehicles.length - 1, 0));
  const vehicle = vehicles[index] || vehicles[0];
  const selection = selectVehiclePhotos(vehicle, message);
  const photos = selection.photos;

  if (photos.length === 0) {
    return {
      ok: true,
      text: "Esse aqui nao trouxe fotos no estoque agora. Quer que eu chame um consultor pra conferir pra voce?",
      source: "vehicle_photos_unavailable",
      media: [],
    };
  }

  return {
    ok: true,
    text: buildPhotoReplyText(selection.target),
    source: "vehicle_photos_reply",
    vehicle,
    media: photos.map((file: string, photoIndex: number) => ({
      file,
      type: "image",
      caption: buildPhotoCaption(selection.target, vehicle, photoIndex),
    })),
  };
}

async function savePresentedVehicles(supabase: any, input: {
  lead_id?: string | null;
  agent_id: string;
  user_id: string;
  current: any;
  vehicles: any[];
}) {
  if (!input.lead_id || !Array.isArray(input.vehicles) || input.vehicles.length === 0) return input.current || {};
  const nextState = {
    ...(input.current || {}),
    veiculos_apresentados: input.vehicles.slice(0, 8),
    atendimento: {
      ...(input.current?.atendimento || {}),
      etapa: "apresentando_opcoes",
    },
    last_extracted_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("pedro_conversation_state")
    .upsert({
      lead_id: input.lead_id,
      agent_id: input.agent_id,
      user_id: input.user_id,
      state: nextState,
      updated_at: new Date().toISOString(),
    }, { onConflict: "lead_id,agent_id" });

  if (error) {
    console.warn("[PedroV2] Failed to save presented vehicles", error);
    return input.current || {};
  }
  return nextState;
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
  const mediaContext = await resolvePedroMediaContext(input.payload, input.wa_instance);
  const adContext = mergeAdAndMediaContext(await resolvePedroAdContext(input.payload, text), mediaContext);
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
    media_context: sanitizePedroMediaContext(mediaContext),
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

  const effectiveMemory = !dryRun && lead?.id && stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length > 0
    ? await savePresentedVehicles(supabase, {
        lead_id: lead.id,
        agent_id: input.agent.id,
        user_id: input.agent.user_id,
        current: nextMemory,
        vehicles: stockResult.items,
      })
    : nextMemory;

  const reply = contextualIntent.intent === "photo_request"
    ? buildVehiclePhotoReply(effectiveMemory, text)
    : generatePedroSalesReply({
        memory: effectiveMemory,
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
    const preserveFormatting = reply.source === "stock_fact_reply";
    sendResult = await sendPedroText(instance, {
      to: remoteJidToPhone(remoteJid),
      text: reply.text,
    }, { humanize: !preserveFormatting });
    const mediaResults: any[] = [];
    if (sendResult?.ok && Array.isArray(reply.media) && reply.media.length > 0) {
      for (const media of reply.media) {
        const mediaResult = await sendPedroMedia(instance, {
          to: remoteJidToPhone(remoteJid),
          file: media.file,
          type: (media.type || "image") as "image" | "audio" | "video" | "document",
          caption: media.caption || "",
        });
        mediaResults.push(mediaResult);
        if (!mediaResult.ok) break;
      }
      sendResult = { ...sendResult, media_results: mediaResults };
    }
    if (sendResult?.ok) {
      await markAgentReplyForLead(supabase, lead?.id || null);
    }
  } else if (!dryRun && reply.ok) {
    sendResult = { ok: true, dry_run: true, reason: "PEDRO_V2_SEND_ENABLED_disabled" };
    await markAgentReplyForLead(supabase, lead?.id || null);
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
        media_context: sanitizePedroMediaContext(mediaContext),
        identity_kind: identity.kind,
      },
      result: {
        confidence: contextualIntent.confidence,
        reason: contextualIntent.reason,
        needs_stock_search: contextualIntent.needs_stock_search,
        needs_handoff: contextualIntent.needs_handoff,
        stock_result_count: stockResult?.total || 0,
        reply_source: reply.source,
        media_count: Array.isArray(reply.media) ? reply.media.length : 0,
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
