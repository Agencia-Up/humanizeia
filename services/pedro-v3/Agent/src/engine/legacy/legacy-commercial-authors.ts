// ============================================================================
// legacy-commercial-authors.ts — autoria determinística exclusiva de replay.
//
// Este módulo não é importado pelo caminho ativo para conduzir conversa. Ele
// preserva os handlers antigos somente para harnesses de replay explicitamente
// autorizados; a política de habilitação permanece em legacy-replay.ts.
// ============================================================================
import type { TurnContext } from "../../domain/context.ts";
import type { ConversationState } from "../../domain/conversation-state.ts";
import type { AgentToolObservation, BusinessInfoTopic } from "../../domain/agent-brain.ts";
import type {
  ProposedDecision,
  ProposedEffectPlan,
  QueryResult,
  ResponseDraft,
  TurnAction,
  TurnDecision,
} from "../../domain/decision.ts";
import type { RenderedResponse } from "../../domain/decision.ts";
import type { RememberedVehicleIdentity, VehicleFact } from "../../domain/types.ts";
import type { LeadEngagement } from "../lead-intent.ts";
import type { RelaxKind } from "../commercial-constraints.ts";
import {
  authorizesPhotoByResolvedTarget,
  authorizesPhotoSend,
  leadRequestsPhoto,
  targetAcceptsKey,
  type TargetResolution,
  type TargetResolutionSource,
  type ValidatedUnderstanding,
} from "../turn-understanding.ts";
import { selectPhotos } from "../photo-selection.ts";
import { institutionalTopicsRequested, mentionsContact } from "../turn-domain.ts";
import { PolicyEngine, hasDeny } from "../policy-engine.ts";
import { ResponseRenderer } from "../response-renderer.ts";
import { finalize } from "../finalizer.ts";
import { ensureSendMessage } from "../central-turn-io.ts";
import { canonicalVehicleLabel } from "../vehicle-label.ts";

// ── P0-C (audit): EXECUTOR DETERMINÍSTICO de foto. Usado no single-author quando o cérebro NÃO autorou resposta
//    aterrada. Pedido de foto + alvo resolvido (ordinal/modelo da última lista ou selecionado) + vehicle_photos_resolve
//    OK com photoIds -> materializa send_media (nunca fallback genérico). Sem alvo/lista -> pede qual veículo (não
//    consulta arbitrário). Alvo resolvido mas sem photoIds -> honesto e específico. PURO. ───────────────────────────
export function buildDeterministicPhotoResponse(args: {
  readonly leadMessage: string;
  readonly ctx: TurnContext;
  readonly facts: readonly QueryResult[];
  readonly identities: readonly RememberedVehicleIdentity[];
  readonly turnId: string;
  readonly photoVU: ValidatedUnderstanding | null;   // P0-2: vU que autoriza foto (llmFirst=cérebro; senão fallback)
  readonly requireBrain: boolean;
  readonly target: TargetResolution;                 // P0-1: alvo do assunto (verificado por modelo)
  readonly adCandidateKeys: readonly string[];       // Fix C: candidatos do anúncio (>1 -> pergunta qual, lista só eles)
}): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[]; targetSource: TargetResolutionSource } | null {
  // P0-2: em llmFirst sem cérebro NÃO envia — EXCETO alvo resolvido (ordinal/anúncio/seleção/modelo) + pedido de foto (grounding
  // máximo; nunca "foto solta"), OU conjunto CANDIDATO do anúncio (>1) + pedido de foto (aí pergunta QUAL, não escolhe errado).
  if (!authorizesPhotoSend(args.photoVU, args.leadMessage, args.requireBrain) && !authorizesPhotoByResolvedTarget(args.target, args.leadMessage, args.ctx.state) && !(args.adCandidateKeys.length > 1 && leadRequestsPhoto(args.leadMessage))) return null;
  const state = args.ctx.state;
  const factsArr = [...args.facts];
  const build = (proposedEffects: ProposedEffectPlan[], text: string, action: TurnAction, reasonCode: string, reasonSummary: string, confidence: number, targetSource: TargetResolutionSource) => {
    const proposal: ProposedDecision = { proposedAction: action, facts: [], proposedEffects, responsePlan: { guidance: text }, reasonCode, reasonSummary, confidence };
    const post = PolicyEngine.postQuery(proposal, factsArr, args.ctx);
    if (hasDeny(post)) return null;
    const decision = finalize(args.turnId, proposal, post, factsArr);
    return { decision, composed: { draft: { parts: [{ type: "text" as const, content: text }] }, text }, proposedEffects, targetSource };
  };
  // P0-1: o ALVO vem do ASSUNTO (ordinal/modelo verificado/pronome), NUNCA de um photo fact solto. Ambíguo/ausente -> pergunta.
  const target = args.target;
  const hasList = (state.lastRenderedOfferContext?.items?.length ?? 0) > 0;
  if (target.kind !== "resolved") {
    // Fix C: pedido de foto do anúncio com >1 CANDIDATO (ex.: 2 Onix 2025) -> lista SÓ os candidatos do anúncio e pergunta
    // qual, NUNCA re-lista o estoque todo nem escolhe errado. Aterrado nos itens já ofertados (marca/modelo/ano/preço reais).
    const candItems = (state.lastRenderedOfferContext?.items ?? []).filter((it) => args.adCandidateKeys.includes(it.vehicleKey));
    if (candItems.length > 1) {
      const lines = candItems.slice(0, 4).map((it, i) => { const lbl = [it.marca, it.modelo, it.ano].filter(Boolean).join(" "); const price = typeof it.preco === "number" && it.preco > 0 ? ` — R$ ${it.preco.toLocaleString("pt-BR")}` : ""; return `${i + 1}. ${lbl}${price}`; });
      const text = `Do anúncio, temos essas opções:\n${lines.join("\n")}\nDe qual você quer as fotos? Me diz o número ou o ano.`;
      return build(ensureSendMessage([]), text, "clarify", "photo_clarify_ad_candidates", "pedido de foto do anúncio com >1 candidato -> lista só os candidatos do anúncio", 0.6, "ambiguous");
    }
    const text = target.kind === "ambiguous"
      ? `Temos mais de uma opção${target.subjectModel ? ` de ${target.subjectModel}` : ""}. De qual você quer as fotos? Me diz o número ou o ano.`
      : (hasList ? "De qual carro da lista você quer as fotos? Me diz o número ou o modelo." : "Claro! De qual carro você quer ver as fotos?");
    return build(ensureSendMessage([]), text, "clarify", "photo_clarify_which", "pedido de foto sem alvo único do assunto", 0.5, target.kind === "ambiguous" ? "ambiguous" : "none");
  }
  const targetKey = target.vehicleKey;
  const label = canonicalVehicleLabel(targetKey, args.facts, args.identities, state);
  // P0-1: a foto SÓ vale se o vehicle_photos_resolve for do ALVO (key ∈ candidates). Fato de outro carro é IGNORADO.
  const photos = args.facts.find(
    (f): f is Extract<QueryResult, { ok: true; tool: "vehicle_photos_resolve" }> =>
      f.ok && f.tool === "vehicle_photos_resolve" && f.data.vehicleKey === targetKey && targetAcceptsKey(target, f.data.vehicleKey) && f.data.photoIds.length > 0,
  );
  if (photos) {
    // PARTE B (missão): anexa mark_photos_sent para o photoLedger ACUMULAR os IDs enviados (dedup durável de "manda mais").
    // Os photoIds aqui são o conjunto completo; a CURADORIA (cap 5 + dedup) é aplicada 1x no chokepoint capPhotoEffects,
    // que reescreve ESTE onSuccess para os IDs realmente enviados. (Antes era onSuccess:[] e o ledger não populava.)
    // ⭐CADEIA DE MÍDIA: também aqui o snapshot resolvido pela tool acompanha o plano (o executor legado usa o MESMO
    // dispatcher, então precisa do mesmo contrato — senão este caminho continuaria relendo o feed no envio).
    const media: ProposedEffectPlan = { kind: "send_media", planId: "photos", order: 1, onSuccess: [{ op: "mark_photos_sent", effectId: "x", vehicleKey: targetKey, photoIds: [...photos.data.photoIds] }], vehicleKey: targetKey, photoIds: [...photos.data.photoIds], ...(photos.data.media ? { media: photos.data.media } : {}) };
    const text = label ? `Aqui estão as fotos do ${label}. Quer que eu te passe mais detalhes dele?` : "Aqui estão as fotos que você pediu. Quer que eu te passe mais detalhes desse carro?";
    return build(ensureSendMessage([media]), text, "send_photos", "send_vehicle_photos", "executor determinístico de foto (alvo do assunto + photoIds reais)", 0.9, target.source);
  }
  const text = label ? `Não localizei as fotos do ${label} agora. Quer que eu te passe os detalhes dele por aqui?` : "Não localizei as fotos desse carro agora. Quer que eu te passe os detalhes dele por aqui?";
  return build(ensureSendMessage([]), text, "clarify", "photo_unavailable", "alvo resolvido mas sem photoIds do assunto", 0.4, target.source);
}

// ── PARTE B (missão): CURADORIA de fotos no chokepoint ÚNICO da decisão finalizada. Limita o payload de send_media a
//    até 5 fotos com DIVERSIDADE (photo-selection) e remove as JÁ ENVIADAS (dedup durável: photoLedger ∪ lastPhotoAction
//    do MESMO veículo). NÃO muda a decisão do cérebro (mesmo carro, mesma fala) — só seleciona melhor o payload de mídia.
//    Reescreve também o onSuccess mark_photos_sent para os IDs REALMENTE enviados (ledger consistente). PURO. ───────────
type LastPhotoWM = { readonly lastPhotoAction?: { readonly vehicleKey: string; readonly photoIds: readonly string[] } | null };
function photoIdsAlreadySent(state: ConversationState, wm: LastPhotoWM, vehicleKey: string): string[] {
  const ledger = state.photoLedger?.sentByVehicle?.[vehicleKey] ?? [];
  const last = (wm.lastPhotoAction && wm.lastPhotoAction.vehicleKey === vehicleKey) ? wm.lastPhotoAction.photoIds : [];
  return [...new Set([...ledger, ...last])];
}
export function capPhotoEffects(decision: TurnDecision, state: ConversationState, wm: LastPhotoWM): TurnDecision {
  if (!decision.effectPlan.some((p) => p.kind === "send_media")) return decision;
  const newPlan: (typeof decision.effectPlan)[number][] = [];
  for (const p of decision.effectPlan) {
    if (p.kind !== "send_media" || !p.photoIds || p.photoIds.length === 0) { newPlan.push(p); continue; }
    const sent = photoIdsAlreadySent(state, wm, p.vehicleKey);
    const sel = selectPhotos({ availablePhotoIds: p.photoIds, alreadySentPhotoIds: sent });
    if (sel.selectedPhotoIds.length === 0) continue;   // tudo já enviado -> NÃO reenvia (drop; não manda 0 nem repete)
    if (sel.selectedPhotoIds.length === p.photoIds.length) { newPlan.push(p); continue; }   // nada a recortar/dedupar
    const onSuccess = (p.onSuccess ?? []).map((op) => op.op === "mark_photos_sent" ? { ...op, photoIds: [...sel.selectedPhotoIds] } : op);
    // ⭐CADEIA DE MÍDIA: ao recortar os ids, o SNAPSHOT tem de ser recortado junto — senão o plano sairia com mais
    // urls do que ids selecionados e o dispatcher enviaria fotos já enviadas (ou a mais). Filtra preservando a
    // ORDEM da seleção, não a do snapshot.
    const media = p.media
      ? sel.selectedPhotoIds.map((id) => p.media!.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => m != null)
      : undefined;
    newPlan.push({ ...p, photoIds: [...sel.selectedPhotoIds], onSuccess, ...(media ? { media } : {}) });
  }
  return { ...decision, effectPlan: newPlan };
}

// ── P0 ROTEAMENTO POR DOMÍNIO (missão): RESPOSTA INSTITUCIONAL determinística. Se o lead pediu endereço/horário/loja e
//    a tool tenant_business_info RESOLVEU o tópico, o turno NUNCA vira technical_fallback — responde com os FATOS da tool
//    (não menu, não "não consegui confirmar"). Tópicos ok respondidos; NOT_CONFIGURED respondido honestamente. Não cita
//    carro, não usa vehicle_details, não pergunta funil. É o fallback determinístico MÍNIMO que a missão autoriza (§4). PURO.
export function buildInstitutionalResponse(args: {
  readonly leadMessage: string;
  readonly institutionalObs: ReadonlyMap<BusinessInfoTopic, AgentToolObservation>;
  readonly ctx: TurnContext;
  readonly turnId: string;
}): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } | null {
  const topics = institutionalTopicsRequested(args.leadMessage);
  // audit Codex (§G): contato (instagram/site/telefone) não é topic da tool -> honesto (o prompt tem, mas o determinístico
  // não parseia; a resposta natural do cérebro é a via principal, isto é só o backstop honesto — nunca fallback técnico).
  if (topics.length === 0) {
    if (!mentionsContact(args.leadMessage)) return null;
    const text = "Sobre o nosso contato, deixa eu confirmar essa informação com a equipe e já te passo. Posso te ajudar em mais alguma coisa?";
    const pe = ensureSendMessage([]);
    const prop: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects: pe, responsePlan: { guidance: text }, reasonCode: "institutional_answer", reasonSummary: "contato institucional (honesto)", confidence: 0.7 };
    return { decision: finalize(args.turnId, prop, PolicyEngine.postQuery(prop, [], args.ctx), []), composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects: pe };
  }
  const clauses: string[] = [];
  for (const topic of topics) {
    const obs = args.institutionalObs.get(topic);
    if (obs?.ok && obs.tool === "tenant_business_info") {
      const v = obs.data.value;
      clauses.push(topic === "address" ? `a loja fica na ${v}` : topic === "hours" ? `nosso horário é ${v}` : `nossa unidade é ${v}`);
    } else {
      // NOT_CONFIGURED / falha -> honesto (nunca inventa). audit Codex (§F): mesmo TODOS ausentes gera resposta honesta.
      clauses.push(topic === "address" ? "sobre o endereço, ainda não tenho ele configurado aqui, mas confirmo com a equipe"
        : topic === "hours" ? "sobre o horário, ainda não tenho essa informação configurada aqui, mas confirmo com a equipe"
        : "sobre a unidade, ainda não tenho isso configurado aqui");
    }
  }
  const body = clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(", ")} e ${clauses[clauses.length - 1]}`;
  const text = `Claro! ${body.charAt(0).toUpperCase()}${body.slice(1)}. Posso te ajudar em mais alguma coisa?`;
  const proposedEffects = ensureSendMessage([]);
  const proposal: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects, responsePlan: { guidance: text }, reasonCode: "institutional_answer", reasonSummary: "resposta institucional determinística (fatos da tool)", confidence: 0.9 };
  const decision = finalize(args.turnId, proposal, PolicyEngine.postQuery(proposal, [], args.ctx), []);
  return { decision, composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects };
}

// ── Fase 4 (Evidence H): DESINTERESSE. Lead desengajado -> resposta CURTA e humana, SEM lista/funil/pressão. Executor
//    determinístico (como o institucional): usado quando o cérebro não autora. NÃO empurra venda; deixa a porta aberta. ──
export function buildDisengagementResponse(args: { readonly engagement: LeadEngagement; readonly ctx: TurnContext; readonly turnId: string }): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } {
  const text = args.engagement === "not_interested"
    ? "Sem problema! Se precisar de qualquer informação sobre os nossos veículos, fico por aqui à disposição. 😊"
    : "Tranquilo! Qualquer coisa que precisar sobre os veículos, é só me chamar. 😊";
  const pe = ensureSendMessage([]);
  const prop: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects: pe, responsePlan: { guidance: text }, reasonCode: "lead_disengaged", reasonSummary: "desinteresse -> resposta curta, sem funil/lista", confidence: 0.85 };
  const decision = finalize(args.turnId, prop, PolicyEngine.postQuery(prop, [], args.ctx), []);
  return { decision, composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects: pe };
}

// F2.29 (invariante 5): "mais opções/tem outros?" SEM escopo recuperável (nem filtro comercial ativo, nem oferta homogênea
// derivável) -> o engine PERGUNTA o escopo em vez de listar genérico. Determinístico, aterrado, honesto: não inventa lista,
// não mostra moto/carros aleatórios. Só dispara quando o cérebro não autorou resposta aceitável (fallback do else-branch).
export function buildMoreOptionsScopeQuestion(args: { readonly ctx: TurnContext; readonly turnId: string }): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } {
  const text = "Claro! Pra te mostrar as opções certas, você quer ver outros de qual tipo (SUV, sedan, hatch, picape) ou faixa de valor?";
  const pe = ensureSendMessage([]);
  const prop: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects: pe, responsePlan: { guidance: text }, reasonCode: "more_options_needs_scope", reasonSummary: "mais opções sem escopo recuperável -> pergunta tipo/faixa (nunca lista genérico)", confidence: 0.8 };
  const decision = finalize(args.turnId, prop, PolicyEngine.postQuery(prop, [], args.ctx), []);
  return { decision, composed: { draft: { parts: [{ type: "text", content: text }] }, text }, proposedEffects: pe };
}

// ── Fix A (audit CTWA — condução SDR): resposta de RECUPERAÇÃO por RELAXAMENTO. A busca EXATA zerou; o engine já rodou a
//    cascata (async) e achou itens REAIS num filtro relaxado. Aqui monta a resposta que CONDUZ: nomeia o filtro original que
//    não achou + apresenta a lista relaxada ATERRADA + uma pergunta única. Nunca "quer que eu veja outras opções?" solto. PURO. ──
// Fix A: a autoria do cérebro JÁ apresenta veículo (lista de oferta OU foto)? Se sim, não sobrepõe com o relaxamento. PURO.
export function authoredPresentsVehicles(composed: RenderedResponse | null, effects: readonly ProposedEffectPlan[] | null): boolean {
  if (effects?.some((e) => e.kind === "send_media")) return true;
  return (composed?.draft?.parts ?? []).some((p) => (p as { type?: string }).type === "vehicle_offer_list");
}
const RELAX_LEADIN: Record<RelaxKind, string> = {
  same_type_in_range: "eu não encontrei agora, mas nessa faixa achei estas opções pra você",
  drop_ceiling: "eu não encontrei exatamente nessa faixa, mas tenho estas bem próximas, um pouco acima",
  same_brand_in_range: "eu não encontrei, mas nessa faixa tenho outras opções da mesma marca",
  same_type: "eu não encontrei nessa faixa, mas tenho estas do mesmo tipo",
  in_range: "eu não encontrei, mas nessa faixa tenho estas opções",
};
export function buildRelaxedOfferResponse(args: {
  readonly zeroedDesc: string;
  readonly kind: RelaxKind;
  readonly items: readonly VehicleFact[];
  readonly facts: readonly QueryResult[];
  readonly identities: readonly RememberedVehicleIdentity[];
  readonly ctx: TurnContext;
  readonly turnId: string;
}): { decision: TurnDecision; composed: RenderedResponse; proposedEffects: ProposedEffectPlan[] } {
  const keys = args.items.slice(0, 4).map((v) => v.vehicleKey);
  const lead = args.zeroedDesc ? `${args.zeroedDesc} ${RELAX_LEADIN[args.kind]}:` : `Não achei exatamente isso, mas ${RELAX_LEADIN[args.kind]}:`;
  const draft: ResponseDraft = { parts: [{ type: "text", content: lead }, { type: "vehicle_offer_list", vehicleKeys: keys }, { type: "text", content: "Quer que eu te mostre as fotos ou os detalhes de alguma?" }] };
  const factsArr = [...args.facts];
  const text = ResponseRenderer.render(draft, factsArr, args.ctx.state, args.identities);
  const pe = ensureSendMessage([]);
  const prop: ProposedDecision = { proposedAction: "reply", facts: [], proposedEffects: pe, responsePlan: { guidance: text }, reasonCode: "recovery_relaxed_offer", reasonSummary: `busca vazia -> relaxamento ${args.kind} com itens reais`, confidence: 0.7 };
  const decision = finalize(args.turnId, prop, PolicyEngine.postQuery(prop, factsArr, args.ctx), factsArr);
  return { decision, composed: { draft, text }, proposedEffects: pe };
}
