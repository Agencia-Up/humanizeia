/**
 * funnelGenerator.ts
 * Implementação TypeScript tipada da função generateFunnel.
 *
 * Recebe um funnelId e clientId → retorna { nodes, edges } prontos
 * para serem passados diretamente ao React Flow do Daniel (FunnelFlowchart).
 *
 * Tipos do nó:  FunnelNodeData (label, emoji, role, agent, phase)
 * Tipo React Flow: 'editableNode' (registrado em FunnelFlowchart.tsx)
 */

import type { Node, Edge } from 'reactflow';
import { MarkerType } from 'reactflow';
import type { FunnelNodeData, AidaPhase, AgentName } from '@/components/daniel/flowTypes';
import { PHASE_COLORS } from '@/components/daniel/flowTypes';
import { funnelLibrary } from './funnelLibrary';

// ─── Stage → AidaPhase + visual ──────────────────────────────────────────────

const STAGE_META: Record<string, { phase: AidaPhase; emoji: string; label: string }> = {
  ATENCAO:   { phase: 'atencao',   emoji: '👀', label: 'Atenção'   },
  INTERESSE: { phase: 'interesse', emoji: '🖥️', label: 'Interesse' },
  DESEJO:    { phase: 'desejo',    emoji: '📧', label: 'Desejo'    },
  ACAO:      { phase: 'acao',      emoji: '💳', label: 'Ação'      },
  POS_VENDA: { phase: 'posVenda',  emoji: '📊', label: 'Pós-Venda' },
  // Extras para funis customizados
  TRAFEGO:   { phase: 'atencao',   emoji: '📡', label: 'Tráfego'   },
  CAPTURA:   { phase: 'interesse', emoji: '📩', label: 'Captura'   },
  NUTRICAO:  { phase: 'desejo',    emoji: '💌', label: 'Nutrição'  },
  UPSELL:    { phase: 'posVenda',  emoji: '🚀', label: 'Upsell'    },
};

// ─── Action → role label ──────────────────────────────────────────────────────

const ACTION_ROLES: Record<string, string> = {
  criar_conteudo_social:  'Conteúdo Social',
  criar_landing_page:     'Landing Page',
  pagina_captura:         'Página de Captura',
  sequencia_email:        'Email Marketing',
  checkout:               'Conversão / Leads',
  analise_kpi:            'Análise de KPIs',
  trafego_pago:           'Tráfego Pago',
  vsl_copy:               'VSL / Webinário',
  whatsapp_qualificacao:  'Qualificação WhatsApp',
  pos_venda:              'Pós-Venda / Retenção',
};

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * generateFunnel
 * @param funnelId   ID do funil na funnelLibrary (ex: 'aida_basic')
 * @param clientId   ID do cliente/usuário — usado como prefixo dos nó IDs
 * @returns          { nodes, edges } prontos para React Flow
 */
export function generateFunnel(
  funnelId: string,
  clientId: string,
): { nodes: Node<FunnelNodeData>[]; edges: Edge[] } {
  const funnel = funnelLibrary.find(f => f.id === funnelId);
  if (!funnel) return { nodes: [], edges: [] };

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const nodes: Node<FunnelNodeData>[] = funnel.steps.map((step, index) => {
    const meta = STAGE_META[step.stage] ?? {
      phase: 'hub' as AidaPhase,
      emoji: '🔷',
      label: step.stage,
    };
    const role = ACTION_ROLES[step.action] ?? step.action.replace(/_/g, ' ');

    return {
      id: `${clientId}-${index}`,
      type: 'editableNode',                // registrado em FunnelFlowchart.tsx
      data: {
        label: meta.label,
        emoji: meta.emoji,
        role,
        agent: step.agent as AgentName,
        phase: meta.phase,
      } satisfies FunnelNodeData,
      position: { x: 300, y: index * 180 }, // layout vertical, 180px entre nós
    };
  });

  // ── Edges ─────────────────────────────────────────────────────────────────
  const edges: Edge[] = nodes
    .map((node, i) => {
      if (i === 0) return null;
      const color = PHASE_COLORS[node.data.phase]?.border ?? '#6b7280';
      return {
        id: `e-${nodes[i - 1].id}-${node.id}`,
        source: nodes[i - 1].id,
        target: node.id,
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 2 },
      } satisfies Edge;
    })
    .filter((e): e is Edge => e !== null);

  return { nodes, edges };
}
