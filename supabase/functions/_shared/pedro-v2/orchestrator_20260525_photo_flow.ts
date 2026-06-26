import { makeTurnLogger, newTraceId } from "../observability/structuredLog.ts";
import { identifyPedroContact } from "./contactIdentity.ts";
import { handleOwnerMessage } from "../jose-v2/ownerVoice.ts";
import { isFeatureEnabled } from "../jose-v2/flags.ts";
import { mapQualidadeLead } from "../jose-v2/leadQuality.ts";
import { ensurePedroV2Lead, findPedroV2Lead, loadPedroMemory, updatePedroMemoryFromIntent } from "./leadMemory.ts";
import { routePedroIntent } from "./intentRouter_20260525_sales.ts";
import { confirmSellerAck, executePedroV2Handoff } from "./transferRouter.ts";
import { resolveAutomationRules } from "../automation/rules.ts";
import { managerPhones } from "../transfer/managers.ts";
import { composeSellerMsg, composeGerenteMsg, buildEtiquetas, maybeStripEmojis } from "../transfer/messageTemplates.ts";
import { pickInterestVehicleFromState } from "../transfer/interestVehicle.ts";
import { leadTransferStatusLine, leadTransferStatusText, LeadTransferStatusKey } from "../transfer/leadStatus.ts";
import { classifyLeadSdrCategory, sdrCategoryLine, sdrCategoryText, mapQualificacaoToLeadColumns, classifyLeadSdr } from "../transfer/leadSdrCategory.ts";
import { remoteJidToPhone } from "./phone.ts";
import { generatePedroBrainReply, buildDeterministicStockReply } from "./pedroBrainReply_20260525.ts";
import { fetchPedroKnowledgeContext } from "./knowledgeBase.ts";
import { planPedroTurn } from "./pedroBrainPlanner_20260525.ts";
import { searchPedroStock } from "./stockSearch_20260525_photo_flow.ts";
import { setSdrLabelOnChat } from "./uazapiLabels.ts";
import { resolvePedroInstance, sendPedroMedia, sendPedroText } from "./uazapiSender_20260524.ts";
import { PedroV2TurnInput, PedroV2TurnResult } from "./types.ts";
import { isPedroV2SendingEnabled } from "./server.ts";
import { adContextToMemory, buildMessageWithAdContext, resolvePedroAdContext } from "./adContext_20260525.ts";
import { mediaContextToAdLikeContext, resolvePedroMediaContext, sanitizePedroMediaContext } from "./mediaContext_20260524.ts";
import { resolvePedroVehicleTurn } from "./vehicleResolver_20260525_brain.ts";
import { buildTokenAlertText, consumeUserTokens, normalizeAlertPhone } from "./tokenMeter.ts";
import { resolveAiKey, isAccountGrandfathered, AiKeyCtx, ProviderError } from "../aiKeys.ts";
// LÓGICA DE DECISÃO PURA (testável offline, $0). Extraída deste arquivo p/ decisionLogic.ts —
// ver scripts/regression/offline.ts. NÃO redefinir essas funções aqui (importadas abaixo).
import {
  PhotoTarget,
  normalizePlannerText,
  leadMessageHasExplicitPriceCeiling,
  leadMessageAsksBroadStock,
  buildStockFilters,
  normalizePhotoText,
  detectPhotoTarget,
  messageAsksForPhotos,
  requestedVehicleQueryForMediaGuard,
  queryIsBroadOrGenericVehicle,
  leadAsksForMoreOptions,
  vehicleDedupKey,
  excludeAlreadyPresented,
  replyDeniesAvailability,
  updateRejeitados,
  clearRejeitadoOnRequest,
  excludeRejeitados,
  photoRequestTargetModel,
  messageIsTooVagueToAct,
  leadExpressesVisitOrBuyIntent,
  leadExplicitlyDeclined,
  leadProvidingTradeDetails,
  nextFunnelQuestion,
  replyHasMeaningfulQuestion,
  replyIsGracefulClose,
  leadAsksInfoQuestion,
  leadAffirmsSchedulingQuestion,
  leadAffirmsPresenceToFollowupPing,
  classifyAgentReplyPending,
} from "./decisionLogic.ts";
import { verifyReplyText, replyMentionsAnyVehicle, neutralizeUngroundedSpecs, replyOffersPhotos, rewriteUnavailablePhotoOffer, stripPhotoReoffer, neutralizeUngroundedClaims, neutralizeAiIdentityLeak, replyDefersSearch, ensureSelfIntroduction, ensureTransferContactClarity, stripTrailingFillerQuestion } from "./preSendVerify.ts";
import { validateGrounding } from "./grounding.ts";
// FLUXO DE FOTO / VEÍCULO puro (testável offline) -> photoLogic.ts. NÃO redefinir aqui.
import {
  vehicleKey,
  stableVehicleKey,
  cleanVehicleLabel,
  sameVehicleModel,
  photoRequestIsAttributeOnly,
  buildVehiclePhotoReply,
  vehicleMatchesRequestedQuery,
  buildBlockedWrongVehiclePhotoReply,
  photoCtaDecision,
} from "./photoLogic.ts";

async function recordPedroV2TurnLog(supabase: any, entry: Record<string, any>) {
  try {
    await supabase.from("pedro_v2_turn_logs").insert(entry);
  } catch (error) {
    console.warn("[PedroV2] Failed to record turn log", error);
  }
}

// BYOK: alerta o dono (1x a cada 6h) quando uma conta NOVA recebe lead mas NAO tem chave de IA
// propria configurada -> o agente nao responde (nao usa a nossa chave). Throttle em memoria.
const _noKeyAlertCache = new Map<string, number>();
async function alertOwnerNoAiKey(supabase: any, input: any, log: any) {
  const userId = input?.agent?.user_id;
  if (!userId) return;
  const now = Date.now();
  if (now - (_noKeyAlertCache.get(userId) || 0) < 6 * 60 * 60 * 1000) return;
  _noKeyAlertCache.set(userId, now);
  const phone = normalizeAlertPhone(input?.agent?.gerente_phone);
  if (!phone || !input?.wa_instance) return;
  try {
    await sendPedroText(input.wa_instance, {
      to: phone,
      text: "⚠️ *Seu agente de IA está sem chave configurada.*\n\nChegou um lead, mas o agente NÃO respondeu porque a chave de IA da sua conta ainda não foi cadastrada. Configure em *Administração → IA → Sua chave de IA* para ativar o atendimento automático. (Sua conta usa a sua própria chave de IA — o consumo é cobrado na sua conta do provedor.)",
    }, { humanize: false });
    log?.("info", "pedro_v2_no_ai_key_alert_sent", { user_id: userId });
  } catch (_e) { /* nao bloqueia o turno */ }
}

// FALHA DE IA NO TURNO: o provedor recusou a chamada (sem credito / chave invalida) e o agente
// caiu pro fallback "burro". Alerta quem pode AGIR e loga sempre. Throttle 6h por (user+kind).
//  - source='client': a chave e do CLIENTE -> alerta o gerente da conta (ele recarrega/corrige).
//  - source='platform': e a NOSSA chave (conta grandfathered) -> NAO incomoda o lojista; loga em
//    alta visibilidade e avisa o dono da plataforma (numero cadastrado no portal -> platform_settings).
const _llmFailAlertCache = new Map<string, number>();

// Numero do dono da plataforma p/ alerta de falha da NOSSA chave. Prioriza o env (override de
// emergencia); senao le de platform_settings (gerenciado pelo superadmin no portal). Cache 10min.
let _platformPhoneCache: { value: string; at: number } | null = null;
async function getPlatformAlertPhone(supabase: any): Promise<string> {
  const env = (Deno.env.get("PEDRO_PLATFORM_ALERT_PHONE") || "").trim();
  if (env) return env;
  const now = Date.now();
  if (_platformPhoneCache && now - _platformPhoneCache.at < 10 * 60 * 1000) return _platformPhoneCache.value;
  let value = "";
  try {
    const { data } = await supabase.from("platform_settings").select("alert_phone").eq("id", "global").maybeSingle();
    value = String(data?.alert_phone || "");
  } catch (_e) { /* fail-safe: sem telefone */ }
  _platformPhoneCache = { value, at: now };
  return value;
}
async function alertOwnerLlmFailure(supabase: any, input: any, errors: ProviderError[], source: string | undefined, log: any) {
  // So alerta no que e ACIONAVEL: sem credito (quota) ou chave invalida (auth). rate/other = transitorio.
  const actionable = (errors || []).filter((e) => e.kind === "quota" || e.kind === "auth");
  if (actionable.length === 0) return;
  // quota tem prioridade (caso mais comum: "acabaram os creditos").
  const kind = actionable.some((e) => e.kind === "quota") ? "quota" : "auth";
  const provider = (actionable.find((e) => e.kind === kind)?.provider) || "openai";
  const userId = input?.agent?.user_id || "unknown";

  // Log SEMPRE (independe de ter telefone): nossa observabilidade pega.
  log?.("error", source === "platform" ? "pedro_v2_platform_llm_failure" : "pedro_v2_client_llm_failure",
    { user_id: userId, source, kind, provider, errors: actionable.slice(0, 4) });

  const cacheKey = `${userId}:${kind}`;
  const now = Date.now();
  if (now - (_llmFailAlertCache.get(cacheKey) || 0) < 6 * 60 * 60 * 1000) return;

  // Destinatario: cliente -> gerente da conta; plataforma -> numero do dono (portal: platform_settings,
  // gerenciavel pelo superadmin; env PEDRO_PLATFORM_ALERT_PHONE so como override de emergencia).
  const rawPhone = source === "platform"
    ? await getPlatformAlertPhone(supabase)
    : input?.agent?.gerente_phone;
  const phone = normalizeAlertPhone(rawPhone);
  if (!phone || !input?.wa_instance) { _llmFailAlertCache.set(cacheKey, now); return; }
  _llmFailAlertCache.set(cacheKey, now);

  const provName = provider === "anthropic" ? "Anthropic (Claude)" : provider === "deepseek" ? "DeepSeek" : "OpenAI";
  let textMsg: string;
  if (source === "platform") {
    textMsg = kind === "quota"
      ? `🚨 *IA da PLATAFORMA sem crédito (${provName}).* O agente de uma conta atual (grandfathered) caiu pro modo limitado por falta de saldo na NOSSA chave. Recarregue o ${provName} para normalizar o atendimento de TODAS as contas atuais.`
      : `🚨 *Chave de IA da PLATAFORMA inválida (${provName}).* O agente caiu pro modo limitado. Verifique a chave ${provName} configurada no servidor.`;
  } else {
    textMsg = kind === "quota"
      ? `⚠️ *Sua chave de IA está sem crédito (${provName}).* Chegou um lead e o agente não conseguiu responder direito. Recarregue créditos na sua conta ${provName} para reativar o atendimento automático.`
      : `⚠️ *Sua chave de IA parece inválida (${provName}).* O agente não conseguiu responder. Revise a chave em *Administração → IA → Sua chave de IA*.`;
  }
  try {
    await sendPedroText(input.wa_instance, { to: phone, text: textMsg }, { humanize: false });
    log?.("info", "pedro_v2_llm_failure_alert_sent", { user_id: userId, source, kind, to: phone });
  } catch (_e) { /* nao bloqueia o turno */ }
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
  const raw = message?.senderName ||
    message?.notifyName ||
    message?.pushName ||
    payload?.chat?.name ||
    payload?.pushName ||
    payload?.senderName ||
    payload?.data?.pushName ||
    payload?.data?.senderName ||
    "";
  // Nome-LIXO do WhatsApp (pushName "$", ".", emoji, 1 letra) NAO vira lead_name: senao vaza em
  // "Bom dia $!" no follow-up e "Cliente: $" pro vendedor. Exige >=2 letras reais; senao default "Lead".
  return (String(raw).match(/\p{L}/gu) || []).length >= 2 ? String(raw).trim() : "Lead";
}

// normalizePlannerText / leadMessageHasExplicitPriceCeiling / leadMessageAsksBroadStock
// -> movidos p/ decisionLogic.ts (puros, test\u00e1veis offline). Importados no topo.

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

// ── CTWA AD em RAJADA (burst) ──────────────────────────────────────────────
// O externalAdReply (veiculo do anuncio) vem SO na 1a mensagem do clique. Quando o lead manda
// uma rajada ("Ola tenho interesse" + "Bom dia" + "Quantos km"), o debounce responde a ULTIMA,
// cujo payload NAO tem o anuncio -> ad_context vazio -> agente pergunta "qual modelo?" (bug real
// lead Pulse Audace 5512991196020). Solucao: ao salvar CADA mensagem, persistimos o anuncio
// (podado, sem thumbnail) no metadata; no turno final recuperamos do burst se o payload nao tiver.
function deepFindExternalAdReply(obj: any, depth = 0): any {
  if (!obj || typeof obj !== "object" || depth > 14) return null;
  if (obj.externalAdReply && typeof obj.externalAdReply === "object") return obj.externalAdReply;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") { const r = deepFindExternalAdReply(v, depth + 1); if (r) return r; }
  }
  return null;
}
// Mantem so os campos de TEXTO do anuncio (veiculo/preco/link); descarta thumbnail/blobs gigantes.
function pruneCtwaAd(ear: any): Record<string, any> | null {
  if (!ear || typeof ear !== "object") return null;
  const pick = (...ks: string[]) => { for (const k of ks) { const v = ear[k]; if (typeof v === "string" && v.trim()) return v.trim(); } return null; };
  const out: Record<string, any> = {
    greetingMessageBody: pick("greetingMessageBody", "greetingMessage", "greeting"),
    title: pick("title"),
    body: pick("body", "description"),
    sourceUrl: pick("sourceUrl", "source_url", "sourceURL", "mediaUrl"),
    sourceApp: pick("sourceApp"),
    sourceId: pick("sourceId", "source_id", "ad_id"), // ad_id real (Meta 2ª via via referral.source_id)
  };
  return Object.values(out).some(Boolean) ? out : null;
}
// Payload sintetico que resolvePedroAdContext sabe ler (externalAdReply no topo).
function payloadWithRecoveredAd(basePayload: any, prunedEar: Record<string, any>): any {
  return { ...(basePayload && typeof basePayload === "object" ? basePayload : {}), externalAdReply: prunedEar };
}
// Procura a 1a URL de imagem de ANUNCIO (fb/ig CDN) em qualquer lugar do payload. A foto do anuncio
// costuma vir como MEDIA da msg; restringir ao CDN de anuncios (fbcdn/scontent/cdninstagram/ads-image)
// evita pescar selfie/foto de perfil do lead (pps.whatsapp.net) e tratar como "carro do anuncio".
function _firstAdImageUrl(value: any, depth = 0): string | null {
  if (!value || depth > 8) return null;
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) && /(?:fbcdn|scontent|cdninstagram|\/ads\/image)/i.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const it of value) { const f = _firstAdImageUrl(it, depth + 1); if (f) return f; }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value)) { const f = _firstAdImageUrl(v, depth + 1); if (f) return f; }
  }
  return null;
}
// Injeta a imagem do anuncio em externalAdReply.thumbnailUrl (campo que resolvePedroAdContext varre)
// p/ a VISAO (gpt-4o le o carro DA IMAGEM) rodar. Preserva os campos do anuncio ja presentes e nao
// sobrescreve thumbnail/media existente (texto do anuncio com veiculo continua vencendo a visao).
function withAdImageThumbnail(payload: any, imageUrl: string): any {
  const ear = (deepFindExternalAdReply(payload)
    || (payload && typeof payload === "object" ? payload.externalAdReply : null)
    || {}) as Record<string, any>;
  if (ear.thumbnailUrl || ear.mediaUrl || ear.thumbnail) return payload; // ja tem imagem -> nao mexe
  return { ...(payload && typeof payload === "object" ? payload : {}), externalAdReply: { ...ear, thumbnailUrl: imageUrl } };
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
      // Folga de 30min no cutoff (fix relatorio mestre #5): se a webhook do Evolution/UAZAPI
      // atrasar para criar o lead, as 1as mensagens do cliente (que geraram o lead) caiam fora
      // do filtro temporal e o agente respondia "as cegas". Como ha order desc + limit(24),
      // alargar o cutoff nao traz historico antigo demais — so recupera as msgs iniciais.
      const cutoff = new Date(new Date(input.lead_created_at).getTime() - 30 * 60 * 1000).toISOString();
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
      const cutoff = new Date(new Date(input.lead_created_at).getTime() - 30 * 60 * 1000).toISOString();
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

// PhotoTarget + normalizePhotoText -> movidos p/ decisionLogic.ts (puros, test\u00e1veis offline).

// ── FLUXO DE FOTO / VEÍCULO -> movido p/ photoLogic.ts (puro, testável offline). Importado no topo. ──



// detectPhotoTarget / messageAsksForPhotos / requestedVehicleQueryForMediaGuard /
// queryIsBroadOrGenericVehicle -> movidos p/ decisionLogic.ts (puros, testáveis offline). Importados no topo.



async function savePresentedVehicles(supabase: any, input: {
  lead_id?: string | null;
  agent_id: string;
  user_id: string;
  current: any;
  vehicles: any[];
  listed_keys?: string[];
}) {
  if (!input.lead_id || !Array.isArray(input.vehicles) || input.vehicles.length === 0) return input.current || {};
  const nextState = {
    ...(input.current || {}),
    veiculos_apresentados: input.vehicles.slice(0, 30),
    veiculos_apresentados_at: new Date().toISOString(), // MEM-3: carimbo p/ TTL (nao servir pool velho)
    // CASO #2: chaves dos carros JA LISTADOS (acumulado) p/ "mais opcoes" trazer DIFERENTES.
    ...(Array.isArray(input.listed_keys) ? { opcoes_listadas_keys: input.listed_keys.slice(0, 40) } : {}),
    ultima_foto: null, // Limpa referencia de fotos antigas quando novos carros sao apresentados em texto
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
  // LEDGER DE FOTOS POR VEÍCULO (chave ESTÁVEL marca|modelo|ano, não depende de preço/km): registra que
  // ESTE veículo já foi fotografado, pra próximos turnos NÃO re-oferecerem foto dele (dor nº1 do dono).
  // ADITIVO: preserva o que já existe e NÃO toca em `ultima_foto` (que o fluxo atual usa). Lido por
  // photoCtaDecision/photosAlreadySentForVehicle (photoLogic).
  const _stableKey = stableVehicleKey(input.reply.vehicle);
  const _prevLedger = (input.current?.fotos_por_veiculo && typeof input.current.fotos_por_veiculo === "object")
    ? input.current.fotos_por_veiculo : {};
  const nextState = {
    ...(input.current || {}),
    ...(_stableKey ? {
      fotos_por_veiculo: {
        ..._prevLedger,
        [_stableKey]: { fotos_enviadas: fotosEnviadas, last_sent_at: new Date().toISOString() },
      },
    } : {}),
    ultima_foto: {
      veiculo_index: selectedIndex,
      veiculo_key: selectedKey,
      veiculo_stable_key: _stableKey || null,
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
// Janela maior para mensagens curtas/fragmentadas (ver debounceWindowMs).
const PEDRO_V2_DEBOUNCE_FRAGMENT_MS = 18000;

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Janela de debounce ADAPTATIVA. Mensagens curtas e sem pergunta ("ok", "vamos",
// "vê", "cobinado", "brigado"...) quase sempre vêm em RAJADA — o lead digita em
// pedaços com pausas de mais de 10s entre eles. Para agrupar tudo num turno só
// (e nao responder 2x), essas esperam mais. Mensagem "completa" (uma pergunta ou
// frase com >=4 palavras) mantem a janela padrao para resposta rapida.
function debounceWindowMs(text: string): number {
  const t = String(text || "").trim();
  const words = t.split(/\s+/).filter(Boolean).length;
  const isQuestion = /\?/.test(t);
  if (!isQuestion && words <= 3) return PEDRO_V2_DEBOUNCE_FRAGMENT_MS;
  return PEDRO_V2_DEBOUNCE_MS;
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

  // ── José v3.1: mensagem do DONO (responsável) ─────────────────────────────
  // O número do responsável NUNCA é lead. Trata texto/áudio/imagem do dono num só
  // lugar (gate SIM/NÃO, análise de criativo, ou José responde a pergunta). Se NÃO
  // for o dono, handled:false e segue o fluxo normal do Pedro. Em dry_run não roda;
  // qualquer erro aqui NÃO bloqueia o Pedro.
  if (!dryRun) {
    try {
      const owner = await handleOwnerMessage(supabase, {
        user_id: input.agent.user_id,
        agent_id: input.agent.id,
        payload: input.payload,
        remote_jid: remoteJid,
        text: rawText,
        instance: input.wa_instance,
      });
      if (owner.handled) {
        log("info", "jose_owner_message", { remote_jid: remoteJid, action: owner.action });
        return { ok: true, dry_run: dryRun, correlation_id: correlationId, next_action: "jose_owner_" + (owner.action || "handled") };
      }
    } catch (e) {
      log("warn", "jose_owner_message_error", { error: String((e as any)?.message || e) });
    }
  }

  log("info", "pedro_v2_turn_start", { remote_jid: remoteJid, dry_run: dryRun });

  const identity = await identifyPedroContact(supabase, {
    user_id: input.agent.user_id,
    agent_id: input.agent.id,
    remote_jid: remoteJid,
  });

  if (identity.kind === "seller") {
    // TRF-1: o vendedor so ASSUME o lead se a mensagem for um ACEITE de verdade ("Ok",
    // "assumo", "pode deixar", 👍...). Antes, QUALQUER mensagem do telefone do vendedor
    // (ate "quem e esse cliente?") confirmava a transferencia e atribuia o lead. Uma
    // duvida/pergunta do vendedor NAO pode atribuir o lead.
    const _sellerMsg = String(rawText || "").toLowerCase().trim();
    const _isSellerAck = /[👍✅🤝🙏]/.test(rawText || "")
      || /^\s*(ok+|okay|k|blz|beleza|sim|isso|fechado|fechou|show|bora|certo|combinado|positivo|confirmo|confirmado)\b/.test(_sellerMsg)
      || /\b(assumo|assumir|vou assumir|assumido|pode deixar|deixa comigo|deixa cmg|peguei|pego esse|pego ele|to indo|to nessa|vou atender|ja atendo|atendo ele|atendo esse|vou cuidar|cuido dele|consigo atender)\b/.test(_sellerMsg);
    const ack = await confirmSellerAck(supabase, {
      user_id: input.agent.user_id,
      agent_id: input.agent.id,
      seller_phone: identity.phone,
      commit: !dryRun && _isSellerAck,
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

  // ── BYOK GATE ──────────────────────────────────────────────────────────────
  // A conta pode usar IA? Resolve a chave de OpenAI (cliente > nossa-se-grandfathered > nenhuma).
  // Conta NOVA sem chave propria (source='none') NUNCA usa a nossa: nao roda NENHUMA chamada de
  // IA (visao/audio/planner/reply), alerta o dono 1x e encerra. Contas atuais (grandfathered) e
  // contas com chave propria seguem normal. O `_openaiKey`/`_aiKeyCtx` sao passados aos cerebros.
  const _allowPlatformAi = await isAccountGrandfathered(supabase, input.agent.user_id);
  const _openaiResolved = await resolveAiKey(supabase, input.agent.user_id, "openai", { allowPlatformFallback: _allowPlatformAi });
  if (_openaiResolved.source === "none") {
    if (!dryRun) { await alertOwnerNoAiKey(supabase, input, log); }
    log("info", "pedro_v2_no_ai_key_blocked", { user_id: input.agent.user_id });
    return {
      ok: true,
      dry_run: dryRun,
      correlation_id: correlationId,
      next_action: "no_ai_key_configured",
      ai_key_source: "none",
    };
  }
  const _openaiKey = _openaiResolved.key;
  // provider_errors: acumulador MUTAVEL do turno (reply/planner empurram falhas de IA aqui).
  const _aiKeyCtx: AiKeyCtx = { supabase, user_id: input.agent.user_id, allow_platform: _allowPlatformAi, openai_key: _openaiKey, source: _openaiResolved.source, provider_errors: [] };

  const mediaContext = await resolvePedroMediaContext(input.payload, input.wa_instance, _openaiKey);
  let text = mediaContext.kind === "audio" && mediaContext.text
    ? mediaContext.text
    : rawText;

  if (!text && mediaContext.has_media_context) {
    if (mediaContext.kind === "image") {
      text = "[imagem recebida]";
    } else if (mediaContext.kind === "audio") {
      text = "[áudio recebido]";
    } else if (mediaContext.kind === "video") {
      text = "[vídeo recebido]";
    } else if (mediaContext.kind === "document") {
      text = "[documento recebido]";
    } else {
      text = "[mídia recebida]";
    }
  }

  // RECUPERADOR (anti-sumiço): quando o cron `pedro-recover-dropped` reprocessa uma mensagem que ficou
  // sem resposta (turno original morto no debounce em background), ela JÁ está salva no histórico e o lead
  // JÁ parou de digitar — então PULA o save (não duplica a msg) e, como myUserMsgId fica null, o debounce
  // se auto-pula (processa direto). O resto do turno roda normal (planner/reply/envio/log).
  const _recovery = (input as any)?.recovery === true;
  // Salvar mensagem do usuário no histórico (transferências/CRM/debounce). Captura o id.
  let myUserMsgId: string | null = null;
  let myUserMsgCreatedAt: string | null = null;
  if (!dryRun && !_recovery && lead?.id && text) {
    try {
      // CTWA: guarda o anuncio (podado) no metadata p/ recuperar no turno final do burst (ver helpers).
      const _ctwaAd = pruneCtwaAd(deepFindExternalAdReply(input.payload));
      const userMetadata = (mediaContext.has_media_context || _ctwaAd) ? {
        ...(mediaContext.has_media_context ? {
          media: [{
            file: mediaContext.media_url || mediaContext.media_data_url || null,
            url: mediaContext.media_url || mediaContext.media_data_url || null,
            type: mediaContext.kind || "image",
            caption: mediaContext.text || ""
          }]
        } : {}),
        ...(_ctwaAd ? { ctwa_ad: _ctwaAd } : {}),
      } : null;

      const { data: insertedUserMsg } = await supabase.from("wa_chat_history").insert({
        user_id: input.agent.user_id,
        agent_id: input.agent.id,
        instance_id: input.wa_instance?.instance_name,
        remote_jid: remoteJid,
        role: "user",
        content: text,
        metadata: userMetadata,
      }).select("id, created_at").maybeSingle();
      myUserMsgId = insertedUserMsg?.id || null;
      myUserMsgCreatedAt = insertedUserMsg?.created_at || null;

      // Bloco D (Cabine de Comando): carimba a ORIGEM do anúncio no lead. ad_id é o
      // preciso (vem do referral.source_id da Meta 2ª via); ad_name é o título do CTWA
      // (UAZAPI só tem isso). Preenche só o que estiver nulo (idempotente). Atrás do flag.
      if ((_ctwaAd?.title || _ctwaAd?.sourceId) && await isFeatureEnabled(supabase, input.agent.user_id, "handoff_qualidade")) {
        try {
          if (_ctwaAd.sourceId) {
            await supabase.from("ai_crm_leads")
              .update({ ad_id: String(_ctwaAd.sourceId).trim() })
              .eq("id", lead.id).is("ad_id", null);
          }
          if (_ctwaAd.title) {
            await supabase.from("ai_crm_leads")
              .update({ ad_name: String(_ctwaAd.title).trim() })
              .eq("id", lead.id).is("ad_name", null);
          }
        } catch (_ec) { /* carimbo best-effort, nunca atrapalha o fluxo */ }
      }
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
    // DEBOUNCE PRESENCE-AWARE: alem de agrupar rajadas, ESPERA enquanto o lead esta DIGITANDO ou
    // GRAVANDO AUDIO (wa_lead_presence, alimentada pelo webhook via evento 'presence' do uazapi).
    // So responde quando ele PARA (sem msg nova + sem composing/recording) por >= a janela. Isso
    // resolve o caso do lead que grava audio 30-60s: o agente nao responde no meio.
    const _quietWindow = debounceWindowMs(text);
    const _instName = (input.wa_instance as any)?.instance_name || null;
    const _maxWaitMs = 45000;     // teto (evita segurar a function/webhook demais)
    const _pollMs = 3000;
    const _startTs = Date.now();
    let _quietSinceTs = Date.now();  // ultima atividade do lead; estende com presence ativo
    let _superseded = false;
    while (Date.now() - _startTs < _maxWaitMs) {
      await sleepMs(_pollMs);
      // 1) chegou mensagem MAIS NOVA do lead? -> esta invocacao silencia (a da nova responde o bloco)
      const { data: _latest } = await supabase
        .from("wa_chat_history").select("id")
        .eq("agent_id", input.agent.id).eq("remote_jid", remoteJid).eq("role", "user")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (_latest?.id && _latest.id !== myUserMsgId) { _superseded = true; break; }
      // 2) lead DIGITANDO/GRAVANDO agora? -> reseta o silencio (espera ele terminar)
      if (_instName) {
        try {
          const { data: _pres } = await supabase
            .from("wa_lead_presence").select("state, updated_at")
            .eq("instance_name", _instName).eq("remote_jid", remoteJid).maybeSingle();
          if (_pres && (String(_pres.state) === "composing" || String(_pres.state) === "recording")
              && (Date.now() - new Date(_pres.updated_at).getTime()) < 15000) {
            _quietSinceTs = Date.now();
          }
        } catch (_e) { /* sem tabela/erro -> ignora presence, segue no tempo fixo */ }
      }
      // 3) quieto (sem msg nova + sem digitar/gravar) por >= a janela -> responde
      if (Date.now() - _quietSinceTs >= _quietWindow) break;
    }
    if (_superseded) {
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

  // === REATIVACAO (Follow-up IA) — DETECCAO ANTECIPADA (antes dos bloqueios) ===
  // Decisao do dono: lead "cutucado" pelo motor de reativacao que VOLTOU a responder deve ser
  // RE-QUALIFICADO pela IA (nao pode ficar mudo) e, ao transferir de novo, vai pro MESMO vendedor
  // da 1a vez com selo "recuperado pelo follow-up" (ver linhas de handoff/briefing abaixo). Por
  // isso a deteccao roda AQUI, antes do ai_paused e do hold 24h — senao o turno morria muda.
  let reactivationRecovery = false;
  let reactivationSellerId: string | null = null;
  if (lead?.id && identity.kind !== "seller") {
    try {
      const { data: _react } = await supabase
        .from("pedro_followup_reactivation")
        .select("id, status")
        .eq("lead_id", lead.id)
        .maybeSingle();
      if (_react && (_react.status === "sent" || _react.status === "responded")) {
        reactivationRecovery = true;
        if (!dryRun && _react.status === "sent") {
          await supabase.from("pedro_followup_reactivation")
            .update({ status: "responded", responded_at: new Date().toISOString() })
            .eq("id", _react.id);
        }
        const { data: _lastT } = await supabase
          .from("ai_lead_transfers")
          .select("to_member_id")
          .eq("lead_id", lead.id)
          .not("to_member_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        reactivationSellerId = _lastT?.to_member_id || null;
      }
    } catch (_e) { /* deteccao de reativacao nao pode derrubar o turno */ }
  }
  // Lead RECUPERADO que estava pausado: a IA reassume pra re-qualificar -> DESPAUSA no banco (vale
  // pro turno inteiro/conversa, nao so este). So quando ha reativacao ativa (sinal explicito).
  if (reactivationRecovery && lead?.ai_paused) {
    if (!dryRun) {
      try { await supabase.from("ai_crm_leads").update({ ai_paused: false }).eq("id", lead.id); } catch (_e) { /* nao bloqueia */ }
    }
    (lead as any).ai_paused = false;
    log("info", "pedro_v2_reactivation_unpaused", { lead_id: lead.id });
  }

  // === CHECK AI_PAUSED CONTROL ===
  if (lead?.ai_paused && !reactivationRecovery) {
    console.log(`[PedroV2] IA pausada para ${remoteJid}. Mensagem gravada no historico, ignorando resposta automatica.`);
    return {
      ok: true,
      dry_run: dryRun,
      correlation_id: correlationId,
      identity,
      lead_id: lead?.id || null,
      next_action: "ai_paused",
    };
  }

  // === HOLD POS-TRANSFERENCIA (24h) ===
  // Regra do dono (revisada 04/06): DENTRO de 24h apos a transferencia, o agente avisa o
  // LEAD UMA UNICA VEZ que o consultor vai entrar em contato e DEPOIS FICA EM SILENCIO (nao
  // responde mais nada — senao vira loop infinito). NAO re-notifica o vendedor (e no mesmo
  // dia, ele ja sabe — evita o spam de "seu lead respondeu por aqui"). Passadas as 24h, o
  // lead e tratado NORMALMENTE (fluxo completo); se precisar transferir, o transferRouter
  // manda para o MESMO vendedor (returning_lead_renotify via assigned_to_id).
  // ownedLeadAssistantMode/assistantSellerName ficam SEMPRE false/null (modo assistente
  // desativado por decisao do dono) — mantidos so para compat das referencias abaixo.
  const ownedLeadAssistantMode = false;
  const assistantSellerName: string | null = null;
  // Reativacao (lead recuperado pelo follow-up) PULA o hold 24h: a IA precisa re-qualificar agora.
  if (lead?.id && identity.kind !== "seller" && !reactivationRecovery) {
    const { data: lastTransfer } = await supabase
      .from("ai_lead_transfers")
      .select("created_at, transfer_status, to_member_id")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const transferAtMs = lastTransfer?.created_at ? Date.parse(lastTransfer.created_at) : 0;
    // Transferencia FALHA/EXPIRADA/REJEITADA nao prende o lead -> fluxo normal.
    const _st = String(lastTransfer?.transfer_status || "").toLowerCase();
    const transferUsable = !["expired", "failed", "rejected", "canceled", "cancelled"].includes(_st);
    if (transferUsable && transferAtMs && (Date.now() - transferAtMs) < 24 * 60 * 60 * 1000) {
      // SILENCIO DE 30min APOS A TRANSFERENCIA (decisao do dono 2026-06-11): nos primeiros 30min
      // o agente NAO fala NADA com o lead nem re-notifica o vendedor — o lead se despedindo
      // ("valeu", "beleza", "obrigado") NAO recebe resposta (antes o agente repetia "voce esta com
      // um consultor" e soava robotico). So DEPOIS de 30min, se o lead mandar mensagem, o agente
      // avisa o lead 1x + notifica o vendedor 1x (bloco abaixo). Passadas 24h, fluxo normal.
      if ((Date.now() - transferAtMs) < 30 * 60 * 1000) {
        return {
          ok: true,
          dry_run: dryRun,
          correlation_id: correlationId,
          identity,
          lead_id: lead.id,
          next_action: "post_transfer_silence_30min",
        };
      }
      const _at = ((currentMemory as any)?.atendimento) || {};
      // Avisa o LEAD uma unica vez por transferencia (throttle via transfer_notice_at).
      const noticeAtMs = _at.transfer_notice_at ? Date.parse(_at.transfer_notice_at) : 0;
      const shouldNoticeLead = !(noticeAtMs && noticeAtMs >= transferAtMs);
      // Avisa o VENDEDOR (dono da transferencia) UMA UNICA VEZ que o lead voltou a
      // responder dentro das 24h (throttle via transfer_seller_renotified_at). Decisao do
      // dono: ele precisa saber que o lead mandou mensagem, mas so 1 aviso por transferencia.
      const sellerNotifiedAtMs = _at.transfer_seller_renotified_at ? Date.parse(_at.transfer_seller_renotified_at) : 0;
      const shouldNotifySeller = !(sellerNotifiedAtMs && sellerNotifiedAtMs >= transferAtMs);
      const _nowIso = new Date().toISOString();
      const _nextAt: Record<string, any> = { ..._at };
      if (!dryRun && (shouldNoticeLead || shouldNotifySeller) && isPedroV2SendingEnabled()) {
        const inst = input.wa_instance || await resolvePedroInstance(supabase, {
          user_id: input.agent.user_id, agent_id: input.agent.id, instance_id: input.wa_instance?.id,
        });
        // 1) LEAD: confirma 1x que o consultor vai entrar em contato.
        if (shouldNoticeLead) {
          await sendPedroText(inst, { to: remoteJidToPhone(remoteJid), text: "Seu atendimento já está com um dos nossos consultores de vendas, ele já vai entrar em contato com você. É só aguardar um momentinho! 😊" }).catch(() => {});
          _nextAt.transfer_notice_at = _nowIso;
        }
        // 2) VENDEDOR: avisa 1x que o lead respondeu (busca o dono da ultima transferencia).
        if (shouldNotifySeller && lastTransfer?.to_member_id) {
          try {
            const { data: _seller } = await supabase
              .from("ai_team_members").select("name, whatsapp_number")
              .eq("id", lastTransfer.to_member_id).maybeSingle();
            if (_seller?.whatsapp_number) {
              const _leadNm = lead.lead_name || pushName || "O lead";
              const _leadPh = remoteJidToPhone(remoteJid);
              const _sellerMsg = `🔔 *${_leadNm} voltou a responder*\nO lead que foi te encaminhado mandou mensagem agora. Da uma olhada quando puder.\n\n*Atender:* https://wa.me/${_leadPh}`;
              await sendPedroText(inst, { to: _seller.whatsapp_number, text: _sellerMsg }).catch(() => {});
              _nextAt.transfer_seller_renotified_at = _nowIso;
            }
          } catch (_e) { /* nao bloqueante */ }
        }
        // Grava as flags (lead + vendedor) de uma vez so.
        try {
          await supabase.from("pedro_conversation_state").upsert({
            lead_id: lead.id, agent_id: input.agent.id, user_id: input.agent.user_id,
            state: { ...(currentMemory || {}), atendimento: _nextAt },
            updated_at: _nowIso,
          }, { onConflict: "lead_id,agent_id" });
        } catch (_e) { /* nao bloqueante */ }
      }
      // SILENCIO: nao processa o resto do turno (o agente nao responde mais ate 24h).
      return {
        ok: true,
        dry_run: dryRun,
        correlation_id: correlationId,
        identity,
        lead_id: lead.id,
        next_action: "post_transfer_hold_24h",
      };
    }
  }

  // === FASE C — REATIVACAO (Follow-up IA) ===
  // A DETECCAO (reactivationRecovery + reactivationSellerId + marcar 'responded') foi movida pra
  // ANTES dos bloqueios ai_paused/hold-24h (ver acima), pra o lead recuperado nao morrer mudo.
  // Aqui o turno segue NORMAL: o cerebro requalifica; ao transferir, vai pro MESMO vendedor com o
  // selo "recuperado pelo follow-up" (preferred_seller_id/_recoveryTag mais abaixo).

  const intent = routePedroIntent({ message: text, current_memory: currentMemory });
  // CTWA em RAJADA: se o payload da vez NAO traz o anuncio (rajada respondida na ultima msg, sem
  // externalAdReply), recupera o anuncio salvo no metadata de uma msg recente do MESMO burst (ate
  // o ultimo turno do agente). Sem isso, "Ola tenho interesse"+"Bom dia"+"Quantos km" perdia o
  // veiculo do anuncio (bug real lead Pulse Audace).
  let _adResolvePayload = input.payload;
  // A IMAGEM do anuncio (fb/ig CDN) chega como MEDIA da msg (metadata.media), SEPARADA do TEXTO do
  // anuncio (ctwa_ad — pruneCtwaAd descarta o thumbnail ao salvar). A VISAO do adContext (gpt-4o le o
  // carro DA IMAGEM) so roda se a imagem chegar ao resolvePedroAdContext. Em anuncio de TEXTO GENERICO
  // ("Veiculos revisados") + imagem de um carro ESPECIFICO (ex.: foto de uma Hilux branca), sem a
  // imagem o agente NUNCA identifica o veiculo do anuncio e despeja lista generica (lead real 9742-6008).
  // Recupera a imagem (do payload atual OU do burst) e injeta no payload p/ a visao identificar o veiculo.
  let _adImageUrl: string | null = _firstAdImageUrl(input.payload);
  const _inlineAd = deepFindExternalAdReply(input.payload);
  if (lead?.id && (!_inlineAd || !_adImageUrl)) {
    try {
      const { data: _recent } = await supabase
        .from("wa_chat_history")
        .select("metadata, role, created_at")
        .eq("agent_id", input.agent.id).eq("remote_jid", remoteJid)
        .order("created_at", { ascending: false }).limit(12);
      for (const row of _recent || []) {
        if (String(row?.role) === "assistant") break; // so o burst atual (nao anuncio de conversa ja respondida)
        const _md = (row?.metadata as any) || {};
        if (!_adImageUrl) {
          const _u = _md?.media?.[0]?.url;
          if (typeof _u === "string" && /(?:fbcdn|scontent|cdninstagram|\/ads\/image)/i.test(_u)) _adImageUrl = _u;
        }
        if (!_inlineAd && _md?.ctwa_ad) {
          _adResolvePayload = payloadWithRecoveredAd(input.payload, _md.ctwa_ad);
          log("info", "pedro_v2_ctwa_ad_recovered_from_burst", { lead_id: lead.id });
          break; // ctwa_ad + imagem ficam na MESMA msg (1a do burst); a imagem ja foi capturada acima
        }
      }
    } catch (_e) { /* recuperacao best-effort: nunca derruba o turno */ }
  }
  // Garante que a imagem do anuncio chegue ao adContext (thumbnailUrl) p/ a visao rodar no anuncio generico+imagem.
  if (_adImageUrl && deepFindExternalAdReply(_adResolvePayload)) {
    _adResolvePayload = withAdImageThumbnail(_adResolvePayload, _adImageUrl);
  }
  // BLINDAGEM: o enriquecimento do anuncio (fetch da pagina FB + inferencia LLM) e OPCIONAL — se
  // lancar, NUNCA pode derrubar o turno (lead de anuncio ficaria SEM resposta, caso real Maria Rosa/
  // Onix). Em falha, segue SEM ad_context (o agente ainda responde a mensagem do lead).
  let _resolvedAd: any;
  try {
    _resolvedAd = await resolvePedroAdContext(_adResolvePayload, text, _openaiKey);
  } catch (_adErr) {
    log("warn", "pedro_v2_ad_context_failed", { lead_id: lead?.id || null, error: String((_adErr as any)?.message || _adErr).slice(0, 300) });
    _resolvedAd = { has_ad_context: false, source: null, url: null, title: null, description: null, raw_text: null, vehicle_query: null, vehicle_type: null, summary: null, confidence: 0 };
  }
  const adContext = mergeAdAndMediaContext(_resolvedAd, mediaContext);
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
  // PLANO A (enriquecer o cérebro): o que o lead REJEITOU. Computa ANTES do planner pra ele NÃO
  // re-oferecer + ler "não, o outro" certo. Mutável em currentMemory -> planner e reply veem neste turno.
  (currentMemory as any).rejeitados = updateRejeitados(text, (currentMemory as any)?.veiculos_apresentados, (currentMemory as any)?.rejeitados);
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
    audit: { client: supabase, userId: input.agent.user_id, agentId: input.agent.id, agentName: input.agent.name },
    ai_key_ctx: _aiKeyCtx,
    // Override de provedor do cerebro SO em dry-run (testes A/B de DeepSeek vs OpenAI sem
    // afetar trafego real). Em producao usa o env PEDRO_PLANNER_PROVIDER (default OpenAI).
    planner_provider: dryRun ? (input.payload?.planner_provider ?? null) : null,
    planner_model: dryRun ? (input.payload?.planner_model ?? null) : null,
  });
  if (adContext?.has_ad_context && adContext?.vehicle_query && brainPlan?.search_filters?.preco_max && !leadMessageHasExplicitPriceCeiling(text)) {
    brainPlan.search_filters.ad_price = brainPlan.search_filters.preco_max;
    delete brainPlan.search_filters.preco_max;
  }
  // PLANO A: lead AGORA pede explicitamente o que rejeitou (mudou de ideia) -> tira da lista de rejeitados.
  if ((brainPlan as any)?.search_query) {
    (currentMemory as any).rejeitados = clearRejeitadoOnRequest((currentMemory as any).rejeitados, (brainPlan as any).search_query);
  }
  // MODO ASSISTENTE: lead com vendedor dono NUNCA recebe foto do agente (roteia pro
  // vendedor) nem handoff de rodizio (ja tem dono). Rebaixa para reply_only.
  if (ownedLeadAssistantMode) {
    if (brainPlan.action === "photo_request") {
      brainPlan.action = "reply_only";
      brainPlan.use_memory_vehicle = false;
      brainPlan.reason = `assistant_mode_route_photos_to_seller:${brainPlan.reason || ""}`;
    } else if (brainPlan.action === "handoff") {
      brainPlan.action = "reply_only";
      brainPlan.reason = `assistant_mode_no_requalify_handoff:${brainPlan.reason || ""}`;
    }
  }
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
  // PLANO A: carrega rejeitados pro nextMemory -> o REPLY usa neste turno e a persistência final salva.
  (nextMemory as any).rejeitados = (currentMemory as any).rejeitados;

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
    ? buildStockFilters(contextualIntent, nextMemory, enrichedText, brainPlan, vehicleResolution, {
        lead_message: text,
        ad_context: adContext,
      })
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

    // marca_required (Pilar B): marca explicita ("so se for Honda") NAO e busca ampla — senao este
    // bloco ZERA a query ("honda") e liga stock_broad, e a busca vira sedan generico de qualquer marca.
    const broadStockIntent = !(stockFilters as any).marca_required
      && Boolean((stockFilters as any).stock_broad || leadMessageAsksBroadStock(text));
    if (broadStockIntent) {
      isGenericQuery = false;
      (stockFilters as any).stock_broad = true;
      (stockFilters as any).query = "";
      // Mesma raiz do bloco de buildStockFilters: numa busca de CATEGORIA, ad_context (frase do
      // lead / blob do anuncio) nao pode agir como filtro DURO de match — senao zera o pool cheio.
      (stockFilters as any).ad_context = "";
      (stockFilters as any).contexto_anuncio = "";
    }

    // CRITERIO DE PRECO/SEGMENTO ("mais economico/barato/popular/em conta/basico")
    // NAO e busca generica — e pedido dos carros MAIS EM CONTA. Forca a busca
    // ampla (o stockSearch ja ordena por PRECO CRESCENTE -> mais baratos primeiro)
    // em vez de devolver "pergunte qual modelo". Antes, "carro mais economico"
    // virava query "carro" -> generico -> 0 resultados -> "nao temos".
    // RAIZ de "lidera com o carro errado em lead de anuncio": o _budgetText usava enrichedText
    // (mensagem + CORPO DO ANUNCIO). O corpo do anuncio costuma dizer "otimo custo-beneficio",
    // "precos acessiveis" etc. -> casava budgetIntent (/custo|acessiv|barat/) e ativava o modo
    // "mais barato" (budget_cheapest), que ordena por preco CRESCENTE e desliga o "liderar com o
    // ano do anuncio" -> o agente abria com a unidade mais VELHA/barata em vez da do anuncio.
    // O "quero o mais barato" e do LEAD, nunca do texto promocional do anuncio -> usa SO `text`.
    const _budgetText = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const budgetIntent = /\b(economic|barat|popular|basic|baratinh|acessiv|custo)/.test(_budgetText) || /\bem\s+conta\b/.test(_budgetText);
    if (budgetIntent) {
      isGenericQuery = false;
      (stockFilters as any).budget_cheapest = true;
    }

    // CARROCERIA EXPLICITA (fix v62): so quando o lead ESCREVEU a palavra de carroceria.
    // Vira filtro de RANKING (scoreVehicle +40/-25), NUNCA de busca/eliminacao. Captura
    // PALAVRAS DE CARROCERIA APENAS — nome de modelo jamais entra aqui (senao reintroduz
    // o bug do "polo" eliminar o Polo Sedan, fix v61). A busca-ampla de alternativas NAO
    // herda body_type (ela monta filtros do zero, sem spread de stockFilters).
    let _bodyType: string | null = null;
    if (/\b(suv|utilitario)\b/.test(_budgetText)) _bodyType = "suv";
    else if (/\b(sedan|seda|tres volumes|3 volumes)\b/.test(_budgetText)) _bodyType = "sedan";
    else if (/\b(hatch|hatchback)\b/.test(_budgetText)) _bodyType = "hatch";
    else if (/\b(picape|pickup|caminhonete|camionete|cabine dupla)\b/.test(_budgetText)) _bodyType = "pickup";
    if (_bodyType) (stockFilters as any).body_type = _bodyType;

    // ORCAMENTO/ATRIBUTO SEM MODELO (perde-lead grave): "carro ate 40 mil", "automatico ate 70k",
    // "me indica algo ate 80 mil" — o lead chega so com FAIXA DE PRECO ou ATRIBUTO (cambio/tipo),
    // sem citar modelo. NAO e generico: tem que MOSTRAR os carros na faixa, NAO pedir um modelo.
    // Busca ampla ordenada por preco (mais em conta primeiro) com os filtros que ele deu.
    const _hasBudgetOrAttr = Number((stockFilters as any).preco_max) > 0
      || (stockFilters as any).cambio
      || (stockFilters as any).body_type;
    const _hasRealModel = Boolean(((stockFilters as any).modelo_desejado && !isWeak) || (stockFilters as any).marca);
    if (isGenericQuery && _hasBudgetOrAttr && !_hasRealModel) {
      isGenericQuery = false;
      (stockFilters as any).query = "";
      (stockFilters as any).modelo_desejado = null;
      (stockFilters as any).budget_cheapest = true;
      // cambio como FILTRO DURO zerava o estoque (ex.: "automatico ate 70k" -> 0). Vira
      // preferencia do reply (ele apresenta os automaticos dos resultados), nao elimina.
      (stockFilters as any).cambio = null;
    }
  }

  // MAIS BARATO (cheaper_followup do planner): o lead achou o carro em foco caro e quer
  // opcoes mais em conta. A busca AMPLA normal ZERA nesses leads porque buildStockFilters
  // mistura ad_context (blob do anuncio/conversa) + interesse velho no query -> vira filtro
  // estrito de modelo. Aqui LIMPAMOS tudo e fazemos busca limpa por TIPO+PRECO (mesmo caminho
  // comprovado da recuperacao por tipo+preco). caso real 5512974108975 (Polo 110k, budget 70k).
  if (stockFilters && (brainPlan?.search_filters as any)?.cheaper_followup) {
    const _t = String((brainPlan.search_filters as any).tipo_veiculo || "").toLowerCase();
    const _tipo = ["hatch", "sedan", "suv", "pickup"].includes(_t) ? _t : null;
    const _pmax = Number((brainPlan.search_filters as any).preco_max) || null;
    const sf = stockFilters as any;
    sf.query = "";
    sf.modelo_desejado = null; sf.modelo = null; sf.marca = null; sf.versao = null;
    sf.ano = null; sf.ano_min = null; sf.ano_max = null;
    sf.cor = null; sf.cambio = null; sf.combustivel = null;
    sf.ad_context = ""; sf.contexto_anuncio = ""; sf.stock_broad = false;
    sf.tipo_veiculo = _tipo;
    if (_tipo) sf.body_type = _tipo;
    sf.budget_cheapest = true;
    if (_pmax) sf.preco_max = _pmax; else delete sf.preco_max;
    isGenericQuery = false;
  }

  // EST-3: pedido de MOTO. A loja (Icom) trabalha SO com carros. "moto" caia na busca generica
  // e o reply chegava a dizer "Trabalhamos sim!" (confirmando falsamente que vende moto). Detecta
  // o pedido de moto e responde com clareza que e so carro, sem cair no "que tipo de carro?".
  const _motoText = `${String(stockFilters?.query || "")} ${String(text || "")}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const _isMotoRequest = /\b(moto|motos|motoca|motocicleta|motocicletas|scooter|lambreta)\b/.test(_motoText);
  // Capacidade POR AGENTE: a loja vende motos? (wa_ai_agents.sells_motorcycles, default false).
  // Override de dry-run (payload.sells_motorcycles) p/ testar sem o agente do cliente configurado.
  const _sellsMotos = (input.agent as any)?.sells_motorcycles === true
    || (dryRun && (input.payload as any)?.sells_motorcycles === true);
  const _stockFeedOverride = dryRun ? ((input.payload as any)?.stock_feed_url ?? null) : null;
  if (stockFilters && _isMotoRequest && !_sellsMotos) {
    // Loja CAR-ONLY: recusa moto com clareza (sem cair no "que tipo de carro?").
    stockResult = {
      success: true,
      total: 0,
      items: [],
      is_moto_request: true,
      response_guidance: "INSTRUCAO INTERNA (NUNCA cite jargao tecnico): o lead perguntou sobre MOTO, mas a loja trabalha SOMENTE com CARROS. Responda com clareza e simpatia que aqui e so carro (nao temos motos) e, se ele quiser, voce ajuda a achar um carro. NUNCA confirme que vendemos moto nem pergunte 'que tipo de carro' como se ele tivesse pedido um carro.",
    };
  } else if (stockFilters && _isMotoRequest && _sellsMotos) {
    // Loja que VENDE moto: busca REAL de motos (tipo_veiculo='moto' -> so motos). REMOVE a
    // palavra-TIPO "moto" da query/modelo (senao vira termo de MODELO e o strict-match
    // descarta a moto, que nao tem "moto" no nome -> 0 resultados). Modelo especifico
    // ("biz", "cb 500") permanece e busca a moto certa; "tem moto?" generico -> todas as motos.
    const _motoModel = String(stockFilters.query || stockFilters.modelo_desejado || stockFilters.modelo || "")
      .replace(/\b(moto|motos|motoca|motocicleta|motocicletas|scooter|lambreta)\b/gi, "")
      .replace(/\s+/g, " ").trim();
    stockResult = await searchPedroStock(supabase, {
      user_id: input.agent.user_id,
      query: _motoModel,
      filters: { ...stockFilters, tipo_veiculo: "moto", query: _motoModel, modelo: _motoModel || undefined, modelo_desejado: _motoModel || undefined },
      limit: 24,
      sells_motorcycles: true,
      match_engine: dryRun ? ((input.payload as any)?.match_engine ?? null) : null,
      stock_feed_url: _stockFeedOverride,
    } as any);
  } else if (stockFilters && !isGenericQuery) {
    stockResult = await searchPedroStock(supabase, {
      user_id: input.agent.user_id,
      query: stockFilters.query,
      filters: stockFilters,
      limit: 24,
      // Loja que vende moto mantem motos no pool; car-only filtra (default).
      sells_motorcycles: _sellsMotos,
      // B3 sombra: override do motor SO no dry-run (prod usa o env PEDRO_FF_NEW_MATCH).
      match_engine: dryRun ? ((input.payload as any)?.match_engine ?? null) : null,
      // Override de fonte de estoque SO no dry-run: testa RevendaMais (feed JSON) sem precisar
      // da integracao gravada nem do agente do cliente novo. Em prod a fonte vem da integracao.
      stock_feed_url: _stockFeedOverride,
    } as any);
  } else if (stockFilters && isGenericQuery) {
    stockResult = {
      success: true,
      total: 0,
      items: [],
      is_generic_query: true,
      query: stockFilters.query,
      response_guidance: "INSTRUCAO INTERNA (NUNCA repita nem mencione isto ao cliente): o cliente ainda nao disse um modelo/tipo especifico. Pergunte de forma natural e acolhedora, como um vendedor humano, que tipo de carro ele procura (ex.: 'Que tipo de carro voce ta buscando? Tipo um SUV, sedan, hatch, ou tem algum modelo em mente?'). PROIBIDO dizer 'busca generica', 'busca ampla', 'estoque', 'sistema' ou qualquer termo tecnico — fale 100% como gente.",
    };
  }

  // MULTI-MODELO ("A ou B" / "A, B") — PROATIVO: o lead citou VARIOS modelos, mas o planner so
  // poe UM no search_query. Sem isso, "compass ou onix" (os dois no estoque) mostra SO o Onix.
  // Busca CADA modelo citado e JUNTA com o resultado primario -> apresenta TODOS que existem.
  // So em mensagem CURTA de escolha de modelo (evita falso positivo em frase comum).
  const _hadModelQuery = Boolean(stockFilters && ((stockFilters as any).modelo_desejado || (stockFilters as any).modelo || (stockFilters as any).marca));
  // marca_required (Pilar B) = restricao de marca UNICA ("so se for Honda"), NAO multi-modelo —
  // sem a guarda, a virgula em "quero um sedan, so se for honda" dispara sub-buscas genericas
  // que sobrepoem o resultado correto da marca.
  if (stockFilters && !isGenericQuery && _hadModelQuery && !(stockFilters as any)?.marca_required
      && normalizePhotoText(text).split(/\s+/).filter(Boolean).length <= 6
      && /(?:\bou\b|\/|,|\be\b)/i.test(text)) {
    const _mmParts = text.split(/\s+ou\s+|\s*\/\s*|\s*,\s*|\s+e\s+/i)
      .map((s) => s.trim())
      .filter((s) => s.length >= 3 && s.length <= 25);
    if (_mmParts.length >= 2) {
      const _merged: any[] = Array.isArray(stockResult?.items) ? [...stockResult.items] : [];
      const _seen = new Set<string>(_merged.map((v) => vehicleKey(v)).filter(Boolean) as string[]);
      let _addedNew = false;
      const _absentParts: string[] = [];
      for (const part of _mmParts.slice(0, 4)) {
        const _r = await searchPedroStock(supabase, { user_id: input.agent.user_id, query: part, limit: 6 });
        const _items = (_r?.success && Array.isArray(_r.items)) ? (_r.items as any[]) : [];
        // Modelo pedido que NAO existe no estoque (busca estrita = 0). Precisa ir EXPLICITO pro
        // reply, senao ele assume que "temos os dois" so porque o lead citou (bug Tcross+Compass).
        if (_items.length === 0) {
          _absentParts.push(part);
        } else {
          for (const v of _items) {
            const k = vehicleKey(v);
            if (k && !_seen.has(k)) { _seen.add(k); _merged.push(v); _addedNew = true; }
          }
        }
      }
      // Sobrescreve tambem quando ALGUM modelo pedido esta AUSENTE (mesmo sem adicionar novo):
      // e o caso "Tcross ou Compass" em que so Compass existe e o reply precisa dizer que NAO
      // temos o T-Cross em vez de alucinar "temos os dois".
      if (_merged.length > 0 && (_addedNew || (stockResult?.items?.length || 0) === 0 || _absentParts.length > 0)) {
        // INTERCALA por modelo (round-robin): sem isso o _merged fica [modeloA x N, modeloB x M]
        // e o reply, que mostra ~5, traz so o modeloA e SOTERRA o modeloB (lead pede "compass OU
        // renegade" e ve so Renegade). Intercalado, os primeiros itens ja misturam os dois.
        const _byModel = new Map<string, any[]>();
        for (const v of _merged) {
          const _mk = String((v as any).modelo || "").toLowerCase().trim().split(/\s+/)[0] || "outro";
          if (!_byModel.has(_mk)) _byModel.set(_mk, []);
          _byModel.get(_mk)!.push(v);
        }
        const _interleaved: any[] = [];
        for (let _i = 0, _more = true; _more; _i++) {
          _more = false;
          for (const _arr of _byModel.values()) {
            if (_i < _arr.length) { _interleaved.push(_arr[_i]); _more = true; }
          }
        }
        const _absentTxt = _absentParts.length > 0
          ? ` ATENCAO: NAO temos em estoque: ${_absentParts.join(", ")}. Diga CLARAMENTE que esse(s) NAO temos no momento — NUNCA afirme que temos — e ofereca os que existem aqui como alternativa.`
          : " Se ALGUM modelo pedido NAO aparece aqui, diga so daquele que nao temos.";
        stockResult = {
          success: true, total: _interleaved.length, items: _interleaved,
          response_guidance: `O lead pediu MAIS DE UM modelo. ESTES sao os que temos no estoque (ja intercalados entre os modelos) — apresente os de CADA modelo de forma CURTA e pergunte qual interessa / se quer ver fotos.${_absentTxt} NUNCA diga que nao temos NENHUM.`,
        };
        log("info", "pedro_v2_multimodel_merge", { parts: _mmParts.slice(0, 4), total: _interleaved.length, absent: _absentParts });
      }
    }
  }

  // ── PILAR B: marca_required + busca principal ZEROU. A unidade da marca pode nao casar a
  // carroceria estrita (ex.: Honda City subcat "unknown" some quando tipo=sedan). Re-busca SO a
  // MARCA (sem tipo) — fica DENTRO da marca pedida (acha a Honda City que existe), NUNCA cai em
  // outras marcas. Se nem assim achar, fica vazio e o grounding/reply trata com honestidade.
  if (stockFilters && (stockFilters as any).marca_required && (stockFilters as any).marca
      && stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length === 0) {
    const _hr = await searchPedroStock(supabase, {
      user_id: input.agent.user_id,
      query: String((stockFilters as any).marca),
      filters: { marca: String((stockFilters as any).marca), marca_required: true },
      limit: 12,
    } as any);
    if (_hr?.success && Array.isArray(_hr.items) && _hr.items.length > 0) stockResult = _hr;
  }

  // SEARCH-AND-RETRY (fix relatorio mestre / Falha 5 - Edison): a busca ESPECIFICA nao
  // achou nada -> NAO encerra de maos vazias. Faz uma 2a busca AMPLA (mesma categoria e/ou
  // teto de preco, SEM o modelo/marca) e oferece os parecidos como ALTERNATIVA, em vez de
  // "nao temos" + pular pro funil de pagamento. O searchPedroStock ja ordena por preco
  // crescente (mais em conta primeiro). So dispara quando havia um modelo/marca especifico.
  // marca_required NAO entra aqui (ja tratada acima — nunca oferece outras marcas).
  if (stockFilters && !isGenericQuery && !(stockFilters as any).marca_required && stockResult?.success
      && Array.isArray(stockResult.items) && stockResult.items.length === 0) {
    const _hadSpecificModel = Boolean((stockFilters as any).modelo_desejado || (stockFilters as any).modelo || (stockFilters as any).marca);
    const _broadType = (stockFilters as any).tipo_veiculo || null;
    const _broadPriceMax = Number((stockFilters as any).preco_max) || null;
    const _q = String((stockFilters as any).query || (stockFilters as any).modelo_desejado || (stockFilters as any).marca || "");
    const _brandMatch = _q.match(/\b(fiat|volkswagen|vw|chevrolet|gm|ford|toyota|honda|hyundai|renault|nissan|peugeot|citroen|jeep|mitsubishi|kia|bmw|mercedes|audi|volvo|land\s*rover|mini|ram|dodge|chery|caoa|byd|gwm|suzuki|subaru)\b/i);
    // Tipo REAL (sedan/suv/hatch/pickup) pedido pelo lead. Quando ha, a recuperacao por MESMO TIPO
    // (estagio 2) e melhor que por MARCA (estagio 1): "corolla"(sedan) sem estoque deve oferecer outros
    // SEDANS, nao qualquer Toyota (a marca trazia a Hilux/picape pra quem pediu um Corolla).
    const _realType = ["sedan", "suv", "hatch", "pickup"].includes(String(_broadType || "").toLowerCase());
    let _alt: any = null;
    let _altIsBrand = false;
    let _altMulti = false;
    let _altOverBudget = false; // alternativas ACIMA da faixa pedida (so quando nada cabe no teto)
    // ESTAGIO 0 — MULTI-MODELO ("A ou B"): o lead citou MAIS DE UM modelo e o planner so
    // pegou UM (as vezes o que NAO existe), dizendo "nao temos" pro outro que TEM. Ex.:
    // "Tcross ou compass" -> planner pega T-Cross (0) e perde o Compass (4 no estoque). Busca
    // CADA modelo citado e junta os que existem. So em mensagem CURTA de escolha de modelo.
    if (_hadSpecificModel
        && normalizePhotoText(text).split(/\s+/).filter(Boolean).length <= 6
        && /(?:\bou\b|\/|,|\be\b)/i.test(text)) {
      const _parts = text.split(/\s+ou\s+|\s*\/\s*|\s*,\s*|\s+e\s+/i)
        .map((s) => s.trim())
        .filter((s) => s.length >= 3 && s.length <= 25);
      if (_parts.length >= 2) {
        const _combined: any[] = [];
        for (const part of _parts.slice(0, 4)) {
          const _r = await searchPedroStock(supabase, { user_id: input.agent.user_id, query: part, limit: 6 });
          if (_r?.success && Array.isArray(_r.items)) _combined.push(...(_r.items as any[]));
        }
        const _seen = new Set<string>();
        const _uniq: any[] = [];
        for (const v of _combined) {
          const k = vehicleKey(v);
          if (k && !_seen.has(k)) { _seen.add(k); _uniq.push(v); }
        }
        if (_uniq.length > 0) { _alt = { success: true, items: _uniq }; _altMulti = true; }
      }
    }
    // ESTAGIO 1 — recuperacao por MARCA: a query especifica pode ter vindo contaminada (burst/nome,
    // ex.: "Peugeot Erick" -> 0). Se ha uma marca conhecida, busca SO a marca e apresenta como RESPOSTA.
    if (!_alt && _hadSpecificModel && _brandMatch && !_realType) {
      const _br = await searchPedroStock(supabase, { user_id: input.agent.user_id, query: _brandMatch[0], limit: 6 });
      if (_br?.success && Array.isArray(_br.items) && _br.items.length > 0) { _alt = _br; _altIsBrand = true; }
    }
    // ESTAGIO 2 — parecidos por CATEGORIA, reordenados por RELEVANCIA (anti "Pajero 2013 pra
    // T-Cross"): o searchPedroStock devolve do MAIS BARATO, e o 1o costuma ser um carro VELHO/
    // fora do perfil do modelo pedido (que veio de anuncio = quase sempre recente). Ancora de
    // preco = orcamento do lead OU preco do anuncio; COM ancora, prioriza os mais PROXIMOS dela;
    // SEM ancora, prioriza os mais RECENTES (mais barato so como desempate).
    if (!_alt && _hadSpecificModel && (_broadType || _broadPriceMax)) {
      const _anchorPrice = Number(_broadPriceMax) || Number((stockFilters as any).ad_price) || 0;
      const _capMax = _broadPriceMax || (_anchorPrice > 0 ? Math.round(_anchorPrice * 1.25) : null);
      const _by = await searchPedroStock(supabase, { user_id: input.agent.user_id, query: "", filters: { tipo_veiculo: _broadType, preco_max: _capMax, ...(_broadPriceMax ? { hard_price_ceiling: true } : {}) }, limit: 12 });
      if (_by?.success && Array.isArray(_by.items) && _by.items.length > 0) {
        const _its = [...(_by.items as any[])];
        if (_anchorPrice > 0) {
          // Com orcamento/preco do anuncio: respeita o budget — mais PROXIMOS do preco-ancora.
          _its.sort((a, b) => Math.abs((Number(a.preco) || _anchorPrice) - _anchorPrice) - Math.abs((Number(b.preco) || _anchorPrice) - _anchorPrice));
        } else {
          // SEM orcamento -> ESPIRITO VENDEDOR: lidera com os similares MAIS CAROS/premium (upsell),
          // ja que o lead pediu um modelo especifico (ex.: Cruze LTZ) e nao limitou preco. Assim
          // oferece o Virtus antes do Onix Sedan basico. Recencia desempata; carro sem preco vai pro fim.
          _its.sort((a, b) => (Number(b.preco) || 0) - (Number(a.preco) || 0) || (Number(b.ano) || 0) - (Number(a.ano) || 0));
        }
        _alt = { ..._by, items: _its.slice(0, 6) };
      }
    }
    // ESTAGIO 3 — fallback GERAL: ainda 0 -> mostra alguns carros do estoque. A loja SEMPRE tem
    // estoque; o agente nunca pode encerrar com "nao temos" sem oferecer alternativas reais.
    // COM orcamento explicito, RESPEITA o teto (hard_price_ceiling): nada de oferecer carro 40%
    // acima do que o lead pediu (bug real "corolla ate 50 mil" -> Pajero 60990). So se NAO houver
    // NADA na faixa cai p/ o estoque geral, e ai marca _altOverBudget p/ a guidance ser honesta.
    if (!_alt && _hadSpecificModel) {
      if (_broadPriceMax) {
        const _inBudget = await searchPedroStock(supabase, { user_id: input.agent.user_id, query: "", filters: { preco_max: _broadPriceMax, hard_price_ceiling: true }, limit: 6 });
        if (_inBudget?.success && Array.isArray(_inBudget.items) && _inBudget.items.length > 0) _alt = _inBudget;
      }
      if (!_alt) {
        const _any = await searchPedroStock(supabase, { user_id: input.agent.user_id, query: "", filters: {}, limit: 6 });
        if (_any?.success && Array.isArray(_any.items) && _any.items.length > 0) { _alt = _any; if (_broadPriceMax) _altOverBudget = true; }
      }
    }
    if (_alt?.success && Array.isArray(_alt.items) && _alt.items.length > 0) {
      const _wanted = (stockFilters as any).query || (stockFilters as any).modelo_desejado || "o que voce pediu";
      const _alts = _alt.items.slice(0, 4);
      stockResult = _altMulti
        ? {
            success: true, total: _alts.length, items: _alts, is_alternatives: false,
            response_guidance: `Dos modelos que o lead pediu, ESTES existem no estoque — apresente-os de forma CURTA e pergunte qual interessa. Se ALGUM dos pedidos nao apareceu aqui, diga so daquele especifico que nao temos. NUNCA diga que nao temos NENHUM quando ha estes aqui.`,
          }
        : _altIsBrand
        ? {
            success: true, total: _alts.length, items: _alts, is_alternatives: false,
            response_guidance: `Estes sao os ${_brandMatch![0]} disponiveis no estoque. Apresente-os de forma CURTA e pergunte qual interessa. NUNCA diga que nao temos.`,
          }
        : _altOverBudget
        ? {
            success: true, total: _alts.length, items: _alts, is_alternatives: true,
            response_guidance: `NAO temos "${_wanted}" dentro da faixa de ate R$${Number(_broadPriceMax)} que o lead pediu. Estes estao um pouco ACIMA dessa faixa — apresente-os com HONESTIDADE, deixando claro que estao acima do valor que ele falou, e pergunte se ele consegue esticar um pouco o orcamento OU se prefere algo mais em conta. NUNCA finja que cabem no valor pedido nem esconda que estao acima.`,
          }
        : {
            success: true, total: _alts.length, items: _alts, is_alternatives: true,
            response_guidance: `NAO temos exatamente "${_wanted}", mas ofereca ESTES como ALTERNATIVA de forma CURTA e pergunte se quer ver algum. NUNCA encerre dizendo apenas que nao temos.`,
          };
      log("info", "pedro_v2_search_recovery", { wanted: String(_wanted).slice(0, 40), brand: _altIsBrand, alternatives: _alts.length });
    }
  }

  // LIDERAR COM O ANO DO ANUNCIO / MAIS NOVO (decisao do dono 2026-06-13). Caso real Creta
  // (5512997147533): anuncio era 2025, mas o agente abriu com a unidade 2019 (mais barata).
  // Quando o modelo pedido tem 2+ unidades E o lead veio de ANUNCIO E NAO deu orcamento, lidera
  // com a unidade do ANO DO ANUNCIO (se existir) senao com a MAIS NOVA (espirito vendedor).
  // NAO mexe em: alternativas (recuperacao tem ordem propria), multi-modelo ("A ou B"), ou
  // quando o lead deu faixa de preco (ai preco manda). Falha-segura (try/catch).
  try {
    const _multiModelText = /(?:\bou\b|\/|,)/i.test(text) && normalizePhotoText(text).split(/\s+/).filter(Boolean).length <= 6;
    const _leadHasBudget = leadMessageHasExplicitPriceCeiling(text) || Number((stockFilters as any)?.preco_max) > 0;
    const _isSpecificModel = Boolean(stockFilters && ((stockFilters as any).modelo_desejado || (stockFilters as any).query)
      && !(stockFilters as any).stock_broad && !(stockFilters as any).budget_cheapest
      && !(brainPlan?.search_filters as any)?.cheaper_followup);
    const _fromAd = Boolean(adContext?.has_ad_context || memory?.referencia?.origem_anuncio || memory?.referencia?.veiculo_citado);
    if (_isSpecificModel && _fromAd && !_leadHasBudget && !_multiModelText
        && stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length >= 2
        && !(stockResult as any).is_alternatives) {
      const _adStr = String(adContext?.vehicle_query || memory?.referencia?.veiculo_citado || "");
      const _adYearM = _adStr.match(/\b(19|20)\d{2}\b/);
      const _adYear = _adYearM ? Number(_adYearM[0]) : null;
      const _ordered = [...stockResult.items].sort((a, b) => {
        const am = _adYear && Number((a as any).ano) === _adYear ? 1 : 0;
        const bm = _adYear && Number((b as any).ano) === _adYear ? 1 : 0;
        if (am !== bm) return bm - am;                                            // ano do anuncio primeiro
        return (Number((b as any).ano) || 0) - (Number((a as any).ano) || 0)      // senao, MAIS NOVO primeiro
          || (Number((a as any).preco) || Infinity) - (Number((b as any).preco) || Infinity);
      });
      stockResult = { ...stockResult, items: _ordered };
    }
  } catch (_e) { /* reordenacao e best-effort: nunca bloqueia o turno */ }

  // FOTO GARANTIDA (rede de seguranca): se o lead pediu fotos EXPLICITAMENTE e
  // temos veiculos para mostrar — da memoria (ja apresentados) OU de uma busca
  // ESPECIFICA recem-feita NESTE turno — enviamos as imagens de verdade. Sem isso,
  // quando o planner rebaixa "fotos do <modelo>" para stock_search (modelo visto
  // como "novo topico" ou veiculos ainda nao salvos na memoria), o agente PROMETE
  // fotos e manda so texto (bug: "vou separar as fotos do Renegade" e nada chega).
  const leadAskedPhotosExplicitly = messageAsksForPhotos(text);
  // MEM-3 (TTL): veiculos apresentados ha MUITO tempo (lead voltou dias depois) nao podem servir
  // de pool de foto/referencia — o estoque muda e o interesse pode ter mudado. Acima de 7 dias,
  // ignora o pool velho (forca uma busca fresca em vez de mandar foto de carro de outra conversa).
  const _vaAt = (nextMemory as any)?.veiculos_apresentados_at;
  const _vaFresh = !_vaAt || (Date.now() - new Date(_vaAt).getTime()) < 7 * 24 * 60 * 60 * 1000;
  const memoryPhotoVehicles = (_vaFresh && Array.isArray(nextMemory?.veiculos_apresentados)) ? nextMemory.veiculos_apresentados : [];
  const freshSpecificStock = (!isGenericQuery && stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length > 0)
    ? stockResult.items
    : [];
  // TOPICO ATUAL = o que o agente acabou de buscar/apresentar NESTE turno. O estoque
  // fresco e a fonte de verdade do topico (a memoria pode estar VELHA, presa em
  // veiculos de uma busca anterior que o lead ja abandonou). Quando ha estoque fresco,
  // ele e o pool E a ancora de modelo do topico.
  const photoVehiclesPool = freshSpecificStock.length > 0 ? freshSpecificStock : memoryPhotoVehicles;
  // ANCORA DE MODELO DO TOPICO (TRAVA do seletor — ver pickReferencedVehicle): o
  // veiculo cujo MODELO define o foco atual. Cor/atributo so seleciona DENTRO desse
  // modelo; nunca pula para outro modelo (bug 5512988987269: lead no Creta pede "o
  // preto" e recebia foto de um Jeep Renegade preto de uma busca de SUV anterior).
  //   1) Estoque fresco: 1o item da busca recem-feita (o modelo recem-pesquisado).
  //   2) Sem estoque fresco: NAO confia em UM campo isolado (veiculos_apresentados[0]
  //      ou ultima_foto podem estar VELHOS/contaminados). Usa o modelo PREDOMINANTE
  //      do pool como ancora SOMENTE quando o pool e HOMOGENEO (todos do mesmo modelo
  //      = o topico esta coerente). Pool HETEROGENEO (modelos diferentes, resto de uma
  //      busca ampla abandonada, ex.: [Tracker, Jeep]) NAO tem topico confiavel ->
  //      ancora = null e o seletor entra em modo seguro (ver topicIsAmbiguous abaixo).
  const poolModelsHomogeneous = photoVehiclesPool.length > 0
    && photoVehiclesPool.every((v: any) => sameVehicleModel(v, photoVehiclesPool[0]));
  let topicAnchorVehicle: any = null;
  if (freshSpecificStock.length > 0) {
    topicAnchorVehicle = freshSpecificStock[0];
  } else if (poolModelsHomogeneous) {
    topicAnchorVehicle = photoVehiclesPool[0];
  }
  // Topico AMBIGUO: lead pediu fotos mas NAO ha estoque fresco e o pool de memoria e
  // heterogeneo (modelos misturados) -> nao da pra saber a QUAL modelo "o preto" se
  // refere sem chutar. Em vez de mandar um carro aleatorio de outro modelo, pedimos
  // esclarecimento. So vale para pedido por ATRIBUTO/COR (sem nome de modelo nem
  // ordinal explicito): se o lead nomeou o carro ou disse "o primeiro", o seletor
  // resolve com seguranca e nao precisa de clarificacao.
  const topicIsAmbiguous = freshSpecificStock.length === 0
    && photoVehiclesPool.length > 1
    && !poolModelsHomogeneous
    && photoRequestIsAttributeOnly(text, photoVehiclesPool);
  // GUARD ANTI-FOTO-FORA-DE-CONTEXTO (regressao reportada: "disparando imagens sem contexto"):
  // o planner as vezes marca "Sim, mas tem outra?" / "Sim, mas e muito longe" como photo_request
  // (so viu o "Sim" da oferta) e REENVIA foto do carro errado/repetido, ignorando o resto do burst.
  // Se a msg do lead sinaliza que quer OUTRO carro, recusa, ou levanta OUTRA preocupacao
  // (localizacao/preco/ja recebeu), NAO manda foto — deixa o cerebro responder a intencao REAL.
  // So bloqueia quando NAO for pedido EXPLICITO de foto.
  const _msgNorm = normalizePhotoText(text);
  const _wantsOtherVehicle = /\b(tem|tinha|quero|queria|ver|mostra|busca|procuro)\s+(outr[oa]|mais)\b/.test(_msgNorm)
    || /\boutr[oa]s?\s+(carr|veicul|opc|model|suv|seda|hatch|picape|marca|ano)/.test(_msgNorm)
    || /\b(mais\s+opc|outra\s+opc|tem\s+outr[oa])\b/.test(_msgNorm);
  const _offTopicConcern = /\b(muito\s+longe|fica\s+longe|ta\s+longe|distante|outra\s+cidade|sao\s+paulo|frete|entrega|caro\s+demais|muito\s+caro|nao\s+quero|nao\s+precisa|nao\s+e\s+esse|ja\s+(mandou|enviou|vi|recebi|mostrou))\b/.test(_msgNorm);
  // AGRADECIMENTO por fotos JA recebidas != pedido de MAIS fotos (caso real lead
  // 5511974994767: "Bacana obrigado pela fotos / posso passar amanha?" -> o agente
  // REDESPEJOU +5 fotos so porque a msg tinha a palavra "fotos"). A palavra "fotos"
  // aqui e GRATIDAO, nao requisicao. Exige uma palavra de elogio/agradecimento perto
  // de "foto(s)" E que NAO haja pedido explicito de mais ("manda/mais/quero ... foto").
  // Bloqueia ATE quando messageAsksForPhotos casa (justamente porque "fotos" no
  // agradecimento engana esse detector) — por isso fica FORA do `!messageAsksForPhotos`.
  const _thanksForPhotos = /\bfotos?\b/.test(_msgNorm)
    && /\b(obrigad|agradec|valeu|brigad|vlw|gostei|adorei|amei|curti|show|bacana|massa|otim|perfeit|maravilh|sensacional|muito\s+bo[am]|top|legal|ficaram?\s+(boa|otim|linda|show|top))/.test(_msgNorm)
    && !/\b(mais|outra|outras|manda|mandar|envia|enviar|quero|queria|pode|tem|ver)\b[^.!?\n]{0,18}\bfotos?\b/.test(_msgNorm)
    && !/\bfotos?\b[^.!?\n]{0,16}\b(traseir|frente|dianteir|lateral|lado|interior|dentro|motor|painel|roda|banco|porta[- ]?mala|outr)/.test(_msgNorm);
  // ATEND-1: PERGUNTA DE SPEC/MEDIDA ("qual o tamanho do porta-malas?", "quantos litros?",
  // "qual o consumo/motor?", "quantos lugares?") NAO e pedido de foto — e pra RESPONDER o dado.
  // Antes, a palavra "porta-malas"/"banco"/"motor" disparava 3 fotos junto (excesso reclamado).
  // So bloqueia quando NAO ha "foto/mostra/ver" explicito (ai sim ele quer VER a parte).
  const _isSpecQuestion = /\b(qual|quanto|quantos|quantas|cabe|tem)\b/.test(_msgNorm)
    && /\b(tamanho|cabe|cabem|litros?|capacidade|consumo|km\s*\/?\s*l|km\s+por\s+litro|cavalos|potencia|lugares|assentos|cilindrada|tanque|porta[- ]?malas?|porta[- ]?mala)\b/.test(_msgNorm)
    && !/\b(foto|fotos|imagem|imagens|mostra|me\s+mostra|ver|manda|envia)\b/.test(_msgNorm);
  const _blockPhotoOffTopic = _thanksForPhotos || _isSpecQuestion
    || ((_wantsOtherVehicle || _offTopicConcern) && !messageAsksForPhotos(text));

  // GUARD ANTI-OVERVIEW-GENERICO (bug real "fotos sem necessidade", lead Domingos): quando o
  // pedido de foto vem SO da deteccao de texto (leadAskedPhotosExplicitly) e a busca/contexto e
  // GENERICA (sem modelo: "carro"/tipo/faixa de preco), NAO despeja o album do carro mais barato
  // que sobrou no pool — o cerebro pergunta QUAL carro. NAO afeta action==="photo_request" (oferta
  // de fotos ACEITA "👍"/seletor ja tem carro especifico em memoria) pra nao regredir esse fluxo.
  const _genericPhotoBlast = queryIsBroadOrGenericVehicle(
    requestedVehicleQueryForMediaGuard(brainPlan, vehicleResolution, stockFilters),
  );
  // BUSCA AMPLA DE CATEGORIA = APRESENTAR A LISTA, nao despejar foto de UM carro (lead 99716-4335:
  // clicou no anuncio do Tracker, disse "procuro um suv 2020 pra frente" -> busca ampla de SUV (27),
  // mas o fluxo de foto disparava no veiculo do anuncio e respondia "vou confirmar as fotos do Tracker",
  // ignorando os SUVs que o lead pediu). Quando o lead AMPLIA p/ um tipo (stock_broad) e NAO pediu foto
  // EXPLICITA nesta msg, o certo e apresentar as opcoes em TEXTO (o cerebro lista) e oferecer fotos —
  // nao fixar num modelo. Geral: vale p/ qualquer anuncio/tipo. Pedido explicito de foto ("manda foto")
  // segue normal.
  // Busca AMPLA de categoria = apresentar a LISTA primeiro (narrow), nunca despejar foto de 1 carro —
  // mesmo que messageAsksForPhotos de falso-positivo (o texto enriquecido do anuncio pode casar "ver").
  // So liberamos foto numa busca ampla se o lead pediu foto de um MODELO especifico (que ai nao e ampla).
  const _broadCategoryBrowse = Boolean((stockFilters as any)?.stock_broad);
  // "SIM" a um PING DE FOLLOW-UP ("ainda está por aí?" / "conseguiu dar uma olhada?") é confirmação de
  // PRESENÇA, NÃO aceite de foto (lead 3199-6370: follow-up perguntou presença, lead disse "Sim" e o agente
  // RE-DESPEJOU 5 fotos). O planner marca esse "Sim" como photo_request. Bloqueia a foto (a não ser que o
  // lead tenha pedido foto EXPLÍCITA na mesma msg) e deixa re-engajar. Aceitar OFERTA DE FOTO segue normal.
  const _lastAgentMsgForPhoto = (Array.isArray(recentHistory) ? recentHistory : [])
    .filter((h: any) => { const r = String(h?.role || h?.direction || "").toLowerCase(); return r === "assistant" || r === "agent" || r === "ai" || r === "bot"; })
    .map((h: any) => String(h?.content || h?.text || h?.message || ""))
    .pop() || "";
  const _affirmFollowupPing = !leadAskedPhotosExplicitly && leadAffirmsPresenceToFollowupPing(text, _lastAgentMsgForPhoto);
  // Modo assistente NUNCA envia fotos (roteia pro vendedor dono) — vale ate quando o lead
  // pede fotos explicitamente. E NUNCA envia quando o topico e ambiguo (pool velho
  // heterogeneo + pedido so por cor): pedir esclarecimento e mais seguro que chutar
  // um modelo errado. E NUNCA quando o lead claramente quer OUTRA coisa (_blockPhotoOffTopic).
  const shouldSendVehiclePhotos = !ownedLeadAssistantMode && !topicIsAmbiguous && !_blockPhotoOffTopic
    && !_broadCategoryBrowse && !_affirmFollowupPing
    && (brainPlan.action === "photo_request"
    || (leadAskedPhotosExplicitly && photoVehiclesPool.length > 0 && !_genericPhotoBlast));

  // Quando o topico esta ambiguo, instrui o cerebro a perguntar QUAL carro o lead quer
  // em vez de mandar foto. NAO reaproveita um modelo aleatorio da lista velha.
  const ambiguousPhotoPlan = topicIsAmbiguous
    ? {
        ...brainPlan,
        action: "clarify" as const,
        use_memory_vehicle: false,
        response_guidance: "O lead pediu fotos por COR/atributo, mas nao da pra saber com seguranca a QUAL carro ele se refere (a conversa tem modelos diferentes em contexto). NAO envie fotos nem cite um modelo especifico: pergunte de forma curta e natural QUAL carro (qual modelo) ele quer ver as fotos.",
        reason: `ambiguous_photo_topic_clarify:${brainPlan.reason || ""}`,
      }
    : (_blockPhotoOffTopic && brainPlan.action === "photo_request")
    ? {
        ...brainPlan,
        action: "reply_only" as const,
        use_memory_vehicle: false,
        response_guidance: "O lead NAO esta pedindo fotos: ele AGRADECEU/elogiou as fotos que ja recebeu, OU quer OUTRO carro/opcao, OU levantou outra questao (distancia/localizacao, preco). NAO envie fotos NEM prometa fotos NEM reenvie as mesmas. Responda a intencao REAL, curto e natural: se ele agradeceu/gostou, reconheca de forma breve e AVANCE (proponha agendar a visita / test drive / falar de condicoes); se quer outro modelo/opcao, pergunte o perfil (tipo/faixa de preco) ou ofereca alternativas; se e distancia, tranquilize (proposta a distancia / detalhes por aqui).",
        reason: `block_photo_offtopic:${brainPlan.reason || ""}`,
      }
    : brainPlan;
  if (topicIsAmbiguous) {
    log("info", "pedro_v2_ambiguous_photo_topic_clarify", {
      lead_id: lead?.id || null,
      pool_size: photoVehiclesPool.length,
    });
  }

  // FOTO DE MODELO NOMEADO SEM POOL: pedido de foto de um modelo (ex.: "fotos do compass")
  // quando NAO houve busca de estoque neste turno e a memoria esta vazia -> o pool ficava
  // vazio e o agente PEDIA referencia ("qual carro?") em vez de mandar a foto do carro que
  // TEMOS. Busca o modelo nomeado no estoque e usa como pool pra enviar a foto na hora.
  let _photoPool = photoVehiclesPool;
  if (shouldSendVehiclePhotos && _photoPool.length === 0 && !topicIsAmbiguous) {
    const _photoModelQuery = String(
      (brainPlan as any)?.search_query
      || (stockFilters as any)?.modelo_desejado
      || (vehicleResolution as any)?.query
      || "",
    ).trim();
    if (_photoModelQuery) {
      try {
        const _ph = await searchPedroStock(supabase, { user_id: input.agent.user_id, query: _photoModelQuery, limit: 6 });
        if (_ph?.success && Array.isArray(_ph.items) && _ph.items.length > 0) {
          _photoPool = _ph.items;
          if (!topicAnchorVehicle) topicAnchorVehicle = _ph.items[0];
          log("info", "pedro_v2_photo_stock_lookup", { query: _photoModelQuery, found: _ph.items.length });
        }
      } catch (_e) { /* nao bloqueia: cai no need_reference padrao */ }
    }
  }

  // ── FOTO DO CARRO ERRADO (bug real Bárbara/Peugeot 2008): o pool/âncora estava ESTRAGADO com OUTRO
  // modelo (Tracker de apresentação anterior do anúncio genérico) e a lead pediu foto do INTERESSE
  // (Peugeot 2008) -> mandou a Tracker. Aqui: se o lead pede foto e o MODELO-ALVO (interesse referenciado
  // OU nomeado) NÃO bate com a âncora, busca o modelo certo + re-ancora. Se não existir no estoque,
  // esvazia o pool (fluxo honesto, NUNCA manda o carro errado).
  if (shouldSendVehiclePhotos && !topicIsAmbiguous && _photoPool.length > 0) {
    const _wantModel = photoRequestTargetModel(
      text,
      nextMemory,
      String((brainPlan as any)?.search_query || (stockFilters as any)?.modelo_desejado || (vehicleResolution as any)?.query || "").trim() || null,
    );
    const _anchorVeh = topicAnchorVehicle || _photoPool[0];
    if (_wantModel && _anchorVeh && !vehicleMatchesRequestedQuery(_anchorVeh, _wantModel)) {
      try {
        const _ph2 = await searchPedroStock(supabase, {
          user_id: input.agent.user_id, query: _wantModel, limit: 6,
          sells_motorcycles: _sellsMotos,
          match_engine: dryRun ? ((input.payload as any)?.match_engine ?? null) : null,
          stock_feed_url: _stockFeedOverride,
        } as any);
        if (_ph2?.success && Array.isArray(_ph2.items) && _ph2.items.length > 0) {
          _photoPool = _ph2.items;
          topicAnchorVehicle = _ph2.items[0];
          log("warn", "pedro_v2_photo_pool_mismatch_research", { lead_id: lead?.id || null, want: _wantModel, was: (_anchorVeh as any)?.modelo || null, found: _ph2.items.length });
        } else {
          _photoPool = [];
          topicAnchorVehicle = undefined as any;
          log("warn", "pedro_v2_photo_pool_mismatch_no_stock", { lead_id: lead?.id || null, want: _wantModel, was: (_anchorVeh as any)?.modelo || null });
        }
      } catch (_e) { /* nao bloqueia */ }
    }
  }

  // ── CASO #2: "MOSTRA MAIS OPCOES" — nunca repetir o que o lead JA VIU ──────────────────────
  // Bug real (lead 99647-8589): pediu "mostra mais opcoes" e o agente repetiu os MESMOS 5 carros.
  // Raiz: a busca devolve o mesmo top-ranqueado e o reply lista os mesmos sem excluir o ja-listado.
  // Aqui, quando o lead pede MAIS opcoes e ja vimos uma lista, EXCLUIMOS o que ele ja viu
  // (opcoes_listadas_keys, acumulado abaixo) do resultado -> carros DIFERENTES. Se esgotar, o cerebro
  // e instruido a oferecer VARIAR o criterio (preco/cambio/marca) em vez de repetir.
  // PLANO B: enforcement determinístico do Plano A — tira dos resultados os MODELOS que o lead rejeitou
  // (o cérebro pode escorregar; a busca NUNCA re-oferece um recusado). clearRejeitadoOnRequest já tirou
  // da lista o que ele voltou a pedir, então isto não esconde nada que ele queira AGORA. Não esvazia o
  // pool (se tudo for rejeitado, mantém — o reply trata via lead_rejeitou e oferece variar).
  const _rejModels = (currentMemory as any)?.rejeitados?.modelos || [];
  if (_rejModels.length > 0 && stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length > 0) {
    const _kept = excludeRejeitados(stockResult.items, { modelos: _rejModels });
    const _removed = stockResult.items.length - _kept.length;
    if (_kept.length > 0 && _removed > 0) {
      stockResult = { ...stockResult, items: _kept, total: _kept.length };
      log("info", "pedro_v2_excluded_rejeitados", { lead_id: lead?.id || null, removed: _removed, modelos: _rejModels });
    }
  }
  const _moreOptions = leadAsksForMoreOptions(text);
  const _seenListedKeys: string[] = Array.isArray((nextMemory as any)?.opcoes_listadas_keys)
    ? (nextMemory as any).opcoes_listadas_keys : [];
  // NÃO REPETIR LISTAS (decisão do dono: repetir os mesmos carros robotiza a conversa). Deduplica em
  // "mais opcoes" E em qualquer lista AMPLA/categoria — EXCETO quando o lead pede os MAIS BARATOS/orçamento
  // (aí pode repetir os mais em conta, ele quer ver os baratos). Lista de modelo ESPECÍFICO não deduplica
  // (se ele pede "o Onix" de novo, mostra o Onix). Histórico acumula sempre (abaixo), pra saber o que já viu.
  const _txtLowDedup = String(text || "").toLowerCase();
  const _isCheapestReq = Boolean((brainPlan as any)?.search_filters?.orcamento_max || (stockFilters as any)?.orcamento_max)
    || /\b(mais barat|mais em conta|baratinho|menor preco|mais acessivel|de menor valor)\b/.test(_txtLowDedup);
  const _isBroadList = Boolean((stockFilters as any)?.stock_broad || (brainPlan as any)?.search_filters?.stock_broad);
  let _optionsExhausted = false;
  if ((_moreOptions || _isBroadList) && !_isCheapestReq && _seenListedKeys.length > 0
      && stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length > 0) {
    const _fresh = excludeAlreadyPresented(stockResult.items, _seenListedKeys);
    if (_fresh.length > 0) {
      stockResult = { ...stockResult, items: _fresh, total: _fresh.length };
    } else {
      _optionsExhausted = true;
    }
    log("info", "pedro_v2_list_dedup", { lead_id: lead?.id || null, seen: _seenListedKeys.length, fresh: _fresh.length, exhausted: _optionsExhausted, more: _moreOptions, broad: _isBroadList });
  }
  const _replyPlanForList = ((_moreOptions || _isBroadList) && _optionsExhausted)
    ? {
        ...ambiguousPhotoPlan,
        response_guidance: `${(ambiguousPhotoPlan as any).response_guidance || ""}\nO lead pediu MAIS opcoes, mas ele JA viu as que batem com esse perfil. NAO repita os mesmos carros: reconheca de forma natural que ja te mostrou esses e ofereca VARIAR o criterio (faixa de preco, cambio, marca, ano) ou pergunte o que e mais importante pra ele, pra voce trazer algo diferente.`.trim(),
        reason: `more_options_exhausted:${(ambiguousPhotoPlan as any).reason || ""}`,
      }
    : ambiguousPhotoPlan;

  // BASE DE CONHECIMENTO (RAG, OPCIONAL): enriquece o reply com a info da LOJA que o cliente cadastrou
  // (garantia, financiamento, documentação, FAQ — o que o agente hoje não sabe e às vezes inventa). Só
  // custa quando o agente TEM base ligada (senão retorna "" após 1 query barata). Best-effort: nunca
  // derruba o turno. Query = a mensagem REAL do lead (não o enriched, p/ não poluir o embedding).
  const _knowledgeContext = await fetchPedroKnowledgeContext(supabase, {
    agentId: input.agent.id,
    userId: input.agent.user_id,
    agentName: input.agent.name,
    queryText: text,
    openaiKey: _openaiKey,
    auditable: !dryRun,
  });

  // CÉREBRO/FOCO DA CONVERSA: garante o VEÍCULO EM FOCO (o carro que a conversa discute) no pool de fotos —
  // com isso "fotos dele / mais detalhes" resolve NELE (pickReferencedVehicle ancora no foco), em vez de
  // perguntar "de qual?" e listar carros aleatórios (lead 3199-6370: "Do yaris" → "fotos dele" virava lista).
  // Só prepende se o foco TEM fotos e NÃO está no pool; o pivô (lead nomeia outro modelo/ordinal) ainda vence.
  const _focoAtual = (nextMemory as any)?.veiculo_em_foco;
  if (shouldSendVehiclePhotos && _focoAtual?.key && Array.isArray(_focoAtual?.fotos) && _focoAtual.fotos.length > 0
      && !(_photoPool || []).some((v: any) => vehicleKey(v) === _focoAtual.key)) {
    _photoPool = [_focoAtual, ...(_photoPool || [])];
  }

  let reply = shouldSendVehiclePhotos
    ? buildVehiclePhotoReply({ ...nextMemory, veiculos_apresentados: _photoPool }, text, topicAnchorVehicle)
    : await generatePedroBrainReply({
        agent: input.agent,
        agent_system_prompt: input.agent?.system_prompt || input.agent?.prompt || null,
        assigned_seller_name: assistantSellerName,
        memory: nextMemory,
        intent: contextualIntent,
        stock_result: stockResult,
        message: enrichedText,
        plan: _replyPlanForList,
        vehicle_resolution: vehicleResolution,
        ad_context: adContext,
        media_context: sanitizePedroMediaContext(mediaContext),
        recent_history: recentHistory,
        knowledge_context: _knowledgeContext,
        usage_sink: usageSink,
        audit: { client: supabase, userId: input.agent.user_id, agentId: input.agent.id, agentName: input.agent.name },
        ai_key_ctx: _aiKeyCtx,
        reply_provider_override: dryRun ? ((input.payload as any)?.reply_provider ?? null) : null,
        reply_model_override: dryRun ? ((input.payload as any)?.reply_model ?? null) : null,
      });

  // "SIM" a um PING DE FOLLOW-UP de presença -> RE-ENGAJA, nunca re-despeja foto (ver _affirmFollowupPing).
  if (_affirmFollowupPing) {
    reply = {
      ok: true,
      text: "Que bom que está por aí! 😊 Quer que eu te passe mais detalhes de algum dos carros que te mandei, ou prefere que eu te mostre outras opções?",
      source: "followup_ping_reengage",
      media: [],
    } as any;
    log("info", "pedro_v2_followup_ping_affirm_reengage", { lead_id: lead?.id || null });
  }

  if (reply?.source === "vehicle_photos_reply" && Array.isArray(reply.media) && reply.media.length > 0) {
    // PICK EXPLÍCITO POR ORDINAL ("foto do 3") é AUTORITATIVO — o lead escolheu pela POSIÇÃO na lista, não há
    // MODELO a "casar". O requestedPhotoQuery (que o planner às vezes resolve pro carro ERRADO, ex.: o #1)
    // fazia o guard BLOQUEAR o pick correto E AINDA CITAR o carro errado (lead 3199-6370: "foto do 3" = Onix
    // virou "vou confirmar as fotos do Ford Focus" e não mandou nada). Num pick por ordinal, confia e manda.
    const _explicitOrdinalPick = (reply as any).selected_vehicle_reason === "explicit_ordinal";
    const requestedPhotoQuery = _explicitOrdinalPick ? null : requestedVehicleQueryForMediaGuard(brainPlan, vehicleResolution, stockFilters);
    if (requestedPhotoQuery && !vehicleMatchesRequestedQuery((reply as any).vehicle, requestedPhotoQuery)) {
      log("warn", "pedro_v2_media_vehicle_mismatch_blocked", {
        lead_id: lead?.id || null,
        requested_query: requestedPhotoQuery,
        selected_vehicle_label: (reply as any).selected_vehicle_label || cleanVehicleLabel((reply as any).vehicle || {}),
        selected_vehicle_key: (reply as any).selected_vehicle_key || null,
      });
      // O modelo pedido pra foto EXISTE no estoque? Se NAO (busca estrita = 0), nao adianta
      // "vou confirmar certinho" (beco sem saida: nada a confirmar, o lead pediu T-Cross que
      // a loja nao tem). Responde HONESTO ("nao temos") e oferece parecidos, em vez de sumir.
      let _reqExists = true;
      try {
        const _reqStock = await searchPedroStock(supabase, { user_id: input.agent.user_id, query: requestedPhotoQuery, limit: 3 });
        _reqExists = Boolean(_reqStock?.success && Array.isArray(_reqStock.items) && _reqStock.items.length > 0);
      } catch { _reqExists = true; }
      reply = _reqExists
        ? buildBlockedWrongVehiclePhotoReply(requestedPhotoQuery)
        : {
            ok: true,
            text: `Na real, o ${requestedPhotoQuery} a gente nao tem no estoque agora. Quer que eu te mostre alguma opcao parecida que eu tenho aqui?`,
            source: "vehicle_photos_absent_vehicle",
            media: [],
          };
    }
  }

  // ── MÍDIA SEM FAILOVER (áudio/imagem não processados) — pedir TEXTO, nunca dar brush-off ────────
  // A transcrição (Whisper) e a visão usam SÓ a OpenAI; quando ela cai (sem crédito) e o failover é o
  // DeepSeek (texto puro, não faz mídia), o áudio chega "[áudio recebido]" e a imagem "[imagem recebida]".
  // Caso real (lead Luize): 3 áudios -> agente não entendeu, deu brush-off e transferiu. Aqui, quando a
  // mídia NÃO foi processada e o turno é SÓ a mídia (sem texto real), respondemos de forma DETERMINÍSTICA
  // e acolhedora pedindo por TEXTO — sem prometer "vou ouvir", sem transferir. (Quando houver provedor de
  // mídia de failover, isto deixa de disparar porque a mídia será processada.)
  if (mediaContext.kind === "audio" && !(mediaContext as any).diagnostics?.audio_transcribed && text === "[áudio recebido]") {
    reply = {
      ok: true,
      text: "Recebi seu áudio, mas não consegui ouvir ele agora 😕 Me manda por texto rapidinho qual carro você procura (o modelo ou uma faixa de preço) que eu já confiro no estoque pra você! 😊",
      source: "audio_not_transcribed_ask_text",
      media: [],
    } as any;
  } else if (mediaContext.kind === "image" && !(mediaContext as any).vehicle_query && text === "[imagem recebida]") {
    reply = {
      ok: true,
      text: "Recebi sua imagem! Só pra eu te ajudar certinho, me conta qual carro/modelo você tem interesse (ou uma faixa de preço) que eu confiro no estoque pra você. 😊",
      source: "image_not_processed_ask_text",
      media: [],
    } as any;
  }

  // ── TRAVA FINAL: NUNCA "nao temos" sem ter CHECADO (cinto-e-suspensorio anti-alucinacao) ─────────
  // Backstop universal: se o cerebro NAO buscou neste turno (stockResult null) mas o lead NOMEOU um
  // veiculo (resolver pegou) e o reply esta NEGANDO disponibilidade, o agente esta alucinando que nao
  // tem (nunca checou). Faz a busca que faltou; se o carro EXISTE, troca o reply pela lista REAL (nao
  // mente); se realmente nao existe, o "nao temos" e legitimo e segue. Pega QUALQUER gap futuro de
  // roteamento do planner (caso real Hilux: LLM rotulou trade_in e negou um carro que existia).
  if (stockResult === null && (vehicleResolution as any)?.has_current_vehicle_signal
      && (reply as any)?.text && replyDeniesAvailability((reply as any).text)) {
    const _recQuery = (vehicleResolution as any)?.query || (brainPlan as any)?.search_query
      || (stockFilters as any)?.modelo_desejado || null;
    if (_recQuery) {
      try {
        const _rec = await searchPedroStock(supabase, {
          user_id: input.agent.user_id, query: _recQuery, limit: 6,
          sells_motorcycles: _sellsMotos,
          match_engine: dryRun ? ((input.payload as any)?.match_engine ?? null) : null,
          stock_feed_url: _stockFeedOverride,
        } as any);
        if (_rec?.success && Array.isArray(_rec.items) && _rec.items.length > 0) {
          stockResult = _rec;
          reply = {
            ok: true,
            text: buildDeterministicStockReply({ memory: nextMemory, plan: { ...(brainPlan as any), action: "stock_search", search_query: _recQuery } as any, intent: contextualIntent as any, stock_result: _rec }),
            source: "denial_without_search_recovered",
            media: [],
          } as any;
          log("warn", "pedro_v2_denial_without_search_recovered", { lead_id: lead?.id || null, query: _recQuery, found: _rec.items.length });
        }
      } catch (_recErr) { /* recuperacao best-effort: nunca derruba o turno */ }
    }
  }

  // ── CAMADA DE VERIFICACAO PRE-ENVIO (Chain-of-Verification): ultimo check antes de enviar ────────
  // Roda em TODA resposta. LOGA as violacoes (eval-driven: medimos o que dispara em trafego real) e
  // corrige a "besteira" mais clara (promessa de foto sem anexar midia -> nunca prometer; oferece no
  // presente). Consolida os invariantes espalhados; cada novo "erro bobo" vira +1 check em
  // preSendVerify.ts (com 1 teste offline) em vez de remendo solto no orchestrator.
  // DUVIDAS PENDENTES (decisao do dono): quando o agente NAO sabe e adia ("confirmo com a equipe"),
  // a duvida vai pro BRIEFING do vendedor. Acumula aqui (neste turno) -> persiste no estado -> handoff.
  const _SPEC_DUVIDA: Record<string, string> = { consumo: "consumo (km/l)", potencia: "potencia (cavalos)", litros: "capacidade em litros (porta-malas/tanque)" };
  const _CLAIM_DUVIDA: Record<string, string> = { laudo: "laudo cautelar/vistoria", garantia_fabrica: "garantia (confirmar a politica da loja)" };
  const _duvidasThisTurn: string[] = [];
  try {
    // ANTI-ALUCINACAO DE FICHA TECNICA (Solucao D Antigravity): o estoque NAO traz consumo/cv/litros; se
    // o LLM CRAVOU um numero desses que nao esta no texto real do veiculo, troca a frase por "confirmo com
    // o time" (preserva midia/fotos e o resto da resposta). Aterramento = label/versao/modelo dos veiculos.
    const _vehText = (arr: any) => (Array.isArray(arr) ? arr : []).map((v: any) => `${v?.label || ""} ${v?.versao || ""} ${v?.modelo || ""} ${v?.descricao || v?.observacoes || v?.titulo || ""}`).join(" | ");
    const _factsForSpec = `${_vehText(stockResult?.items)} ${_vehText((nextMemory as any)?.veiculos_apresentados)} ${_vehText([(nextMemory as any)?.veiculo_em_foco].filter(Boolean))}`;
    const _specNeutral = neutralizeUngroundedSpecs((reply as any)?.text || "", _factsForSpec);
    if (_specNeutral.neutralized) {
      reply = { ...(reply as any), text: _specNeutral.text };
      for (const h of _specNeutral.hits) { const k = String(h).split(":")[0]; if (_SPEC_DUVIDA[k] && !_duvidasThisTurn.includes(_SPEC_DUVIDA[k])) _duvidasThisTurn.push(_SPEC_DUVIDA[k]); }
      log("warn", "pedro_v2_spec_hallucination_neutralized", { lead_id: lead?.id || null, hits: _specNeutral.hits, source: (reply as any)?.source });
    }

    // AFIRMACAO NAO-ATERRADA NO PROMPT (garantia de fabrica, laudo cautelar): o agente so afirma o que
    // esta no system_prompt da loja; se inventou (nao esta no prompt) -> "confirmo com a equipe" (decisao
    // do dono). PROMPT-AWARE: loja que tem laudo/garantia-fabrica no prompt pode afirmar. Caso 98861-9201.
    const _agentPrompt = (input.agent as any)?.system_prompt || (input.agent as any)?.prompt || "";
    const _claimNeutral = neutralizeUngroundedClaims((reply as any)?.text || "", _agentPrompt);
    if (_claimNeutral.neutralized) {
      reply = { ...(reply as any), text: _claimNeutral.text };
      for (const h of _claimNeutral.hits) { if (_CLAIM_DUVIDA[h] && !_duvidasThisTurn.includes(_CLAIM_DUVIDA[h])) _duvidasThisTurn.push(_CLAIM_DUVIDA[h]); }
      log("warn", "pedro_v2_ungrounded_claim_neutralized", { lead_id: lead?.id || null, hits: _claimNeutral.hits, source: (reply as any)?.source });
    }

    // ANTI-VAZAMENTO DE IDENTIDADE (segurança contra manipulação): se a resposta vazar que é IA/bot/
    // modelo, troca pela deflexão de persona (o agente é o consultor da loja). Caso 98861-9201.
    const _idLeak = neutralizeAiIdentityLeak((reply as any)?.text || "", input.agent?.name || null);
    if (_idLeak.changed) {
      reply = { ...(reply as any), text: _idLeak.text, media: [] };
      log("warn", "pedro_v2_ai_identity_leak_blocked", { lead_id: lead?.id || null, source: (reply as any)?.source });
    }

    // ANÚNCIO GENÉRICO (de frota, sem veículo específico — leads 98109-7851 / 99223-8447): o agente
    // reconheceu o anúncio mas NÃO há carro pra apresentar. Decisão do dono: nesse caso, com o lead VAGO
    // ("tenho interesse", sem modelo/tipo/orçamento), QUALIFICAR PRIMEIRO — NÃO deferir ("vou buscar... um
    // momento") NEM despejar uma lista de 5 carros (= "complicado"). Faz a ABORDAGEM (ETAPA 1 do funil):
    // cumprimenta, se apresenta e pergunta o que procura. Dispara quando o anúncio não tem veículo
    // (adNeedsVehicleConfirmation) E (o reply deferiu OU o lead chegou vago). Se o lead citou modelo/tipo/
    // orçamento, NÃO entra aqui (aí mostra o que ele pediu, normal).
    const _adVagueText = String(text || "").toLowerCase();
    const _adNamedType = /\b(suv|sedan|seda|hatch|picape|pickup|caminhonete|utilitario|4x4)\b/.test(_adVagueText);
    const _adNamedBudget = /(\b\d{1,3}\s*(mil|k)\b|r\$\s*\d|at[eé]\s+\d|faixa de)/.test(_adVagueText);
    const _adLeadVague = !(vehicleResolution as any)?.canonical_model && !_adNamedType && !_adNamedBudget
      && !Boolean((currentMemory as any)?.interesse?.modelo_desejado);
    // 1º CONTATO (nenhum turno anterior do agente) e SEM veículo do anúncio resolvido. O dono: no 1º
    // contato com lead VAGO ("tenho interesse"), NUNCA despejar lista — perguntar. Cobre tbm o anúncio
    // que NÃO foi identificado (has_ad mas sem vehicle_query, OU sem ad_context nenhum).
    const _adFirstContact = (Array.isArray(recentHistory) ? recentHistory : []).filter((h: any) => {
      const r = String(h?.role || h?.direction || "").toLowerCase();
      return r === "assistant" || r === "agent" || r === "ai" || r === "bot";
    }).length === 0;
    const _noAdVehicle = !(adContext as any)?.vehicle_query;
    if ((adNeedsVehicleConfirmation && (replyDefersSearch((reply as any)?.text || "") || _adLeadVague))
        || (_adFirstContact && _adLeadVague && _noAdVehicle)) {
      const _agName = (input.agent?.name || "").toString().trim().split(/\s+/)[0] || "";
      const _agCompany = (input.agent?.company_name || "").toString().trim();
      const _intro = _agCompany ? `Oi! Aqui é o ${_agName || "consultor"} da ${_agCompany} 😊` : `Oi! Aqui é o ${_agName || "consultor"} 😊`;
      reply = {
        ok: true,
        // 1º CONTATO: apresenta + RECONHECE o anúncio (menos neutro/robótico) + qualifica. RE-CONTATO (o agente
        // JÁ falou antes): NÃO repete a apresentação — só conduz (lead 99178-2158: re-apresentou idêntico = robô,
        // e o lead já tinha falado). Decide pelo _adFirstContact (há turno anterior do agente no histórico).
        text: _adFirstContact
          ? `${_intro} Que bom que você se interessou pelos nossos veículos! Pra eu te indicar certinho: você já tem algum modelo em mente, ou prefere que eu te ajude a escolher pela sua necessidade — tipo de carro e a faixa de valor que você pensa?`
          : `Me conta rapidinho o que você procura que eu já te trago as melhores opções 😊 Você tem algum modelo em mente, ou prefere por tipo (SUV, sedan, hatch, picape) e faixa de valor?`,
        source: "ad_generic_abordagem",
        media: [],
      } as any;
      log("info", "pedro_v2_ad_generic_abordagem", { lead_id: lead?.id || null, vague: _adLeadVague, first_contact: _adFirstContact });
    }

    // "VOU BUSCAR..." E SOME (lead 99747-0573 "Palio"): o reply DEFERIU a busca que JA rodou neste turno
    // -> apresenta o resultado REAL agora (buildDeterministicStockReply ja e HONESTO: "Temos sim" so se o
    // modelo existe, senao "nao tenho X, mas tenho parecidos"). Recupera a busca se o stockResult faltou.
    else if (replyDefersSearch((reply as any)?.text || "")) {
      let _defStock: any = stockResult;
      if (!(_defStock?.success && Array.isArray(_defStock.items) && _defStock.items.length > 0)) {
        const _defQuery = (vehicleResolution as any)?.query || (brainPlan as any)?.search_query || (stockFilters as any)?.modelo_desejado || null;
        if (_defQuery) {
          try {
            _defStock = await searchPedroStock(supabase, {
              user_id: input.agent.user_id, query: _defQuery, limit: 6, sells_motorcycles: _sellsMotos,
              match_engine: dryRun ? ((input.payload as any)?.match_engine ?? null) : null, stock_feed_url: _stockFeedOverride,
            } as any);
          } catch { /* best-effort: nunca derruba o turno */ }
        }
      }
      const _defHasItems = Boolean(_defStock?.success && Array.isArray(_defStock.items) && _defStock.items.length > 0);
      if (_defHasItems) stockResult = _defStock;
      reply = {
        ok: true,
        text: buildDeterministicStockReply({ memory: nextMemory, plan: { ...(brainPlan as any), action: "stock_search" } as any, intent: contextualIntent as any, stock_result: _defHasItems ? _defStock : { success: true, items: [] } }),
        source: "search_deferral_resolved",
        media: [],
      } as any;
      log("warn", "pedro_v2_search_deferral_resolved", { lead_id: lead?.id || null, found: _defHasItems ? _defStock.items.length : 0 });
    }

    // PRECO INVENTADO (backstop final — caso GRAVE dos prints: Civic 73.990->50.000, S10 91.990->59.000):
    // mesmo com o grounding do reply (R6), garante que NENHUM preco fora do estoque saia, por QUALQUER
    // caminho de resposta. Se o texto final cita preco que nao bate com veiculo real (stock+apresentados),
    // relista DETERMINISTICAMENTE com os precos REAIS. Preco errado quebra confianca e e risco comercial.
    const _priceFacts = [
      ...(((stockResult as any)?.items as any[]) || []),
      ...(((nextMemory as any)?.veiculos_apresentados as any[]) || []),
    ].filter(Boolean);
    if (_priceFacts.length > 0) {
      const _r6 = validateGrounding((reply as any)?.text || "", _priceFacts).violations.filter((v) => v.rule === "R6");
      if (_r6.length > 0) {
        log("warn", "pedro_v2_wrong_price_blocked", { lead_id: lead?.id || null, prices: _r6.map((v) => v.detail), source: (reply as any)?.source });
        if ((stockResult as any)?.success && Array.isArray((stockResult as any).items) && (stockResult as any).items.length > 0) {
          reply = {
            ok: true,
            text: buildDeterministicStockReply({ memory: nextMemory, plan: { ...(brainPlan as any), action: "stock_search" } as any, intent: contextualIntent as any, stock_result: stockResult }),
            source: "wrong_price_relisted_deterministic",
            media: [],
          } as any;
        }
      }
    }

    // OFERTA DE FOTO SEM FOTO (caso real dos prints: carro "em preparação" = images_count 0, o agente
    // oferecia "quer ver fotos?" e depois recuava). Se o reply OFERECE foto mas NENHUM veículo do turno
    // tem foto cadastrada, troca a oferta por CTA de detalhes/visita. Só dispara quando NÃO há foto em
    // lugar nenhum (lista com algum carro COM foto mantém a oferta). Não toca em envio real de fotos.
    if ((reply as any)?.source !== "vehicle_photos_reply" && replyOffersPhotos((reply as any)?.text || "")) {
      const _hasPhoto = (arr: any) => (Array.isArray(arr) ? arr : []).some((v: any) => Number(v?.images_count) > 0 || (Array.isArray(v?.fotos) && v.fotos.length > 0));
      const _anyPhotos = _hasPhoto((stockResult as any)?.items) || _hasPhoto((nextMemory as any)?.veiculos_apresentados);
      if (!_anyPhotos) {
        const _photoRw = rewriteUnavailablePhotoOffer((reply as any)?.text || "");
        if (_photoRw.changed) {
          reply = { ...(reply as any), text: _photoRw.text };
          log("warn", "pedro_v2_photo_offer_without_photos", { lead_id: lead?.id || null, source: (reply as any)?.source });
        }
      } else if (_focoAtual && photoCtaDecision(nextMemory, _focoAtual, text).reason === "already_sent_suppress") {
        // LEDGER (dor nº1 do dono): as fotos do veículo EM FOCO já foram enviadas num turno anterior e o lead
        // NÃO está pedindo (mais) foto -> NÃO re-oferecer "quer ver as fotos?". Strip só a frase de oferta e
        // mantém o resto da resposta (a info real que o lead perguntou). Não toca em envio real de foto.
        const _reoff = stripPhotoReoffer((reply as any)?.text || "");
        if (_reoff.changed) {
          reply = { ...(reply as any), text: _reoff.text };
          log("info", "pedro_v2_photo_reoffer_suppressed", { lead_id: lead?.id || null, foco: (_focoAtual as any)?.key || null });
        }
      }
    }

    const _mediaCount = Array.isArray((reply as any)?.media) ? (reply as any).media.length : 0;
    const _violations = verifyReplyText((reply as any)?.text || "", {
      mediaCount: _mediaCount,
      searchedThisTurn: stockResult !== null,
      hasVehicleSignal: Boolean((vehicleResolution as any)?.has_current_vehicle_signal),
      rejeitadosModelos: Array.isArray((nextMemory as any)?.rejeitados?.modelos) ? (nextMemory as any).rejeitados.modelos : [],
    });
    if (_violations.length > 0) {
      log("warn", "pedro_v2_presend_violations", { lead_id: lead?.id || null, types: _violations.map((v) => v.type), source: (reply as any)?.source });
      // CORRECAO determinista: prometeu enviar foto mas NAO anexou midia -> NAO promete; oferece AGORA.
      if (_violations.some((v) => v.type === "promise_undelivered_media") && _mediaCount === 0) {
        const _focus = (nextMemory as any)?.interesse?.modelo_desejado || null;
        reply = {
          ok: true,
          text: _focus
            ? `Quer que eu te mande as fotos do ${_focus} agora? Posso mostrar na hora! 😊`
            : `Me confirma qual carro você quer ver que eu já te mando as fotos certinhas! 😊`,
          source: "presend_fixed_no_photo_promise",
          media: [],
        } as any;
      }
    }

    // CATEGORIA que NAO apresenta (gap provado do gpt-4.1-mini): lead AMPLIOU p/ um TIPO (_broadCategoryBrowse),
    // a busca trouxe >=2 opcoes, mas o reply so saudou/perguntou rapport e NAO citou NENHUM veiculo achado
    // (variancia do modelo barato — as vezes lista, as vezes ignora). Decisao do dono (v134): pediu TIPO +
    // ha varios => APRESENTA as opcoes. Relista de forma DETERMINISTICA (provider-independente, sem custo).
    if (_broadCategoryBrowse && stockResult?.success && Array.isArray(stockResult.items)
        && stockResult.items.length >= 2
        && !messageIsTooVagueToAct(text, currentMemory)
        && !_optionsExhausted  // já mostrou todas as opções desse perfil -> NÃO relistar (repetir); o LLM oferece variar
        && !["vehicle_photos_reply", "vehicle_photos_pick_which", "presend_fixed_no_photo_promise", "ad_generic_abordagem"].includes((reply as any)?.source)
        && !replyMentionsAnyVehicle((reply as any)?.text || "", stockResult.items)) {
      reply = {
        ok: true,
        text: buildDeterministicStockReply({ memory: nextMemory, plan: { ...(brainPlan as any), action: "stock_search" } as any, intent: contextualIntent as any, stock_result: stockResult }),
        source: "category_relisted_deterministic",
        media: [],
      } as any;
      log("warn", "pedro_v2_category_relisted", { lead_id: lead?.id || null, count: stockResult.items.length });
    }

    // QUALIFICACAO de lead VAGO ("perguntar, nao chutar"): o planner marcou precisa_qualificar (msg
    // generica sem criterio — "quero um carro", "me ajuda a escolher"). Garante que o reply FACA uma
    // pergunta de qualificacao; se o LLM nao perguntou (sem "?" ou sem citar tipo/faixa), usa pergunta
    // DETERMINISTICA (zero variancia) — nunca despeja carros aleatorios.
    if ((brainPlan as any)?.precisa_qualificar) {
      const _rt = String((reply as any)?.text || "");
      const _asksQualifier = /\?/.test(_rt)
        && /\b(tipo|suv|sedan|seda|hatch|picape|pickup|faixa|preco|preço|valor|orcamento|orçamento|uso|usar|procura|prefere|modelo)\b/i.test(_rt);
      if (!_asksQualifier) {
        reply = {
          ok: true,
          text: "Claro, vou te ajudar a achar o carro ideal! 😊 Pra eu já filtrar certinho pra você: tem algum *tipo* em mente (SUV, sedan, hatch, picape) ou prefere me dizer uma *faixa de preço*?",
          source: "qualify_vague_deterministic",
          media: [],
        } as any;
        log("warn", "pedro_v2_qualify_vague", { lead_id: lead?.id || null });
      }
    }

    // APRESENTAÇÃO no 1º CONTATO (BLOCO 3 do funil, estilo HÍBRIDO escolhido pelo dono): se é a PRIMEIRA
    // resposta do agente (nenhum turno anterior dele) e o texto NÃO traz auto-apresentação, insere "Aqui é
    // o {nome}, consultor da {empresa} 😊" (logo após a saudação, se houver). Backstop determinístico — o
    // prompt JÁ manda apresentar (pedroBrainReply ~814) mas o LLM ignora e vai direto no carro (varredura
    // confirmou). Última transformação do texto. Não toca em transferência silenciosa.
    const _priorAgentTurns = (Array.isArray(recentHistory) ? recentHistory : []).filter((h: any) => {
      const r = String(h?.role || h?.direction || "").toLowerCase();
      return r === "assistant" || r === "agent" || r === "ai" || r === "bot" || r === "out" || r === "outbound";
    }).length;
    if (_priorAgentTurns === 0 && (reply as any)?.transferir_silencioso !== true
        && String((reply as any)?.text || "").trim().length > 0) {
      let _hr = 12;
      try { _hr = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(new Date())); } catch { /* fallback */ }
      if (!Number.isFinite(_hr)) _hr = 12;
      const _greet = _hr < 12 ? "Bom dia" : _hr < 18 ? "Boa tarde" : "Boa noite";
      const _intro = ensureSelfIntroduction(String((reply as any).text || ""), {
        agentName: (input.agent as any)?.name,
        companyName: (input.agent as any)?.company_name,
        greeting: _greet,
      });
      let _introText = _intro.added ? _intro.text : String((reply as any).text || "");
      // HÍBRIDO = apresenta + carro + 1 PERGUNTA. Se a 1ª resposta não tem NENHUMA pergunta (o agente
      // só despejou o carro), acrescenta a pergunta de conexão do BLOCO 3 (qualificação, não filler).
      // Não faz se for transferência (pronto_para_transferir) nem se já houver "?".
      if ((reply as any)?.pronto_para_transferir !== true && !/\?/.test(_introText)) {
        _introText = `${_introText.replace(/\s+$/, "")}\n\nVocê já conhece a nossa loja?`;
        _intro.added = true;
      }
      if (_intro.added) {
        reply = { ...(reply as any), text: _introText };
        log("info", "pedro_v2_self_intro_added", { lead_id: lead?.id || null, source: (reply as any)?.source });
      }
    }

    // SDR PROATIVO / FUNIL FORÇADO (decisão do dono: "ele tá preguiçoso — se o lead pergunta as coisas, ele
    // precisa tentar QUALIFICAR; ele só precisa ser mais esperto, sem quebrar a intenção"): lê o funil
    // ESTRUTURADO do cliente (agent_funnel_config.bloco4) e, em turno NÃO-inicial, se o agente respondeu de
    // forma PASSIVA (sem nenhuma pergunta SIGNIFICATIVA — isca vazia tipo "Precisa de mais alguma informação?"
    // NÃO conta), tira a isca e ACRESCENTA a próxima pergunta de qualificação ainda não respondida.
    // Caso real (Avant): lead "onde fica a loja?" -> agente respondeu o endereço + isca, e PAROU; agora ele
    // responde + "O que você está procurando?". Não dispara em despedida/recusa/transferência nem quando o
    // agente JÁ pergunta algo de venda (foto/modelo/visita...) — pra não empilhar nem virar robô.
    // Última msg do AGENTE (anti-repetição: não empilhar pergunta se ele JÁ perguntou algo no turno anterior).
    const _sdrLastAgent = (Array.isArray(recentHistory) ? recentHistory : [])
      .filter((h: any) => { const r = String(h?.role || h?.direction || "").toLowerCase(); return r === "assistant" || r === "agent" || r === "ai" || r === "bot"; })
      .map((h: any) => String(h?.content || h?.text || h?.message || ""))
      .pop() || "";
    const _b4 = (input.agent as any)?.funnel_bloco4;
    if (_b4 && _priorAgentTurns > 0
        && leadAsksInfoQuestion(text)                                  // ⭐GATILHO: só qualifica quando o LEAD PERGUNTA algo (não em pedido de foto/resposta curta — lead 99742-3129)
        && !replyHasMeaningfulQuestion(_sdrLastAgent)                  // ⭐ANTI-REPETIÇÃO: o agente NÃO acabou de perguntar algo (não empilha turno após turno)
        && (reply as any)?.pronto_para_transferir !== true && (reply as any)?.transferir_silencioso !== true
        && (reply as any)?.temperatura !== "desqualificado"
        && !leadExplicitlyDeclined(text)
        && !replyIsGracefulClose((reply as any)?.text || "")
        && !["vehicle_photos_pick_which", "vehicle_photos_need_reference", "vehicle_photos_reply", "vehicle_photos_album",
             "presend_fixed_no_photo_promise", "ad_generic_abordagem",
             "trade_collecting", "visit_schedule_qualify", "visit_cpf_qualify", "lone_emoji_no_transfer"].includes((reply as any)?.source)
        && !replyHasMeaningfulQuestion((reply as any)?.text || "")) {
      const _fq = { ...((reply as any)?.qualificacao_coletada || {}) };
      const _hasNm = Boolean(_fq.nome || lead?.lead_name || (pushName && /\p{L}{2,}/u.test(String(pushName))));
      const _hasInt = Boolean(_fq.interesse || (nextMemory as any)?.interesse?.modelo_desejado || (nextMemory as any)?.interesse?.tipo_veiculo);
      const _fqMerged = { ..._fq, carro_troca: _fq.carro_troca || (nextMemory as any)?.negociacao?.carro_troca || null };
      const _nextQ = nextFunnelQuestion(_b4, _fqMerged, { hasName: _hasNm, hasInterest: _hasInt });
      if (_nextQ && String((reply as any)?.text || "").trim().length > 0) {
        const _cleaned = stripTrailingFillerQuestion((reply as any).text); // tira a isca pra dar lugar à qualificação
        reply = { ...(reply as any), text: `${String(_cleaned).replace(/\s+$/, "")}\n\n${_nextQ}` };
        log("info", "pedro_v2_funnel_question_forced", { lead_id: lead?.id || null });
      }
    }
  } catch (_vErr) { /* verificacao best-effort: nunca derruba o turno */ }

  let effectiveMemory = nextMemory;
  // DUVIDAS PENDENTES acumuladas (estado anterior + as deste turno) -> vao pro handoff/briefing + persistem.
  const _allDuvidas = Array.from(new Set([
    ...(Array.isArray((effectiveMemory as any)?.atendimento?.duvidas_pendentes) ? (effectiveMemory as any).atendimento.duvidas_pendentes : []),
    ..._duvidasThisTurn,
  ])).filter(Boolean).slice(0, 8) as string[];
  if (stockResult?.success && Array.isArray(stockResult.items) && stockResult.items.length > 0) {
    const indices = Array.isArray((reply as any).presented_vehicle_indices) ? (reply as any).presented_vehicle_indices : [];
    let vehiclesToSave = indices
      .map((idx: number) => stockResult.items[idx - 1])
      .filter(Boolean);

    if (vehiclesToSave.length === 0 && ["brain_stock_reply", "stock_fact_reply", "brain_stock_fallback", "brain_ad_vehicle_reply", "brain_ad_vehicle_fallback", "denial_without_search_recovered", "category_relisted_deterministic", "wrong_price_relisted_deterministic", "search_deferral_resolved"].includes(reply.source)) {
      vehiclesToSave = stockResult.items;
    }

    // Se as FOTOS sairam de uma busca fresca (lead pediu "fotos do X" antes de os
    // veiculos estarem salvos na memoria), guarda os encontrados para o proximo
    // "mais fotos"/referencia funcionar pela memoria.
    if (vehiclesToSave.length === 0 && reply.source === "vehicle_photos_reply") {
      vehiclesToSave = stockResult.items;
    }

    if (vehiclesToSave.length > 0) {
      // NÃO REPETIR LISTAS: acumula SEMPRE (união) as chaves dos carros já LISTADOS ao longo da conversa,
      // pra deduplicar as próximas listas (decisão do dono). Antes resetava em lista nova -> perdia o
      // histórico e repetia. Cap nas últimas 40 (carros diferentes têm chaves diferentes; não bloqueia pivô).
      const _isListReply = reply.source !== "vehicle_photos_reply";
      const _listedNowKeys = _isListReply
        ? (stockResult.items || []).slice(0, 5).map(vehicleDedupKey).filter(Boolean)
        : [];
      const _newListedKeys = _isListReply
        ? Array.from(new Set([..._seenListedKeys, ..._listedNowKeys])).slice(-40)
        : _seenListedKeys;
      effectiveMemory = !dryRun && lead?.id
        ? await savePresentedVehicles(supabase, {
            lead_id: lead.id,
            agent_id: input.agent.id,
            user_id: input.agent.user_id,
            current: nextMemory,
            vehicles: vehiclesToSave,
            listed_keys: _newListedKeys,
          })
        : {
            ...nextMemory,
            veiculos_apresentados: vehiclesToSave.slice(0, 30),
            opcoes_listadas_keys: _newListedKeys.slice(0, 40),
          };
    }
  }

  if (reply?.source === "vehicle_photos_reply" && Array.isArray(reply.media) && reply.media.length > 0) {
    const brainClosing = await generatePedroBrainReply({
      agent: input.agent,
      agent_system_prompt: input.agent?.system_prompt || input.agent?.prompt || null,
      assigned_seller_name: assistantSellerName,
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
      audit: { client: supabase, userId: input.agent.user_id, agentId: input.agent.id, agentName: input.agent.name },
      ai_key_ctx: _aiKeyCtx,
      reply_provider_override: dryRun ? ((input.payload as any)?.reply_provider ?? null) : null,
      reply_model_override: dryRun ? ((input.payload as any)?.reply_model ?? null) : null,
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

  // GUARD DE IDEMPOTENCIA (anti-resposta-dupla / relatorio Antigravity #4): se outra
  // invocacao concorrente (instancia serverless paralela) JA respondeu este lead apos a
  // mensagem que disparou este turno, NAO envia de novo — evita resposta dupla no WhatsApp
  // e gasto dobrado de tokens. O debounce ja cobre o caso comum; este fecha a brecha de
  // race (a resposta deste turno so e salva como 'assistant' DEPOIS do envio, abaixo).
  if (!dryRun && reply.ok && lead?.id && myUserMsgId && isPedroV2SendingEnabled()) {
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
      log("info", "pedro_v2_superseded_by_newer_message", { remote_jid: remoteJid, current: myUserMsgId, newer: latestUserMsg.id });
      return {
        ok: true,
        dry_run: dryRun,
        correlation_id: correlationId,
        identity,
        lead_id: lead.id,
        next_action: "duplicate_reply_suppressed",
      };
    }

    if (myUserMsgCreatedAt) {
      const { data: priorAssistant } = await supabase
        .from("wa_chat_history")
        .select("id")
        .eq("agent_id", input.agent.id)
        .eq("remote_jid", remoteJid)
        .eq("role", "assistant")
        .gt("created_at", myUserMsgCreatedAt)
        .limit(1)
        .maybeSingle();
      if (priorAssistant?.id) {
        log("info", "pedro_v2_duplicate_reply_suppressed", { remote_jid: remoteJid });
        return {
          ok: true,
          dry_run: dryRun,
          correlation_id: correlationId,
          identity,
          lead_id: lead.id,
          next_action: "duplicate_reply_suppressed",
        };
      }
    }
  }

  // ALERTA DE FALHA DE IA: se o planner/reply caíram por falta de crédito (quota) ou chave
  // inválida (auth), o agente respondeu em modo "burro" (fallback). Avisa quem pode agir.
  if (!dryRun && _aiKeyCtx.provider_errors && _aiKeyCtx.provider_errors.length > 0) {
    await alertOwnerLlmFailure(supabase, input, _aiKeyCtx.provider_errors, _aiKeyCtx.source, log);
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
      // PRESERVAR FORMATAÇÃO (lista de veículos): a humanização (LLM que reflui em até 3 msgs) DESTRÓI as
      // quebras de linha da lista -> sai tudo grudado/desorganizado (reclamação real do dono). Toda resposta
      // de LISTA de estoque (LLM ou DETERMINÍSTICA: relista/deferral/preço/recuperação/anúncio) vai por
      // typingOnly (texto íntegro, sem split). + heurística: QUALQUER texto com lista numerada ("\n1. ")
      // preserva, independente da source. Conversa normal (sem lista) segue humanizada.
      const _LIST_SOURCES = [
        "stock_fact_reply", "brain_stock_reply", "brain_stock_fallback",
        "brain_ad_vehicle_reply", "brain_ad_vehicle_fallback",
        "denial_without_search_recovered", "category_relisted_deterministic",
        "wrong_price_relisted_deterministic", "search_deferral_resolved",
      ];
      // RESPOSTAS DETERMINÍSTICAS dos guards têm wording INTENCIONAL — a humanização (LLM que reflui) pode
      // INVERTER o sentido. Caso real 99230-7003 (TROCA): o guard `trade_collecting` gerou "Show, anotei tudo
      // do seu carro, pode mandar fotos quando puder" e a humanização reescreveu pra "Tranquilo, não vou tomar
      // seu tempo, qualquer coisa me chama" -> FECHOU no meio da negociação (lead respondeu "aqui agora não",
      // não se despediu). Essas vão VERBATIM (sem humanizar), igual às listas.
      const _VERBATIM_SOURCES = [
        "trade_collecting", "visit_schedule_qualify", "visit_cpf_qualify", "ad_generic_abordagem",
        "vehicle_photos_pick_which", "vehicle_photos_need_reference", "vehicle_photos_ambiguous_model",
        "lone_emoji_no_transfer", "presend_fixed_no_photo_promise", "followup_ping_reengage",
      ];
      const _looksLikeList = /\n\s*\d+[.)]\s/.test(String(reply.text || ""));
      const preserveFormatting = _LIST_SOURCES.includes(reply.source) || _VERBATIM_SOURCES.includes(reply.source) || _looksLikeList;
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
      const hasTextOrMediaOut = Boolean(reply.text || (reply.media && reply.media.length > 0));
      if (hasTextOrMediaOut) {
        try {
          let replyContent = reply.text || "";
          if (!replyContent && reply.media && reply.media.length > 0) {
            const first = reply.media[0];
            if (first.type === "image") replyContent = "[imagem enviada]";
            else if (first.type === "audio") replyContent = "[áudio enviado]";
            else if (first.type === "video") replyContent = "[vídeo enviado]";
            else if (first.type === "document") replyContent = "[documento enviado]";
            else replyContent = "[mídia enviada]";
          }
          await supabase.from("wa_chat_history").insert({
            user_id: input.agent.user_id,
            agent_id: input.agent.id,
            instance_id: input.wa_instance?.instance_name,
            remote_jid: remoteJid,
            role: "assistant",
            content: replyContent,
            metadata: { ...(reply.media && reply.media.length > 0 ? { media: reply.media } : {}), model: (reply as any)._reply_model || null, provider: (reply as any)._reply_provider || null },
          });
        } catch (err) {
          console.warn("[PedroV2] Failed to save assistant reply to chat history:", err);
        }
      }
    }
  } else if (!dryRun && reply.ok) {
    sendResult = { ok: true, dry_run: true, reason: "PEDRO_V2_SEND_ENABLED_disabled" };
    await markAgentReplyForLead(supabase, lead?.id || null);
    const hasTextOrMediaOut = Boolean(reply.text || (reply.media && reply.media.length > 0));
    if (hasTextOrMediaOut) {
      try {
        let replyContent = reply.text || "";
        if (!replyContent && reply.media && reply.media.length > 0) {
          const first = reply.media[0];
          if (first.type === "image") replyContent = "[imagem enviada]";
          else if (first.type === "audio") replyContent = "[áudio enviado]";
          else if (first.type === "video") replyContent = "[vídeo enviado]";
          else if (first.type === "document") replyContent = "[documento enviado]";
          else replyContent = "[mídia enviada]";
        }
        await supabase.from("wa_chat_history").insert({
          user_id: input.agent.user_id,
          agent_id: input.agent.id,
          instance_id: input.wa_instance?.instance_name,
          remote_jid: remoteJid,
          role: "assistant",
          content: replyContent,
          metadata: { ...(reply.media && reply.media.length > 0 ? { media: reply.media } : {}), model: (reply as any)._reply_model || null, provider: (reply as any)._reply_provider || null },
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
  // Nome para o gate de transferencia: aceita tambem o pushName do WhatsApp deste turno
  // (alguns leads chegam sem lead_name salvo). Evita o lead QUALIFICADO ficar preso no robo
  // so porque o campo nome estava vazio. (Hardening relatorio Antigravity #3.)
  const _hasNome = Boolean(_q.nome || lead?.lead_name || pushName);
  const _hasContext = Boolean(_q.interesse) || Boolean(_q.dia_agendamento)
    || _q.tem_troca === true || _q.tem_troca === false || Boolean(_q.valor_entrada) || Boolean(_q.forma_pagamento)
    || Boolean(effectiveMemory?.interesse?.modelo_desejado)
    || (Array.isArray(effectiveMemory?.veiculos_apresentados) && effectiveMemory.veiculos_apresentados.length > 0);
  // FINANCIAMENTO/SIMULACAO = TRANSFERIR JA (o SDR NAO simula). Lead que QUER simular/financiar e
  // ja tem nome + interesse vai pro especialista na hora. Enforcement DETERMINISTICO: o LLM as vezes
  // ignora a regra do prompt e fica pedindo "tem entrada?" (caso real, queima o lead quente). Guarda
  // contra pergunta SO informativa ("voces financiam?") e exige acao clara (quero/simular/como ficam).
  const _txtFin = String(text || "").toLowerCase();
  const _wantsFinanceAction =
    (/\bquero\s+(financiar|parcelar|simular|fechar)\b/.test(_txtFin)
      || /\b(podemos|pode|consigo|tem\s+como|da\s+pra|gostaria\s+de|queria|quero|me)\s+\w*\s*simul/.test(_txtFin)
      || /\b(como|quanto)\s+(fica|ficam|seria|seriam|sai|sairia)\b[^?]*\b(parcel|presta|financ)/.test(_txtFin)
      || /\b(faz|fazer)\s+(uma\s+)?simula/.test(_txtFin))
    && !/\b(voces?|vcs?|a\s+loja|aqui)\s+financia/.test(_txtFin)
    && !/\b(tem|aceita|trabalha[m]?\s+com|fazem?)\s+financiamento\b/.test(_txtFin);
  const _hasInterestFin = Boolean(_q.interesse) || Boolean(effectiveMemory?.interesse?.modelo_desejado)
    || (Array.isArray(effectiveMemory?.veiculos_apresentados) && effectiveMemory.veiculos_apresentados.length > 0);
  // SEMPRE aplica a mensagem LIMPA de transferencia (nao so quando o LLM falha): mesmo quando o
  // LLM marca pronto sozinho, o texto dele as vezes sai contraditorio ("nao temos o Onix" + transfere).
  // So nao mexe se for transferencia SILENCIOSA (lead desqualificado -> outra mensagem/fluxo).
  if (!ownedLeadAssistantMode && _wantsFinanceAction && _hasNome && _hasInterestFin
      && reply?.transferir_silencioso !== true) {
    reply.pronto_para_transferir = true;
    reply.text = "Perfeito! Já vou passar seu atendimento pro nosso especialista de financiamento, ele já entra em contato com você com as melhores condições 😊";
    reply.media = [];
    reply.source = "finance_transfer_enforced";
    log("info", "pedro_v2_finance_transfer_enforced", { lead_id: lead?.id || null });
  }

  // TROCA QUALIFICADA = TRANSFERIR com ANUNCIO (o SDR NAO avalia troca). Quando o lead OFERECE um
  // carro na troca E ja temos o veiculo da TROCA + o INTERESSE de compra + nome, o lead esta pronto
  // pro consultor que avalia a troca e fecha. Enforcement DETERMINISTICO: o LLM as vezes FECHA com
  // "estou a disposicao" (dispensa) ou transfere em SILENCIO em vez de ANUNCIAR o handoff — caso
  // real lead 99710-1211 "Marcos" (colheu Onix+CRLV+valor, interesse Strada, e deu "a disposicao").
  // NAO mexe se: ja em modo-assistente (lead JA atribuido -> evita re-anunciar a cada msg = repeticao),
  // se o cerebro ja escolheu handoff explicito, nem em transferencia silenciosa (desqualificado).
  // Gated em !ownedLeadAssistantMode (igual ao financiamento): transfere+anuncia o lead qualificado
  // AINDA nao atribuido; depois de atribuido o handoff (linha ~2738) ja nao re-transfere.
  const _tradeIntent = String(brainPlan?.intent || contextualIntent?.intent || "") === "trade_in" || _q.tem_troca === true;
  // BUG REAL (lead 99603-7979): checava `_q.veiculo_troca` mas o campo do schema/persistencia e
  // `carro_troca` -> o carro de troca NUNCA era reconhecido -> a transferencia de troca nao disparava
  // e o agente ENCERRAVA o lead quente. Aceita o campo certo + o valor persistido em negociacao.
  const _tradeVehicleName = lead?.trade_in_vehicle || (effectiveMemory?.interesse as any)?.trade_in_vehicle
    || _q.carro_troca || _q.veiculo_troca || (effectiveMemory as any)?.negociacao?.carro_troca || null;
  const _hasTradeVehicle = Boolean(_tradeVehicleName);
  // COLETA da TROCA é etapa CRUCIAL (lead 99628-7178): o agente NÃO pode transferir no MEIO da coleta. Só
  // encaminha DEPOIS de colher os detalhes do carro do lead. Não transfere quando: (a) o lead está
  // DESCREVENDO o carro da troca (km/estado/itens), (b) mandou FOTO/VÍDEO da troca, (c) é o turno da OFERTA
  // (carro de troca citado AGORA pela 1ª vez, ainda sem nada coletado na memória) -> aí o agente PEDE os
  // detalhes. Quando a coleta avança e o lead segue (pergunta de compra / "vamos fechar") -> aí transfere.
  const _leadDescrevendoTroca = leadProvidingTradeDetails(text);
  const _tradeMidiaTurn = mediaContext?.kind === "image" || mediaContext?.kind === "video";
  const _ofertaTrocaFresca = Boolean(_q.carro_troca) && !Boolean((currentMemory as any)?.negociacao?.carro_troca);
  // TROCA = lead QUENTE -> transfere ANUNCIANDO (NUNCA encerra/silencia), MAS só DEPOIS da coleta. O SDR NÃO
  // avalia troca nem promete proposta: quem avalia/traz a proposta é o consultor. (Encerrar troca = barrado
  // pelo v170 "não encerrar lead qualificado".)
  if (!ownedLeadAssistantMode && _tradeIntent && _hasTradeVehicle && _hasNome
      && !_leadDescrevendoTroca && !_tradeMidiaTurn && !_ofertaTrocaFresca
      && contextualIntent.needs_handoff !== true
      && reply?.source !== "finance_transfer_enforced") {
    const _nm = (_q.nome || lead?.lead_name || pushName || "").toString().split(/\s+/)[0] || "";
    reply.pronto_para_transferir = true;
    reply.transferir_silencioso = false; // troca e HOT: anuncia o handoff, NAO encerra em silencio
    reply.text = `Perfeito${_nm ? ", " + _nm : ""}! Já anotei o seu ${String(_tradeVehicleName).trim()} pra avaliação da troca. 😊 Quem faz a avaliação certinha e te traz a proposta é o nosso consultor — já vou passar pra ele, que entra em contato com você!`;
    reply.media = [];
    reply.source = "trade_in_transfer_enforced";
    log("info", "pedro_v2_trade_in_transfer_enforced", { lead_id: lead?.id || null, trade_vehicle: _tradeVehicleName });
  }

  // TEMPERATURA em ACUSACAO DE GOLPE/HOSTILIDADE: o LLM as vezes deixa temperatura=null nesses
  // casos e o lead fica sem classificacao no CRM. Marca 'desqualificado' deterministicamente em
  // sinais INEQUIVOCOS (golpe/fraude/picaretagem). Nao toca deboche leve (pode ser "kkk" positivo).
  if (reply && (!reply.temperatura || reply.temperatura === "morno")
      && /\b(golpe|fraude|picaret|171|estelionat|vigaris|larap|ladr[aã]o|enganaç|enganando|roubando|me roubar|trapac)\b/.test(String(text || "").toLowerCase())) {
    reply.temperatura = "desqualificado";
  }

  // GUARD: NUNCA ENCERRAR (silenciar) UM LEAD QUALIFICADO -> transfere ANUNCIANDO com os dados coletados.
  // Decisao do dono (lead 99603-7979): lead com interesse/contexto + nome e um lead em potencial; vai pro
  // vendedor com tudo, NUNCA "encerra o atendimento". O LLM as vezes le "Grata!"/"obrigado" de um lead
  // engajado como fim e marca transferir_silencioso (encerra). So mantemos o silencio quando o lead
  // REALMENTE recusou (leadExplicitlyDeclined) ou e desqualificado (golpe/hostil). Nao toca finance/troca
  // (ja anunciam) nem handoff explicito (lead pediu humano -> ja anunciado).
  if (!ownedLeadAssistantMode && reply?.transferir_silencioso === true && _hasNome && _hasContext
      && reply?.temperatura !== "desqualificado"
      && !leadExplicitlyDeclined(text)
      && contextualIntent?.needs_handoff !== true
      && reply?.source !== "trade_in_transfer_enforced" && reply?.source !== "finance_transfer_enforced") {
    const _nm = (_q.nome || lead?.lead_name || pushName || "").toString().split(/\s+/)[0] || "";
    reply.transferir_silencioso = false;
    reply.pronto_para_transferir = true;
    reply.text = `Perfeito${_nm ? ", " + _nm : ""}! 😊 Vou passar seu atendimento pro nosso consultor de vendas com tudo o que conversamos — ele já entra em contato com você pra seguir daqui.`;
    reply.media = [];
    reply.source = "qualified_lead_announced_transfer";
    log("info", "pedro_v2_qualified_no_silent_close", { lead_id: lead?.id || null });
  }

  // VISITA/COMPRA -> AGENDAR + COLETAR ANTES de transferir (decisao do dono: poupar o vendedor e colher
  // dados; NUNCA transferir "do nada"). Caso 98861-9201: "Irei ate a loja" -> transferiu cru. Pergunta o
  // dia/horario (+ nome se faltar) ANTES do handoff. Anti-loop: segura SO 1x (marca agendamento_solicitado
  // na memoria); se ja perguntou e o lead nao deu data, NAO trava -> deixa transferir. Nao toca em
  // transferencia de financiamento/troca (essas sao handoff legitimo imediato) nem silenciosa.
  // A última mensagem do AGENTE (pra detectar "Sim" confirmando uma pergunta de agendamento).
  const _lastAgentMsg = (Array.isArray(recentHistory) ? recentHistory : [])
    .filter((h: any) => { const r = String(h?.role || h?.direction || "").toLowerCase(); return r === "assistant" || r === "agent" || r === "ai" || r === "bot"; })
    .map((h: any) => String(h?.content || h?.text || h?.message || ""))
    .pop() || "";
  const _visitBuyIntent = leadExpressesVisitOrBuyIntent(text) || leadAffirmsSchedulingQuestion(text, _lastAgentMsg);
  // VISITA = COLETA EM 2 ETAPAS antes de transferir (decisão do dono: dia + hora + nome + CPF). Cada etapa
  // intercepta a transferência prematura; só LIBERA o handoff quando tem agendamento E CPF. Anti-loop: cada
  // etapa pergunta SÓ 1x (marca *_solicitado); se o lead não der, na 2ª vez deixa transferir (não trava).
  const _hasSchedule = Boolean((_q as any)?.dia_agendamento || (effectiveMemory as any)?.atendimento?.dia_agendamento);
  const _hasCpf = Boolean((_q as any)?.cpf || (effectiveMemory as any)?.qualificacao?.cpf);
  const _askedSchedule = Boolean((effectiveMemory as any)?.atendimento?.agendamento_solicitado);
  const _askedCpf = Boolean((effectiveMemory as any)?.atendimento?.cpf_solicitado);
  // Em fluxo de visita = o lead expressou/confirmou agendar OU já começamos a colher (perguntamos o dia).
  const _inVisitFlow = _visitBuyIntent || _askedSchedule;
  const _visitFlowActive = !ownedLeadAssistantMode && _inVisitFlow && reply?.pronto_para_transferir === true
      && reply?.transferir_silencioso !== true
      && reply?.source !== "finance_transfer_enforced" && reply?.source !== "trade_in_transfer_enforced"
      && contextualIntent?.needs_handoff !== true;
  if (_visitFlowActive && !_hasSchedule && !_askedSchedule) {
    // ETAPA 1 — dia/hora (+ nome se faltar)
    const _nm = (_q?.nome || lead?.lead_name || pushName || "").toString().split(/\s+/)[0] || "";
    const _nmValido = Boolean(_nm) && /[a-zà-ÿ]{2,}/i.test(_nm) && !["cliente", "lead"].includes(_nm.toLowerCase());
    reply.pronto_para_transferir = false;
    reply.text = _nmValido
      ? `Que ótimo, ${_nm}! 😊 Pra eu já deixar tudo certinho com o consultor, qual o melhor dia e horário pra você passar na loja?`
      : `Que ótimo! 😊 Pra eu já deixar tudo certinho com o consultor, me confirma seu nome e qual o melhor dia e horário pra você passar na loja?`;
    reply.media = [];
    reply.source = "visit_schedule_qualify";
    (memoryAfterReply as any).atendimento = { ...((memoryAfterReply as any)?.atendimento || {}), agendamento_solicitado: true };
    log("info", "pedro_v2_visit_schedule_qualify", { lead_id: lead?.id || null, has_name: _nmValido });
  } else if (_visitFlowActive && _hasSchedule && !_hasCpf && !_askedCpf) {
    // ETAPA 2 — CPF (decisão do dono: deixar o cadastro pronto pro vendedor agilizar a visita)
    reply.pronto_para_transferir = false;
    reply.text = `Show, já anotei seu horário! 😊 Por último, me passa seu CPF? É só pra eu já deixar seu cadastro pronto pro consultor — assim ele agiliza tudo na sua visita.`;
    reply.media = [];
    reply.source = "visit_cpf_qualify";
    (memoryAfterReply as any).atendimento = { ...((memoryAfterReply as any)?.atendimento || {}), cpf_solicitado: true };
    log("info", "pedro_v2_visit_cpf_qualify", { lead_id: lead?.id || null });
  }

  // COLETA DA TROCA EM ANDAMENTO -> NÃO transferir nem encerrar AGORA (último guard antes do handoff). O
  // lead está DESCREVENDO o carro (km/estado/itens) ou mandou FOTO/VÍDEO dele: o agente acolhe e SEGUE
  // colhendo (caso 99628-7178: transferiu no meio e perdeu km/estado/fotos). Cobre o LLM/qualquer
  // enforcement que tenha marcado transferir/encerrar no meio da coleta. Não toca em handoff explícito
  // (lead pediu humano) nem em lead JÁ atribuído (assistant mode).
  if (!ownedLeadAssistantMode && contextualIntent?.needs_handoff !== true
      && (_tradeIntent || _hasTradeVehicle) && (_leadDescrevendoTroca || _tradeMidiaTurn)
      && (reply?.pronto_para_transferir === true || reply?.transferir_silencioso === true)) {
    reply.pronto_para_transferir = false;
    reply.transferir_silencioso = false;
    // Acolhe + pergunta SÓ o que ainda falta (não re-pergunta interesse/nome que já temos).
    const _temInteresse = Boolean((effectiveMemory as any)?.interesse?.modelo_desejado || _q?.interesse);
    const _temNomeReal = Boolean(_q?.nome || lead?.lead_name || (pushName && /\p{L}{2,}/u.test(String(pushName))));
    let _pede = " Pode mandar mais detalhes ou fotos do seu carro, se quiser. 😊";
    if (!_temInteresse && !_temNomeReal) _pede = " E me confirma: qual veículo nosso te interessou e como é o seu nome? 😊";
    else if (!_temInteresse) _pede = " E qual veículo nosso te interessou? 😊";
    else if (!_temNomeReal) _pede = " E como é o seu nome? 😊";
    reply.text = `Show, anotei tudo do seu carro! 🙌 Pra eu já adiantar pro nosso consultor que avalia a troca:${_pede}`;
    reply.media = [];
    reply.source = "trade_collecting";
    log("info", "pedro_v2_trade_collecting_no_transfer", { lead_id: lead?.id || null });
  }

  // SALVAGUARDA reação/emoji solto (caso 99146-6876): um LONE EMOJI/ack ("👍","👌","❤️", sem letras/dígitos)
  // NUNCA justifica TRANSFERIR — é no máximo um "sim" pra uma pergunta pendente, jamais "me transfere". A 1ª
  // defesa é IGNORAR a reação no webhook; isto cobre uma reação que escape da detecção OU um emoji ENVIADO.
  const _loneAck = String(text || "").trim().length > 0 && !/[\p{L}\d]/u.test(String(text || ""));
  if (_loneAck && (reply?.pronto_para_transferir === true
      || ["trade_in_transfer_enforced", "finance_transfer_enforced"].includes((reply as any)?.source))) {
    reply.pronto_para_transferir = false;
    reply.transferir_silencioso = false;
    const _focoEmoji = (effectiveMemory as any)?.interesse?.modelo_desejado || null;
    reply.text = _focoEmoji
      ? `😊 Quer seguir com o ${_focoEmoji} então? Posso te passar mais detalhes ou já agendar sua visita.`
      : `😊 Me conta o que prefere: te passo mais detalhes de algum carro ou já agendamos uma visita?`;
    reply.media = [];
    reply.source = "lone_emoji_no_transfer";
    log("info", "pedro_v2_lone_emoji_no_transfer", { lead_id: lead?.id || null });
  }

  // FUNIL ANTES DO HANDOFF: interesse curto ("Gostei", "Quero esse") nao basta para transferir.
  // Se o cerebro marcou pronto, mas ainda existe pergunta obrigatoria do bloco4 sem resposta,
  // segura o handoff e conduz a proxima pergunta do SDR. Nao bloqueia pedido explicito de humano,
  // nem os enforcements deterministas de financiamento/troca ja qualificados.
  if (!ownedLeadAssistantMode
      && contextualIntent?.needs_handoff !== true
      && reply?.temperatura !== "desqualificado"
      && reply?.source !== "finance_transfer_enforced" && reply?.source !== "trade_in_transfer_enforced"
      && (reply?.pronto_para_transferir === true || reply?.transferir_silencioso === true)) {
    const _b4Handoff = (input.agent as any)?.funnel_bloco4;
    const _fqHandoff: any = {
      ..._q,
      nome: _q.nome || lead?.lead_name || pushName || null,
      interesse: _q.interesse || (effectiveMemory as any)?.interesse?.modelo_desejado || (effectiveMemory as any)?.interesse?.tipo_veiculo || null,
      tem_troca: _q.tem_troca ?? (effectiveMemory as any)?.negociacao?.tem_troca ?? null,
      carro_troca: _q.carro_troca || _q.veiculo_troca || (effectiveMemory as any)?.negociacao?.carro_troca || null,
      valor_entrada: _q.valor_entrada || (effectiveMemory as any)?.negociacao?.valor_entrada || null,
      forma_pagamento: _q.forma_pagamento || (effectiveMemory as any)?.negociacao?.forma_pagamento || null,
      sabe_localizacao: _q.sabe_localizacao ?? (effectiveMemory as any)?.atendimento?.sabe_localizacao ?? null,
      dia_agendamento: _q.dia_agendamento || (effectiveMemory as any)?.atendimento?.dia_agendamento || null,
      cpf: _q.cpf || (effectiveMemory as any)?.qualificacao?.cpf || null,
    };
    const _hasInterestFunnel = Boolean(_fqHandoff.interesse)
      || (Array.isArray((effectiveMemory as any)?.veiculos_apresentados) && (effectiveMemory as any).veiculos_apresentados.length > 0);
    const _nextFunnelBeforeHandoff = nextFunnelQuestion(_b4Handoff, _fqHandoff, { hasName: _hasNome, hasInterest: _hasInterestFunnel });
    if (_nextFunnelBeforeHandoff) {
      reply.pronto_para_transferir = false;
      reply.transferir_silencioso = false;
      reply.media = [];
      reply.source = "handoff_blocked_pending_funnel";
      reply.text = `Perfeito! Antes de eu te encaminhar para o consultor, preciso completar rapidinho seu atendimento.\n\n${_nextFunnelBeforeHandoff}`;
      log("info", "pedro_v2_handoff_blocked_pending_funnel", { lead_id: lead?.id || null, question: _nextFunnelBeforeHandoff });
    }
  }
  const brainReadyToTransfer = reply?.pronto_para_transferir === true && _hasNome && _hasContext;
  // Transferencia SILENCIOSA: lead desqualificado (recusou EXPLICITAMENTE) -> vai para o
  // vendedor para follow-up futuro, SEM anunciar ao lead (a msg do cerebro ja e uma
  // despedida gentil, sem dizer que vai transferir). NUNCA encerramos sem encaminhar.
  const silentTransfer = reply?.transferir_silencioso === true && _hasNome && !brainReadyToTransfer && !contextualIntent.needs_handoff;
  // CLAREZA da transferência ANUNCIADA (lead 98198-7661): a msg do BLOCO 7 do cliente nem sempre deixa
  // claro que o CONSULTOR vai entrar em contato com o LEAD. Garante o fecho ("ele já vai entrar em contato
  // com você. Obrigado!") quando falta. Só na anunciada (a silenciosa é despedida gentil sem anunciar).
  if ((brainReadyToTransfer || contextualIntent.needs_handoff === true) && !silentTransfer && reply?.transferir_silencioso !== true) {
    const _tc = ensureTransferContactClarity((reply as any)?.text || "");
    if (_tc.changed) {
      reply = { ...(reply as any), text: _tc.text };
      log("info", "pedro_v2_transfer_clarity_added", { lead_id: lead?.id || null });
    }
  }
  // Transferencia automatica (qualificacao/silenciosa) respeita a regra do agente:
  // se o gerente desligou a transferencia, o agente NAO repassa (atende sozinho).
  const _automationRules = resolveAutomationRules(input.agent?.automation_rules);
  // Veiculo de interesse para o relatorio de transferencia: prioriza o que ja
  // esta na memoria (modelo do lead / veiculo do anuncio / apresentados) e cai
  // para o veiculo do anuncio deste turno. Garante que o vendedor SEMPRE saiba
  // qual carro o lead veio buscar (em especial leads de anuncio que so dizem
  // "tenho interesse").
  const _veiculoInteresse = pickInterestVehicleFromState(effectiveMemory)
    || (adContext?.vehicle_query ? String(adContext.vehicle_query).trim() : null)
    || (vehicleResolution?.query ? String(vehicleResolution.query).trim() : null)
    || null;
  if (!dryRun && lead?.id && !ownedLeadAssistantMode && _automationRules.transfer.enabled && (contextualIntent.needs_handoff || brainReadyToTransfer || silentTransfer) && identity.kind !== "seller") {
    try {
      handoffResult = await executePedroV2Handoff(supabase, {
        user_id: input.agent.user_id,
        agent_id: input.agent.id,
        lead_id: lead.id,
        remote_jid: remoteJid,
        lead_name: _q.nome || lead.lead_name || pushName || null,
        reason: contextualIntent.needs_handoff ? `handoff:${brainPlan?.intent || contextualIntent.intent || "humano"}` : (silentTransfer ? "handoff:desqualificado_silencioso_followup" : "handoff:qualificado_pronto"),
        qualificacao: { ...(_q as any), duvidas_pendentes: _allDuvidas },
        seller_response_min: _automationRules.transfer.seller_response_min,
        veiculo_interesse: _veiculoInteresse,
        // RECUPERACAO por follow-up: força o MESMO vendedor do 1o atendimento (rule #3),
        // mesmo que ele nao tenha confirmado antes (senao cairia no rodizio).
        preferred_seller_id: reactivationRecovery ? reactivationSellerId : null,
      });
      if (handoffResult?.ok && handoffResult.seller?.whatsapp_number && isPedroV2SendingEnabled()) {
        const handoffInstance = input.wa_instance || await resolvePedroInstance(supabase, {
          user_id: input.agent.user_id,
          agent_id: input.agent.id,
          instance_id: input.wa_instance?.id,
        });
        const leadPhone = remoteJidToPhone(remoteJid);
        // Lead que RETORNOU para o vendedor que ja o atendia: o vendedor JA e dono,
        // entao nao pedimos "Responda Ok para assumir" (so avisamos do retorno).
        const isRenotify = handoffResult.reason === "returning_lead_renotify";
        // STATUS PADRONIZADO do lead (mesmo nos 2 caminhos). Derivado dos sinais
        // que ja existem — nada inventado.
        const _temp = String((reply as any)?.temperatura || "").toLowerCase();
        // 3 CATEGORIAS do SDR (decisao do dono 04/06): 🎯 Qualificado / 🧊 Pouco
        // Qualificado / 💤 Inativo. Derivado dos dados coletados (qualificacao_coletada
        // + carro do anuncio). silentTransfer (lead frio/desqualificado) NUNCA e
        // 'qualificado'. A mesma regra alimenta o briefing E o status_crm gravado abaixo.
        const _qcCat = {
          client_name: _q.nome || lead?.lead_name || pushName || null,
          vehicle_interest: _q.interesse || _veiculoInteresse || (effectiveMemory as any)?.interesse?.modelo_desejado || null,
          payment_method: _q.forma_pagamento || null,
          trade_in_vehicle: _q.carro_troca || null,
          down_payment: _q.valor_entrada || null,
          visit_scheduled: _q.dia_agendamento || null,
          cpf: (_q as any).cpf || null,
          status_crm: (lead as any)?.status_crm || null,
        };
        const _sdrCat = classifyLeadSdrCategory(_qcCat, { ready_to_transfer: brainReadyToTransfer && !silentTransfer });
        // Selo de RECUPERACAO: lead que tinha esfriado e voltou pelo follow-up. Vai no topo
        // do briefing do vendedor E do gerente (rules #4 e #5), sem mudar o resto.
        const _recoveryTag = reactivationRecovery ? "♻️ *RECUPERADO PELO FOLLOW-UP*\n" : "";
        // Cabecalho: so distingue o lead que RETORNOU (vendedor ja e dono). Nos demais,
        // titulo neutro — a categoria vai na linha de status (so as 3 categorias).
        const sellerHeader = isRenotify
          ? `*LEAD RETORNOU (Pedro v2)*\nUm cliente que ja era seu voltou a conversar. Retome o atendimento.`
          : `*NOVO LEAD PARA ATENDIMENTO (Pedro v2)*`;
        const sellerFooter = isRenotify
          ? `*Atender:* https://wa.me/${leadPhone}`
          : `*Atender:* https://wa.me/${leadPhone}\n\n*Responda "Ok" para assumir este atendimento!*`;
        // Etiquetas pros templates personalizados (vendedor/gerente). Se o agente NAO
        // tem template salvo, composeSellerMsg/composeGerenteMsg caem no fallback inline
        // de sempre -> quem nao mexeu NAO muda nada (aditivo, gated, seguro p/ producao).
        const _msgVars = buildEtiquetas(effectiveMemory, {
          agentName: input.agent?.name,
          leadName: lead.lead_name || pushName,
          leadPhone: leadPhone,
          sellerName: handoffResult.seller?.name,
          sellerPhone: handoffResult.seller?.whatsapp_number,
          temperatura: _temp,
          interesse: _veiculoInteresse,
          classificacao: sdrCategoryText(_sdrCat),
          horario: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
          resumo: handoffResult.briefing,
        });
        const _sellerInline = `${sellerHeader}\n\n${_recoveryTag}*Cliente:* ${lead.lead_name || pushName || "Desconhecido"}\n${sdrCategoryLine(_sdrCat)}\n*Contato:* +${leadPhone}${_veiculoInteresse ? `\n🚗 *Veículo:* ${_veiculoInteresse}` : ""}\n*Agente IA:* ${input.agent?.name || "Agente"}\n\n--------------------\n${handoffResult.briefing}\n--------------------\n\n${sellerFooter}`;
        const sellerNotif = maybeStripEmojis(input.agent, composeSellerMsg(input.agent, _msgVars, _sellerInline));
        await sendPedroText(handoffInstance, { to: handoffResult.seller.whatsapp_number, text: sellerNotif });
        // ETIQUETA SDR no WhatsApp Business (UAZAPI): marca o chat com a categoria do lead
        // (🎯 Qualificado / 🧊 Pouco qualificado / 💤 Inativo) NO MOMENTO da transferencia.
        // Nao bloqueante (try/catch interno) e gated por PEDRO_FF_WA_LABELS='on'.
        await setSdrLabelOnChat(handoffInstance, leadPhone, _sdrCat);

        // Relatorio automatico ao(s) gerente(s) — ate 2 (mesma regra do portal).
        // Nao dispara em re-aviso de lead que retornou (evita relatorio repetido
        // do mesmo lead a cada vez que ele volta a falar).
        const _gerentes = managerPhones(input.agent);
        if (!isRenotify && _gerentes.length > 0) {
          const _hora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
          // Feedback do gerente: COMPLETO (mesmo briefing do vendedor + qual vendedor
          // atende) quando o agente liga gerente_feedback_completo; senao o RESUMIDO.
          const _mgrNum = String(handoffResult.seller?.whatsapp_number || "").replace(/\D/g, "");
          const _mgrMsg = maybeStripEmojis(input.agent, (input.agent?.gerente_feedback_completo === true)
            ? `${_recoveryTag}🧑‍💼 *Vendedor atribuído:* ${handoffResult.seller?.name || "Vendedor"}${_mgrNum ? ` — wa.me/${_mgrNum}` : ""}\n\n${sellerNotif}`
            : composeGerenteMsg(input.agent, _msgVars, `📊 *RELATÓRIO DE LEAD — ${input.agent?.name || "Agente"}*\n\n${_recoveryTag}🕐 *Horário:* ${_hora}\n\n👤 *Lead:* ${lead.lead_name || pushName || "Desconhecido"}\n📱 *Telefone:* +${leadPhone}\n🏷️ *Status:* ${sdrCategoryText(_sdrCat)}${_veiculoInteresse ? `\n🚗 *Veículo de interesse:* ${_veiculoInteresse}` : ""}\n\n━━━━━━━━━━━━━━━━━━━━\n\n🎯 *Enviado para:* ${handoffResult.seller?.name || "Vendedor"}\n📲 *WhatsApp vendedor:* ${handoffResult.seller?.whatsapp_number || ""}\n\n━━━━━━━━━━━━━━━━━━━━\n_Gerado automaticamente pelo Pedro SDR_`));
          for (const gp of _gerentes) {
            try { await sendPedroText(handoffInstance, { to: gp, text: _mgrMsg }); } catch (_e) { /* nao bloqueante */ }
          }
        }

        // RECUPERACAO: marca a reativacao como 'transferred' (encerra a fila de cutucao +
        // alimenta o dashboard de recuperados, rule #6). So quando veio do follow-up.
        if (reactivationRecovery) {
          try {
            await supabase.from("pedro_followup_reactivation")
              .update({ status: "transferred", transferred_at: new Date().toISOString() })
              .eq("lead_id", lead.id);
          } catch (_e) { /* nao bloqueante */ }
        }

        // PERSISTENCIA PRO DASHBOARD: grava a categoria (status_crm) + os dados coletados
        // na tabela do lead. NUNCA sobrescreve um estado movido pelo vendedor (classifyLeadSdr
        // preserva PROTECTED) nem apaga dado existente (so escreve campo com valor). Best-effort:
        // a persistencia jamais derruba a transferencia, que ja foi enviada acima.
        try {
          const _persistCat = classifyLeadSdr({ ..._qcCat, status_crm: (lead as any)?.status_crm }, { ready_to_transfer: brainReadyToTransfer && !silentTransfer });
          const { safe, extra } = mapQualificacaoToLeadColumns(_q, _temp);
          const _leadPatch: Record<string, any> = { ...safe };
          if (["inativo", "pouco_qualificado", "qualificado"].includes(_persistCat as string)) {
            _leadPatch.status_crm = _persistCat;
          }
          // Bloco D (Cabine de Comando): qualidade do lead (bom/medio/ruim) p/ "de qual
          // anúncio vêm os bons". Derivada dos sinais que o Pedro JÁ tem (temperatura +
          // categoria SDR) — nada inventado. Vai no MESMO _leadPatch (zero round-trip
          // extra). Atrás do flag handoff_qualidade; best-effort nunca derruba o handoff.
          try {
            if (await isFeatureEnabled(supabase, input.agent.user_id, "handoff_qualidade")) {
              const _qual = mapQualidadeLead(_temp, _persistCat);
              if (_qual) {
                _leadPatch.qualidade_lead = _qual.qualidade;
                _leadPatch.motivo_classificacao = _qual.motivo;
                _leadPatch.classificado_em = new Date().toISOString();
                _leadPatch.classificado_por = "pedro";
              }
            }
          } catch (_eq) { /* classificação best-effort */ }
          if (Object.keys(_leadPatch).length > 0) {
            await supabase.from("ai_crm_leads").update(_leadPatch).eq("id", lead.id);
          }
          if (Object.keys(extra).length > 0) {
            try { await supabase.from("ai_crm_leads").update(extra).eq("id", lead.id); } catch (_e2) { /* colunas de tipo incerto */ }
          }
        } catch (_e) { /* persistencia best-effort */ }
      }
    } catch (e) {
      console.warn("[PedroV2] Falha ao executar handoff (Etapa C):", e);
    }
  }

  if (!dryRun && lead?.id && reply.ok) {
    // AMNESIA CONVERSACIONAL (fix relatorio mestre #2): o cerebro (gpt-4o) extrai os dados
    // qualificados em 'qualificacao_coletada' (nome, interesse REAL de compra, troca,
    // entrada, pagamento, agendamento), mas isso NAO era persistido — o estado estruturado
    // ficava vazio e o agente repetia as MESMAS perguntas no turno seguinte. Aqui mesclamos
    // de volta na memoria. Bonus: como o LLM separa 'interesse' (compra) de 'carro_troca',
    // isso tambem CORRIGE a poluicao do carro de troca em interesse.modelo_desejado.
    const _qc = (reply?.qualificacao_coletada && typeof reply.qualificacao_coletada === "object") ? reply.qualificacao_coletada : null;
    let memToSave: any = memoryAfterReply || {};
    if (_qc) {
      const _b = (v: any) => v === true || v === false;
      memToSave = {
        ...memToSave,
        lead: { ...(memToSave.lead || {}), nome: _qc.nome || memToSave.lead?.nome || null },
        interesse: {
          ...(memToSave.interesse || {}),
          modelo_desejado: _qc.interesse || memToSave.interesse?.modelo_desejado || null,
        },
        negociacao: {
          ...(memToSave.negociacao || {}),
          tem_troca: _b(_qc.tem_troca) ? _qc.tem_troca : memToSave.negociacao?.tem_troca ?? null,
          carro_troca: _qc.carro_troca || memToSave.negociacao?.carro_troca || null,
          valor_entrada: _qc.valor_entrada || memToSave.negociacao?.valor_entrada || null,
          forma_pagamento: _qc.forma_pagamento || memToSave.negociacao?.forma_pagamento || null,
        },
        atendimento: {
          ...(memToSave.atendimento || {}),
          sabe_localizacao: _b(_qc.sabe_localizacao) ? _qc.sabe_localizacao : memToSave.atendimento?.sabe_localizacao ?? null,
          dia_agendamento: _qc.dia_agendamento || memToSave.atendimento?.dia_agendamento || null,
          duvidas_pendentes: _allDuvidas.length > 0 ? _allDuvidas : (memToSave.atendimento?.duvidas_pendentes || null),
        },
      };
    } else if (_allDuvidas.length > 0) {
      // sem qualificacao nova, mas houve duvida neutralizada neste turno -> persiste mesmo assim.
      memToSave = { ...memToSave, atendimento: { ...(memToSave.atendimento || {}), duvidas_pendentes: _allDuvidas } };
    }
    // ── CÉREBRO DA CONVERSA: atualiza o VEÍCULO EM FOCO (o carro que a conversa discute) pro PRÓXIMO turno.
    // SUBSTITUÍVEL: foto enviada / carro resolvido NESTE turno = foco novo (o lead pode PIVOTAR de carro);
    // o lead AMPLIOU pra um TIPO (categoria) = LIMPA o foco (navegação de lista, sem foco único); senão
    // MANTÉM o foco anterior. Persiste junto (saveRecentConversationTurn faz ...current). Resolve "fotos
    // dele / mais detalhes" no carro certo no turno seguinte, sem perder o contexto (decisão do dono).
    {
      const _norm = (s: any) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const _snap = (v: any) => {
        if (!v) return null;
        const fotos = Array.isArray(v?.fotos) ? v.fotos.filter(Boolean).slice(0, 15) : [];
        return {
          key: vehicleKey(v),
          label: cleanVehicleLabel(v) || [v?.marca, v?.modelo, v?.ano].filter(Boolean).join(" ") || null,
          marca: v?.marca ?? null, modelo: v?.modelo ?? null, versao: v?.versao ?? null,
          ano: v?.ano ?? null, preco: v?.preco ?? null, km: v?.km ?? null, cor: v?.cor ?? null,
          cambio: v?.cambio ?? null, combustivel: v?.combustivel ?? null, fotos,
          at: new Date().toISOString(),
        };
      };
      let _novoFoco: any = (memToSave as any)?.veiculo_em_foco || null;
      try {
        if (_broadCategoryBrowse) {
          _novoFoco = null;
        } else if (reply?.source === "vehicle_photos_reply" && (reply as any)?.vehicle) {
          _novoFoco = _snap((reply as any).vehicle) || _novoFoco;
        } else {
          const _rq = _norm((vehicleResolution as any)?.query || (brainPlan as any)?.search_query || "");
          if (_rq) {
            const _src = [
              ...(Array.isArray(stockResult?.items) ? stockResult.items : []),
              ...(Array.isArray((memToSave as any)?.veiculos_apresentados) ? (memToSave as any).veiculos_apresentados : []),
            ];
            const _hit = _src.find((v: any) => {
              const m = _norm(v?.modelo); const tok = m.split(/\s+/)[0];
              return (m && _rq.includes(m)) || (tok && tok.length >= 3 && _rq.includes(tok));
            });
            if (_hit) _novoFoco = _snap(_hit) || _novoFoco;
          }
        }
      } catch { /* mantém o foco anterior */ }
      (memToSave as any).veiculo_em_foco = _novoFoco;
    }
    // ── PENDING_QUESTION PERSISTIDO (Codex): grava O QUE ESTA RESPOSTA do agente perguntou/ofereceu, pro
    // PRÓXIMO turno interpretar o "sim/ok/👍/2024" do lead a partir do estado (não re-parseando a última
    // fala, que pode vir duplicada/atrasada). O planner (classifyPendingQuestion) PREFERE este valor.
    try { (memToSave as any).pending_question = classifyAgentReplyPending((reply as any)?.text, (reply as any)?.source); }
    catch { /* best-effort, nunca derruba o turno */ }
    memoryAfterReply = await saveRecentConversationTurn(supabase, {
      lead_id: lead.id,
      agent_id: input.agent.id,
      user_id: input.agent.user_id,
      current: memToSave,
      incoming_text: text,
      reply_text: reply.text || "",
      reply_source: reply.source || null,
    });
    // PERSISTENCIA POR TURNO (pro dashboard E pra cron de inatividade ja achar os dados
    // na hora de transferir): grava na tabela do lead o que o cerebro coletou NESTE turno.
    // So campos com valor (nunca apaga o que o vendedor preencheu), best-effort (nunca
    // derruba o turno). NAO mexe em status_crm aqui — a categoria e definida na transferencia.
    if (_qc) {
      try {
        const { safe, extra } = mapQualificacaoToLeadColumns(_qc, String((reply as any)?.temperatura || "").toLowerCase() || null);
        if (Object.keys(safe).length > 0) await supabase.from("ai_crm_leads").update(safe).eq("id", lead.id);
        if (Object.keys(extra).length > 0) {
          try { await supabase.from("ai_crm_leads").update(extra).eq("id", lead.id); } catch (_e2) { /* coluna de tipo incerto */ }
        }
      } catch (_e) { /* persistencia best-effort */ }
    }
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
        grounding_corrected: (reply as any)?.grounding_corrected === true,
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
    ai_key_source: _aiKeyCtx.source,
    ai_provider_errors: _aiKeyCtx.provider_errors,
    next_action: sendResult?.ok ? "reply_sent" : dryRun ? "dry_run_reply_planned" : "reply_generated",
  };
}
