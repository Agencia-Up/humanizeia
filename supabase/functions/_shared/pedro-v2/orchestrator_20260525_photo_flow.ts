import { makeTurnLogger, newTraceId } from "../observability/structuredLog.ts";
import { identifyPedroContact } from "./contactIdentity.ts";
import { ensurePedroV2Lead, findPedroV2Lead, loadPedroMemory, updatePedroMemoryFromIntent } from "./leadMemory.ts";
import { routePedroIntent } from "./intentRouter_20260525_sales.ts";
import { confirmSellerAck, executePedroV2Handoff } from "./transferRouter.ts";
import { resolveAutomationRules } from "../automation/rules.ts";
import { managerPhones } from "../transfer/managers.ts";
import { remoteJidToPhone } from "./phone.ts";
import { generatePedroBrainReply } from "./pedroBrainReply_20260525.ts";
import { planPedroTurn } from "./pedroBrainPlanner_20260525.ts";
import { searchPedroStock } from "./stockSearch_20260525_photo_flow.ts";
import { resolvePedroInstance, sendPedroMedia, sendPedroText } from "./uazapiSender_20260524.ts";
import { PedroV2TurnInput, PedroV2TurnResult } from "./types.ts";
import { isPedroV2SendingEnabled } from "./server.ts";
import { adContextToMemory, buildMessageWithAdContext, resolvePedroAdContext } from "./adContext_20260525.ts";
import { mediaContextToAdLikeContext, resolvePedroMediaContext, sanitizePedroMediaContext } from "./mediaContext_20260524.ts";
import { resolvePedroVehicleTurn } from "./vehicleResolver_20260525_brain.ts";
import { buildTokenAlertText, consumeUserTokens, normalizeAlertPhone } from "./tokenMeter.ts";

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

function buildStockFilters(intent: any, memory: any, text: string, brainPlan?: any, vehicleResolution?: any) {
  const currentVehicleQuery = brainPlan?.search_query || vehicleResolution?.query || null;
  const allowMemoryVehicle = !vehicleResolution?.has_current_vehicle_signal && brainPlan?.use_memory_vehicle !== false;
  return {
    ...(memory?.interesse || {}),
    ...(intent?.extracted?.interesse || {}),
    ...(brainPlan?.search_filters || {}),
    query:
      currentVehicleQuery ||
      intent?.extracted?.interesse?.modelo_desejado ||
      (allowMemoryVehicle ? memory?.interesse?.modelo_desejado : null) ||
      (allowMemoryVehicle ? memory?.referencia?.veiculo_citado : null) ||
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

function mergeBrainPlanIntoIntent(intent: any, brainPlan: any, vehicleResolution: any) {
  const interestPatch = vehicleResolution?.query
    ? {
        modelo_desejado: vehicleResolution.query,
        tipo_veiculo: vehicleResolution.vehicle_type || intent?.extracted?.interesse?.tipo_veiculo || null,
      }
    : (brainPlan?.search_query
        ? {
            modelo_desejado: brainPlan.search_query,
            tipo_veiculo: brainPlan.search_filters?.tipo_veiculo || intent?.extracted?.interesse?.tipo_veiculo || null,
          }
        : {});

  const nextIntent = brainPlan?.intent || intent?.intent || "unknown";
  return {
    ...(intent || {}),
    intent: nextIntent,
    needs_stock_search: brainPlan?.action === "stock_search",
    needs_handoff: brainPlan?.action === "handoff" || Boolean(intent?.needs_handoff),
    confidence: Math.max(Number(intent?.confidence || 0), Number(brainPlan?.confidence || 0)),
    reason: brainPlan?.reason || intent?.reason || "brain_plan",
    extracted: {
      ...(intent?.extracted || {}),
      interesse: {
        ...(intent?.extracted?.interesse || {}),
        ...interestPatch,
        ...(brainPlan?.search_filters || {}),
      },
      referencia: {
        ...(intent?.extracted?.referencia || {}),
        veiculo_citado: vehicleResolution?.query || brainPlan?.search_query || intent?.extracted?.referencia?.veiculo_citado || null,
        confidence: vehicleResolution?.confidence || brainPlan?.confidence || intent?.extracted?.referencia?.confidence || null,
      },
    },
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

function compactRecentTurns(memory: any, incomingText: string, replyText: string, replySource?: string | null) {
  const now = new Date().toISOString();
  const previous = Array.isArray(memory?.recent_turns) ? memory.recent_turns : [];
  return [
    ...previous,
    {
      role: "lead",
      text: String(incomingText || "").trim().slice(0, 1200),
      at: now,
      source: "whatsapp",
    },
    {
      role: "agent",
      text: String(replyText || "").trim().slice(0, 1600),
      at: now,
      source: replySource || null,
    },
  ]
    .filter((turn) => turn.text)
    .slice(-24);
}

function inboxPhoneCandidates(remoteJid: string) {
  const digits = remoteJidToPhone(remoteJid);
  return [
    remoteJid,
    digits,
    digits ? `+${digits}` : null,
    digits ? `${digits}@s.whatsapp.net` : null,
    digits ? `${digits}@c.us` : null,
  ].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index);
}

function inboxRowToTurn(row: any) {
  const direction = String(row?.direction || "").toLowerCase();
  const role = direction === "outgoing" ? "agent" : "lead";
  const type = String(row?.message_type || "").toLowerCase();
  const content = String(row?.content || "").trim();
  const mediaHint = row?.media_url
    ? type.includes("image")
      ? "[imagem]"
      : type.includes("audio")
        ? "[audio]"
        : type.includes("video")
          ? "[video]"
          : "[midia]"
    : "";
  const text = [mediaHint, content].filter(Boolean).join(" ").trim();
  if (!text) return null;
  return {
    role,
    text: text.slice(0, 1600),
    at: row?.created_at || new Date().toISOString(),
    source: "wa_inbox",
  };
}

function mergeRecentTurns(...groups: any[][]) {
  const allTurns = groups.flat().filter((turn) => turn?.text);
  allTurns.sort((a, b) => new Date(a?.at || 0).getTime() - new Date(b?.at || 0).getTime());
  const merged: any[] = [];
  for (const turn of allTurns) {
    const previous = merged[merged.length - 1];
    const previousText = normalizePhotoText(previous?.text || "");
    const currentText = normalizePhotoText(turn?.text || "");
    if (previous?.role === turn.role && previousText && previousText === currentText) continue;
    merged.push(turn);
  }
  return merged.slice(-24);
}

async function loadRecentConversationHistory(supabase: any, input: {
  user_id: string;
  remote_jid: string;
  memory: any;
  lead_created_at?: string | null;
}) {
  const memoryTurns = Array.isArray(input.memory?.recent_turns) ? input.memory.recent_turns : [];
  try {
    let inboxQuery = supabase
      .from("wa_inbox")
      .select("direction, content, message_type, media_url, created_at")
      .eq("user_id", input.user_id)
      .in("phone", inboxPhoneCandidates(input.remote_jid));

    if (input.lead_created_at) {
      // Permitir uma folga de 2 segundos para o caso de gravação assíncrona
      const cutoff = new Date(new Date(input.lead_created_at).getTime() - 2000).toISOString();
      inboxQuery = inboxQuery.gte("created_at", cutoff);
    }

    const { data: inboxData, error: inboxError } = await inboxQuery
      .order("created_at", { ascending: false })
      .limit(24);

    if (inboxError) {
      console.warn("[PedroV2] Failed to load wa_inbox history", inboxError);
    }

    const inboxTurns = (Array.isArray(inboxData) ? inboxData : [])
      .reverse()
      .map(inboxRowToTurn)
      .filter(Boolean);

    let historyQuery = supabase
      .from("wa_chat_history")
      .select("role, content, created_at")
      .eq("user_id", input.user_id)
      .eq("remote_jid", input.remote_jid);

    if (input.lead_created_at) {
      const cutoff = new Date(new Date(input.lead_created_at).getTime() - 2000).toISOString();
      historyQuery = historyQuery.gte("created_at", cutoff);
    }

    const { data: historyData, error: historyError } = await historyQuery
      .order("created_at", { ascending: false })
      .limit(24);

    if (historyError) {
      console.warn("[PedroV2] Failed to load wa_chat_history history", historyError);
    }

    const historyTurns = (Array.isArray(historyData) ? historyData : [])
      .reverse()
      .map((row: any) => {
        const role = row?.role === "assistant" ? "agent" : "lead";
        const text = String(row?.content || "").trim();
        if (!text) return null;
        return {
          role,
          text: text.slice(0, 1600),
          at: row?.created_at || new Date().toISOString(),
          source: "wa_chat_history",
        };
      })
      .filter(Boolean);

    return mergeRecentTurns(memoryTurns, inboxTurns, historyTurns);
  } catch (error) {
    console.warn("[PedroV2] wa_inbox/chat_history history unavailable", error);
    return mergeRecentTurns(memoryTurns);
  }
}

async function saveRecentConversationTurn(supabase: any, input: {
  lead_id?: string | null;
  agent_id: string;
  user_id: string;
  current: any;
  incoming_text: string;
  reply_text: string;
  reply_source?: string | null;
}) {
  if (!input.lead_id || !input.reply_text) return input.current || {};
  const nextState = {
    ...(input.current || {}),
    recent_turns: compactRecentTurns(input.current, input.incoming_text, input.reply_text, input.reply_source),
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
    console.warn("[PedroV2] Failed to save recent conversation turn", error);
    return input.current || {};
  }
  return nextState;
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

function normalizeVehicleKey(value: string) {
  return normalizePhotoText(value).replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
}

function cleanVehiclePart(value?: string | number | null) {
  return String(value || "")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function removeDuplicatedModelFromVersion(model: string, version: string) {
  const normalizedModel = normalizePhotoText(model);
  const normalizedVersion = normalizePhotoText(version);
  if (!normalizedModel || !normalizedVersion.startsWith(normalizedModel)) return version;
  const modelWords = normalizedModel.split(/\s+/).filter(Boolean).length;
  const versionWords = version.split(/\s+/).filter(Boolean);
  return versionWords.slice(modelWords).join(" ").trim() || version;
}

function cleanVehicleLabel(vehicle: any) {
  const marca = cleanVehiclePart(vehicle?.marca);
  const modelo = cleanVehiclePart(vehicle?.modelo);
  const versao = removeDuplicatedModelFromVersion(modelo, cleanVehiclePart(vehicle?.versao));
  return [marca, modelo, versao, vehicle?.ano].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function vehicleKey(vehicle: any) {
  return normalizeVehicleKey([
    vehicle?.marca,
    vehicle?.modelo,
    vehicle?.versao,
    vehicle?.ano,
    vehicle?.preco,
    vehicle?.km,
  ].filter(Boolean).join("|"));
}

function clampVehicleIndex(index: number, vehicles: any[]) {
  return Math.max(0, Math.min(Math.max(vehicles.length - 1, 0), index));
}

function explicitVehicleOrdinal(message: string): number | null {
  const normalized = normalizePhotoText(message);
  if (/\b(primeiro|primeira|1|um|uma)\b/.test(normalized)) return 0;
  if (/\b(segundo|segunda|2|dois|duas)\b/.test(normalized)) return 1;
  if (/\b(terceiro|terceira|3|tres)\b/.test(normalized)) return 2;
  if (/\b(quarto|quarta|4)\b/.test(normalized)) return 3;
  if (/\b(quinto|quinta|5)\b/.test(normalized)) return 4;
  return null;
}

function messageVehicleAttributeScore(message: string, vehicle: any) {
  const normalized = normalizePhotoText(message);
  const indexed = normalizePhotoText([
    vehicle?.marca,
    vehicle?.modelo,
    vehicle?.versao,
    vehicle?.ano,
    vehicle?.cor,
    vehicle?.cambio,
    vehicle?.combustivel,
  ].filter(Boolean).join(" "));
  if (!normalized || !indexed) return 0;

  let score = 0;
  const wantsAuto = /\b(automatico|automatica|aut)\b/.test(normalized);
  const wantsManual = /\b(manual|mecanico|mecanica|mec)\b/.test(normalized);
  if (wantsAuto) score += /\b(automatico|automatica|aut)\b/.test(indexed) ? 8 : -6;
  if (wantsManual) score += /\b(manual|mecanico|mecanica|mec)\b/.test(indexed) ? 8 : -6;

  const colors = ["branco", "preto", "prata", "cinza", "azul", "vermelho", "laranja", "verde", "bege", "marrom"];
  for (const color of colors) {
    if (new RegExp(`\\b${color}\\b`).test(normalized)) score += indexed.includes(color) ? 5 : -2;
  }

  for (const body of ["sedan", "hatch", "suv", "picape", "pickup", "caminhonete"]) {
    if (new RegExp(`\\b${body}\\b`).test(normalized)) score += indexed.includes(body) ? 4 : -1;
  }

  for (const year of normalized.match(/\b20\d{2}\b/g) || []) {
    score += indexed.includes(year) ? 4 : -2;
  }

  const modelTokens = normalizePhotoText([vehicle?.modelo, vehicle?.versao].filter(Boolean).join(" "))
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  for (const token of modelTokens) {
    if (new RegExp(`\\b${token}\\b`).test(normalized)) score += 3;
  }

  return score;
}

function pickVehicleByMessageAttributes(message: string, vehicles: any[]) {
  const normalized = normalizePhotoText(message);
  const hasDiscriminator = /\b(automatico|automatica|aut|manual|mecanico|mecanica|mec|branco|preto|prata|cinza|azul|vermelho|laranja|sedan|hatch|suv|picape|pickup|caminhonete|20\d{2})\b/.test(normalized);
  if (!hasDiscriminator) return null;

  const ranked = vehicles
    .map((vehicle, index) => ({ vehicle, index, score: messageVehicleAttributeScore(message, vehicle) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  if (ranked.length === 0) return null;
  const [best, second] = ranked;
  if (best.score >= 5 && (!second || best.score >= second.score + 2)) {
    return { index: best.index, reason: "message_attribute_match", key: vehicleKey(best.vehicle) };
  }
  return null;
}

// Casa o veiculo pelo NOME (marca/modelo) citado na mensagem (ex: "fotos do
// renegade" -> o Jeep Renegade do pool). Sem isso, "fotos do <modelo>" caia no
// default index 0 e mandava as fotos do PRIMEIRO carro da lista (carro errado).
function pickVehicleByModelName(message: string, vehicles: any[]) {
  const normalized = normalizePhotoText(message);
  if (!normalized) return null;
  const ranked = vehicles
    .map((vehicle, index) => {
      const tokens = Array.from(new Set(
        normalizePhotoText([vehicle?.marca, vehicle?.modelo].filter(Boolean).join(" "))
          .split(/\s+/)
          .filter((token) => token.length >= 3),
      ));
      let score = 0;
      for (const token of tokens) {
        if (new RegExp(`\\b${token}\\b`).test(normalized)) score += token.length >= 4 ? 4 : 2;
      }
      return { vehicle, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0) return null;
  return { index: ranked[0].index, reason: "model_name_match", key: vehicleKey(ranked[0].vehicle) };
}

function pickReferencedVehicle(message: string, memory: any, vehicles: any[]) {
  const explicitIndex = explicitVehicleOrdinal(message);
  if (explicitIndex !== null) {
    const index = clampVehicleIndex(explicitIndex, vehicles);
    return { index, explicit: true, reason: "explicit_ordinal", key: vehicleKey(vehicles[index]) };
  }

  const attributeMatch = pickVehicleByMessageAttributes(message, vehicles);
  if (attributeMatch) {
    return { ...attributeMatch, explicit: true };
  }

  // Nome do modelo/marca citado vence a continuidade/memoria (mensagem atual
  // sempre ganha do contexto antigo). So cai na memoria se nada for citado.
  const modelMatch = pickVehicleByModelName(message, vehicles);
  if (modelMatch) {
    return { ...modelMatch, explicit: true };
  }

  const lastKey = memory?.ultima_foto?.veiculo_key || memory?.referencia?.ultimo_veiculo_key || null;
  if (lastKey) {
    const keyIndex = vehicles.findIndex((vehicle) => vehicleKey(vehicle) === lastKey);
    if (keyIndex >= 0) {
      return { index: keyIndex, explicit: false, reason: "last_photo_vehicle_key", key: lastKey };
    }
  }

  const rememberedIndex = Number.isFinite(Number(memory?.ultima_foto?.veiculo_index))
    ? Number(memory.ultima_foto.veiculo_index)
    : Number.isFinite(Number(memory?.referencia?.ultimo_veiculo_index))
      ? Number(memory.referencia.ultimo_veiculo_index)
      : null;

  if (rememberedIndex !== null) {
    const index = clampVehicleIndex(rememberedIndex, vehicles);
    return { index, explicit: false, reason: "last_photo_vehicle_index", key: vehicleKey(vehicles[index]) };
  }

  return { index: 0, explicit: false, reason: "default_first_vehicle", key: vehicleKey(vehicles[0]) };
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

// Detecta pedido EXPLICITO de fotos/imagens (mesma regra do planner.isPhotoText).
// Rede de seguranca do envio de fotos: se o lead pediu fotos e ha veiculos para
// mostrar, enviamos as imagens de verdade mesmo que o planner tenha roteado para
// stock_search (evita o agente PROMETER fotos e mandar so texto).
function messageAsksForPhotos(message: string): boolean {
  const normalized = normalizePhotoText(message);
  return /\b(foto|fotos|imagem|imagens|painel|interior|banco|bancos|roda|rodas|porta malas|porta-malas|traseira|frente|lateral|video|videos)\b/.test(normalized);
}

function uniqueIndexes(indexes: number[], total: number, max = 5) {
  const selected: number[] = [];
  for (const rawIndex of indexes) {
    const index = Math.max(0, Math.min(total - 1, Math.round(rawIndex)));
    if (!selected.includes(index)) selected.push(index);
    if (selected.length >= Math.min(max, total)) break;
  }
  return selected;
}

function fillIndexes(indexes: number[], total: number, max = 5, fallbackStart = 0, fallbackDirection: "forward" | "backward" = "forward") {
  const selected = uniqueIndexes(indexes, total, max);
  let index = fallbackStart;
  while (selected.length < Math.min(max, total) && index >= 0 && index < total) {
    if (!selected.includes(index)) selected.push(index);
    index += fallbackDirection === "forward" ? 1 : -1;
  }
  for (let fallback = 0; selected.length < Math.min(max, total) && fallback < total; fallback++) {
    if (!selected.includes(fallback)) selected.push(fallback);
  }
  return selected.slice(0, Math.min(max, total));
}

function selectVehiclePhotos(vehicle: any, message: string, alreadySent: number[] = []) {
  const photos = [
    ...(Array.isArray(vehicle?.fotos) ? vehicle.fotos : []),
    vehicle?.principal_image,
  ].filter(Boolean).filter((url, position, all) => all.indexOf(url) === position);

  const total = photos.length;
  const target = detectPhotoTarget(message);
  if (total === 0) return { target, photos: [] as string[], sent_indexes: [] as number[] };
  if (total <= 5) {
    const idx = Array.from({ length: total }, (_, i) => i);
    return { target, photos: idx.map((i) => photos[i]), sent_indexes: idx };
  }

  const middle = Math.max(4, Math.floor(total * 0.48));
  const late = Math.max(middle + 1, Math.floor(total * 0.66));
  const maxPhotos = target === "overview" || target === "interior" ? 5 : 3;
  const strategies: Record<PhotoTarget, number[]> = {
    overview: [0, 3, 6, 7, 8, 9, 4, 1, 2, middle, late],
    front: [0, 1, 2, 3, middle],
    side: [2, 3, 1, 4, middle],
    rear: [4, 5, 3, 6, Math.min(total - 1, late)],
    wheel: [3, 4, 2, 5, 1],
    interior: [5, 6, 7, 8, 9, middle, late, total - 1],
    dashboard: [8, 7, 9, 6, 10, 5, late, late + 1, total - 1],
    seats: [5, 6, 7, 8, 9, middle, late, total - 1],
    trunk: [Math.max(0, total - 2), Math.max(0, total - 3), 4, 5, late],
  };

  // Ordem COMPLETA de exibicao: a estrategia do alvo primeiro, depois todas as
  // demais fotos em ordem (garante que "mais fotos" caminhe por todo o acervo).
  const interiorish = target === "interior" || target === "dashboard" || target === "seats";
  const ordered = uniqueIndexes(
    [...strategies[target], ...Array.from({ length: total }, (_, i) => i)],
    total,
    total,
  );
  // Remove as fotos JA enviadas para este veiculo -> "mais fotos" manda diferentes.
  // Se o lead ja viu todas, recomeca o ciclo (nunca fica sem foto).
  const sentSet = new Set((alreadySent || []).map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n)));
  const remaining = ordered.filter((i) => !sentSet.has(i));
  // Sempre tenta entregar maxPhotos (5 no overview "como antes"): prioriza as NAO
  // enviadas e, se faltar, completa com o restante do acervo (ja vistas). Assim um
  // lote de "mais fotos" nao sai com 3 quando ha como completar.
  let indexes = remaining.slice(0, maxPhotos);
  if (indexes.length < maxPhotos) {
    for (const i of ordered) {
      if (indexes.length >= maxPhotos) break;
      if (!indexes.includes(i)) indexes.push(i);
    }
  }
  if (indexes.length === 0) {
    indexes = fillIndexes(strategies[target], total, maxPhotos, interiorish ? Math.min(total - 1, 5) : 0, "forward");
  }
  return { target, photos: indexes.map((index) => photos[index]), sent_indexes: indexes };
}

function pickPhrase(seed: string, phrases: string[]) {
  const index = normalizeVehicleKey(seed).split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % phrases.length;
  return phrases[index] || phrases[0];
}

function buildPhotoReplyText(target: PhotoTarget, vehicle: any, message: string) {
  const label = cleanVehicleLabel(vehicle) || "esse carro";
  const phrases: Record<PhotoTarget, string[]> = {
    overview: [
      "Da pra ter uma nocao bem melhor dele por essas fotos. O que voce achou?",
      "Essas fotos mostram melhor o estado dele. Fez sentido pra voce?",
      "Ele tem uma presenca boa nas fotos. Quer que eu confirme algum detalhe?",
    ],
    front: [
      "Pela frente da pra ver bem a conservacao dele. O que achou?",
      "Essa dianteira esta bem apresentada nas fotos. Quer ver mais algum detalhe?",
    ],
    side: [
      "A lateral ajuda bastante a ver alinhamento e cuidado. O que achou?",
      "Por esse angulo ja da pra sentir melhor o estado dele. Fez sentido?",
    ],
    rear: [
      "A traseira tambem parece bem inteira pelas fotos. Quer ver mais algum detalhe?",
      "Assim voce consegue avaliar melhor a conservacao. O que achou?",
    ],
    interior: [
      "Por dentro ele parece bem inteiro pelas fotos. O que achou?",
      "Interior costuma dizer muito sobre cuidado de uso. Esse aqui parece legal.",
      "Essas internas ajudam a ver melhor o acabamento. Fez sentido pra voce?",
    ],
    dashboard: [
      "Esse painel parece bem conservado nas fotos. Quer ver algum outro detalhe dele?",
      "Painel e comandos ajudam bastante a sentir o cuidado do carro. O que achou?",
      "Boa, pelo painel ja da pra ver melhor o estado de uso dele.",
    ],
    seats: [
      "Bancos bem cuidados fazem muita diferenca no dia a dia. O que achou?",
      "Essas fotos mostram melhor o estado dos bancos. Fez sentido pra voce?",
    ],
    trunk: [
      "Porta-malas e espaco interno contam bastante no uso real. Esse tamanho te atende?",
      "Da pra avaliar melhor o espaco por essas fotos. Faz sentido pra voce?",
    ],
    wheel: [
      "A roda ajuda bastante a ver cuidado de uso. Quer que eu confirme mais algum detalhe dele?",
      "Esse detalhe da roda ja mostra melhor a conservacao. O que achou?",
    ],
  };
  return pickPhrase(`${vehicleKey(vehicle)} ${target} ${message} ${label}`, phrases[target]);
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

  const reference = pickReferencedVehicle(message, memory, vehicles);
  const index = reference.index;
  const vehicle = vehicles[index] || vehicles[0];
  // Fotos ja enviadas SO contam se for o MESMO veiculo da ultima vez (senao reseta).
  const refKey = reference.key || vehicleKey(vehicle);
  const sameVehicle = memory?.ultima_foto?.veiculo_key && memory.ultima_foto.veiculo_key === refKey;
  const alreadySent = sameVehicle && Array.isArray(memory?.ultima_foto?.fotos_enviadas)
    ? memory.ultima_foto.fotos_enviadas
    : [];
  const selection = selectVehiclePhotos(vehicle, message, alreadySent);
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
    text: buildPhotoReplyText(selection.target, vehicle, message),
    source: "vehicle_photos_reply",
    vehicle,
    selected_index: index,
    selected_vehicle_key: reference.key || vehicleKey(vehicle),
    selected_vehicle_label: cleanVehicleLabel(vehicle),
    selected_vehicle_reason: reference.reason,
    photo_target: selection.target,
    sent_photo_indexes: selection.sent_indexes,
    same_vehicle_as_last: Boolean(sameVehicle),
    media: photos.map((file: string, photoIndex: number) => ({
      file,
      type: "image",
      caption: "",
      order: photoIndex + 1,
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
    veiculos_apresentados: input.vehicles.slice(0, 30),
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

async function savePhotoReference(supabase: any, input: {
  lead_id?: string | null;
  agent_id: string;
  user_id: string;
  current: any;
  reply: any;
}) {
  if (!input.lead_id || input.reply?.source !== "vehicle_photos_reply") return input.current || {};
  const selectedIndex = Number.isFinite(Number(input.reply.selected_index)) ? Number(input.reply.selected_index) : 0;
  const selectedKey = input.reply.selected_vehicle_key || vehicleKey(input.reply.vehicle);
  const selectedLabel = input.reply.selected_vehicle_label || cleanVehicleLabel(input.reply.vehicle);
  // Acumula os indices de fotos ja enviadas deste veiculo (para "mais fotos"
  // mandar diferentes). Reseta se for um veiculo diferente do ultimo.
  const prevSent = (input.reply.same_vehicle_as_last && Array.isArray(input.current?.ultima_foto?.fotos_enviadas))
    ? input.current.ultima_foto.fotos_enviadas
    : [];
  const newSent = Array.isArray(input.reply.sent_photo_indexes) ? input.reply.sent_photo_indexes : [];
  const fotosEnviadas = Array.from(new Set([...prevSent, ...newSent].map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n))));
  const nextState = {
    ...(input.current || {}),
    ultima_foto: {
      veiculo_index: selectedIndex,
      veiculo_key: selectedKey,
      veiculo_label: selectedLabel,
      target: input.reply.photo_target || "overview",
      fotos_enviadas: fotosEnviadas,
      updated_at: new Date().toISOString(),
    },
    referencia: {
      ...(input.current?.referencia || {}),
      ultimo_veiculo_index: selectedIndex,
      ultimo_veiculo_key: selectedKey,
      ultimo_veiculo_label: selectedLabel,
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
    console.warn("[PedroV2] Failed to save photo reference", error);
    return input.current || {};
  }
  return nextState;
}

// ── DEBOUNCE / agrupamento de mensagens em rajada (ponto 3) ───────────────────
// Janela de agrupamento (debounce). Subiu de 7s -> 10s para batelar melhor as
// RAJADAS de leads de anuncio (CTWA): a mensagem do anuncio (Meta) costuma chegar
// "solta", alguns segundos depois do texto do lead; com 7s ela escapava e disparava
// um 2o turno (agente respondia 2x / se reapresentava / pedia o modelo que o anuncio
// ja trazia). 10s unifica o bloco -> 1 turno com o veiculo do anuncio resolvido.
const PEDRO_V2_DEBOUNCE_MS = 10000;

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Junta as mensagens do lead ainda NAO respondidas (desde a ultima resposta do
// agente) em um unico texto, para o cerebro tratar varias bolhas como UM turno.
async function gatherUnansweredUserText(supabase: any, agentId: string, remoteJid: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("wa_chat_history")
      .select("role, content, created_at")
      .eq("agent_id", agentId)
      .eq("remote_jid", remoteJid)
      .order("created_at", { ascending: false })
      .limit(20);
    const rows = Array.isArray(data) ? data.slice().reverse() : [];
    let lastAssistantIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i]?.role || "") === "assistant") { lastAssistantIdx = i; break; }
    }
    const pending = rows.slice(lastAssistantIdx + 1).filter((r: any) => String(r?.role || "") === "user");
    const parts = pending.map((r: any) => String(r?.content || "").trim()).filter(Boolean);
    return parts.join("\n").trim();
  } catch (_e) {
    return "";
  }
}

export async function processPedroV2Turn(
  supabase: any,
  input: PedroV2TurnInput & { agent: any; wa_instance: any },
): Promise<PedroV2TurnResult> {
  const correlationId = newTraceId();
  const dryRun = input.dry_run !== false;
  // Token metering: acumula o uso dos cérebros (planner + reply) deste turno.
  const usageSink = { tokens: 0 };
  const log = makeTurnLogger(correlationId, {
    agent_id: input.agent?.id,
    instance_id: input.wa_instance?.id,
  });

  const remoteJid = pickRemoteJid(input.payload);
  const rawText = pickText(input.payload);
  const pushName = pickPushName(input.payload);
  if (!remoteJid) {
    return { ok: false, dry_run: dryRun, correlation_id: correlationId, error: "remote_jid_missing" };
  }

  // IGNORA grupos / broadcast / status / canais — IGUAL ao Pedro v1
  // (uazapi-webhook ja barrava @g.us e @broadcast). O agente so conversa em
  // chat PRIVADO de lead. Sem este guard, ao migrar pro v2 o agente passou a
  // responder DENTRO de grupos (jid @g.us), tratando o grupo como lead e
  // falando com vendedores como se fossem clientes. Bail ANTES de qualquer
  // identidade/debounce/escrita/envio.
  if (/@g\.us|@broadcast|@newsletter|status@broadcast/i.test(remoteJid)) {
    log("info", "pedro_v2_ignored_non_private_chat", { remote_jid: remoteJid });
    return {
      ok: true,
      dry_run: dryRun,
      correlation_id: correlationId,
      next_action: "ignored_group_or_broadcast",
    };
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
    // Paridade com o v1: avisa o vendedor que o "OK" foi registrado (sem isso ele
    // acha que nao funcionou). So no OK que de fato confirmou um lead.
    if (!dryRun && ack.confirmed && isPedroV2SendingEnabled()) {
      try {
        const sellerInstance = input.wa_instance || await resolvePedroInstance(supabase, {
          user_id: input.agent.user_id,
          agent_id: input.agent.id,
          instance_id: input.wa_instance?.id,
        });
        await sendPedroText(sellerInstance, {
          to: remoteJidToPhone(remoteJid),
          text: "✅ *Atendimento confirmado!*\n\nO lead foi atribuído a você no CRM. Pode seguir com a venda! 🚀",
        });
      } catch (_e) { /* silencioso — a confirmacao ja esta gravada no banco */ }
    }
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
  const recentHistory = await loadRecentConversationHistory(supabase, {
    user_id: input.agent.user_id,
    remote_jid: remoteJid,
    memory: currentMemory,
    lead_created_at: lead?.created_at || null,
  });

  const mediaContext = await resolvePedroMediaContext(input.payload, input.wa_instance);
  let text = mediaContext.kind === "audio" && mediaContext.text
    ? mediaContext.text
    : rawText;

  // Salvar mensagem do usuário no histórico (transferências/CRM/debounce). Captura o id.
  let myUserMsgId: string | null = null;
  if (!dryRun && lead?.id && text) {
    try {
      const { data: insertedUserMsg } = await supabase.from("wa_chat_history").insert({
        user_id: input.agent.user_id,
        agent_id: input.agent.id,
        instance_id: input.wa_instance?.instance_name,
        remote_jid: remoteJid,
        role: "user",
        content: text,
      }).select("id").maybeSingle();
      myUserMsgId = insertedUserMsg?.id || null;
    } catch (err) {
      console.warn("[PedroV2] Failed to save user message to chat history:", err);
    }
  }

  // === DEBOUNCE / AGRUPAMENTO (ponto 3): trata mensagens em rajada como UM turno ===
  // Espera ~7s; se chegou mensagem mais nova do lead, ESTA invocacao fica silenciosa
  // (a da mensagem mais nova responde). A ultima junta todas as nao-respondidas.
  // So em conversa real (nao dry_run) e v2 (este orquestrador). Mensagem unica = mesmo
  // comportamento + a espera.
  if (!dryRun && lead?.id && text && myUserMsgId) {
    await sleepMs(PEDRO_V2_DEBOUNCE_MS);
    const { data: latestUserMsg } = await supabase
      .from("wa_chat_history")
      .select("id")
      .eq("agent_id", input.agent.id)
      .eq("remote_jid", remoteJid)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestUserMsg?.id && latestUserMsg.id !== myUserMsgId) {
      // Chegou mensagem mais nova -> a invocacao dela responde o bloco completo.
      return {
        ok: true,
        dry_run: dryRun,
        correlation_id: correlationId,
        identity,
        lead_id: lead?.id || null,
        next_action: "debounced_superseded",
      };
    }
    const batched = await gatherUnansweredUserText(supabase, input.agent.id, remoteJid);
    if (batched) text = batched;
  }

  const intent = routePedroIntent({ message: text, current_memory: currentMemory });
  const adContext = mergeAdAndMediaContext(await resolvePedroAdContext(input.payload, text), mediaContext);
  const enrichedText = buildMessageWithAdContext(text, adContext);
  const adMemory = adContextToMemory(adContext);
  const adNeedsVehicleConfirmation = adContext.has_ad_context && !adContext.vehicle_query;
  const enrichedIntent = adContext.has_ad_context
    ? routePedroIntent({ message: enrichedText, current_memory: currentMemory })
    : intent;
  const contextualIntentBase = adContext.has_ad_context
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
  const vehicleResolution = resolvePedroVehicleTurn({
    message: text,
    enriched_message: enrichedText,
    memory: currentMemory,
    ad_context: adContext,
    media_context: mediaContext,
  });
  const brainPlan = await planPedroTurn({
    agent: input.agent,
    message: text,
    enriched_message: enrichedText,
    memory: currentMemory,
    heuristic_intent: contextualIntentBase,
    ad_context: adContext,
    media_context: sanitizePedroMediaContext(mediaContext),
    recent_history: recentHistory,
    vehicle_resolution: vehicleResolution,
    usage_sink: usageSink,
  });
  const contextualIntent = mergeBrainPlanIntoIntent(contextualIntentBase, brainPlan, vehicleResolution);
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
    vehicle_resolution: vehicleResolution,
    brain_plan: brainPlan,
    memory_stage: nextMemory?.atendimento?.etapa,
  });

  const stockFilters = contextualIntent.needs_stock_search
    ? buildStockFilters(contextualIntent, nextMemory, enrichedText, brainPlan, vehicleResolution)
    : null;

  let stockResult = null;
  let isGenericQuery = false;

  if (stockFilters) {
    const q = stockFilters.query;
    const isUrl = /^https?:\/\//i.test(String(q || "").trim());
    const norm = String(q || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const isWeak = ["carro", "carros", "veiculo", "veiculos", "moto", "motos", "anuncio", "anuncios", "estoque"].includes(norm);
    
    // Split and filter tokens that are not weak
    const weakWordList = ["carro", "carros", "veiculo", "veiculos", "moto", "motos", "anuncio", "anuncios", "estoque", "tem", "voces", "voce", "preco", "valor", "anuncio", "instagram", "facebook", "esse", "essa", "este", "esta", "sobre", "quero", "queria", "saber", "mais", "fotos", "foto", "detalhes", "modelo", "versao"];
    const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean).filter(t => t.length >= 2 && !weakWordList.includes(t));
    
    if (isUrl || isWeak || tokens.length === 0) {
      isGenericQuery = true;
    }

    // CRITERIO DE PRECO/SEGMENTO ("mais economico/barato/popular/em conta/basico")
    // NAO e busca generica — e pedido dos carros MAIS EM CONTA. Forca a busca
    // ampla (o stockSearch ja ordena por PRECO CRESCENTE -> mais baratos primeiro)
    // em vez de devolver "pergunte qual modelo". Antes, "carro mais economico"
    // virava query "carro" -> generico -> 0 resultados -> "nao temos".
    const _budgetText = `${text || ""} ${enrichedText || ""}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const budgetIntent = /\b(economic|barat|popular|basic|baratinh|acessiv|custo)/.test(_budgetText) || /\bem\s+conta\b/.test(_budgetText);
    if (budgetIntent) {
      isGenericQuery = false;
      (stockFilters as any).budget_cheapest = true;
    }
  }

  if (stockFilters && !isGenericQuery) {
    stockResult = await searchPedroStock(supabase, {
      user_id: input.agent.user_id,
      query: stockFilters.query,
      filters: stockFilters,
      limit: 24,
    });
  } else if (stockFilters && isGenericQuery) {
    stockResult = {
      success: true,
      total: 0,
      items: [],
      is_generic_query: true,
      query: stockFilters.query,
      response_guidance: "A busca do cliente foi genérica (ex: 'carro', 'veículo' ou link não resolvido). Não pesquise no estoque e pergunte de forma natural qual veículo/modelo específico ele gostaria de ver.",
    };
  }

  // FOTO GARANTIDA (rede de seguranca): se o lead pediu fotos EXPLICITAMENTE e
  // temos veiculos para mostrar — da memoria (ja apresentados) OU de uma busca
  // ESPECIFICA recem-feita NESTE turno — enviamos as imagens de verdade. Sem isso,
  // quando o planner rebaixa "fotos do <modelo>" para stock_search (modelo visto
  // como "novo topico" ou veiculos ainda nao salvos na memoria), o agente PROMETE
  // fotos e manda so texto (bug: "vou separar as fotos do Renegade" e nada chega).
  const leadAskedPhotosExplicitly = messageAsksForPhotos(text);
  const memoryPhotoVehicles = Array.isArray(nextMemory?.veiculos_apresentados) ? nextMemory.veiculos_apresentados : [];
  const freshSpecificStock = (!isGenericQuery && stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length > 0)
    ? stockResult.items
    : [];
  const photoVehiclesPool = memoryPhotoVehicles.length > 0 ? memoryPhotoVehicles : freshSpecificStock;
  const shouldSendVehiclePhotos = brainPlan.action === "photo_request"
    || (leadAskedPhotosExplicitly && photoVehiclesPool.length > 0);

  let reply = shouldSendVehiclePhotos
    ? buildVehiclePhotoReply({ ...nextMemory, veiculos_apresentados: photoVehiclesPool }, text)
    : await generatePedroBrainReply({
        agent: input.agent,
        agent_system_prompt: input.agent?.system_prompt || input.agent?.prompt || null,
        memory: nextMemory,
        intent: contextualIntent,
        stock_result: stockResult,
        message: enrichedText,
        plan: brainPlan,
        vehicle_resolution: vehicleResolution,
        ad_context: adContext,
        media_context: sanitizePedroMediaContext(mediaContext),
        recent_history: recentHistory,
        usage_sink: usageSink,
      });

  let effectiveMemory = nextMemory;
  if (stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length > 0) {
    const indices = Array.isArray((reply as any).presented_vehicle_indices) ? (reply as any).presented_vehicle_indices : [];
    let vehiclesToSave = indices
      .map((idx: number) => stockResult.items[idx - 1])
      .filter(Boolean);

    if (vehiclesToSave.length === 0 && ["brain_stock_reply", "stock_fact_reply", "brain_stock_fallback", "brain_ad_vehicle_reply", "brain_ad_vehicle_fallback"].includes(reply.source)) {
      vehiclesToSave = stockResult.items;
    }

    // Se as FOTOS sairam de uma busca fresca (lead pediu "fotos do X" antes de os
    // veiculos estarem salvos na memoria), guarda os encontrados para o proximo
    // "mais fotos"/referencia funcionar pela memoria.
    if (vehiclesToSave.length === 0 && reply.source === "vehicle_photos_reply") {
      vehiclesToSave = stockResult.items;
    }

    if (vehiclesToSave.length > 0) {
      effectiveMemory = !dryRun && lead?.id
        ? await savePresentedVehicles(supabase, {
            lead_id: lead.id,
            agent_id: input.agent.id,
            user_id: input.agent.user_id,
            current: nextMemory,
            vehicles: vehiclesToSave,
          })
        : {
            ...nextMemory,
            veiculos_apresentados: vehiclesToSave.slice(0, 30),
          };
    }
  }

  if (reply?.source === "vehicle_photos_reply" && Array.isArray(reply.media) && reply.media.length > 0) {
    const brainClosing = await generatePedroBrainReply({
      agent: input.agent,
      agent_system_prompt: input.agent?.system_prompt || input.agent?.prompt || null,
      memory: effectiveMemory,
      intent: contextualIntent,
      stock_result: stockResult,
      message: enrichedText,
      plan: {
        ...brainPlan,
        response_guidance:
          "A tool de fotos ja selecionou as imagens. Escreva a mensagem humana que sera enviada ANTES das fotos, citando o veiculo certo e o detalhe pedido. Nao repita lista de carros.",
      },
      vehicle_resolution: vehicleResolution,
      ad_context: adContext,
      media_context: sanitizePedroMediaContext(mediaContext),
      recent_history: recentHistory,
      usage_sink: usageSink,
      tool_result: {
        type: "vehicle_photos",
        selected_vehicle_label: reply.selected_vehicle_label || null,
        selected_vehicle_reason: reply.selected_vehicle_reason || null,
        photo_target: reply.photo_target || null,
        media_count: reply.media.length,
      },
    });

    if (brainClosing?.ok && brainClosing.text) {
      reply = {
        ...reply,
        text: brainClosing.text,
        text_source: brainClosing.source,
      };
    }
  }

  let memoryAfterReply = effectiveMemory;
  if (!dryRun && lead?.id && reply.source === "vehicle_photos_reply") {
    memoryAfterReply = await savePhotoReference(supabase, {
      lead_id: lead.id,
      agent_id: input.agent.id,
      user_id: input.agent.user_id,
      current: effectiveMemory,
      reply,
    });
  }

  let sendResult: any = null;
  if (!dryRun && reply.ok && isPedroV2SendingEnabled()) {
    const instance = input.wa_instance || await resolvePedroInstance(supabase, {
      user_id: input.agent.user_id,
      agent_id: input.agent.id,
      instance_id: input.wa_instance?.id,
    });
    const mediaResults: any[] = [];
    if (reply.source === "vehicle_photos_reply" && Array.isArray(reply.media) && reply.media.length > 0) {
      const openingResult = reply.text
        ? await sendPedroText(instance, {
            to: remoteJidToPhone(remoteJid),
            text: reply.text,
          }, { humanize: true })
        : null;
      if (openingResult && openingResult.ok === false) {
        sendResult = {
          ok: false,
          media_first: false,
          opening_result: openingResult,
          media_results: mediaResults,
        };
      } else {
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
      const mediaOk = mediaResults.length === reply.media.length && mediaResults.every((item) => item?.ok);
      sendResult = {
        ok: mediaOk,
        media_first: false,
        opening_result: openingResult,
        media_results: mediaResults,
      };
      }
    } else {
      const preserveFormatting = ["stock_fact_reply", "brain_stock_reply", "brain_stock_fallback"].includes(reply.source);
      sendResult = await sendPedroText(instance, {
        to: remoteJidToPhone(remoteJid),
        text: reply.text,
      }, { humanize: !preserveFormatting, typingOnly: preserveFormatting });
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
    }
    if (sendResult?.ok) {
      await markAgentReplyForLead(supabase, lead?.id || null);
      if (reply.text) {
        try {
          await supabase.from("wa_chat_history").insert({
            user_id: input.agent.user_id,
            agent_id: input.agent.id,
            instance_id: input.wa_instance?.instance_name,
            remote_jid: remoteJid,
            role: "assistant",
            content: reply.text,
          });
        } catch (err) {
          console.warn("[PedroV2] Failed to save assistant reply to chat history:", err);
        }
      }
    }
  } else if (!dryRun && reply.ok) {
    sendResult = { ok: true, dry_run: true, reason: "PEDRO_V2_SEND_ENABLED_disabled" };
    await markAgentReplyForLead(supabase, lead?.id || null);
    if (reply.text) {
      try {
        await supabase.from("wa_chat_history").insert({
          user_id: input.agent.user_id,
          agent_id: input.agent.id,
          instance_id: input.wa_instance?.instance_name,
          remote_jid: remoteJid,
          role: "assistant",
          content: reply.text,
        });
      } catch (err) {
        console.warn("[PedroV2] Failed to save assistant reply to chat history:", err);
      }
    }
  }

  // ETAPA C: lead qualificado / agendou / pediu humano -> transfere para vendedor.
  // Marca status='transferido' (sem mexer no status_crm); com isso o follow-up de
  // inatividade para sozinho (o cron so processa novo/interessado). Gated a v2.
  let handoffResult: any = null;
  // Transfere quando: (1) o planner mandou handoff (lead pediu humano explicitamente), OU
  // (2) o cerebro, seguindo o system prompt, marcou pronto_para_transferir COM nome +
  // algum contexto real (interesse, dia de agendamento, troca/entrada/pagamento). Quem
  // controla o TIMING (qualificar antes) e o cerebro seguindo o System Prompt; este guard
  // so evita transferir um turno vazio/sem contexto.
  const _q = (reply?.qualificacao_coletada && typeof reply.qualificacao_coletada === "object") ? reply.qualificacao_coletada : {};
  const _hasNome = Boolean(_q.nome || lead?.lead_name);
  const _hasContext = Boolean(_q.interesse) || Boolean(_q.dia_agendamento)
    || _q.tem_troca === true || _q.tem_troca === false || Boolean(_q.valor_entrada) || Boolean(_q.forma_pagamento)
    || Boolean(effectiveMemory?.interesse?.modelo_desejado)
    || (Array.isArray(effectiveMemory?.veiculos_apresentados) && effectiveMemory.veiculos_apresentados.length > 0);
  const brainReadyToTransfer = reply?.pronto_para_transferir === true && _hasNome && _hasContext;
  // Transferencia SILENCIOSA: lead desqualificado (recusou EXPLICITAMENTE) -> vai para o
  // vendedor para follow-up futuro, SEM anunciar ao lead (a msg do cerebro ja e uma
  // despedida gentil, sem dizer que vai transferir). NUNCA encerramos sem encaminhar.
  const silentTransfer = reply?.transferir_silencioso === true && _hasNome && !brainReadyToTransfer && !contextualIntent.needs_handoff;
  // Transferencia automatica (qualificacao/silenciosa) respeita a regra do agente:
  // se o gerente desligou a transferencia, o agente NAO repassa (atende sozinho).
  const _automationRules = resolveAutomationRules(input.agent?.automation_rules);
  if (!dryRun && lead?.id && _automationRules.transfer.enabled && (contextualIntent.needs_handoff || brainReadyToTransfer || silentTransfer) && identity.kind !== "seller") {
    try {
      handoffResult = await executePedroV2Handoff(supabase, {
        user_id: input.agent.user_id,
        agent_id: input.agent.id,
        lead_id: lead.id,
        remote_jid: remoteJid,
        lead_name: _q.nome || lead.lead_name || pushName || null,
        reason: contextualIntent.needs_handoff ? `handoff:${brainPlan?.intent || contextualIntent.intent || "humano"}` : (silentTransfer ? "handoff:desqualificado_silencioso_followup" : "handoff:qualificado_pronto"),
        qualificacao: _q,
        seller_response_min: _automationRules.transfer.seller_response_min,
      });
      if (handoffResult?.ok && handoffResult.seller?.whatsapp_number && isPedroV2SendingEnabled()) {
        const handoffInstance = input.wa_instance || await resolvePedroInstance(supabase, {
          user_id: input.agent.user_id,
          agent_id: input.agent.id,
          instance_id: input.wa_instance?.id,
        });
        const leadPhone = remoteJidToPhone(remoteJid);
        const sellerHeader = silentTransfer
          ? `*LEAD PARA FOLLOW-UP (nao avancou agora) - Pedro v2*\nCliente nao se desqualificou de vez; vale retomar depois.`
          : `*NOVO LEAD QUALIFICADO (Pedro v2)*`;
        const sellerNotif = `${sellerHeader}\n\n*Cliente:* ${lead.lead_name || pushName || "Desconhecido"}\n*Contato:* +${leadPhone}\n*Agente IA:* ${input.agent?.name || "Agente"}\n\n--------------------\n${handoffResult.briefing}\n--------------------\n\n*Atender:* https://wa.me/${leadPhone}\n\n*Responda "Ok" para assumir este atendimento!*`;
        await sendPedroText(handoffInstance, { to: handoffResult.seller.whatsapp_number, text: sellerNotif });

        // Relatorio automatico ao(s) gerente(s) — ate 2 (mesma regra do portal).
        const _gerentes = managerPhones(input.agent);
        if (_gerentes.length > 0) {
          const _hora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
          const _mgrMsg = `📊 *RELATÓRIO DE LEAD — ${input.agent?.name || "Agente"}*\n\n🕐 *Horário:* ${_hora}\n\n👤 *Lead:* ${lead.lead_name || pushName || "Desconhecido"}\n📱 *Telefone:* +${leadPhone}\n\n━━━━━━━━━━━━━━━━━━━━\n\n🎯 *Enviado para:* ${handoffResult.seller?.name || "Vendedor"}\n📲 *WhatsApp vendedor:* ${handoffResult.seller?.whatsapp_number || ""}\n\n━━━━━━━━━━━━━━━━━━━━\n_Gerado automaticamente pelo Pedro SDR_`;
          for (const gp of _gerentes) {
            try { await sendPedroText(handoffInstance, { to: gp, text: _mgrMsg }); } catch (_e) { /* nao bloqueante */ }
          }
        }
      }
    } catch (e) {
      console.warn("[PedroV2] Falha ao executar handoff (Etapa C):", e);
    }
  }

  if (!dryRun && lead?.id && reply.ok) {
    memoryAfterReply = await saveRecentConversationTurn(supabase, {
      lead_id: lead.id,
      agent_id: input.agent.id,
      user_id: input.agent.user_id,
      current: memoryAfterReply,
      incoming_text: text,
      reply_text: reply.text || "",
      reply_source: reply.source || null,
    });
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
        vehicle_resolution: vehicleResolution,
        brain_plan: brainPlan,
        stock_filters: stockFilters,
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
        selected_vehicle_index: reply.selected_index ?? null,
        selected_vehicle_key: reply.selected_vehicle_key || null,
        selected_vehicle_reason: reply.selected_vehicle_reason || null,
        photo_target: reply.photo_target || null,
        send_result: sendResult,
        handoff: handoffResult ? { ok: handoffResult.ok, reason: handoffResult.reason, seller: handoffResult.seller?.name || null } : null,
      },
    });
  }

  // Token metering: desconta o que os cérebros gastaram neste turno e avisa o
  // dono no WhatsApp (gerente_phone) quando o saldo cruza ≤10% ou ≤0. Nunca
  // bloqueia o atendimento — roda depois da resposta e nunca lança erro.
  if (!dryRun) {
    const consume = await consumeUserTokens(supabase, {
      userId: input.agent.user_id,
      tokens: usageSink.tokens,
      agent: "pedro",
      description: "Pedro SDR v2 — resposta no WhatsApp",
    });
    if (consume.just_depleted || consume.just_low) {
      const alertPhone = normalizeAlertPhone(input.agent.gerente_phone);
      if (alertPhone && input.wa_instance) {
        try {
          await sendPedroText(input.wa_instance, {
            to: alertPhone,
            text: buildTokenAlertText(consume.just_depleted ? "depleted" : "low"),
          }, { humanize: false });
          log("info", "pedro_v2_token_alert_sent", {
            kind: consume.just_depleted ? "depleted" : "low",
            balance_after: consume.balance_after,
          });
        } catch (alertErr) {
          console.warn("[tokens] v2 alert send failed", alertErr);
        }
      }
    }
  }

  return {
    ok: true,
    dry_run: dryRun,
    correlation_id: correlationId,
    identity,
    lead_id: lead?.id || null,
    intent: contextualIntent,
    brain_plan: brainPlan,
    vehicle_resolution: vehicleResolution,
    stock_result: stockResult,
    reply,
    send_result: sendResult,
    next_action: sendResult?.ok ? "reply_sent" : dryRun ? "dry_run_reply_planned" : "reply_generated",
  };
}
