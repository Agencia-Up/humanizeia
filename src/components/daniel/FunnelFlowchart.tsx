import { useState, useCallback, useRef, useEffect, memo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  BackgroundVariant,
  NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Save, RotateCcw, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateFunnel, adaptFunnelToClient, recommendFunnel } from '@/lib/funnelGenerator';
import { funnelLibrary } from '@/lib/funnelLibrary';
import { NodeConfigDrawer } from './NodeConfigDrawer';
import { NodePalette } from './NodePalette';
import { FunnelNodeData, AidaPhase, PHASE_COLORS, AGENT_COLORS, PALETTE_ITEMS } from './flowTypes';

// ─── Custom Node: EditableNode ────────────────────────────────────────────────

const EditableNode = memo(({ data, selected }: NodeProps<FunnelNodeData>) => {
  const phaseColor = PHASE_COLORS[data.phase] ?? PHASE_COLORS['hub'];
  const agentColor = AGENT_COLORS[data.agent] ?? '#6b7280';
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 200,
        background: phaseColor.bg,
        border: `2px solid ${selected ? phaseColor.border : phaseColor.border + 'aa'}`,
        borderRadius: 12,
        padding: '12px 14px',
        boxShadow: selected
          ? `0 0 24px 4px ${phaseColor.glow}, 0 0 0 2px ${phaseColor.border}`
          : `0 0 12px 2px ${phaseColor.glow}`,
        position: 'relative',
        transform: selected ? 'scale(1.02)' : 'scale(1)',
        transition: 'box-shadow 0.2s, transform 0.15s, border-color 0.2s',
        cursor: 'pointer',
      }}
    >
      <Handle type="target"  position={Position.Top}    style={{ background: phaseColor.border }} />
      <Handle type="source"  position={Position.Bottom} style={{ background: phaseColor.border }} />
      <Handle type="source"  position={Position.Left}   id="left"  style={{ background: phaseColor.border }} />
      <Handle type="source"  position={Position.Right}  id="right" style={{ background: phaseColor.border }} />

      {/* Edit hint */}
      {hovered && (
        <div style={{
          position: 'absolute',
          top: 6,
          right: 6,
          background: '#ffffff22',
          borderRadius: 4,
          padding: '2px 5px',
          fontSize: 9,
          color: '#cbd5e1',
        }}>
          ✏️
        </div>
      )}

      {/* Emoji + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>{data.emoji}</span>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#f8fafc', lineHeight: 1.3 }}>
          {data.label}
        </span>
      </div>

      {/* Role */}
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 6 }}>{data.role}</div>

      {/* Metric badge */}
      {data.metric && (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          background: `${phaseColor.border}22`,
          border: `1px solid ${phaseColor.border}44`,
          borderRadius: 4,
          padding: '2px 6px',
          fontSize: 9,
          color: phaseColor.text,
          marginBottom: 6,
        }}>
          📊 {data.metric}
        </div>
      )}

      {/* Agent badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: agentColor,
          display: 'inline-block',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 9, color: agentColor, fontWeight: 600 }}>{data.agent}</span>
      </div>
    </div>
  );
});
EditableNode.displayName = 'EditableNode';

// ─── Custom Node: DecisionNode ────────────────────────────────────────────────

const DecisionNode = memo(({ data, selected }: NodeProps<FunnelNodeData>) => {
  return (
    <div style={{
      width: 180,
      background: 'linear-gradient(135deg, #1c1917, #0c0a09)',
      border: `2px solid ${selected ? '#f59e0b' : '#d97706aa'}`,
      borderRadius: 8,
      padding: '12px 14px',
      boxShadow: selected
        ? '0 0 24px 4px #f59e0b44, 0 0 0 2px #f59e0b'
        : '0 0 14px 2px #d9770633',
      position: 'relative',
      textAlign: 'center',
      transform: selected ? 'scale(1.02)' : 'scale(1)',
      transition: 'box-shadow 0.2s, transform 0.15s',
      cursor: 'pointer',
    }}>
      <Handle type="target"  position={Position.Top}    style={{ background: '#d97706' }} />
      <Handle type="source"  id="yes" position={Position.Bottom} style={{ left: '30%', background: '#22c55e' }} />
      <Handle type="source"  id="no"  position={Position.Right}  style={{ background: '#ef4444' }} />

      <div style={{ fontSize: 22, marginBottom: 6 }}>{data.emoji}</div>
      <div style={{ fontSize: 11, color: '#fcd34d', fontWeight: 600, lineHeight: 1.4 }}>
        {data.label}
      </div>

      {/* SIM / NÃO labels */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 8 }}>
        <span style={{ fontSize: 8, color: '#22c55e', fontWeight: 700, marginLeft: '10%' }}>SIM ↓</span>
      </div>
      <div style={{ position: 'absolute', right: -24, top: '50%', transform: 'translateY(-50%)', fontSize: 8, color: '#ef4444', fontWeight: 700 }}>
        NÃO →
      </div>
    </div>
  );
});
DecisionNode.displayName = 'DecisionNode';

// ─── Custom Node: StageNode ───────────────────────────────────────────────────

const StageNode = memo(({ data }: NodeProps) => (
  <div style={{
    width: 900,
    background: data.gradient,
    border: `1.5px solid ${data.borderColor}`,
    borderRadius: 10,
    padding: '10px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    position: 'relative',
    pointerEvents: 'none',
  }}>
    <Handle type="target" position={Position.Top}    style={{ opacity: 0 }} />
    <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    <div style={{ fontSize: 22 }}>{data.emoji}</div>
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, color: data.textColor, letterSpacing: 0.4 }}>{data.label}</div>
      <div style={{ fontSize: 10, color: '#94a3b8' }}>{data.sublabel}</div>
    </div>
  </div>
));
StageNode.displayName = 'StageNode';

// ─── nodeTypes — MUST be defined OUTSIDE component ───────────────────────────

const nodeTypes = {
  editable: EditableNode,
  decision: DecisionNode,
  stage:    StageNode,
};

// ─── Initial nodes ────────────────────────────────────────────────────────────

function getInitialNodes(): Node<any>[] {
  return [
    // HUB
    { id: 'salomao',    type: 'editable', position: { x: 340, y: 0   }, data: { emoji: '👑', label: 'SALOMÃO',  role: 'Orquestrador • Base de Conhecimento', agent: 'SALOMÃO', phase: 'hub', metric: '' } },
    { id: 'daniel-hub', type: 'editable', position: { x: 340, y: 140 }, data: { emoji: '📊', label: 'DANIEL',   role: 'Estrategista de Vendas',                agent: 'DANIEL',  phase: 'hub', metric: '' } },

    // STAGE ATENÇÃO
    { id: 'stage-atencao', type: 'stage', position: { x: 0, y: 300 }, data: { emoji: '🔴', label: 'A — ATENÇÃO', sublabel: 'Topo do Funil • Atração e Impacto', gradient: 'linear-gradient(90deg,#1f0505,#2d0a0a)', borderColor: '#ef4444', textColor: '#fca5a5' } },

    // Agentes Atenção
    { id: 'jose-meta',    type: 'editable', position: { x:  90, y: 400 }, data: { emoji: '🎯', label: 'Meta Ads',          role: 'Tráfego Pago',         agent: 'JOSÉ',  phase: 'atencao', metric: 'CTR • ROAS' } },
    { id: 'jose-google',  type: 'editable', position: { x: 360, y: 400 }, data: { emoji: '🎯', label: 'Google Ads',         role: 'Tráfego Pago',         agent: 'JOSÉ',  phase: 'atencao', metric: 'CPC • Impressões' } },
    { id: 'davi',         type: 'editable', position: { x: 630, y: 400 }, data: { emoji: '📱', label: 'Social Orgânico',     role: 'Social Media Orgânico', agent: 'DAVI',  phase: 'atencao', metric: 'Alcance • Engaj.' } },
    { id: 'paulo-hooks',  type: 'editable', position: { x: 180, y: 560 }, data: { emoji: '✍️', label: 'Copywriter',          role: 'Copy',                  agent: 'PAULO', phase: 'atencao', metric: 'Hooks • Headlines' } },
    { id: 'maria',        type: 'editable', position: { x: 540, y: 560 }, data: { emoji: '🎨', label: 'Design Criativo',     role: 'Design',                agent: 'MARIA', phase: 'atencao', metric: 'Criativos • Banners' } },

    // Decision 1
    { id: 'dec-1', type: 'decision', position: { x: 365, y: 710 }, data: { emoji: '👁️', label: 'Visualizou e se interessou?', agent: 'Nenhum', phase: 'decisao', role: 'SIM / NÃO' } },

    // STAGE INTERESSE
    { id: 'stage-interesse', type: 'stage', position: { x: 0, y: 820 }, data: { emoji: '🟡', label: 'I — INTERESSE', sublabel: 'Meio do Funil • Engajamento e Consideração', gradient: 'linear-gradient(90deg,#1a1200,#2d1f00)', borderColor: '#eab308', textColor: '#fde047' } },

    // Agentes Interesse
    { id: 'lucas-lp',  type: 'editable', position: { x: 180, y: 920 }, data: { emoji: '🌐', label: 'Landing Page', role: 'Funil',     agent: 'LUCAS', phase: 'interesse', metric: 'Taxa de Conv. LP' } },
    { id: 'paulo-lp',  type: 'editable', position: { x: 540, y: 920 }, data: { emoji: '✍️', label: 'Copy da LP',   role: 'Copy',      agent: 'PAULO', phase: 'interesse', metric: 'Conversão • CTA' } },

    // Decision 2
    { id: 'dec-2', type: 'decision', position: { x: 365, y: 1080 }, data: { emoji: '🖱️', label: 'Clicou no CTA / Deixou contato?', agent: 'Nenhum', phase: 'decisao', role: 'SIM / NÃO' } },

    // STAGE DESEJO
    { id: 'stage-desejo', type: 'stage', position: { x: 0, y: 1190 }, data: { emoji: '🟢', label: 'D — DESEJO', sublabel: 'Meio-Fundo do Funil • Nutrição e Relacionamento', gradient: 'linear-gradient(90deg,#021a0e,#052e16)', borderColor: '#10b981', textColor: '#6ee7b7' } },

    // Agentes Desejo
    { id: 'marcos-wpp',    type: 'editable', position: { x:  90, y: 1290 }, data: { emoji: '💬', label: 'WhatsApp',       role: 'Leads',        agent: 'MARCOS', phase: 'desejo', metric: 'Taxa de Resposta' } },
    { id: 'joao-email',    type: 'editable', position: { x: 360, y: 1290 }, data: { emoji: '📧', label: 'Email Marketing', role: 'Nutrição',     agent: 'JOÃO',   phase: 'desejo', metric: 'Open Rate • Cliques' } },
    { id: 'paulo-nurture', type: 'editable', position: { x: 630, y: 1290 }, data: { emoji: '✍️', label: 'Copy de Nutrição', role: 'Copy',        agent: 'PAULO',  phase: 'desejo', metric: 'Engajamento' } },

    // Decision 3
    { id: 'dec-3', type: 'decision', position: { x: 365, y: 1460 }, data: { emoji: '🔥', label: 'Demonstrou interesse real?', agent: 'Nenhum', phase: 'decisao', role: 'SIM / NÃO' } },

    // STAGE AÇÃO
    { id: 'stage-acao', type: 'stage', position: { x: 0, y: 1570 }, data: { emoji: '🟩', label: 'A — AÇÃO', sublabel: 'Fundo do Funil • Fechamento da Venda', gradient: 'linear-gradient(90deg,#021a05,#052e0e)', borderColor: '#22c55e', textColor: '#86efac' } },

    // Agentes Ação
    { id: 'marcos-fecha', type: 'editable', position: { x: 180, y: 1670 }, data: { emoji: '💬', label: 'Fechamento WhatsApp', role: 'Fechamento', agent: 'MARCOS', phase: 'acao', metric: 'Taxa de Fechamento' } },
    { id: 'paulo-oferta', type: 'editable', position: { x: 540, y: 1670 }, data: { emoji: '✍️', label: 'Copy da Oferta',       role: 'Copy',       agent: 'PAULO',  phase: 'acao', metric: 'Conversão Final' } },

    // Decision 4
    { id: 'dec-4', type: 'decision', position: { x: 365, y: 1840 }, data: { emoji: '💳', label: 'Comprou?', agent: 'Nenhum', phase: 'decisao', role: 'SIM / NÃO' } },

    // STAGE PÓS-VENDA
    { id: 'stage-posvenda', type: 'stage', position: { x: 0, y: 1950 }, data: { emoji: '🟣', label: 'PÓS-VENDA', sublabel: 'Retenção • Upsell • Fidelização', gradient: 'linear-gradient(90deg,#150a2d,#1e0a3a)', borderColor: '#a78bfa', textColor: '#c4b5fd' } },

    // Agentes Pós-venda
    { id: 'joao-ret',     type: 'editable', position: { x:  90, y: 2050 }, data: { emoji: '📧', label: 'Retenção / Onboarding', role: 'Retenção',  agent: 'JOÃO',   phase: 'posVenda', metric: 'Churn Rate' } },
    { id: 'marcos-upsell',type: 'editable', position: { x: 360, y: 2050 }, data: { emoji: '🚀', label: 'Upsell / Suporte',      role: 'Recompra',  agent: 'MARCOS', phase: 'posVenda', metric: 'LTV • NPS' } },
    { id: 'daniel-kpis',  type: 'editable', position: { x: 630, y: 2050 }, data: { emoji: '📊', label: 'Análise de KPIs',        role: 'Estratégia', agent: 'DANIEL', phase: 'posVenda', metric: 'ROI • ROAS • LTV' } },

    // Recovery nodes
    { id: 'rec-remarketing', type: 'editable', position: { x: 960, y:  700 }, data: { emoji: '🔁', label: 'Remarketing',           role: 'Recovery', agent: 'JOSÉ',  phase: 'recovery', metric: '' } },
    { id: 'rec-retargeting', type: 'editable', position: { x: 960, y: 1070 }, data: { emoji: '🔁', label: 'Retargeting LP',         role: 'Recovery', agent: 'JOSÉ',  phase: 'recovery', metric: '' } },
    { id: 'rec-followup',    type: 'editable', position: { x: 960, y: 1450 }, data: { emoji: '🔁', label: 'Follow-up',              role: 'Recovery', agent: 'MARCOS', phase: 'recovery', metric: '' } },
    { id: 'rec-oferta',      type: 'editable', position: { x: 960, y: 1830 }, data: { emoji: '🔁', label: 'Oferta de Recuperação',  role: 'Recovery', agent: 'PAULO',  phase: 'recovery', metric: '' } },
  ];
}

// ─── Initial edges ────────────────────────────────────────────────────────────

function mk(color: string) {
  return { type: MarkerType.ArrowClosed, color };
}

function getInitialEdges(): Edge[] {
  return [
    // HUB
    { id: 'e-sal-dan',  source: 'salomao',    target: 'daniel-hub', animated: true,  style: { stroke: '#f59e0b', strokeWidth: 2 }, markerEnd: mk('#f59e0b'), label: 'Base de conhecimento', labelStyle: { fontSize: 9, fill: '#f59e0b' }, labelBgStyle: { fill: '#0f172a' } },
    { id: 'e-dan-sal',  source: 'daniel-hub', sourceHandle: 'left', target: 'salomao', animated: true, style: { stroke: '#818cf8', strokeWidth: 2 }, markerEnd: mk('#818cf8'), label: 'Estratégia AIDA', labelStyle: { fontSize: 9, fill: '#818cf8' }, labelBgStyle: { fill: '#0f172a' } },

    // Salomão → stage-atencao
    { id: 'e-sal-atencao', source: 'salomao', target: 'stage-atencao', style: { stroke: '#f59e0b', strokeWidth: 1.5, strokeDasharray: '5 4' }, markerEnd: mk('#f59e0b'), label: 'Distribui tarefas', labelStyle: { fontSize: 9, fill: '#f59e0b' }, labelBgStyle: { fill: '#0f172a' } },

    // stage-atencao → agents
    { id: 'e-atencao-jose-meta',    source: 'stage-atencao', target: 'jose-meta',   style: { stroke: '#ef4444', strokeWidth: 1.2 }, markerEnd: mk('#ef4444') },
    { id: 'e-atencao-jose-google',  source: 'stage-atencao', target: 'jose-google', style: { stroke: '#ef4444', strokeWidth: 1.2 }, markerEnd: mk('#ef4444') },
    { id: 'e-atencao-davi',         source: 'stage-atencao', target: 'davi',        style: { stroke: '#ef4444', strokeWidth: 1.2 }, markerEnd: mk('#ef4444') },

    // agents → paulo/maria
    { id: 'e-jose-meta-paulo',   source: 'jose-meta',   target: 'paulo-hooks', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
    { id: 'e-jose-google-paulo', source: 'jose-google', target: 'paulo-hooks', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
    { id: 'e-jose-meta-maria',   source: 'jose-meta',   target: 'maria',       style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
    { id: 'e-davi-maria',        source: 'davi',        target: 'maria',       style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

    // → dec-1
    { id: 'e-paulo-hooks-dec1', source: 'paulo-hooks', target: 'dec-1', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
    { id: 'e-maria-dec1',       source: 'maria',       target: 'dec-1', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

    // dec-1 SIM / NÃO
    { id: 'e-dec1-sim', source: 'dec-1', sourceHandle: 'yes', target: 'stage-interesse', style: { stroke: '#22c55e', strokeWidth: 1.5 }, markerEnd: mk('#22c55e'), label: 'SIM ✅', labelStyle: { fontSize: 9, fill: '#22c55e' }, labelBgStyle: { fill: '#0f172a' } },
    { id: 'e-dec1-nao', source: 'dec-1', sourceHandle: 'no',  target: 'rec-remarketing', style: { stroke: '#ef4444', strokeWidth: 1.5 }, markerEnd: mk('#ef4444'), label: 'NÃO ❌', labelStyle: { fontSize: 9, fill: '#ef4444' }, labelBgStyle: { fill: '#0f172a' } },
    { id: 'e-rec-remarketing-loop', source: 'rec-remarketing', sourceHandle: 'left', target: 'jose-meta', style: { stroke: '#ef4444', strokeWidth: 1.2, strokeDasharray: '5 4' }, markerEnd: mk('#ef4444') },

    // stage-interesse → agents
    { id: 'e-interesse-lucas',    source: 'stage-interesse', target: 'lucas-lp', style: { stroke: '#eab308', strokeWidth: 1.2 }, markerEnd: mk('#eab308') },
    { id: 'e-interesse-paulo-lp', source: 'stage-interesse', target: 'paulo-lp', style: { stroke: '#eab308', strokeWidth: 1.2 }, markerEnd: mk('#eab308') },

    // agents → dec-2
    { id: 'e-lucas-dec2',    source: 'lucas-lp', target: 'dec-2', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
    { id: 'e-paulo-lp-dec2', source: 'paulo-lp', target: 'dec-2', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

    // dec-2 SIM / NÃO
    { id: 'e-dec2-sim', source: 'dec-2', sourceHandle: 'yes', target: 'stage-desejo',    style: { stroke: '#22c55e', strokeWidth: 1.5 }, markerEnd: mk('#22c55e'), label: 'SIM ✅', labelStyle: { fontSize: 9, fill: '#22c55e' }, labelBgStyle: { fill: '#0f172a' } },
    { id: 'e-dec2-nao', source: 'dec-2', sourceHandle: 'no',  target: 'rec-retargeting', style: { stroke: '#ef4444', strokeWidth: 1.5 }, markerEnd: mk('#ef4444'), label: 'NÃO ❌', labelStyle: { fontSize: 9, fill: '#ef4444' }, labelBgStyle: { fill: '#0f172a' } },
    { id: 'e-rec-retargeting-loop', source: 'rec-retargeting', sourceHandle: 'left', target: 'lucas-lp', style: { stroke: '#ef4444', strokeWidth: 1.2, strokeDasharray: '5 4' }, markerEnd: mk('#ef4444') },

    // stage-desejo → agents
    { id: 'e-desejo-marcos', source: 'stage-desejo', target: 'marcos-wpp',    style: { stroke: '#10b981', strokeWidth: 1.2 }, markerEnd: mk('#10b981') },
    { id: 'e-desejo-joao',   source: 'stage-desejo', target: 'joao-email',    style: { stroke: '#10b981', strokeWidth: 1.2 }, markerEnd: mk('#10b981') },
    { id: 'e-desejo-paulo',  source: 'stage-desejo', target: 'paulo-nurture', style: { stroke: '#10b981', strokeWidth: 1.2 }, markerEnd: mk('#10b981') },

    // agents → dec-3
    { id: 'e-marcos-wpp-dec3',    source: 'marcos-wpp',    target: 'dec-3', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
    { id: 'e-joao-email-dec3',    source: 'joao-email',    target: 'dec-3', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
    { id: 'e-paulo-nurture-dec3', source: 'paulo-nurture', target: 'dec-3', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

    // dec-3 SIM / NÃO
    { id: 'e-dec3-sim', source: 'dec-3', sourceHandle: 'yes', target: 'stage-acao',   style: { stroke: '#22c55e', strokeWidth: 1.5 }, markerEnd: mk('#22c55e'), label: 'SIM ✅', labelStyle: { fontSize: 9, fill: '#22c55e' }, labelBgStyle: { fill: '#0f172a' } },
    { id: 'e-dec3-nao', source: 'dec-3', sourceHandle: 'no',  target: 'rec-followup', style: { stroke: '#ef4444', strokeWidth: 1.5 }, markerEnd: mk('#ef4444'), label: 'NÃO ❌', labelStyle: { fontSize: 9, fill: '#ef4444' }, labelBgStyle: { fill: '#0f172a' } },
    { id: 'e-rec-followup-loop', source: 'rec-followup', sourceHandle: 'left', target: 'marcos-wpp', style: { stroke: '#ef4444', strokeWidth: 1.2, strokeDasharray: '5 4' }, markerEnd: mk('#ef4444') },

    // stage-acao → agents
    { id: 'e-acao-marcos', source: 'stage-acao', target: 'marcos-fecha', style: { stroke: '#22c55e', strokeWidth: 1.2 }, markerEnd: mk('#22c55e') },
    { id: 'e-acao-paulo',  source: 'stage-acao', target: 'paulo-oferta', style: { stroke: '#22c55e', strokeWidth: 1.2 }, markerEnd: mk('#22c55e') },

    // agents → dec-4
    { id: 'e-marcos-fecha-dec4', source: 'marcos-fecha', target: 'dec-4', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
    { id: 'e-paulo-oferta-dec4', source: 'paulo-oferta', target: 'dec-4', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

    // dec-4 SIM / NÃO
    { id: 'e-dec4-sim', source: 'dec-4', sourceHandle: 'yes', target: 'stage-posvenda', style: { stroke: '#22c55e', strokeWidth: 1.5 }, markerEnd: mk('#22c55e'), label: 'SIM ✅', labelStyle: { fontSize: 9, fill: '#22c55e' }, labelBgStyle: { fill: '#0f172a' } },
    { id: 'e-dec4-nao', source: 'dec-4', sourceHandle: 'no',  target: 'rec-oferta',     style: { stroke: '#ef4444', strokeWidth: 1.5 }, markerEnd: mk('#ef4444'), label: 'NÃO ❌', labelStyle: { fontSize: 9, fill: '#ef4444' }, labelBgStyle: { fill: '#0f172a' } },
    { id: 'e-rec-oferta-loop', source: 'rec-oferta', sourceHandle: 'left', target: 'marcos-fecha', style: { stroke: '#ef4444', strokeWidth: 1.2, strokeDasharray: '5 4' }, markerEnd: mk('#ef4444') },

    // stage-posvenda → agents
    { id: 'e-posvenda-joao',   source: 'stage-posvenda', target: 'joao-ret',      style: { stroke: '#a78bfa', strokeWidth: 1.2 }, markerEnd: mk('#a78bfa') },
    { id: 'e-posvenda-marcos', source: 'stage-posvenda', target: 'marcos-upsell', style: { stroke: '#a78bfa', strokeWidth: 1.2 }, markerEnd: mk('#a78bfa') },
    { id: 'e-posvenda-daniel', source: 'stage-posvenda', target: 'daniel-kpis',   style: { stroke: '#a78bfa', strokeWidth: 1.2 }, markerEnd: mk('#a78bfa') },

    // DANIEL KPIs → SALOMÃO feedback loop
    { id: 'e-daniel-kpis-salomao', source: 'daniel-kpis', target: 'salomao', style: { stroke: '#818cf8', strokeWidth: 1.5, strokeDasharray: '6 4' }, markerEnd: mk('#818cf8'), label: 'Ajuste de estratégia', labelStyle: { fontSize: 9, fill: '#818cf8' }, labelBgStyle: { fill: '#0f172a' } },
  ];
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function FunnelFlowchart() {
  const { toast } = useToast();
  const [nodes, setNodes, onNodesChange] = useNodesState(getInitialNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(getInitialEdges());
  const [selectedNode, setSelectedNode] = useState<Node<FunnelNodeData> | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [recommendation, setRecommendation] = useState<{ funnelId: string; name: string; badge: string; reason: string } | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Load flow from Supabase on mount
  useEffect(() => {
    loadFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveFlow = async () => {
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');
      const flow = {
        user_id: user.id,
        name: 'Funil AIDA Principal',
        nodes: nodes.map(n => ({ ...n, data: { ...n.data } })),
        edges,
      };
      const { error } = await (supabase as any)
        .from('funnel_flows')
        .upsert(flow, { onConflict: 'user_id' });
      if (error) throw error;
      toast({ title: '💾 Fluxograma salvo com sucesso!' });
    } catch (err: any) {
      toast({ title: '⚠️ Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const loadFlow = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await (supabase as any)
        .from('funnel_flows')
        .select('*')
        .eq('user_id', user.id)
        .single();

      // Busca briefing para gerar recomendação de funil baseada no ticket
      try {
        const { data: briefing } = await (supabase as any)
          .from('client_briefings')
          .select('price, preco')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (briefing) {
          const rawPrice = briefing.price ?? briefing.preco ?? '0';
          const ticket = parseFloat(String(rawPrice).replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;
          if (ticket > 0) {
            const rec = recommendFunnel({ ticket });
            setRecommendation({
              funnelId: rec.funnel.id,
              name: rec.funnel.name,
              badge: rec.funnel.badge ?? '',
              reason: rec.reason,
            });
          }
        }
      } catch { /* sem briefing — sem recomendação */ }

      if (!error && data?.nodes?.length) {
        // Fluxo salvo encontrado — restaura do banco
        setNodes(data.nodes);
        setEdges(data.edges ?? []);
      } else {
        // Sem fluxo salvo — carrega o Funil AIDA como ponto de partida
        const funnel = generateFunnel('aida_basic', user.id);
        setNodes(funnel.nodes);
        setEdges(funnel.edges);
      }
    } catch {
      // Fallback silencioso — usa o template padrão sem autenticação
      const funnel = generateFunnel('aida_basic', 'demo');
      setNodes(funnel.nodes);
      setEdges(funnel.edges);
    }
  };

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(prev =>
        addEdge(
          {
            ...params,
            animated: false,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280' },
            style: { stroke: '#6b7280', strokeWidth: 2 },
          },
          prev,
        ),
      );
    },
    [setEdges],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData('application/reactflow-node');
      if (!raw || !reactFlowInstance || !reactFlowWrapper.current) return;
      const item = JSON.parse(raw);
      const rect = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      addNodeToCanvas(item, position);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reactFlowInstance],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const addNodeToCanvas = (item: typeof PALETTE_ITEMS[0], position: { x: number; y: number }) => {
    const newNode: Node<FunnelNodeData> = {
      id: `node-${Date.now()}`,
      type: item.isDecision ? 'decision' : 'editable',
      position,
      data: {
        label:  item.label,
        emoji:  item.emoji,
        role:   item.role,
        agent:  item.agent,
        phase:  item.phase,
        metric: '',
        url:    '',
        notes:  '',
      },
    };
    setNodes(prev => [...prev, newNode]);
  };

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type === 'stage') return; // Stage nodes are not editable
      setSelectedNode(node as Node<FunnelNodeData>);
    },
    [],
  );

  const handleSaveNode = (nodeId: string, updatedData: Partial<FunnelNodeData>) => {
    setNodes(prev =>
      prev.map(n => (n.id === nodeId ? { ...n, data: { ...n.data, ...updatedData } } : n)),
    );
    setSelectedNode(null);
    toast({ title: '✅ Nó atualizado' });
  };

  const handleDeleteNode = (nodeId: string) => {
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
    toast({ title: '🗑️ Nó removido', variant: 'destructive' });
  };

  const handleReset = () => {
    setNodes(getInitialNodes());
    setEdges(getInitialEdges());
    setSelectedNode(null);
    toast({ title: '🔄 Fluxograma resetado para o template AIDA' });
  };

  /**
   * loadFromTemplate — carrega qualquer funil da funnelLibrary para o canvas.
   * Usa generateFunnel() para converter os steps em Node<FunnelNodeData>[] + Edge[].
   */
  const loadFromTemplate = async (funnelId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const clientId = user?.id ?? 'demo';

    // Tenta buscar dados do cliente para contextualizar o funil
    let baseFunnel = funnelLibrary.find(f => f.id === funnelId);
    if (!baseFunnel) { toast({ title: '⚠️ Funil não encontrado', variant: 'destructive' }); return; }

    if (user) {
      try {
        const { data: briefing } = await (supabase as any)
          .from('client_briefings')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (briefing) {
          // adaptFunnelToClient injeta nicho, oferta e todos os campos do cliente
          baseFunnel = adaptFunnelToClient(baseFunnel, {
            nicho:            briefing.business_name  ?? briefing.client_name ?? 'Não informado',
            oferta:           briefing.main_offer     ?? briefing.oferta      ?? 'Não informado',
            publico:          briefing.target_audience ?? briefing.publico,
            diferencial:      briefing.differentiators ?? briefing.diferencial,
            tom:              briefing.communication_tone ?? briefing.tom,
            produto:          briefing.product_service ?? briefing.produto,
            preco:            briefing.price ?? briefing.preco,
            cta:              briefing.cta,
            site:             briefing.site,
            redesSociais:     briefing.redesSociais,
            paletaCores:      briefing.paletaCores,
            identidadeVisual: briefing.identidadeVisual,
          });
        }
      } catch { /* sem briefing — usa funil base */ }
    }

    const funnel = generateFunnel(funnelId, clientId);
    setNodes(funnel.nodes);
    setEdges(funnel.edges);
    setSelectedNode(null);
    toast({ title: `📥 "${baseFunnel.name}" carregado!`, description: `${funnel.nodes.length} etapas com contexto do cliente aplicado.` });
  };

  return (
    <div style={{ display: 'flex', height: '80vh', borderRadius: 12, overflow: 'hidden', border: '1px solid #1e293b' }}>
      {/* Left palette */}
      <NodePalette onAddNode={addNodeToCanvas} />

      {/* Canvas area */}
      <div ref={reactFlowWrapper} style={{ flex: 1, position: 'relative', background: '#030712' }}>
        {/* Top toolbar */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(8px)',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: '8px 14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          <span style={{ fontSize: 11, color: '#64748b', marginRight: 4 }}>Funil AIDA Interativo</span>

          {/* Carregar template de funil */}
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <select
              onChange={e => { if (e.target.value) { loadFromTemplate(e.target.value); e.target.value = ''; } }}
              defaultValue=""
              style={{
                fontSize: 11,
                height: 30,
                paddingLeft: 8,
                paddingRight: 8,
                background: '#1e293b',
                border: '1px solid #334155',
                borderRadius: 6,
                color: '#94a3b8',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="" disabled>📥 Carregar Funil</option>
              {funnelLibrary.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          <Button size="sm" variant="outline" onClick={saveFlow} disabled={isSaving}
            style={{ fontSize: 12, height: 30, paddingLeft: 10, paddingRight: 10 }}>
            <Save className="h-3.5 w-3.5 mr-1" />
            {isSaving ? 'Salvando...' : 'Salvar'}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleReset}
            style={{ fontSize: 12, height: 30, paddingLeft: 10, paddingRight: 10 }}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        </div>

        {/* ── Banner de recomendação de funil por ticket ── */}
        {recommendation && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2
                          bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-2 shadow-lg max-w-lg">
            <span className="text-blue-400 text-base">💡</span>
            <div className="flex-1 min-w-0">
              <span className="text-[11px] text-blue-400 font-semibold">
                Recomendado para este cliente:&nbsp;
                <button
                  onClick={() => loadFromTemplate(recommendation.funnelId)}
                  className="underline hover:text-blue-300 transition-colors"
                >
                  {recommendation.name}
                </button>
                {recommendation.badge && (
                  <span className="ml-1.5 text-[9px] bg-blue-500/20 border border-blue-500/30 px-1.5 py-0.5 rounded-full">
                    {recommendation.badge}
                  </span>
                )}
              </span>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{recommendation.reason}</p>
            </div>
            <button onClick={() => setRecommendation(null)} className="text-muted-foreground hover:text-foreground text-xs shrink-0">✕</button>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.05, maxZoom: 0.7 }}
          minZoom={0.08}
          maxZoom={2}
          deleteKeyCode="Delete"
          proOptions={{ hideAttribution: true }}
          connectionLineStyle={{ stroke: '#6b7280', strokeWidth: 2 }}
        >
          <Background color="#1f2937" gap={20} variant={BackgroundVariant.Dots} />
          <Controls className="!bg-gray-900 !border-gray-700 !shadow-xl" />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === 'stage') return '#374151';
              const phase = n.data?.phase as AidaPhase;
              return PHASE_COLORS[phase]?.border ?? '#374151';
            }}
            style={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
          />
        </ReactFlow>
      </div>

      {/* Right config drawer */}
      <NodeConfigDrawer
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onSave={handleSaveNode}
        onDelete={handleDeleteNode}
      />
    </div>
  );
}
