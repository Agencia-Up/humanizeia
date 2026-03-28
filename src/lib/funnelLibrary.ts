/**
 * funnelLibrary.ts
 * Biblioteca central de funis — single source of truth para todos os agentes.
 * Adicione novos funis aqui; eles ficam disponíveis em Daniel, Lucas e Salomão.
 */

import type { AgentName } from '@/components/daniel/flowTypes';

export interface FunnelStep {
  stage: string;
  agent: AgentName;
  action: string;
  // input é opcional na definição base — preenchido por adaptFunnelToClient()
  input?: Record<string, string>;
}

/** Dados do cliente vindos do client_briefings (Salomão) */
export interface ClientData {
  nicho: string;
  oferta: string;
  publico?: string;
  diferencial?: string;
  tom?: string;
  produto?: string;
  preco?: string;
  cta?: string;
  site?: string;
  redesSociais?: string;
  paletaCores?: string;
  identidadeVisual?: string;
}

export interface FunnelDefinition {
  id: string;
  name: string;
  description: string;
  steps: FunnelStep[];
  ticketMin?: number;   // ticket mínimo recomendado (usado por recommendFunnel)
  ticketMax?: number;   // ticket máximo recomendado (undefined = sem limite)
  badge?: string;       // label exibido na UI (ex: "Baixo Ticket", "Alto Ticket")
}

/** Perfil do cliente usado pela recomendação de funil */
export interface ClientProfile {
  ticket: number;       // valor do ticket em R$
  nicho?: string;
  canal?: 'meta' | 'google' | 'whatsapp' | 'organico';
}

export const funnelLibrary: FunnelDefinition[] = [
  // ── AIDA Base ───────────────────────────────────────────────────────────────
  {
    id: 'aida_basic',
    name: 'Funil AIDA',
    description: 'Modelo estratégico com cada agente responsável por uma etapa da jornada',
    steps: [
      { stage: 'ATENCAO',   agent: 'DAVI',   action: 'criar_conteudo_social' },
      { stage: 'INTERESSE', agent: 'LUCAS',  action: 'criar_landing_page'    },
      { stage: 'DESEJO',    agent: 'JOÃO',   action: 'sequencia_email'       },
      { stage: 'ACAO',      agent: 'MARCOS', action: 'checkout'              },
      { stage: 'POS_VENDA', agent: 'DANIEL', action: 'analise_kpi'          },
    ],
  },

  // ── Recomendados por Ticket ──────────────────────────────────────────────────

  /**
   * TRIPWIRE — Ticket < R$ 100
   * Produto de entrada (R$ 7–97) que quebra a barreira de compra.
   * Objetivo: converter visitante em comprador o mais rápido possível.
   * Fluxo: Anúncio → LP de tripwire → Upsell → Email pós-compra → Análise
   */
  {
    id: 'tripwire',
    name: 'Tripwire (Baixo Ticket)',
    description: 'Produto de entrada R$ 7–97 que transforma visitante em comprador rapidamente',
    ticketMin: 0,
    ticketMax: 99,
    badge: 'Até R$ 99',
    steps: [
      { stage: 'ATENCAO',   agent: 'JOSÉ',   action: 'trafego_pago'          },
      { stage: 'INTERESSE', agent: 'PAULO',  action: 'vsl_copy'              },
      { stage: 'ACAO',      agent: 'LUCAS',  action: 'checkout'              },
      { stage: 'UPSELL',    agent: 'PAULO',  action: 'vsl_copy'              },
      { stage: 'NUTRICAO',  agent: 'JOÃO',   action: 'sequencia_email'       },
      { stage: 'POS_VENDA', agent: 'DANIEL', action: 'analise_kpi'          },
    ],
  },

  /**
   * LEAD MAGNET — Ticket R$ 100–1000
   * Ímã de leads (e-book, quiz, mini-curso) captura email → nutre → vende.
   * Fluxo: Conteúdo orgânico + Tráfego → Captura → Sequência email → Oferta
   */
  {
    id: 'lead_magnet',
    name: 'Lead Magnet (Médio Ticket)',
    description: 'Ímã de leads → nutrição por email → conversão. Ideal para R$ 100–1.000',
    ticketMin: 100,
    ticketMax: 999,
    badge: 'R$ 100–999',
    steps: [
      { stage: 'ATENCAO',   agent: 'DAVI',   action: 'criar_conteudo_social' },
      { stage: 'CAPTURA',   agent: 'LUCAS',  action: 'pagina_captura'        },
      { stage: 'NUTRICAO',  agent: 'JOÃO',   action: 'sequencia_email'       },
      { stage: 'DESEJO',    agent: 'PAULO',  action: 'vsl_copy'              },
      { stage: 'ACAO',      agent: 'MARCOS', action: 'checkout'              },
      { stage: 'POS_VENDA', agent: 'DANIEL', action: 'analise_kpi'          },
    ],
  },

  /**
   * WEBINAR — Ticket > R$ 1.000
   * Webinário ao vivo ou gravado para produtos de alto valor.
   * Fluxo: Tráfego → Inscrição → Aquecimento → Webinário → WhatsApp → Fechamento
   */
  {
    id: 'webinar',
    name: 'Webinário (Alto Ticket)',
    description: 'Webinário ao vivo para produtos acima de R$ 1.000 com fechamento consultivo',
    ticketMin: 1000,
    badge: 'Acima de R$ 1.000',
    steps: [
      { stage: 'ATENCAO',   agent: 'JOSÉ',   action: 'trafego_pago'          },
      { stage: 'CAPTURA',   agent: 'LUCAS',  action: 'pagina_captura'        },
      { stage: 'NUTRICAO',  agent: 'JOÃO',   action: 'sequencia_email'       },
      { stage: 'DESEJO',    agent: 'PAULO',  action: 'vsl_copy'              },
      { stage: 'DESEJO',    agent: 'MARCOS', action: 'whatsapp_qualificacao' },
      { stage: 'ACAO',      agent: 'MARCOS', action: 'checkout'              },
      { stage: 'POS_VENDA', agent: 'DANIEL', action: 'analise_kpi'          },
    ],
  },

  // ── Outros templates ────────────────────────────────────────────────────────
  {
    id: 'lancamento',
    name: 'Lançamento Digital',
    description: 'Para infoprodutos e cursos com alta conversão em eventos',
    steps: [
      { stage: 'ATENCAO',   agent: 'JOSÉ',   action: 'trafego_pago'          },
      { stage: 'INTERESSE', agent: 'LUCAS',  action: 'pagina_captura'        },
      { stage: 'DESEJO',    agent: 'JOÃO',   action: 'sequencia_email'       },
      { stage: 'DESEJO',    agent: 'PAULO',  action: 'vsl_copy'              },
      { stage: 'ACAO',      agent: 'LUCAS',  action: 'checkout'              },
      { stage: 'POS_VENDA', agent: 'MARCOS', action: 'pos_venda'             },
    ],
  },
  {
    id: 'whatsapp_leads',
    name: 'WhatsApp Leads',
    description: 'Captura de leads e conversão via WhatsApp Business',
    steps: [
      { stage: 'ATENCAO',   agent: 'JOSÉ',   action: 'trafego_pago'          },
      { stage: 'INTERESSE', agent: 'LUCAS',  action: 'criar_landing_page'    },
      { stage: 'DESEJO',    agent: 'MARCOS', action: 'whatsapp_qualificacao' },
      { stage: 'ACAO',      agent: 'MARCOS', action: 'checkout'              },
      { stage: 'POS_VENDA', agent: 'DANIEL', action: 'analise_kpi'          },
    ],
  },
];
