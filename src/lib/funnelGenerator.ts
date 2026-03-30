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
import { funnelLibrary, type FunnelDefinition, type FunnelStep, type ClientData, type ClientProfile } from './funnelLibrary';

// ─── Stage → AidaPhase + visual ──────────────────────────────────────────────

const STAGE_META: Record<string, { phase: AidaPhase; emoji: string; label: string }> = {
  ATENCAO:   { phase: 'atencao',   emoji: '👀', label: 'Atenção'   },
  INTERESSE: { phase: 'interesse', emoji: '🖥️', label: 'Interesse' },
  DESEJO:    { phase: 'desejo',    emoji: '📧', label: 'Desejo'    },
  ACAO:      { phase: 'acao',      emoji: '💳', label: 'Ação'      },
  POS_VENDA: { phase: 'posVenda',  emoji: '📊', label: 'Pós-Venda' },
  // Extras para funis customizados
  TRAFEGO:   { phase: 'atencao',   emoji: '📡', label: 'Tráfego'    },
  CAPTURA:   { phase: 'interesse', emoji: '📩', label: 'Captura'    },
  NUTRICAO:  { phase: 'desejo',    emoji: '💌', label: 'Nutrição'   },
  UPSELL:    { phase: 'posVenda',  emoji: '🚀', label: 'Upsell'     },
  // Tripwire / Webinar extras
  INSCRICAO: { phase: 'interesse', emoji: '📋', label: 'Inscrição'  },
  WEBINAR:   { phase: 'desejo',    emoji: '🎥', label: 'Webinário'  },
  TRIPWIRE:  { phase: 'acao',      emoji: '⚡', label: 'Tripwire'   },
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

// ─── adaptFunnelToClient ─────────────────────────────────────────────────────

/**
 * adaptFunnelToClient
 * Injeta os dados do cliente (nicho, oferta, público...) em cada step do funil.
 * Cada agente recebe um `input` contextualizado para executar sua tarefa.
 *
 * Uso:
 *   const adapted = adaptFunnelToClient(funnel, clientData);
 *   // adapted.steps[0].input.nicho === 'Fitness'
 *   // adapted.steps[0].input.oferta === 'Programa 90 dias'
 *
 * @param funnel      Definição do funil (da funnelLibrary ou gerado)
 * @param clientData  Dados do cliente vindos do client_briefings (Salomão)
 * @returns           Nova definição do funil com input preenchido por step
 */
export function adaptFunnelToClient(
  funnel: FunnelDefinition,
  clientData: ClientData,
): FunnelDefinition {
  // Campos comuns injetados em TODOS os steps
  const baseInput: Record<string, string> = {
    nicho:            clientData.nicho,
    oferta:           clientData.oferta,
    ...(clientData.publico        && { publico:        clientData.publico }),
    ...(clientData.diferencial    && { diferencial:    clientData.diferencial }),
    ...(clientData.tom            && { tom:            clientData.tom }),
    ...(clientData.produto        && { produto:        clientData.produto }),
    ...(clientData.preco          && { preco:          clientData.preco }),
    ...(clientData.cta            && { cta:            clientData.cta }),
    ...(clientData.site           && { site:           clientData.site }),
    ...(clientData.redesSociais   && { redesSociais:   clientData.redesSociais }),
    ...(clientData.paletaCores    && { paletaCores:    clientData.paletaCores }),
    ...(clientData.identidadeVisual && { identidadeVisual: clientData.identidadeVisual }),
  };

  // Campos extras específicos por agente/action
  const STEP_EXTRA_INPUT: Record<string, Record<string, string>> = {
    criar_conteudo_social: { plataforma: clientData.redesSociais ?? 'Instagram', formato: 'carrossel' },
    criar_landing_page:    { estilo: clientData.identidadeVisual ?? 'moderno', cores: clientData.paletaCores ?? '' },
    sequencia_email:       { tom: clientData.tom ?? 'persuasivo', etapas: '5' },
    checkout:              { preco: clientData.preco ?? '', cta: clientData.cta ?? 'Comprar agora' },
    analise_kpi:           { periodo: '30 dias', metricas: 'CPL, CAC, ROAS, LTV' },
    trafego_pago:          { nicho: clientData.nicho, oferta: clientData.oferta },
    whatsapp_qualificacao: { nicho: clientData.nicho, produto: clientData.produto ?? '' },
    vsl_copy:              { tom: clientData.tom ?? 'persuasivo', oferta: clientData.oferta },
    pagina_captura:        { estilo: clientData.identidadeVisual ?? 'moderno' },
    pos_venda:             { produto: clientData.produto ?? '', oferta: clientData.oferta },
  };

  const adaptedSteps: FunnelStep[] = funnel.steps.map(step => ({
    ...step,
    input: {
      ...baseInput,                              // contexto base do cliente
      ...(step.input ?? {}),                     // input original do step (se houver)
      ...(STEP_EXTRA_INPUT[step.action] ?? {}),  // extras específicos da action
    },
  }));

  return { ...funnel, steps: adaptedSteps };
}

// ─── recommendFunnel ─────────────────────────────────────────────────────────

/**
 * recommendFunnel
 * Recomenda o funil ideal baseado no ticket do cliente.
 *
 * Regras:
 *   ticket < 100   → "tripwire"    (produto de entrada, conversão rápida)
 *   ticket > 1000  → "webinar"     (alto valor, fechamento consultivo)
 *   else           → "lead_magnet" (médio ticket, nutrição por email)
 *
 * Uso:
 *   const rec = recommendFunnel({ ticket: 497 });
 *   // rec.id === 'lead_magnet'
 *   // rec.reason === 'Ticket médio (R$ 100–999): ímã de leads + nutrição por email converte melhor.'
 *
 * @param client  Perfil do cliente com ticket em R$
 * @returns       { funnel: FunnelDefinition; reason: string }
 */
export function recommendFunnel(client: ClientProfile): {
  funnel: FunnelDefinition;
  reason: string;
} {
  let funnelId: string;
  let reason: string;

  if (client.ticket < 100) {
    funnelId = 'tripwire';
    reason = `Ticket baixo (até R$ 99): o tripwire quebra a barreira de compra rapidamente, transformando visitante em comprador com mínima fricção.`;
  } else if (client.ticket > 1000) {
    funnelId = 'webinar';
    reason = `Ticket alto (acima de R$ 1.000): o webinário aquece o lead, constrói autoridade e viabiliza o fechamento consultivo via WhatsApp.`;
  } else {
    funnelId = 'lead_magnet';
    reason = `Ticket médio (R$ 100–999): o ímã de leads captura email, a sequência de nutrição cria desejo e a oferta converte com menos resistência.`;
  }

  const funnel = funnelLibrary.find(f => f.id === funnelId) ?? funnelLibrary[0];
  return { funnel, reason };
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * generateFunnel
 * @param funnelId   ID do funil na funnelLibrary (ex: 'aida_basic')
 * @param clientId   ID do cliente/usuário — usado como prefixo dos nó IDs
 * @returns          { nodes, edges } prontos para React Flow
 */
export function generateFunnel(
  funnelIdOrDef: string | FunnelDefinition,
  clientId: string,
): { nodes: Node<FunnelNodeData>[]; edges: Edge[] } {
  const funnel = typeof funnelIdOrDef === 'string'
    ? funnelLibrary.find(f => f.id === funnelIdOrDef)
    : funnelIdOrDef;
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
      position: { x: index * 260, y: 150 }, // layout horizontal, 260px entre nós
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
        sourceHandle: 'right',   // sai pela direita do nó anterior
        targetHandle: 'left',    // entra pela esquerda do próximo
        animated: false,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 2 },
      } satisfies Edge;
    })
    .filter((e): e is typeof e & Edge => e !== null);

  return { nodes, edges };
}
