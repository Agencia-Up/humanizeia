// ============================================================================
// Pedro v3 — Kernel puro. Tipos de domínio primitivos.
// Fonte: Brain/02-ARQUITETURA-E-CONTRATOS.md. SEM I/O, SEM efeito externo.
// ============================================================================

export type Id = string;
export type Iso = string; // timestamp ISO-8601

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [k: string]: JsonValue };

// Marca de redaction por construção (Codex #8). Nunca aceita PII/segredo cru.
export type Redacted<T> = T & { readonly __redacted: true };
export type RedactedText = Redacted<{ text: string }>;
export function redactText(text: string): RedactedText {
  return { text, __redacted: true } as RedactedText;
}

export type VehicleType = "suv" | "sedan" | "hatch" | "pickup" | "unknown";
export type PaymentMethod = "a_vista" | "financiamento" | "consorcio" | "troca";

export type EntityReference = {
  kind: "vehicle" | "lead" | "slot";
  key: string;
  label?: string | null;
};

// Fato aterrado de um veículo (saída de stock_search / vehicle_details).
export type VehicleFact = {
  vehicleKey: string; // estável: marca|modelo|ano
  marca: string;
  modelo: string;
  ano: number;
  preco: number;
  km?: number;
  tipo: VehicleType;
  photoIds?: string[];
};

export type ConversationStage =
  | "greeting" | "discovery" | "offering" | "negotiating" | "scheduling" | "handoff" | "closed";

export type SlotName =
  | "nome" | "interesse" | "tipoVeiculo" | "faixaPreco" | "formaPagamento"
  | "entrada" | "possuiTroca" | "diaHorario" | "cpf"
  | "parcelaDesejada" | "veiculoTroca" | "cidade" | "conheceLoja" | "interesseVisita";

export type ObjectiveType =
  | "perguntou_pagamento" | "perguntou_troca" | "perguntou_dados"
  | "ofereceu_fotos" | "ofereceu_opcoes";

export type AnswerKind =
  | "valor" | "negacao" | "parcela" | "nome" | "data" | "boolean" | "modelo" | "afirmacao";

// Valor sensível: NUNCA o valor cru no estado (Codex #8). Só referência ao cofre.
export type SensitiveValueRef = { ref: string; kind: "cpf" | "secret"; last4?: string | null };

export function vehicleKeyOf(v: { marca?: string; modelo?: string; ano?: number }): string {
  return [v.marca, v.modelo, v.ano].filter(Boolean).join("|").toLowerCase().replace(/[^\w|]+/g, "-");
}
