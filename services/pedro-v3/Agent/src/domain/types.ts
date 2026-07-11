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
export type TransmissionPreference = "automatic" | "manual";
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
  cambio?: string | null; // F2.7.5: opcional — renderizado "se houver" (fonte de estoque pode preencher)
  cor?: string | null;    // F2.7.5: opcional — idem
  tipo: VehicleType;
  photoIds?: string[];
};

// Identidade LEMBRADA de um veículo (audit autoria única): só marca/modelo (+ ano se conhecido) de uma oferta/
// seleção/foto anterior. Autoriza APENAS NOMEAR o veículo no renderer — NUNCA carrega km/câmbio/cor/preço. Substitui
// o antigo `labelToFact` (que fabricava VehicleFact com ano=0/preco=-1). Atributo só vem de QueryResult REAL do MESMO
// vehicleKey. `ano: null` quando desconhecido -> vehicle_ref(ano) falha fechado (força vehicle_details).
export type RememberedVehicleIdentity = {
  readonly vehicleKey: string;
  readonly marca: string;
  readonly modelo: string;
  readonly ano: number | null;
};

export type ConversationStage =
  | "greeting" | "discovery" | "offering" | "negotiating" | "scheduling" | "handoff" | "closed";

export type SlotName =
  | "nome" | "interesse" | "tipoVeiculo" | "faixaPreco" | "formaPagamento"
  | "entrada" | "possuiTroca" | "diaHorario" | "cpf" | "birthDate"
  | "parcelaDesejada" | "veiculoTroca" | "cidade" | "conheceLoja" | "interesseVisita";

export type ObjectiveType =
  | "perguntou_pagamento" | "perguntou_troca" | "perguntou_dados"
  | "ofereceu_fotos" | "ofereceu_opcoes";

export type AnswerKind =
  | "valor" | "negacao" | "parcela" | "nome" | "data" | "boolean" | "modelo" | "afirmacao";

// Valor sensível: NUNCA o valor cru no estado (Codex #8). Só referência ao cofre.
export type SensitiveValueRef = { ref: string; kind: "cpf" | "birth_date" | "secret"; last4?: string | null };

export function vehicleKeyOf(v: { marca?: string; modelo?: string; ano?: number }): string {
  return [v.marca, v.modelo, v.ano].filter(Boolean).join("|").toLowerCase().replace(/[^\w|]+/g, "-");
}
