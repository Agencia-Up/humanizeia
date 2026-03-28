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
}

export interface FunnelDefinition {
  id: string;
  name: string;
  description: string;
  steps: FunnelStep[];
}

export const funnelLibrary: FunnelDefinition[] = [
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
