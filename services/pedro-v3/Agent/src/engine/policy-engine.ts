import type { TurnContext } from "../domain/context.ts";
import type {
  QueryCall, QueryResult, ProposedDecision, PolicyVerdict, RenderedResponse,
  TurnDecision, EffectPlan, ProposedEffectPlan, MoneyRole,
} from "../domain/decision.ts";
import type { VehicleFact } from "../domain/types.ts";
import { isVehicleKeyGrounded, normalizeText, canonicalModel } from "./catalog-utils.ts";
import { leadStatedMoneyValues } from "./lead-extraction.ts";
import { slotQuestions } from "./question-classify.ts";
import { isInstitutionalTurn, contactPhoneKnownFromChannel, asksLeadContactPhone } from "./turn-domain.ts";

// P0 audit Codex: a RESPOSTA é INSTITUCIONAL PURA (nenhum claim de marca/modelo no texto)? Só então as policies de
// FUNIL se abstêm. Se o texto cita veículo (mesmo lembrado), NÃO é institucional-pura -> funil valida normalmente.
function isInstitutionalOnlyResponse(composed: RenderedResponse, ctx: TurnContext): boolean {
  if (composed.draft.parts.some((p) => p.type !== "text")) return false;   // parts estruturados de veículo -> não é pura
  return ctx.claimExtractor.extractClaims(composed.text).every((c) => c.kind !== "brand" && c.kind !== "model" && c.kind !== "brand_model");
}

// F-4: acha o VehicleFact EXATO nos fatos do turno (stock_search/vehicle_details) pelo vehicleKey.
function factByKey(facts: QueryResult[], key: string): VehicleFact | null {
  for (const f of facts) {
    if (f.ok && f.tool === "stock_search") { const v = f.data.items.find((x) => x.vehicleKey === key); if (v) return v; }
    if (f.ok && f.tool === "vehicle_details" && f.data.vehicle.vehicleKey === key) return f.data.vehicle;
  }
  return null;
}

export type MoneyMention = {
  value: number;
  role: MoneyRole;
  raw: string;
};

export function parseMoneyMentions(text: string): MoneyMention[] {
  const mentions: MoneyMention[] = [];

  // Dividir o texto em cláusulas usando pontuação (não cercada por dígitos) e conjunções/preposições
  const clauses = text.split(/(?!\d)[,.;!?+](?!\d)|\b(?:e|mas|ou|mais|como|com)\b/i);

  for (const clause of clauses) {
    const trimmedClause = clause.trim();
    if (!trimmedClause) continue;

    const normalizedClause = trimmedClause.toLowerCase();

    // Tratamento especial para "entrada zero"
    if (
      normalizedClause.includes("entrada zero") ||
      normalizedClause.includes("zero de entrada") ||
      normalizedClause.includes("entrada de zero") ||
      normalizedClause.includes("sem entrada") ||
      normalizedClause.includes("entrada de 0")
    ) {
      mentions.push({ value: 0, role: "down_payment", raw: "entrada zero" });
      continue;
    }

    // Regex para achar menções de dinheiro
    const regex = /(?:R\$|r\$)?\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]{4,7})\s*(mil\b)?/gi;
    let match;
    while ((match = regex.exec(trimmedClause)) !== null) {
      let numStr = match[1].replace(/\./g, "").replace(/,/g, ".");
      let val = parseFloat(numStr);
      if (isNaN(val)) continue;

      if (match[2] && match[2].toLowerCase().includes("mil")) {
        val = val * 1000;
      }

      // Excluir km/quilometragem/rodado do parser monetário
      const index = match.index;
      const endPos = index + match[0].length;
      const textAfter = trimmedClause.slice(endPos, endPos + 15).toLowerCase();
      if (
        textAfter.includes("km") ||
        textAfter.includes("quilômetro") ||
        textAfter.includes("quilometro") ||
        textAfter.includes("rodado") ||
        textAfter.includes("rodada")
      ) {
        continue;
      }

      // Evita falsos positivos de anos
      const isYear = val >= 1950 && val <= 2030;
      const hasCurrencyPrefix = match[0].toLowerCase().includes("r$");
      if (isYear && !hasCurrencyPrefix) {
        continue;
      }

      // Um número pequeno puro (< 1000, sem separadores "." ou "," e sem R$ ou "mil") não é considerado valor monetário
      const hasSeparator = match[1].includes(".") || match[1].includes(",");
      const isBareSmall = val < 1000 && !hasSeparator;
      if (isBareSmall && !hasCurrencyPrefix && !(match[2] && match[2].toLowerCase().includes("mil"))) {
        continue;
      }

      // Determinar a role analisando APENAS a cláusula atual
      let role: MoneyRole = "vehicle_price";
      if (
        normalizedClause.includes("parcela") ||
        normalizedClause.includes("mensal") ||
        normalizedClause.includes("por mês") ||
        normalizedClause.includes("mensais") ||
        normalizedClause.includes("prestação")
      ) {
        role = "installment";
      } else if (
        normalizedClause.includes("entrada") ||
        normalizedClause.includes("sinal") ||
        normalizedClause.includes("dar") ||
        normalizedClause.includes("pagar de")
      ) {
        role = "down_payment";
      } else if (
        normalizedClause.includes("orçamento") ||
        normalizedClause.includes("orcamento") ||
        normalizedClause.includes("teto") ||
        normalizedClause.includes("limite") ||
        normalizedClause.includes("máximo") ||
        normalizedClause.includes("maximo") ||
        normalizedClause.includes("até") ||
        normalizedClause.includes("ate")
      ) {
        role = "budget";
      } else if (val < 5000) {
        // Se for menor que 5000 e não cair em nenhuma das opções acima, classificamos como installment (parcela)
        role = "installment";
      }

      mentions.push({ value: val, role, raw: match[0] });
    }
  }

  return mentions;
}

function getValidVehicleKeys(facts: QueryResult[]): Set<string> {
  const keys = new Set<string>();
  for (const f of facts) {
    if (f.ok) {
      if (f.tool === "stock_search") {
        for (const v of f.data.items) keys.add(v.vehicleKey);
      }
      if (f.tool === "vehicle_details") {
        keys.add(f.data.vehicle.vehicleKey);
      }
    }
  }
  return keys;
}

function getValidBrandsAndModels(facts: QueryResult[], decision: TurnDecision): { brands: Set<string>, models: Set<string> } {
  const brands = new Set<string>();
  const models = new Set<string>();

  for (const f of facts) {
    if (f.ok) {
      if (f.tool === "stock_search") {
        for (const v of f.data.items) {
          brands.add(normalizeText(v.marca));
          models.add(normalizeText(v.modelo));
        }
      }
      if (f.tool === "vehicle_details") {
        brands.add(normalizeText(f.data.vehicle.marca));
        models.add(normalizeText(f.data.vehicle.modelo));
      }
    }
  }

  if (decision.target?.key) {
    const parts = decision.target.key.split("|");
    if (parts[0]) brands.add(normalizeText(parts[0]));
    if (parts[1]) models.add(normalizeText(parts[1]));
  }

  for (const e of decision.effectPlan) {
    for (const o of e.onSuccess) {
      if (o.op === "record_offer") {
        for (const key of o.offer.vehicleKeys) {
          const parts = key.split("|");
          if (parts[0]) brands.add(normalizeText(parts[0]));
          if (parts[1]) models.add(normalizeText(parts[1]));
        }
      }
    }
  }

  return { brands, models };
}

// Aterramento de modelo EXATO (Codex R10-3): colapsa só FORMATAÇÃO (espaço/hífen/case) — "HB 20"=="HB20",
// "C 3"=="C3" — mas NUNCA por subconjunto de tokens. Assim "HB20" NÃO autoriza "HB20S", "Onix" NÃO autoriza
// "Onix Plus", "C3" NÃO autoriza "C3 Aircross" (são vehicleKeys/modelos DIFERENTES). Um modelo citado só é
// aterrado se, canonizado, for IDÊNTICO a um modelo REAL do turno (nunca "quase igual"). canonicalModel = fonte ÚNICA
// (catalog-utils), compartilhada com o TurnUnderstanding (audit Codex: uma só identidade de modelo).
function modelGroundedExact(claimNorm: string, validModels: Set<string>): boolean {
  const c = canonicalModel(claimNorm);
  if (!c) return false;
  for (const v of validModels) if (canonicalModel(v) === c) return true;
  return false;
}

function priceMap(facts: QueryResult[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const f of facts) {
    if (f.ok && f.tool === "stock_search") for (const v of f.data.items) m.set(v.vehicleKey, v.preco);
    if (f.ok && f.tool === "vehicle_details") m.set(f.data.vehicle.vehicleKey, f.data.vehicle.preco);
  }
  return m;
}

function offeredVehicleKeys(effects: ProposedEffectPlan[]): string[] {
  const keys: string[] = [];
  for (const e of effects) for (const o of e.onSuccess) if (o.op === "record_offer") keys.push(...o.offer.vehicleKeys);
  return keys;
}

export const PolicyEngine = {
  // (1) AUTORIZAÇÃO POR CHAMADA (POL-STATE-011): vê os fatos já acumulados.
  authorizeQuery(call: QueryCall, ctx: TurnContext, _facts: QueryResult[]): PolicyVerdict {
    if (call.tool === "crm_read" && !call.input.leadId) {
      return { policyId: "POL-STATE-011", outcome: "deny", violations: ["crm_read sem leadId"] };
    }
    return { policyId: "POL-STATE-011", outcome: "allow" };
  },

  // (2) PÓS-QUERY: valida a decisão proposta CONTRA OS FATOS.
  postQuery(proposal: ProposedDecision, facts: QueryResult[], ctx: TurnContext): PolicyVerdict[] {
    const verdicts: PolicyVerdict[] = [];
    const obj = ctx.state.currentObjective;

    // POL-TRACK-001: resposta a pergunta de pagamento não vira busca de estoque se relation=answers_pending
    const isPayRelation = ctx.interpretation.relation === "answers_pending" && obj?.type === "perguntou_pagamento" && obj.status === "pending";
    if (isPayRelation && (proposal.proposedAction === "search_stock" || proposal.proposedAction === "send_photos")) {
      verdicts.push({ policyId: "POL-TRACK-001", outcome: "deny", violations: ["resposta de financiamento virou busca"] });
    }

    // POL-STOCK-003: não ofertar veículo acima do teto sem explicar.
    const ceiling = ctx.state.slots.faixaPreco.value?.max;
    if (ceiling != null) {
      const pm = priceMap(facts);
      for (const k of offeredVehicleKeys(proposal.proposedEffects)) {
        const p = pm.get(k);
        if (p != null && p > ceiling) {
          verdicts.push({ policyId: "POL-STOCK-003", outcome: "deny", violations: [`veículo ${k} R$${p} acima do teto R$${ceiling}`] });
        }
      }
    }

    // POL-GROUND-STOCK: veículo ofertado deve existir nos QueryResults (estoque/detalhes)
    const validKeys = getValidVehicleKeys(facts);
    const offeredKeys = offeredVehicleKeys(proposal.proposedEffects);
    const invalidOffered = offeredKeys.filter(k => !validKeys.has(k));
    if (invalidOffered.length > 0) {
      verdicts.push({
        policyId: "POL-GROUND-STOCK",
        outcome: "deny",
        violations: invalidOffered.map(k => `veículo ofertado ${k} ausente dos QueryResults`)
      });
    }

    // POL-CATALOG-OFFER: veículo ofertado deve ter marca e modelo no catálogo do tenant (Fase 1.4).
    // ⭐Missão P0 (fatos frescos vencem snapshot): key vinda das TOOLS do tenant NESTE turno é catálogo válido —
    // snapshot vazio/falho não apaga fato fresco (o engine nunca exige uma key e depois a rejeita).
    for (const k of offeredKeys) {
      if (!isVehicleKeyGrounded(ctx.tenantCatalog, facts, k)) {
        verdicts.push({
          policyId: "POL-GROUND-STOCK",
          outcome: "deny",
          violations: [`veículo ofertado '${k}' contém marca/modelo fora do catálogo do tenant`]
        });
      }
    }

    // POL-HANDOFF-001: handoff exige slots mínimos (nome).
    if (proposal.proposedAction === "handoff" && ctx.state.slots.nome.status !== "known") {
      verdicts.push({ policyId: "POL-HANDOFF-001", outcome: "deny", requirements: ["nome"], violations: ["handoff sem nome"] });
    }

    if (verdicts.length === 0) verdicts.push({ policyId: "POL-OK", outcome: "allow" });
    return verdicts;
  },

  // (3) GROUNDING DA RESPOSTA RENDERIZADA: valida referências estruturadas e defende contra alucinações.
  validateResponse(composed: RenderedResponse, facts: QueryResult[], decision: TurnDecision, ctx: TurnContext): PolicyVerdict[] {
    // P0 ROTEAMENTO POR DOMÍNIO (audit Codex): o bypass é pelo DOMÍNIO DA AFIRMAÇÃO, não da mensagem. Numa mensagem
    // MISTA ("onde fica a loja e esse Onix é automático?") a parte institucional libera, MAS todo trecho que cite
    // veículo/atributo/preço/foto continua validado normalmente. Aqui: `instOnlyResponse` = a RESPOSTA não contém NENHUM
    // claim de veículo (marca/modelo) — só então as policies de FUNIL (reperguntar slot conhecido) se abstêm. As policies
    // de ATRIBUTO/ESTOQUE (DETAIL/ATTR-VALUE/GROUND-STOCK) ficam SEMPRE ligadas (são claim-scoped por natureza); o NOME
    // de um veículo LEMBRADO (selecionado/ofertado) é aterrado por memória (abaixo), então nomeá-lo no institucional passa.
    const instOnlyResponse = isInstitutionalOnlyResponse(composed, ctx);
    // INC2 (P0): no canal WhatsApp o telefone de contato JÁ é conhecido pelo envelope (conversationId "wa:<hash-do-fone>").
    // O agente NUNCA deve pedir o telefone do LEAD (o prompt do portal não coleta telefone) — usa o número do WhatsApp e
    // avança o funil. Se a resposta pede o telefone do lead num canal onde ele já é conhecido -> deny + retry. A exceção
    // (número ALTERNATIVO/secundário pedido de propósito) já é tratada em asksLeadContactPhone (não dispara).
    if (contactPhoneKnownFromChannel(ctx.state.conversationId) && asksLeadContactPhone(composed.text)) {
      return [{ policyId: "POL-PHONE-KNOWN", outcome: "deny", violations: ["nao peca o telefone do lead: no WhatsApp o numero de contato ja e conhecido pelo canal. Use-o como contato e avance o funil (nao pergunte telefone salvo se o prompt pedir um numero alternativo)"] }];
    }
    // POL-QUESTION-OBJECTIVE (R10-2 Codex): UMA pergunta por mensagem, SEM exceção. A classificação lê a ÚLTIMA
    // cláusula interrogativa de cada sentença-com-"?" (question-classify) — reconhecer um dado antes de perguntar
    // ("obrigado pelo nome, tem troca?") conta como a pergunta REAL (troca), não repergunta de nome. Barra:
    // (a) MAIS DE UMA pergunta no turno — interesseVisita/diaHorario (CTA interrogativo) TAMBÉM contam; dado + CTA
    // na mesma msg = duas perguntas -> deny (família de descoberta modelo/tipo conta como UMA). (b) CPF antes da
    // hora. (c) REPERGUNTAR um slot JÁ conhecido (incl. visita/horário já respondidos). A congruência objetivo↔
    // pergunta NÃO é imposta aqui — é RECONCILIADA pós-compose (reconcileObjectiveWithQuestion): o objetivo
    // persistido passa a ser exatamente o slot da pergunta enviada.
    {
      const asked = slotQuestions(composed.text); // TODOS os slots perguntados (incl. visita/horário)
      const slotKnown = (slot: string): boolean => {
        const s = (ctx.state.slots as Record<string, { status?: string; value?: unknown } | undefined>)[slot];
        if (s?.status == null || s.status === "unknown") return false;
        // diaHorario is a compound slot. A weekday alone answers the DAY but
        // does not answer a subsequent request for the TIME.
        if (slot === "diaHorario" && /\b(?:horario|que\s+horas?|qual\s+hora)\b/.test(normalizeText(composed.text))) {
          const value = normalizeText(String(s.value ?? ""));
          const hasTime = /\b(?:[01]?\d|2[0-3])\s*(?::|h)\s*[0-5]?\d?\b|\b(?:manha|tarde|noite|meio-dia)\b/.test(value);
          return hasTime;
        }
        return true;
      };
      const qDeny = (why: string): PolicyVerdict[] => [{ policyId: "POL-QUESTION-OBJECTIVE", outcome: "deny", violations: [why] }];
      // (a) no MÁXIMO UMA pergunta por mensagem (sem exceção de CTA).
      if (asked.length > 1) return qDeny(`mais de uma pergunta no mesmo turno (${asked.join(",")})`);
      // (b) CPF é dado de FECHAMENTO (missão SDR real): só na hora de AGENDAR a visita / fechar — quando o lead QUER
      // visitar ou já deu dia/horário. Intenção de financiamento NÃO libera CPF (pedir CPF logo após "quero financiar"
      // é intrusivo/robótico; o dono quer entrada/parcela/estimativa primeiro). Antes do fechamento -> deny.
      const iv = (ctx.state.slots as { interesseVisita?: { status?: string; value?: unknown } }).interesseVisita;
      const dh = (ctx.state.slots as { diaHorario?: { status?: string } }).diaHorario;
      const cpfDueNow = iv?.value === true || dh?.status === "known";
      if (asked.includes("cpf") && !cpfDueNow) return qDeny(`pergunta CPF antes da hora (CPF so ao agendar visita/fechar)`);
      // (c) reperguntar um slot JÁ CONHECIDO (incl. visita/horário já respondidos — não reoferte visita se já quer).
      //     ROTEAMENTO POR DOMÍNIO (audit Codex): abstém-se SÓ quando a PERGUNTA do lead é institucional E a RESPOSTA é
      //     institucional PURA (sem claim de veículo) — aí um CTA leve na resposta de endereço não derruba tudo. Numa
      //     resposta MISTA (cita veículo) OU num turno de funil normal a trava continua (não mascara reask indevido).
      const abstainFunnelReask = instOnlyResponse && isInstitutionalTurn(ctx.leadMessage);
      const knownAsked = asked.find((s) => s !== "cpf" && slotKnown(s));
      if (knownAsked && !abstainFunnelReask) return qDeny(`pergunta o slot '${knownAsked}' que ja e conhecido`);
    }

    // POL-GROUND-DETAIL (item 2, Codex): afirmar ATRIBUTO de um veículo (câmbio/cor/ano/km/automático/…) exige
    // que o veículo SELECIONADO pelo lead esteja ATERRADO nos FATOS DESTE TURNO (vehicle_details/stock_search do
    // MESMO vehicleKey). "Algum veículo aterrado" NÃO basta; fato de OUTRO veículo não autoriza. Sem seleção ->
    // pede esclarecimento. (O modelo citado no texto continua defendido pelo POL-GROUND-STOCK.) Declarativo (sem "?").
    {
      const t = normalizeText(composed.text);
      // Gatilho ESTREITO: referência POSSESSIVA/pronominal SINGULAR a um veículo (não uma lista numerada de
      // ofertas, que é aterrada por vehicle_offer_list) + afirmação de atributo. Evita falso-positivo em ofertas.
      const possessiveRef =
        /\b(ele|dele|nele|desse|deste|nesse|neste)\b/.test(t)
        || /\b(esse|este|aquele|o|a)\s+(carro|veiculo|suv|sedan|hatch|picape|modelo)\s+que\s+(voce|vc)\s+\w+/.test(t);
      const attributeClaim =
        /\b(e|esta|fica|vem|sai)\s+(automatic|manual|flex|completo|seminovo|blindad|novo|zero)/.test(t)
        || /\b(cambio|cor|motor|airbag|km|quilometragem|ano)\s+(e|esta|dele|deste|desse|de|:)/.test(t)
        || /\b(automatic|manual)[^?]{0,20}\b(sim|mesmo|isso)\b/.test(t);
      const claimsVehicleAttribute = possessiveRef && attributeClaim;   // claim-scoped: vale sempre (inclui msg mista)
      if (claimsVehicleAttribute) {
        const selectedKey = ctx.state.vehicleContext.selected?.key ?? null;
        const grounded = getValidVehicleKeys(facts);
        if (!selectedKey) {
          return [{ policyId: "POL-GROUND-DETAIL", outcome: "deny", violations: [`afirma atributo de veículo sem veículo SELECIONADO (pedir esclarecimento): "${composed.text.slice(0, 50)}"`] }];
        }
        if (!grounded.has(selectedKey)) {
          return [{ policyId: "POL-GROUND-DETAIL", outcome: "deny", violations: [`atributo do veículo selecionado ${selectedKey} sem fato aterrado no turno (consultar vehicle_details antes)`] }];
        }
      }
    }

    // POL-ATTR-VALUE (F-4, Codex): em pergunta de DETALHE, o VALOR do atributo afirmado no texto deve BATER
    // com o VehicleFact do veículo SELECIONADO. "ele é automático" com fato "Manual" -> deny (mismatch de valor).
    if (ctx.interpretation.relation === "asks_vehicle_detail" && ctx.state.vehicleContext.selected?.key) {
      const selFact = factByKey(facts, ctx.state.vehicleContext.selected.key);
      if (selFact) {
        const t = normalizeText(composed.text);
        const attrDeny = (attr: string, why: string): PolicyVerdict[] => [{ policyId: "POL-ATTR-VALUE", outcome: "deny", violations: [`${attr}: ${why} (veículo ${selFact.vehicleKey})`] }];
        const hasRef = (field: string): boolean => composed.draft.parts.some((p) => p.type === "vehicle_ref" && p.vehicleKey === selFact.vehicleKey && p.field === field);
        // ── MISMATCH DE VALOR em texto livre (defesa): o valor afirmado contradiz o VehicleFact do selecionado.
        if (selFact.cambio) {
          const cambioAuto = /automatic/.test(normalizeText(selFact.cambio));
          const claimsAuto = /\bautomatic/.test(t);
          const claimsManual = /\bmanual\b/.test(t) && !claimsAuto;
          if ((claimsAuto && !cambioAuto) || (claimsManual && cambioAuto)) return attrDeny("câmbio", "valor contradiz o fato");
        }
        if (selFact.cor) {
          const factCor = normalizeText(selFact.cor);
          const COLORS = ["branco", "branca", "preto", "preta", "prata", "cinza", "vermelho", "vermelha", "azul", "verde", "amarelo", "marrom", "bege", "dourado", "laranja", "vinho", "grafite"];
          const claimed = COLORS.find((c) => new RegExp(`\\b${c}\\b`).test(t));
          if (claimed && !factCor.includes(claimed.slice(0, 4))) return attrDeny("cor", "cor contradiz o fato");
        }
        const yr = /\b(?:ano\s+(?:e|de)?\s*|e\s+de\s+|de\s+)(20[0-2]\d|19\d\d)\b/.exec(t);
        if (yr && Number(yr[1]) !== selFact.ano) return attrDeny("ano", "ano contradiz o fato");
        // KM (P1 Codex): valor de km afirmado que diverge do fato (tolerância p/ arredondamento "uns 130 mil").
        if (selFact.km != null) {
          const kmM = /\b(\d{1,3}(?:[.\s]\d{3})+|\d{4,7})\s*(?:mil\s*)?(?:km|quilometr)/.exec(t) || /\b(\d{1,3})\s*mil\s*(?:km|quilometr)/.exec(t);
          if (kmM) {
            let claimedKm = Number(kmM[1].replace(/[.\s]/g, ""));
            if (/\bmil\b/.test(kmM[0]) && claimedKm < 1000) claimedKm *= 1000;
            if (Math.abs(claimedKm - selFact.km) > selFact.km * 0.02 + 500) return attrDeny("km", `${claimedKm} contradiz o fato ${selFact.km}`);
          }
        }
        // P1 (Codex): fail-closed contra o ESCAPE de "valor FORA da lista simples/hardcoded".
        // COR e CÂMBIO são conjuntos fechados: uma lista de léxico nunca cobre tudo (Bordô, Grená, CVT…),
        // então um valor errado FORA do léxico passaria por texto livre sem o mismatch acima disparar.
        // Regra: se o lead perguntou COR/CÂMBIO, a resposta precisa ATERRAR o valor de UMA destas formas:
        //   (a) vehicle_ref(campo) do vehicleKey exato (estruturado, sempre correto);
        //   (b) o VALOR do fato presente no texto (ex.: fato "Bordô" -> texto contém "bordo");
        //   (c) dizer explicitamente que vai confirmar depois.
        // Caso contrário -> deny (dodge ou valor não verificável). Numéricos (ano/km) ficam no mismatch acima.
        const asked = normalizeText(ctx.leadMessage);
        const askedCor = /\bcores?\b|\bcor\b/.test(asked);
        const askedCambio = /\bcambio\b|automatic|\bmanual\b/.test(asked);
        const isDeferral = /vou confirmar|vou verificar|nao (tenho|sei).*(informa|confirma|certeza)|preciso confirmar|deixa eu (confirmar|ver)|te confirmo|ja te confirmo|verifico (isso|pra)/.test(t);
        if (askedCor && selFact.cor && !hasRef("cor") && !isDeferral) {
          const corToken = normalizeText(selFact.cor).split(/\s+/)[0] ?? "";
          if (corToken && !t.includes(corToken)) return attrDeny("cor", "resposta de cor precisa aterrar o valor do fato (vehicle_ref, valor do fato no texto, ou confirmar depois)");
        }
        if (askedCambio && selFact.cambio && !hasRef("cambio") && !isDeferral) {
          const cambioAuto = /automatic/.test(normalizeText(selFact.cambio));
          const grounded = cambioAuto ? /automat/.test(t) : /manual/.test(t);
          if (!grounded) return attrDeny("cambio", "resposta de câmbio precisa aterrar o valor do fato (vehicle_ref, valor do fato no texto, ou confirmar depois)");
        }
      }
    }

    const brandModelViolations: string[] = [];
    const priceViolations: string[] = [];
    // Valores monetários que o PRÓPRIO LEAD forneceu (faixa/entrada/parcela) NÃO são preço de veículo inventado —
    // o agente pode referenciá-los no texto ("não temos até 10 mil", "parcela de 1.800"). Só preço de VEÍCULO
    // precisa aterrar num fato do estoque. A exceção é aterrada nos slots monetários CONHECIDOS do estado.
    const PRICE_TOL = 0.02;
    const leadMoney: number[] = [];
    {
      const sl = ctx.state.slots as Record<string, { status?: string; value?: unknown } | undefined>;
      const push = (v: unknown) => { if (typeof v === "number" && v > 0) leadMoney.push(v); };
      const fp = sl.faixaPreco;
      if (fp?.status === "known" && fp.value && typeof fp.value === "object") { const o = fp.value as { min?: number; max?: number }; push(o.min); push(o.max); }
      if (sl.entrada?.status === "known") push(sl.entrada.value);
      if (sl.parcelaDesejada?.status === "known") push(sl.parcelaDesejada.value);
      // ⭐Missão P0 (validationState, audit Codex F2.43): valores que o LEAD ESCREVEU no bloco DESTE turno aterram o
      // eco na resposta ("Tenho 8k de entrada" -> "R$ 8.000 anotado!") mesmo que o slot ainda não esteja no estado
      // durante a validação (o commit dos slots é tudo-ou-nada e acontece depois). Proveniência do lead — paralelo
      // ao veiculoTroca. Valor INVENTADO pela LLM (nem bloco, nem slot) continua sem aterro -> deny.
      for (const v of leadStatedMoneyValues(ctx.leadMessage)) push(v);
    }
    const isLeadValue = (v: number): boolean => leadMoney.some((lv) => Math.abs(lv - v) <= lv * PRICE_TOL);

    // Marcas/modelos REAIS do turno (fatos + alvo + record_offer). Um modelo citado em texto livre é DANO só se
    // NÃO estiver aterrado aqui (invenção); citar em texto um veículo que ESTÁ na oferta/fatos é conversa natural
    // (ex.: abreviar "HB 20 S"→"HB 20"), não alucinação. A defesa contra invenção (modelo de fora) é preservada.
    const { brands: validBrands, models: validModels } = getValidBrandsAndModels(facts, decision);
    // GROUNDING DE MEMÓRIA (audit Codex): o NOME de um veículo LEMBRADO (selecionado ou ofertado antes) é aterrado —
    // nomeá-lo não é invenção mesmo sem stock_search NESTE turno; assim uma resposta institucional pode citar "o Onix"
    // sem cair em POL-GROUND-STOCK. O ATRIBUTO dele continua exigindo vehicle_details (POL-GROUND-DETAIL/ATTR-VALUE).
    {
      const sel = ctx.state.vehicleContext.selected;
      const addClaims = (s: string | null | undefined): void => { if (!s) return; for (const c of ctx.claimExtractor.extractClaims(s)) { if (c.kind === "brand" || c.kind === "brand_model") validBrands.add(c.normalized); if (c.kind === "model" || c.kind === "brand_model") validModels.add(c.normalized); } };
      if (sel?.label) addClaims(sel.label);
      for (const it of ctx.state.lastRenderedOfferContext?.items ?? []) { addClaims(it.marca ?? undefined); addClaims(it.modelo ?? undefined); if (it.marca && it.modelo) addClaims(`${it.marca} ${it.modelo}`); }
      // ⭐Missão P0 (TROCA, proveniência do LEAD): o VEÍCULO DE TROCA é o carro DO LEAD (slots.veiculoTroca — já inclui
      // a extração DESTE turno). Nomeá-lo na resposta ("anotei sua Hilux 2020") é conversa aterrada NA FALA DO LEAD,
      // nunca invenção de catálogo — paralelo ao isLeadValue para valores monetários. Cobre o typo do lead nos DOIS
      // sentidos pela forma de letras colapsadas ("hillux" ≙ "hilux"). O carro de troca NUNCA entra em oferta
      // (vehicle_ref/offer_list seguem exigindo catálogo) — a isenção é só para o NOME em texto livre.
      const tvSlot = (ctx.state.slots as Record<string, { status?: string; value?: unknown } | undefined>).veiculoTroca;
      if (tvSlot?.status === "known" && tvSlot.value && typeof tvSlot.value === "object") {
        const tv = tvSlot.value as { marca?: string; modelo?: string };
        const collapseL = (s: string): string => s.replace(/(\p{L})\1+/gu, "$1");
        addClaims(tv.marca); addClaims(tv.modelo); if (tv.marca && tv.modelo) addClaims(`${tv.marca} ${tv.modelo}`);
        if (tv.modelo) { const n = normalizeText(tv.modelo); validModels.add(n); validModels.add(collapseL(n)); }
        if (tv.marca) { const n = normalizeText(tv.marca); validBrands.add(n); validBrands.add(collapseL(n)); }
      }
    }
    const modelGrounded = (norm: string): boolean => validModels.has(norm) || modelGroundedExact(norm, validModels);
    const claimGrounded = (claim: { kind: string; normalized: string }): boolean => {
      const brandOk = !(claim.kind === "brand" || claim.kind === "brand_model") || validBrands.has(claim.normalized);
      const modelOk = !(claim.kind === "model" || claim.kind === "brand_model") || modelGrounded(claim.normalized);
      return brandOk && modelOk;
    };

    // 1. TextPart não pode conter marca/modelo NÃO-ATERRADO (invenção). Modelo aterrado nos fatos do turno é
    //    permitido em texto (conversa natural sobre o que foi ofertado); preço livre segue proibido (grounding).
    for (const part of composed.draft.parts) {
      if (part.type === "text") {
        // Um modelo citado em texto livre deve estar aterrado (fatos do turno OU memória: selecionado/ofertado). Inventar
        // um modelo continua barrado; nomear o carro lembrado passa (grounding de memória acima).
        const claims = ctx.claimExtractor.extractClaims(part.content);
        for (const claim of claims) {
          if (!claimGrounded(claim)) brandModelViolations.push(`TextPart contém marca/modelo não-aterrado '${claim.text}' em texto livre`);
        }

        // Verifica se há valores monetários no TextPart (excluindo km e valores que o LEAD forneceu).
        // R11-D1: valor 0 ("entrada zero"/"sem entrada") NUNCA é preço de veículo — é termo de pagamento do lead;
        // não pode virar "valor monetário livre" (era terminal-safe falso-positivo). Valor do lead também isento.
        // ⭐Codex rodada 2 (smoke T7): o PREÇO que a PRÓPRIA LOJA mostrou na última oferta renderizada é fato
        // ATERRADO de memória (RenderedOfferItem.preco, R13 Inc2/G) — ecoá-lo ao conduzir o financiamento não é
        // invenção. Sem esta isenção o cérebro entrava em deny-loop ('NÃO afirme valores') ao citar o preço exibido.
        const offeredPrices = new Set((ctx.state.lastRenderedOfferContext?.items ?? []).map((i) => i.preco).filter((v): v is number => typeof v === "number" && v > 0));
        const moneyMentionsText = parseMoneyMentions(part.content).filter((m) => m.value > 0 && !isLeadValue(m.value) && !offeredPrices.has(m.value));
        if (moneyMentionsText.length > 0) {
          priceViolations.push(`TextPart contém valor monetário livre '${moneyMentionsText[0].raw}'`);
        }
      } else if (part.type === "vehicle_ref") {
        // Valida se o veículo referenciado está no catálogo do tenant (Fase 1.4).
        // ⭐Fatos frescos do turno (stock_search/vehicle_details ok) contam como catálogo — snapshot vazio não apaga.
        if (!isVehicleKeyGrounded(ctx.tenantCatalog, facts, part.vehicleKey)) {
          brandModelViolations.push(`veículo referenciado '${part.vehicleKey}' contém marca/modelo fora do catálogo do tenant`);
        }
      } else if (part.type === "money_ref") {
        // Valida se o veículo na fonte está no catálogo do tenant (Fase 1.4)
        if (part.source.kind === "vehicle_fact") {
          if (!isVehicleKeyGrounded(ctx.tenantCatalog, facts, part.source.vehicleKey)) {
            brandModelViolations.push(`veículo referenciado na fonte monetária '${part.source.vehicleKey}' contém marca/modelo fora do catálogo do tenant`);
          }
        }
      } else if (part.type === "vehicle_offer_list") {
        // F2.7.5: cada veículo da lista renderizada deve estar no catálogo do tenant (ou nos fatos frescos do turno).
        for (const key of part.vehicleKeys) {
          if (!isVehicleKeyGrounded(ctx.tenantCatalog, facts, key)) {
            brandModelViolations.push(`veículo da lista '${key}' contém marca/modelo fora do catálogo do tenant`);
          }
        }
      }
    }

    // 2. Defender o texto final renderizado: marcas e modelos citados devem existir nos fatos do turno OU na MEMÓRIA
    //    (selecionado/ofertado) — inventar continua barrado; nomear o carro lembrado passa.
    const renderedClaims = ctx.claimExtractor.extractClaims(composed.text);
    for (const claim of renderedClaims) {
      const normVal = claim.normalized;
      if (claim.kind === "brand" || claim.kind === "brand_model") {
        if (!validBrands.has(normVal)) {
          brandModelViolations.push(`marca não-aterrada '${claim.text}' no texto renderizado`);
        }
      }
      if (claim.kind === "model" || claim.kind === "brand_model") {
        // Aterrado só se EXATO (formatação colapsada) de um modelo REAL do turno — nunca por subconjunto (R10-3).
        if (!validModels.has(normVal) && !modelGroundedExact(normVal, validModels)) {
          brandModelViolations.push(`modelo não-aterrado '${claim.text}' no texto renderizado`);
        }
      }
    }

    if (brandModelViolations.length > 0) {
      return [{
        policyId: "POL-GROUND-STOCK",
        outcome: "deny",
        violations: brandModelViolations
      }];
    }

    // Fix 3 (diag conv2 / POL-GROUND-YEAR): o ANO que faz parte do NOME de um veículo ATERRADO é IDENTIDADE e é
    // PERMITIDO ("Honda CR-V 2010" quando o CR-V 2010 está nos fatos). Mas um ano JUNTO ao modelo de um veículo aterrado
    // que NÃO corresponde a NENHUM par (modelo, ano) real do turno é HALUCINAÇÃO -> deny; idem um ano atribuído por
    // referência possessiva ao veículo SELECIONADO ("ele é 2020") que diverge do fato. Ano CORRETO passa; inventado bloqueia.
    {
      const t = normalizeText(composed.text);
      const grounded: { marca?: string | null; modelo?: string | null; ano?: number | null; key: string }[] = [];
      for (const f of facts) {
        if (!f.ok) continue;
        if (f.tool === "stock_search") for (const v of f.data.items) grounded.push({ marca: v.marca, modelo: v.modelo, ano: v.ano, key: v.vehicleKey });
        if (f.tool === "vehicle_details") { const v = f.data.vehicle; grounded.push({ marca: v.marca, modelo: v.modelo, ano: v.ano, key: v.vehicleKey }); }
      }
      const validModelYear = new Set<string>();            // "modeloCanonico|ano" válidos do turno
      const modelTokens = new Map<string, string>();       // modeloCanonico -> token de regex (separadores flexíveis)
      for (const g of grounded) {
        if (typeof g.ano !== "number" || !g.modelo) continue;
        const canon = normalizeText(g.modelo).replace(/[\s\-]+/g, "");
        if (!canon) continue;
        validModelYear.add(`${canon}|${g.ano}`);
        const parts = normalizeText(g.modelo).split(/[\s\-]+/).filter(Boolean).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        if (parts.length) modelTokens.set(canon, parts.join("[\\s\\-]*"));
      }
      const yearDeny = (y: number, label: string): PolicyVerdict[] => [{ policyId: "POL-GROUND-YEAR", outcome: "deny", violations: [`ano ${y} não confere com um veículo aterrado (${label})`] }];
      for (const [canon, token] of modelTokens) {
        const re = new RegExp(`\\b${token}\\b[^\\d]{0,8}((?:19|20)\\d\\d)\\b`, "g");
        for (let m = re.exec(t); m; m = re.exec(t)) {
          if (!validModelYear.has(`${canon}|${Number(m[1])}`)) return yearDeny(Number(m[1]), canon);
        }
      }
      const selKey = ctx.state.vehicleContext.selected?.key ?? null;
      const selFact = selKey ? grounded.find((g) => g.key === selKey) : null;
      if (selFact && typeof selFact.ano === "number") {
        const pm = /\b(?:ele|ela|esse|este|desse|deste|nesse|neste|isso)\b[^\d]{0,12}((?:19|20)\d\d)\b/.exec(t);
        if (pm && Number(pm[1]) !== selFact.ano) return yearDeny(Number(pm[1]), "veículo selecionado");
      }
    }

    // 3. Validação do grounding monetário no texto final renderizado
    const mentions = parseMoneyMentions(composed.text);
    const realPrices = new Set<number>();
    for (const f of facts) {
      if (f.ok && f.tool === "stock_search") for (const v of f.data.items) realPrices.add(v.preco);
      if (f.ok && f.tool === "vehicle_details") realPrices.add(f.data.vehicle.preco);
    }

    const vehiclePriceMentions = mentions.filter(m => m.role === "vehicle_price");
    const bad = vehiclePriceMentions.filter((m) => !isLeadValue(m.value) && ![...realPrices].some((rp) => Math.abs(rp - m.value) <= rp * PRICE_TOL));

    if (bad.length > 0 || priceViolations.length > 0) {
      const allViolations = [...priceViolations, ...bad.map((m) => `preço não-aterrado R$${m.value} (${m.raw})`)];
      return [{
        policyId: "POL-GROUND-PRICE",
        outcome: "deny",
        violations: allViolations
      }];
    }

    return [{ policyId: "POL-GROUND-PRICE", outcome: "allow" }];
  },
};

export function hasDeny(verdicts: PolicyVerdict[]): boolean {
  return verdicts.some((v) => v.outcome === "deny");
}
export function collectRequirements(verdicts: PolicyVerdict[]): string[] {
  return verdicts.flatMap((v) => v.requirements ?? []);
}
