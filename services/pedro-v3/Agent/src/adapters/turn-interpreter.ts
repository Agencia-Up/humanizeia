// ============================================================================
// TurnInterpreter Adapter â€” classifica semanticamente a relaÃ§Ã£o da fala do lead
// com o estado atual da conversa (responde pendente, muda de assunto, etc.).
// Desacoplado de modelos especÃ­ficos via EntityExtractor genÃ©rico.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { TurnInterpretation, TenantCatalog } from "../domain/decision.ts";
import { normalizedTermInText } from "../engine/catalog-utils.ts";

export type ExtractedEntities = {
  modelType?: string; // ex: "sedan", "suv", "hatch", "pickup"
  brandModelWords?: string[]; // palavras extraÃ­das que representam marcas/modelos
  paymentMention?: boolean;
  tradeMention?: boolean;
  tradeDetails?: boolean; // km, ano, etc.
  changeCue?: boolean; // "mudei", "agora quero", "prefiro", "mudar", "outra coisa"
  greeting?: boolean;
  asksPhotos?: boolean;
  asksWarranty?: boolean;
  asksInspection?: boolean; // laudo
  asksMoreOptions?: boolean;
};

export interface EntityExtractor {
  extract(leadMessage: string, catalog: TenantCatalog): ExtractedEntities;
}

export class CatalogEntityExtractor implements EntityExtractor {
  extract(leadMessage: string, catalog: TenantCatalog): ExtractedEntities {
    const msg = leadMessage.toLowerCase().trim();
    const entities: ExtractedEntities = {};

    // Pistas de mudanÃ§a de direÃ§Ã£o
    if (
      msg.includes("mudei de ideia") ||
      msg.includes("quero outro") ||
      msg.includes("agora quero") ||
      msg.includes("prefiro") ||
      msg.includes("mudar") ||
      msg.includes("outra coisa") ||
      msg.includes("outro carro")
    ) {
      entities.changeCue = true;
    }

    // Tipos de carroceria
    if (msg.includes("sedan") || msg.includes("sedÃ£")) {
      entities.modelType = "sedan";
    } else if (msg.includes("suv")) {
      entities.modelType = "suv";
    } else if (msg.includes("hatch")) {
      entities.modelType = "hatch";
    } else if (msg.includes("pickup") || msg.includes("picape") || msg.includes("caminhonete")) {
      entities.modelType = "pickup";
    }

    // Detalhes da troca (km, ano, rodado, etc.)
    if (
      msg.includes("km") ||
      msg.includes("quilometragem") ||
      msg.includes("rodado") ||
      msg.includes("ano") ||
      /\b(19|20)\d{2}\b/.test(msg)
    ) {
      entities.tradeDetails = true;
    }

    if (msg.includes("troca") || msg.includes("meu carro") || msg.includes("tenho um") || msg.includes("dou um")) {
      entities.tradeMention = true;
    }

    // Detalhes de pagamento
    if (
      msg.includes("parcela") ||
      msg.includes("financia") ||
      msg.includes("entrada") ||
      msg.includes("pagar") ||
      msg.includes("vista") ||
      msg.includes("reais")
    ) {
      entities.paymentMention = true;
    }

    // Marca / modelo vindos dinamicamente do TenantCatalog estruturado.
    // Usa termos completos normalizados para suportar modelos multi-palavra e hifenizados.
    const brandModelWords = new Set<string>();
    for (const entry of catalog.entries) {
      if (normalizedTermInText(leadMessage, entry.brand)) brandModelWords.add(entry.brand);
      if (normalizedTermInText(leadMessage, entry.model)) brandModelWords.add(entry.model);
      for (const alias of entry.aliases) {
        if (normalizedTermInText(leadMessage, alias)) brandModelWords.add(alias);
      }
    }
    if (brandModelWords.size > 0) {
      entities.brandModelWords = [...brandModelWords];
    }

    // Perguntas de detalhes
    if (msg.includes("foto") || msg.includes("imagem") || msg.includes("fotos")) {
      entities.asksPhotos = true;
    }
    if (msg.includes("garantia")) {
      entities.asksWarranty = true;
    }
    if (msg.includes("laudo")) {
      entities.asksInspection = true;
    }

    // Mais opÃ§Ãµes
    if (
      msg.includes("mais opc") ||
      msg.includes("mais opÃ§") ||
      msg.includes("outro") ||
      msg.includes("outra") ||
      msg.includes("outros") ||
      msg.includes("outras") ||
      msg.includes("ver mais")
    ) {
      entities.asksMoreOptions = true;
    }

    // SaudaÃ§Ãµes
    if (
      msg === "oi" || msg === "ola" || msg === "olÃ¡" ||
      msg === "bom dia" || msg === "boa tarde" || msg === "boa noite"
    ) {
      entities.greeting = true;
    }

    return entities;
  }
}

export function interpretTurn(
  leadMessage: string,
  state: ConversationState,
  extractor: EntityExtractor,
  catalog: TenantCatalog
): TurnInterpretation {
  const obj = state.currentObjective;
  const entities = extractor.extract(leadMessage, catalog);

  // Se houver um objetivo pendente (ativo), ele tem prioridade sobre buscas/detalhes
  if (obj && obj.status === "pending") {
    // MudanÃ§a de direÃ§Ã£o exige: changeCue E preferÃªncia de veÃ­culo incompatÃ­vel
    const hasNewVehiclePreference = !!(entities.modelType || (entities.brandModelWords && entities.brandModelWords.length > 0));
    const isVehicleObjective = obj.type === "ofereceu_opcoes" || obj.slot === "interesse" || obj.slot === "tipoVeiculo";

    if (entities.changeCue && hasNewVehiclePreference && !isVehicleObjective) {
      return { relation: "direction_change" };
    }

    // Valida compatibilidade direta com o objetivo pendente para classificar como answers_pending:
    if (obj.type === "perguntou_troca" || obj.slot === "possuiTroca") {
      if (entities.tradeDetails || entities.tradeMention) {
        return { relation: "answers_pending" };
      }
    }

    if (obj.type === "perguntou_pagamento" || obj.slot === "formaPagamento" || obj.slot === "entrada") {
      if (entities.paymentMention) {
        return { relation: "answers_pending" };
      }
    }

    if (isVehicleObjective) {
      if (entities.modelType || (entities.brandModelWords && entities.brandModelWords.length > 0)) {
        return { relation: "answers_pending" };
      }
    }

    // Por padrÃ£o, se hÃ¡ objetivo ativo e nenhuma mudanÃ§a de direÃ§Ã£o explÃ­cita foi confirmada, responde o objetivo
    return { relation: "answers_pending" };
  }

  // Sem objetivo pendente ativo
  if (entities.greeting) {
    return { relation: "unrelated" };
  }

  if (entities.asksPhotos || entities.asksWarranty || entities.asksInspection) {
    return { relation: "asks_vehicle_detail" };
  }

  if (entities.asksMoreOptions) {
    return { relation: "continues_offer" };
  }

  if (entities.modelType || (entities.brandModelWords && entities.brandModelWords.length > 0) || entities.changeCue) {
    return { relation: "direction_change" };
  }

  return { relation: "ambiguous" };
}
