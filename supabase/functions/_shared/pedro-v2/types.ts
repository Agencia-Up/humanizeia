export type PedroV2ContactKind = "lead" | "seller" | "manager" | "internal" | "unknown";

export type PedroV2Intent =
  | "stock_lookup"
  | "price_question"
  | "vehicle_reference"
  | "photo_request"
  | "financing"
  | "trade_in"
  | "location"
  | "human_request"
  | "seller_ack"
  | "complaint"
  | "small_talk"
  | "unknown";

export type PedroV2ConversationStage =
  | "novo_contato"
  | "entendendo_interesse"
  | "consultando_estoque"
  | "apresentando_opcoes"
  | "qualificando_compra"
  | "aguardando_resposta"
  | "transferencia_pendente"
  | "vendedor_assumiu"
  | "ia_pausada"
  | "encerrado";

export type PedroV2Identity = {
  kind: PedroV2ContactKind;
  phone: string;
  remote_jid: string;
  seller?: any;
  seller_matches?: any[];
  reason: string;
};

export type PedroV2LeadMemory = {
  lead?: {
    nome?: string | null;
    telefone?: string | null;
    cidade?: string | null;
  };
  interesse?: {
    modelo_desejado?: string | null;
    marca?: string | null;
    tipo_veiculo?: string | null;
    cambio?: string | null;
    combustivel?: string | null;
    ano_min?: number | null;
    ano_max?: number | null;
    preco_max?: number | null;
    km_max?: number | null;
  };
  negociacao?: {
    forma_pagamento?: string | null;
    valor_entrada?: string | null;
    parcela_desejada?: string | null;
    tem_troca?: boolean | null;
    carro_troca?: Record<string, any> | null;
  };
  referencia?: {
    texto_referencia?: string | null;
    origem_anuncio?: string | null;
    veiculo_citado?: string | null;
    confidence?: number;
  };
  atendimento?: {
    etapa?: PedroV2ConversationStage;
    objecoes?: string[];
    ultimo_proximo_passo?: string | null;
    vendedor_anterior_id?: string | null;
  };
  veiculos_apresentados?: any[];
};

export type PedroV2IntentResult = {
  intent: PedroV2Intent;
  confidence: number;
  needs_stock_search: boolean;
  needs_handoff: boolean;
  extracted: PedroV2LeadMemory;
  reason: string;
};

export type PedroV2TurnInput = {
  payload: any;
  dry_run?: boolean;
};

export type PedroV2TurnResult = {
  ok: boolean;
  dry_run: boolean;
  correlation_id: string;
  identity?: PedroV2Identity;
  lead_id?: string | null;
  intent?: PedroV2IntentResult;
  stock_result?: any;
  reply?: any;
  send_result?: any;
  next_action?: string;
  error?: string;
};
