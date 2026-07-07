// ============================================================================
// turn-understanding.ts — FONTE ÚNICA da semântica do turno. O cérebro LLM emite um TurnUnderstanding no MESMO ciclo;
// este módulo VALIDA a evidência (cada quote ⊂ bloco; cada capability STATEFUL exige evidência DA PRÓPRIA capability) e
// deriva, SÓ do entendimento VÁLIDO DO CÉREBRO, as decisões operacionais: autorização de foto, ALVO (vinculado ao
// assunto e verificado por modelo), exigência de tool, fingerprint. Auditoria Codex F2.23:
//  - P0-1: o alvo da foto é do ASSUNTO (ordinal/modelo/pronome) e verificado por modelo; um vehicle_photos_resolve só
//    vale se sua key ∈ candidateVehicleKeys do assunto. Fato de foto incompatível é REJEITADO (nunca vira envio).
//  - P0-2: só o understanding DO CÉREBRO (fromBrain) autoriza ação comercial (send_media/tool/foco). O fallback regex
//    é HINT conservador só p/ recuperação textual — NUNCA autoriza mídia/foco/tool. "foto" solta não vira request_photos.
//  - P1: a 1ª compreensão validada TRAVA o assunto do turno (reconcile só adiciona fato; não troca sem evidência nova).
// Módulo PURO, sem ciclo. Memória = contexto/pronome, nunca vence o turno.
// ============================================================================
import { normalizeText, canonicalModel, modelIdentityMatches } from "./catalog-utils.ts";
export type KnownVehicleModel = { readonly marca: string | null; readonly modelo: string | null };
import { parseOrdinal } from "./ordinal.ts";
import { institutionalTopicsRequested, mentionsContact } from "./turn-domain.ts";
import type { ClaimExtractor } from "../domain/decision.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type { FrameSignals, TurnUnderstanding, TurnCapability, TurnUnderstandingEvidence, PrimaryIntent, TurnSubjectKind } from "../domain/agent-brain.ts";

// ── Validação de evidência ──────────────────────────────────────────────────────────────────────────────────────
function quoteInBlock(block: string, quote: string): boolean {
  const q = normalizeText(quote).trim();
  if (q.length < 2) return false;   // trecho trivial não conta
  return normalizeText(block).includes(q);
}
export type ValidatedUnderstanding = {
  readonly understanding: TurnUnderstanding;
  readonly trusted: boolean;                                   // há ≥1 evidência válida
  readonly fromBrain: boolean;                                 // veio do CÉREBRO (não do fallback) -> pode autorizar ação
  readonly validEvidence: readonly TurnUnderstandingEvidence[];
};
export function validateTurnUnderstanding(u: TurnUnderstanding, block: string, fromBrain: boolean): ValidatedUnderstanding {
  const validEvidence = (u.evidence ?? []).filter((e) => e != null && typeof e.quote === "string" && quoteInBlock(block, e.quote));
  return { understanding: u, trusted: validEvidence.length > 0, fromBrain, validEvidence };
}
// P1: capability STATEFUL exige evidência DA PRÓPRIA capability (não geral). "oi" ou evidência de outra capability não
// autoriza send_photos.
function capabilityHasOwnEvidence(v: ValidatedUnderstanding, cap: TurnCapability): boolean {
  return v.validEvidence.some((e) => e.capability === cap);
}
// COERÊNCIA de evidência de FOTO (substantivo, sem flexão): a evidência do send_photos TEM de mencionar foto/imagem.
const PHOTO_EVIDENCE_RX = /\bfotos?\b|\bimagens?\b|\bm[ií]dias?\b/;
function hasPhotoEvidence(v: ValidatedUnderstanding): boolean {
  return v.validEvidence.some((e) => e.capability === "send_photos" && PHOTO_EVIDENCE_RX.test(normalizeText(e.quote)));
}

// ── Negação de foto ESCOPADA POR CLÁUSULA (fail-closed): "não quero foto"/"foto depois" nunca envia mídia. ──
const PHOTO_WORD = /\b(?:fotos?|imagens?)\b/u;
const NEG_BEFORE = /\b(?:nao|nem|sem)\b/u;
const DEFERRAL = /\b(?:depois|mais tarde|outra hora|amanha|daqui a pouco|agora nao)\b/u;
const CLAUSE_DELIM = /[.,;:!?\n]/g;
export function isPhotoDeclined(block: string): boolean {
  const norm = normalizeText(block);
  const m = PHOTO_WORD.exec(norm);
  if (!m) return DEFERRAL.test(norm) && /\b(?:foto|imagem)/.test(norm);
  const p = m.index;
  let clauseStart = 0;
  const head = norm.slice(0, p);
  CLAUSE_DELIM.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = CLAUSE_DELIM.exec(head)) !== null) clauseStart = dm.index + 1;
  if (NEG_BEFORE.test(norm.slice(clauseStart, p))) return true;
  const tail = /[.,;:!?\n]/.exec(norm.slice(p));
  const clauseEnd = tail ? p + tail.index : norm.length;
  return DEFERRAL.test(norm.slice(clauseStart, clauseEnd));
}

// ── P0-2: AUTORIZAÇÃO de ENVIO de foto. SÓ com understanding DO CÉREBRO (fromBrain) + capability send_photos com
//    evidência PRÓPRIA que menciona foto + não é recall + não há negação. O fallback (fromBrain=false) NUNCA autoriza. ──
// requireBrain = central_active+llmFirst (produção): SÓ o understanding do cérebro autoriza. Sem llmFirst (replay/legado)
// o fallback validado pode autorizar (mantém a evidência coerente de foto, sem o requisito fromBrain).
export function authorizesPhotoSend(v: ValidatedUnderstanding | null, block: string, requireBrain: boolean): boolean {
  if (!v) return false;
  if (requireBrain && !v.fromBrain) return false;                    // em llmFirst, fallback/ausente nunca autoriza mídia
  const u = v.understanding;
  if (u.primaryIntent === "recall_photos") return false;             // pergunta de memória nunca envia
  if (isPhotoDeclined(block)) return false;                          // negação/adiamento = fail-closed
  const wantsPhotos = u.requestedCapabilities.includes("send_photos") || u.primaryIntent === "request_photos";
  return wantsPhotos && capabilityHasOwnEvidence(v, "send_photos") && hasPhotoEvidence(v);
}
// Pergunta de MEMÓRIA de foto (não envia mídia; nomeia o veículo lembrado).
export function isPhotoRecall(v: ValidatedUnderstanding | null): boolean {
  return v?.understanding.primaryIntent === "recall_photos" || (v?.understanding.requestedCapabilities.includes("recall") ?? false);
}
// ── P0 (RESOLUÇÃO ÚNICA de veículo): AUTORIZAÇÃO DETERMINÍSTICA por ORDINAL RESOLVIDO. Complementa authorizesPhotoSend
//    NO caso "me manda foto do segundo": o alvo veio de turn_ordinal (índice EXATO da última lista renderizada pela loja
//    = grounding MÁXIMO) E o texto do lead tem pedido EXPLÍCITO de foto (verbo de envio/ver + "foto"). Isto NÃO é o "foto
//    solta" que o P0-2 rejeita — aqui o alvo é o item N que a loja ACABOU de mostrar, não um palpite de modelo. Some o
//    "de qual carro?" quando o ordinal já respondeu isso. Fail-closed: negação de foto barra; SÓ turn_ordinal autoriza
//    (nunca modelo inferido/pronome/selecionado antigo). PURO. (Definido com forward-ref a PHOTO_REQUEST_STEM abaixo.) ──
export function authorizesPhotoByResolvedOrdinal(target: TargetResolution, block: string): boolean {
  if (target.kind !== "resolved" || target.source !== "turn_ordinal") return false;
  if (isPhotoDeclined(block)) return false;
  return PHOTO_REQUEST_STEM.test(normalizeText(block));
}
// ── P0-A (audit Codex smoke CTWA): FOTO PRONOMINAL do veículo EXATO do anúncio. Quando o anúncio tem marca/modelo/ANO e o
//    estoque tem EXATAMENTE esse veículo (match único, aterrado), o alvo do anúncio (source="ad_reference") é a referência
//    do pedido pronominal de foto ("me manda fotos dele/desse/esse"). Grounding MÁXIMO (o anúncio nomeou o carro, o estoque
//    tem exatamente ele) — narrow, como o turn_ordinal. Fail-closed: negação de foto barra; só ad_reference autoriza. ──
export function authorizesPhotoByAdReference(target: TargetResolution, block: string): boolean {
  if (target.kind !== "resolved" || target.source !== "ad_reference") return false;
  if (isPhotoDeclined(block)) return false;
  return PHOTO_REQUEST_STEM.test(normalizeText(block));
}
// ── P0-2: AUTORIZAÇÃO TIPADA POR TOOL. Cada tool comercial exige a capability PRÓPRIA + evidência própria, do CÉREBRO.
//    Fonte única: só a intenção declarada+evidenciada autoriza a ação. (tenant_business_info = institucional, à parte.) ──
const TOOL_CAPABILITY: Record<string, TurnCapability> = {
  stock_search: "stock_search", vehicle_details: "vehicle_details", vehicle_photos_resolve: "send_photos",
};
export function toolCapabilityAuthorized(v: ValidatedUnderstanding | null, tool: string): boolean {
  if (!v || !v.fromBrain) return false;
  const cap = TOOL_CAPABILITY[tool];
  if (!cap) return false;
  return v.understanding.requestedCapabilities.includes(cap) && capabilityHasOwnEvidence(v, cap);
}
// select_vehicle_focus proposto pela LLM exige capability select + evidência própria (ordinal determinístico à parte).
export function selectAuthorized(v: ValidatedUnderstanding | null): boolean {
  return !!v && v.fromBrain && v.understanding.requestedCapabilities.includes("select") && capabilityHasOwnEvidence(v, "select");
}
// O turno é uma BUSCA de estoque? (autoridade do requiredToolBeforeFinal) — exige capability stock_search com evidência própria.
export function isStockSearchTurn(v: ValidatedUnderstanding | null): boolean {
  return toolCapabilityAuthorized(v, "stock_search");
}

// ── P0-1: ALVO do turno VINCULADO ao ASSUNTO e VERIFICADO por modelo. O modelo do assunto vem do CLAIM ESCRITO (tem
//    precedência); subjectValue que CONFLITA com o claim escrito torna o entendimento INVÁLIDO (kind=conflict, zero mídia);
//    inferência (typo, sem claim exato) só vira candidato se CONFIRMADA por stock_search/catálogo. vehicle_photos_resolve
//    NUNCA confirma o modelo sozinho (knownModels só vem de stock_search/vehicle_details/oferta/identidade/seleção). ──
export type TargetResolutionSource = "turn_ordinal" | "turn_explicit_model" | "carryover_selected" | "ad_reference" | "ambiguous" | "none";
export type TargetResolution =
  | { readonly kind: "resolved"; readonly vehicleKey: string; readonly source: TargetResolutionSource; readonly candidateVehicleKeys: readonly string[]; readonly subjectModel: string | null }
  | { readonly kind: "ambiguous"; readonly candidateVehicleKeys: readonly string[]; readonly subjectModel: string | null }
  | { readonly kind: "conflict"; readonly subjectModel: null }   // subjectValue conflita com o modelo escrito -> inválido
  | { readonly kind: "none"; readonly subjectModel: string | null };
// Concordância subjectValue × claim ESCRITO (só p/ detectar CONFLITO): mesma identidade canônica OU diferem apenas pelo
// PREFIXO de marca ("chevroletonix" ~ "onix"). NUNCA por sufixo semântico ("onix" ≠ "onixplus"). A resolução de candidato
// (autorização real) é ESTRITA via modelIdentityMatches contra o modelo estruturado; isto só evita conflito FALSO.
function modelsAgreeUpToBrand(a: string, b: string): boolean {
  const ca = canonicalModel(a), cb = canonicalModel(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const [long, short] = ca.length >= cb.length ? [ca, cb] : [cb, ca];
  return long.endsWith(short);   // marca é PREFIXO; "onixplus" NÃO termina em "onix" -> Onix≠Onix Plus continua conflito
}
export function resolveTurnTarget(args: {
  readonly understanding: TurnUnderstanding | null;
  readonly leadMessage: string;
  readonly state: ConversationState;
  readonly claimExtractor: ClaimExtractor;
  readonly knownModels: ReadonlyMap<string, KnownVehicleModel>;   // key -> {marca,modelo} ESTRUTURADO (fato/oferta/identidade)
}): TargetResolution {
  const { understanding: u, leadMessage, state, claimExtractor, knownModels } = args;
  const offerItems = state.lastRenderedOfferContext?.items ?? [];
  const uModel = u?.subject === "explicit_model" && u.subjectValue ? u.subjectValue : null;
  const textModels = claimExtractor.extractClaims(leadMessage).filter((c) => c.kind === "model" || c.kind === "brand_model").map((c) => c.text);

  // A) ORDINAL explícito -> key EXATA da lista estruturada (desambigua sozinho; independe de modelo).
  const ord = parseOrdinal(leadMessage);
  if (ord && ord.value >= 1 && ord.value <= offerItems.length) {
    const key = offerItems[ord.value - 1].vehicleKey;
    return { kind: "resolved", vehicleKey: key, source: "turn_ordinal", candidateVehicleKeys: [key], subjectModel: uModel ?? textModels[0] ?? null };
  }
  // Determinação do MODELO do assunto (precedência do CLAIM escrito; conflito -> inválido). Identidade EXATA (canonicalModel),
  // NUNCA substring: "Onix"!="Onix Plus", "HB20"!="HB20S", "C3"!="C3 Aircross".
  let subjectModel: string | null = null;
  if (textModels.length > 0) {
    // claim escrito é AUTORITATIVO. subjectValue que NÃO concorda com nenhum claim escrito -> CONFLITO (inválido).
    // "Concorda" = mesma identidade canônica OU só difere pelo PREFIXO de marca ("Chevrolet Onix" ~ "Onix"); NUNCA por
    // sufixo semântico ("Onix"≠"Onix Plus"). A resolução de CANDIDATO abaixo segue ESTRITA (modelIdentityMatches).
    if (uModel && !textModels.some((tm) => modelsAgreeUpToBrand(uModel, tm))) return { kind: "conflict", subjectModel: null };
    subjectModel = textModels[0];
  } else if (uModel) {
    // inferência (typo): só é assunto se CONFIRMADA por knownModels (identidade EXATA) OU pelo catálogo (claimExtractor).
    const inKnown = [...knownModels.values()].some((m) => modelIdentityMatches(uModel, m));
    const inCatalog = claimExtractor.extractClaims(uModel).some((c) => c.kind === "model" || c.kind === "brand_model");
    if (inKnown || inCatalog) subjectModel = uModel;   // senão: inferência não confirmada -> não vira assunto (fail-closed)
  }
  // B) MODELO do assunto -> candidatos por IDENTIDADE EXATA (só de knownModels estruturado). Modelo diferente NUNCA herda selected.
  if (subjectModel) {
    const cands = [...new Set([...knownModels.entries()].filter(([, m]) => modelIdentityMatches(subjectModel!, m)).map(([k]) => k))];
    if (cands.length === 1) return { kind: "resolved", vehicleKey: cands[0], source: "turn_explicit_model", candidateVehicleKeys: cands, subjectModel };
    if (cands.length > 1) return { kind: "ambiguous", candidateVehicleKeys: cands, subjectModel };
    return { kind: "none", subjectModel };   // modelo do assunto sem candidato conhecido -> busca antes (nunca herda outro)
  }
  // Se o cérebro afirmou um modelo explícito mas ele não foi confirmado (nem claim escrito nem catálogo) -> não herda selected.
  if (uModel) return { kind: "none", subjectModel: uModel };
  // C) PRONOME / sem novo modelo -> selecionado (nunca em troca de assunto).
  const sel = state.vehicleContext.selected?.key ?? null;
  if (sel && u?.isTopicChange !== true) return { kind: "resolved", vehicleKey: sel, source: "carryover_selected", candidateVehicleKeys: [sel], subjectModel: null };
  return { kind: "none", subjectModel: null };
}
// Uma vehicleKey (send_media autorado OU photo fact) é compatível com o alvo do assunto? conflict/none -> nunca.
export function targetAcceptsKey(target: TargetResolution, key: string): boolean {
  if (target.kind === "resolved") return target.vehicleKey === key || target.candidateVehicleKeys.includes(key);
  if (target.kind === "ambiguous") return target.candidateVehicleKeys.includes(key);
  return false;   // conflict/none -> nenhuma key aceita (fail-closed)
}

// ── P1 (trava do assunto): a 1ª compreensão validada é a BASE do turno. Refinamento só ADICIONA fato (subjectValue) —
//    não troca primaryIntent/subject sem EVIDÊNCIA NOVA (quote não vista na base). Ex.: search_stock -> request_photos
//    sem nova evidência de foto = mantém search_stock. ──
export function reconcileUnderstanding(base: TurnUnderstanding | null, next: TurnUnderstanding, block: string): TurnUnderstanding {
  if (!base) return next;
  const baseQuotes = new Set((base.evidence ?? []).map((e) => normalizeText(e.quote)));
  const newEvidence = (next.evidence ?? []).filter((e) => quoteInBlock(block, e.quote) && !baseQuotes.has(normalizeText(e.quote)));
  const changesSubject = next.primaryIntent !== base.primaryIntent || next.subject !== base.subject;
  if (changesSubject && newEvidence.length === 0) {
    // mudança ARBITRÁRIA sem evidência nova -> mantém a base; só preenche subjectValue se faltava.
    return { ...base, subjectValue: base.subjectValue ?? next.subjectValue };
  }
  return next;   // refinamento legítimo (subjectValue) ou mudança JUSTIFICADA por evidência nova
}

// ── FALLBACK conservador (só HINT p/ recuperação TEXTUAL — NUNCA autoriza ação; fromBrain=false no validate). "foto"
//    SOLTA não vira request_photos: exige verbo de envio + foto (imperativo) OU "fotos do <carro>". ──
const PHOTO_MEMORY_Q = /\b(qual|que|quais)\b[^?]*\b(foto|carro|ve[ií]culo|modelo)\b[^?]*\b(pedi|pediu|mandei|mostrei|recebi)\b/;
const PHOTO_REQUEST_STEM = /\b(?:mand\w*|envi\w*|mostr\w*)\b[^?]*\bfotos?\b|\b(?:quero|posso|pode|gostaria)\b[^?]*\b(?:ver|mandar|enviar)\b[^?]*\bfotos?\b|\bfotos?\s+d(?:o|a|e|esse|essa|ele|ela)\b/;
const BUDGET_RX = /\bate\s+\d|\br\$\s*\d|\b\d{2,3}\s*mil\b|\bbarat|\beconomic|\bfaixa\s+de\s+pre|\bor[çc]amento\b/;
const ATTR_RX = /\bkm\b|quilometr|rodad|\bcor\b|\bcambio\b|c[aâ]mbio|autom[aá]tic|\bmanual\b|\bpre[çc]o\b|\bvalor\b|quanto\s+(?:custa|sai|fica)|\bano\b|\bconsumo\b|\bmotor\b|\bversao\b|vers[aã]o|\bopcionais\b|\bcompleto\b/;
const ORDINAL_WORD_RX = /\b(?:primeir|segund|terceir|quart|quint|sext|ultim)\w*|\bnumero\s+\d+|\bopcao\s+\d+/;
function firstMatch(rx: RegExp, block: string): string | null { const m = rx.exec(normalizeText(block)); return m ? m[0] : null; }
// FALLBACK conservador MULTI-capability (HINT; fromBrain=false não autoriza em produção). Um turno MISTO ("horário e
// quantos km?") acumula institutional_info + vehicle_details, cada uma com evidência própria. Ordem define o primaryIntent.
export function deriveFallbackUnderstanding(block: string, signals: FrameSignals, claimExtractor: ClaimExtractor): TurnUnderstanding {
  const norm = normalizeText(block);
  const caps: TurnCapability[] = [];
  const evidence: TurnUnderstandingEvidence[] = [];
  let primaryIntent: PrimaryIntent = "other";
  const add = (cap: TurnCapability, quote: string | null, intent: PrimaryIntent): void => {
    if (!quote || caps.includes(cap)) return;
    caps.push(cap); evidence.push({ capability: cap, quote });
    if (primaryIntent === "other") primaryIntent = intent;
  };
  const cModels = claimExtractor.extractClaims(block).filter((c) => c.kind === "model" || c.kind === "brand_model" || c.kind === "brand");

  if (PHOTO_MEMORY_Q.test(norm)) add("recall", firstMatch(PHOTO_MEMORY_Q, block), "recall_photos");
  else if (PHOTO_REQUEST_STEM.test(norm) && !isPhotoDeclined(block)) add("send_photos", firstMatch(PHOTO_REQUEST_STEM, block), "request_photos");
  if (institutionalTopicsRequested(block).length > 0 || mentionsContact(block)) add("institutional_info", firstMatch(/\benderec|\bhorario|\bloja|\bunidade|\binstagram|\bsite/, block), "institutional");
  // BUSCA: sinal EXPLÍCITO (tipo/mais opções/popular/orçamento) OU um modelo SOLTO sem outra intenção ("tem Onix?"). Um
  // modelo num turno de FOTO/DETALHE ("me manda foto do Onix") NÃO vira busca (evita forçar stock_search indevidamente).
  const explicitSearch = signals.mentionsVehicleType != null || signals.mentionsMoreOptions || signals.mentionsPopular === true || BUDGET_RX.test(norm);
  const searchQuote = cModels[0]?.text ?? firstMatch(BUDGET_RX, block) ?? firstMatch(/\bpopular\b|\bsuv\b|\bsedan\b|\bhatch\b|\bpicape\b|\bpick-?up\b|\bmais\s+op|\boutr[ao]s?\s+op|\bcarro\b|\bve[ií]culo\b/, block);
  if (explicitSearch || (cModels.length > 0 && primaryIntent === "other")) add("stock_search", searchQuote, "search_stock");
  else if (ATTR_RX.test(norm)) add("vehicle_details", firstMatch(ATTR_RX, block), "vehicle_detail");   // atributo sem busca -> detalhe
  const ord = parseOrdinal(block);
  if (ord) add("select", firstMatch(ORDINAL_WORD_RX, block) ?? String(ord.value), "select_vehicle");

  const subject: TurnSubjectKind = cModels.length > 0 ? "explicit_model" : ord ? "ordinal_from_last_offer" : signals.mentionsVehicleType != null ? "vehicle_type" : "none";
  const subjectValue = cModels[0]?.text ?? (ord ? String(ord.value) : null);
  return { primaryIntent, requestedCapabilities: caps, subject, subjectValue, subjectSource: "current_turn", isTopicChange: false, answeredLeadQuestions: [], evidence };
}

// ── Fingerprint de DENY: mesma rejeição repetida -> recuperar já, sem gastar tentativas idênticas. ──
export function denyFingerprint(feedback: string): string {
  return normalizeText(feedback).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
}
