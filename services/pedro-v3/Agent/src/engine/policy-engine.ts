import type { TurnContext } from "../domain/context.ts";
import type {
  QueryCall, QueryResult, ProposedDecision, PolicyVerdict, RenderedResponse,
  TurnDecision, EffectPlan, ProposedEffectPlan, MoneyRole,
} from "../domain/decision.ts";
import { isVehicleKeyInCatalog, normalizeText } from "./catalog-utils.ts";

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

    // POL-CATALOG-OFFER: veículo ofertado deve ter marca e modelo no catálogo do tenant (Fase 1.4)
    for (const k of offeredKeys) {
      if (!isVehicleKeyInCatalog(ctx.tenantCatalog, k)) {
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
    const brandModelViolations: string[] = [];
    const priceViolations: string[] = [];

    // 1. TextPart não pode conter marca/modelo/valor sem referência estruturada (ClaimExtractor)
    for (const part of composed.draft.parts) {
      if (part.type === "text") {
        const claims = ctx.claimExtractor.extractClaims(part.content);
        for (const claim of claims) {
          brandModelViolations.push(`TextPart contém marca/modelo '${claim.text}' em texto livre`);
        }

        // Verifica se há valores numéricos ou monetários no TextPart (excluindo km)
        const moneyMentionsText = parseMoneyMentions(part.content);
        if (moneyMentionsText.length > 0) {
          priceViolations.push(`TextPart contém valor monetário livre '${moneyMentionsText[0].raw}'`);
        }
      } else if (part.type === "vehicle_ref") {
        // Valida se o veículo referenciado está no catálogo do tenant (Fase 1.4)
        if (!isVehicleKeyInCatalog(ctx.tenantCatalog, part.vehicleKey)) {
          brandModelViolations.push(`veículo referenciado '${part.vehicleKey}' contém marca/modelo fora do catálogo do tenant`);
        }
      } else if (part.type === "money_ref") {
        // Valida se o veículo na fonte está no catálogo do tenant (Fase 1.4)
        if (part.source.kind === "vehicle_fact") {
          if (!isVehicleKeyInCatalog(ctx.tenantCatalog, part.source.vehicleKey)) {
            brandModelViolations.push(`veículo referenciado na fonte monetária '${part.source.vehicleKey}' contém marca/modelo fora do catálogo do tenant`);
          }
        }
      }
    }

    // 2. Defender o texto final renderizado: marcas e modelos citados no texto final devem existir nos QueryResults (defesa em profundidade)
    const { brands: validBrands, models: validModels } = getValidBrandsAndModels(facts, decision);
    const renderedClaims = ctx.claimExtractor.extractClaims(composed.text);
    for (const claim of renderedClaims) {
      const normVal = claim.normalized;
      if (claim.kind === "brand" || claim.kind === "brand_model") {
        if (!validBrands.has(normVal)) {
          brandModelViolations.push(`marca não-aterrada '${claim.text}' no texto renderizado`);
        }
      }
      if (claim.kind === "model" || claim.kind === "brand_model") {
        if (!validModels.has(normVal)) {
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

    // 3. Validação do grounding monetário no texto final renderizado
    const mentions = parseMoneyMentions(composed.text);
    const realPrices = new Set<number>();
    for (const f of facts) {
      if (f.ok && f.tool === "stock_search") for (const v of f.data.items) realPrices.add(v.preco);
      if (f.ok && f.tool === "vehicle_details") realPrices.add(f.data.vehicle.preco);
    }

    const tol = 0.02;
    const vehiclePriceMentions = mentions.filter(m => m.role === "vehicle_price");
    const bad = vehiclePriceMentions.filter((m) => ![...realPrices].some((rp) => Math.abs(rp - m.value) <= rp * tol));

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
