// ============================================================================
// Tipos do módulo de Gestão Comercial (vendas/metas lançadas manualmente).
// Espelham as tabelas comercial_vendas / comercial_metas (migration
// 20260610170000). Vendedor = registro em ai_team_members; papel vem de
// profiles.role (gestor = owner/manager; vendedor = seller).
// ============================================================================

export type OrigemVenda = 'trafego' | 'portais' | 'porta' | 'particular';

export const ORIGENS: { value: OrigemVenda; label: string }[] = [
  { value: 'trafego', label: 'Tráfego Pago' },
  { value: 'portais', label: 'Portais' },
  { value: 'porta', label: 'Porta' },
  { value: 'particular', label: 'Particular' },
];

export const ORIGEM_LABEL: Record<OrigemVenda, string> = {
  trafego: 'Tráfego Pago',
  portais: 'Portais',
  porta: 'Porta',
  particular: 'Particular',
};

/** Cores por origem (HSL) — usadas nos gráficos e barras. */
export const ORIGEM_COR: Record<OrigemVenda, string> = {
  trafego: '#3b82f6',     // azul
  portais: '#a855f7',     // roxo
  porta: '#f59e0b',       // âmbar
  particular: '#10b981',  // verde
};

export interface VendaComercial {
  id: string;
  user_id: string;
  seller_id: string;
  data_venda: string;      // YYYY-MM-DD
  valor: number;
  origem: OrigemVenda;
  portal: string | null;
  veiculo: string | null;
  observacao: string | null;
  created_at: string;
}

export interface MetaComercial {
  id: string;
  user_id: string;
  seller_id: string | null;     // null quando tipo = 'loja'
  tipo: 'individual' | 'loja';
  mes_referencia: string;       // YYYY-MM-01
  valor_meta: number;           // QUANTIDADE de vendas
}

/** Vendedor simplificado (de ai_team_members) para o módulo comercial. */
export interface VendedorComercial {
  id: string;
  nome: string;
}

/** Linha da tabela de desempenho por vendedor. */
export interface DesempenhoVendedor {
  sellerId: string;
  nome: string;
  meta: number;
  vendas: number;
  pctMeta: number;              // 0-100+ (null-safe: 0 quando sem meta)
  faturamento: number;
  porOrigem: Record<OrigemVenda, number>;
}

/** KPIs do topo do bloco comercial (geral ou de 1 vendedor). */
export interface ComercialKpis {
  vendasTotais: number;
  faturamento: number;
  ticketMedio: number;
  metaRef: number;              // meta do recorte (loja no geral; individual no drill-down)
  pctMeta: number;              // vendasTotais / metaRef * 100
  melhorVendedor: { nome: string; vendas: number } | null;  // só no modo geral
  melhorCanal: { origem: OrigemVenda; vendas: number } | null;
}
