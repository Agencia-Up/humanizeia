import { memo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  BackgroundVariant,
  NodeProps,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

// ─── Custom Node Types ────────────────────────────────────────────────────────

const HubNode = memo(({ data }: NodeProps) => (
  <div
    style={{
      width: 220,
      background: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
      border: `2px solid ${data.borderColor || '#f59e0b'}`,
      borderRadius: 12,
      padding: '14px 16px',
      boxShadow: `0 0 18px 2px ${data.glowColor || '#f59e0b55'}`,
      textAlign: 'center',
      position: 'relative',
    }}
  >
    <Handle type="source" position={Position.Bottom} style={{ background: data.borderColor || '#f59e0b' }} />
    <Handle type="source" position={Position.Left} id="left" style={{ background: data.borderColor || '#f59e0b' }} />
    <Handle type="source" position={Position.Right} id="right" style={{ background: data.borderColor || '#f59e0b' }} />
    <Handle type="target" position={Position.Top} style={{ background: data.borderColor || '#f59e0b' }} />
    <Handle type="target" position={Position.Left} id="target-left" style={{ top: '70%', background: data.borderColor || '#f59e0b' }} />
    <div style={{ fontSize: 28, marginBottom: 4 }}>{data.emoji}</div>
    <div style={{ fontWeight: 700, fontSize: 13, color: '#f8fafc', letterSpacing: 0.5 }}>{data.name}</div>
    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{data.role}</div>
  </div>
));
HubNode.displayName = 'HubNode';

const StageNode = memo(({ data }: NodeProps) => (
  <div
    style={{
      width: 900,
      background: data.gradient,
      border: `1.5px solid ${data.borderColor}`,
      borderRadius: 10,
      padding: '10px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      position: 'relative',
    }}
  >
    <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
    <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    <div style={{ fontSize: 22 }}>{data.emoji}</div>
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, color: data.textColor, letterSpacing: 0.4 }}>{data.label}</div>
      <div style={{ fontSize: 10, color: '#94a3b8' }}>{data.sublabel}</div>
    </div>
  </div>
));
StageNode.displayName = 'StageNode';

const AgentNode = memo(({ data }: NodeProps) => (
  <div
    style={{
      width: 180,
      background: data.bgGradient,
      border: `1.5px solid ${data.color}`,
      borderRadius: 10,
      padding: '10px 12px',
      position: 'relative',
    }}
  >
    <Handle type="target" position={Position.Top} style={{ background: data.color }} />
    <Handle type="source" position={Position.Bottom} style={{ background: data.color }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ fontSize: 18 }}>{data.emoji}</span>
      <span style={{ fontWeight: 700, fontSize: 11, color: '#f8fafc' }}>{data.name}</span>
    </div>
    <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 4 }}>{data.role}</div>
    {data.metric && (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          background: `${data.color}22`,
          border: `1px solid ${data.color}44`,
          borderRadius: 4,
          padding: '1px 5px',
          fontSize: 8,
          color: data.color,
          marginBottom: 4,
        }}
      >
        📊 {data.metric}
      </div>
    )}
    {data.description && (
      <div style={{ fontSize: 9, color: '#cbd5e1', lineHeight: 1.4 }}>{data.description}</div>
    )}
  </div>
));
AgentNode.displayName = 'AgentNode';

const DecisionNode = memo(({ data }: NodeProps) => (
  <div
    style={{
      width: 170,
      background: 'linear-gradient(135deg, #1c1917 0%, #0c0a09 100%)',
      border: '2px solid #d97706',
      borderRadius: 8,
      padding: '10px 12px',
      boxShadow: '0 0 14px 2px #d9770633',
      position: 'relative',
      textAlign: 'center',
    }}
  >
    <Handle type="target" position={Position.Top} style={{ background: '#d97706' }} />
    <Handle
      type="source"
      id="yes"
      position={Position.Bottom}
      style={{ left: '30%', background: '#22c55e' }}
    />
    <Handle
      type="source"
      id="no"
      position={Position.Right}
      style={{ background: '#ef4444' }}
    />
    <div style={{ fontSize: 20, marginBottom: 4 }}>{data.emoji}</div>
    <div style={{ fontSize: 10, color: '#fcd34d', fontWeight: 600, lineHeight: 1.4 }}>{data.label}</div>
  </div>
));
DecisionNode.displayName = 'DecisionNode';

const RecoveryNode = memo(({ data }: NodeProps) => (
  <div
    style={{
      width: 170,
      background: 'linear-gradient(135deg, #1f0a0a 0%, #0f0505 100%)',
      border: '2px dashed #ef4444',
      borderRadius: 10,
      padding: '10px 12px',
      position: 'relative',
    }}
  >
    <Handle type="target" position={Position.Left} style={{ background: '#ef4444' }} />
    <Handle type="source" id="loop" position={Position.Bottom} style={{ background: '#ef4444' }} />
    <div style={{ fontSize: 18, marginBottom: 3 }}>{data.emoji}</div>
    <div style={{ fontWeight: 700, fontSize: 10, color: '#fca5a5', marginBottom: 2 }}>{data.label}</div>
    {data.description && (
      <div style={{ fontSize: 8, color: '#94a3b8', lineHeight: 1.4 }}>{data.description}</div>
    )}
  </div>
));
RecoveryNode.displayName = 'RecoveryNode';

const nodeTypes = {
  hubNode: HubNode,
  stageNode: StageNode,
  agentNode: AgentNode,
  decisionNode: DecisionNode,
  recoveryNode: RecoveryNode,
};

// ─── Agent colors ─────────────────────────────────────────────────────────────

const C = {
  jose: { color: '#10b981', bg: 'linear-gradient(135deg, #052e16 0%, #022c22 100%)' },
  paulo: { color: '#3b82f6', bg: 'linear-gradient(135deg, #0c1a3a 0%, #030d24 100%)' },
  maria: { color: '#f472b6', bg: 'linear-gradient(135deg, #2d0a1e 0%, #1a0510 100%)' },
  davi: { color: '#a78bfa', bg: 'linear-gradient(135deg, #1e0a3a 0%, #0f0520 100%)' },
  joao: { color: '#818cf8', bg: 'linear-gradient(135deg, #0c0c3a 0%, #06062a 100%)' },
  lucas: { color: '#fb923c', bg: 'linear-gradient(135deg, #2d1500 0%, #1a0a00 100%)' },
  marcos: { color: '#38bdf8', bg: 'linear-gradient(135deg, #001e2d 0%, #001018 100%)' },
};

// ─── Nodes ────────────────────────────────────────────────────────────────────

const nodes = [
  // HUB
  {
    id: 'salomao',
    type: 'hubNode',
    position: { x: 340, y: 0 },
    data: {
      emoji: '👑',
      name: 'SALOMÃO',
      role: 'Orquestrador • Base de Conhecimento',
      borderColor: '#f59e0b',
      glowColor: '#f59e0b55',
    },
  },
  {
    id: 'daniel-hub',
    type: 'hubNode',
    position: { x: 340, y: 140 },
    data: {
      emoji: '📊',
      name: 'DANIEL',
      role: 'Estrategista de Vendas',
      borderColor: '#818cf8',
      glowColor: '#818cf855',
    },
  },

  // STAGE ATENÇÃO
  {
    id: 'stage-atencao',
    type: 'stageNode',
    position: { x: 0, y: 300 },
    data: {
      emoji: '🔴',
      label: 'A — ATENÇÃO',
      sublabel: 'Topo do Funil • Atração e Impacto',
      gradient: 'linear-gradient(90deg, #1f0505 0%, #2d0a0a 100%)',
      borderColor: '#ef4444',
      textColor: '#fca5a5',
    },
  },

  // Agents row 1 – ATENÇÃO
  {
    id: 'jose-meta',
    type: 'agentNode',
    position: { x: 90, y: 400 },
    data: {
      emoji: '🎯',
      name: 'JOSÉ',
      role: 'Meta Ads',
      metric: 'CTR • ROAS',
      description: 'Campanhas de tráfego pago no Facebook/Instagram',
      color: C.jose.color,
      bgGradient: C.jose.bg,
    },
  },
  {
    id: 'jose-google',
    type: 'agentNode',
    position: { x: 360, y: 400 },
    data: {
      emoji: '🎯',
      name: 'JOSÉ',
      role: 'Google Ads',
      metric: 'CPC • Impressões',
      description: 'Search, Display e YouTube Ads',
      color: C.jose.color,
      bgGradient: C.jose.bg,
    },
  },
  {
    id: 'davi',
    type: 'agentNode',
    position: { x: 630, y: 400 },
    data: {
      emoji: '📱',
      name: 'DAVI',
      role: 'Social Media Orgânico',
      metric: 'Alcance • Engaj.',
      description: 'Conteúdo orgânico para Instagram, TikTok e LinkedIn',
      color: C.davi.color,
      bgGradient: C.davi.bg,
    },
  },

  // Agents row 2 – ATENÇÃO
  {
    id: 'paulo-hooks',
    type: 'agentNode',
    position: { x: 180, y: 560 },
    data: {
      emoji: '✍️',
      name: 'PAULO',
      role: 'Copywriter',
      metric: 'Hooks • Headlines',
      description: 'Copy de atração: hooks, headlines e primeiros segundos',
      color: C.paulo.color,
      bgGradient: C.paulo.bg,
    },
  },
  {
    id: 'maria',
    type: 'agentNode',
    position: { x: 540, y: 560 },
    data: {
      emoji: '🎨',
      name: 'MARIA',
      role: 'Design Criativo',
      metric: 'Criativos • Banners',
      description: 'Peças visuais para anúncios e posts orgânicos',
      color: C.maria.color,
      bgGradient: C.maria.bg,
    },
  },

  // Decision 1
  {
    id: 'dec-1',
    type: 'decisionNode',
    position: { x: 365, y: 710 },
    data: { emoji: '👁️', label: 'Visualizou e se interessou?' },
  },

  // STAGE INTERESSE
  {
    id: 'stage-interesse',
    type: 'stageNode',
    position: { x: 0, y: 820 },
    data: {
      emoji: '🟡',
      label: 'I — INTERESSE',
      sublabel: 'Meio do Funil • Engajamento e Consideração',
      gradient: 'linear-gradient(90deg, #1a1200 0%, #2d1f00 100%)',
      borderColor: '#eab308',
      textColor: '#fde047',
    },
  },

  // Agents – INTERESSE
  {
    id: 'lucas-lp',
    type: 'agentNode',
    position: { x: 180, y: 920 },
    data: {
      emoji: '🔀',
      name: 'LUCAS',
      role: 'Landing Page',
      metric: 'Taxa de Conv. LP',
      description: 'Estrutura, UX e funil da landing page',
      color: C.lucas.color,
      bgGradient: C.lucas.bg,
    },
  },
  {
    id: 'paulo-lp',
    type: 'agentNode',
    position: { x: 540, y: 920 },
    data: {
      emoji: '✍️',
      name: 'PAULO',
      role: 'Copy da LP',
      metric: 'Conversão • CTA',
      description: 'Textos persuasivos da landing page',
      color: C.paulo.color,
      bgGradient: C.paulo.bg,
    },
  },

  // Decision 2
  {
    id: 'dec-2',
    type: 'decisionNode',
    position: { x: 365, y: 1080 },
    data: { emoji: '🖱️', label: 'Clicou no CTA / Deixou contato?' },
  },

  // STAGE DESEJO
  {
    id: 'stage-desejo',
    type: 'stageNode',
    position: { x: 0, y: 1190 },
    data: {
      emoji: '🟢',
      label: 'D — DESEJO',
      sublabel: 'Meio-Fundo do Funil • Nutrição e Relacionamento',
      gradient: 'linear-gradient(90deg, #021a0e 0%, #052e16 100%)',
      borderColor: '#10b981',
      textColor: '#6ee7b7',
    },
  },

  // Agents – DESEJO
  {
    id: 'marcos-wpp',
    type: 'agentNode',
    position: { x: 90, y: 1290 },
    data: {
      emoji: '💬',
      name: 'MARCOS',
      role: 'WhatsApp',
      metric: 'Taxa de Resposta',
      description: 'Nutrição e qualificação via WhatsApp',
      color: C.marcos.color,
      bgGradient: C.marcos.bg,
    },
  },
  {
    id: 'joao-email',
    type: 'agentNode',
    position: { x: 360, y: 1290 },
    data: {
      emoji: '📧',
      name: 'JOÃO',
      role: 'Email Marketing',
      metric: 'Open Rate • Cliques',
      description: 'Sequências de nutrição por email',
      color: C.joao.color,
      bgGradient: C.joao.bg,
    },
  },
  {
    id: 'paulo-nurture',
    type: 'agentNode',
    position: { x: 630, y: 1290 },
    data: {
      emoji: '✍️',
      name: 'PAULO',
      role: 'Copy de Nutrição',
      metric: 'Engajamento',
      description: 'Textos para emails e mensagens de nutrição',
      color: C.paulo.color,
      bgGradient: C.paulo.bg,
    },
  },

  // Decision 3
  {
    id: 'dec-3',
    type: 'decisionNode',
    position: { x: 365, y: 1460 },
    data: { emoji: '🔥', label: 'Demonstrou interesse real?' },
  },

  // STAGE AÇÃO
  {
    id: 'stage-acao',
    type: 'stageNode',
    position: { x: 0, y: 1570 },
    data: {
      emoji: '🟩',
      label: 'A — AÇÃO',
      sublabel: 'Fundo do Funil • Fechamento da Venda',
      gradient: 'linear-gradient(90deg, #021a05 0%, #052e0e 100%)',
      borderColor: '#22c55e',
      textColor: '#86efac',
    },
  },

  // Agents – AÇÃO
  {
    id: 'marcos-fecha',
    type: 'agentNode',
    position: { x: 180, y: 1670 },
    data: {
      emoji: '💬',
      name: 'MARCOS',
      role: 'Fechamento WhatsApp',
      metric: 'Taxa de Fechamento',
      description: 'Script de fechamento e objeções via WhatsApp',
      color: C.marcos.color,
      bgGradient: C.marcos.bg,
    },
  },
  {
    id: 'paulo-oferta',
    type: 'agentNode',
    position: { x: 540, y: 1670 },
    data: {
      emoji: '✍️',
      name: 'PAULO',
      role: 'Copy da Oferta Final',
      metric: 'Conversão Final',
      description: 'Copy da oferta, bônus e urgência',
      color: C.paulo.color,
      bgGradient: C.paulo.bg,
    },
  },

  // Decision 4
  {
    id: 'dec-4',
    type: 'decisionNode',
    position: { x: 365, y: 1840 },
    data: { emoji: '💳', label: 'Comprou?' },
  },

  // STAGE PÓS-VENDA
  {
    id: 'stage-posvenda',
    type: 'stageNode',
    position: { x: 0, y: 1950 },
    data: {
      emoji: '🟣',
      label: 'PÓS-VENDA',
      sublabel: 'Retenção • Upsell • Fidelização',
      gradient: 'linear-gradient(90deg, #150a2d 0%, #1e0a3a 100%)',
      borderColor: '#a78bfa',
      textColor: '#c4b5fd',
    },
  },

  // Agents – PÓS-VENDA
  {
    id: 'joao-ret',
    type: 'agentNode',
    position: { x: 90, y: 2050 },
    data: {
      emoji: '📧',
      name: 'JOÃO',
      role: 'Retenção / Onboarding',
      metric: 'Churn Rate',
      description: 'Sequência de onboarding e retenção por email',
      color: C.joao.color,
      bgGradient: C.joao.bg,
    },
  },
  {
    id: 'marcos-upsell',
    type: 'agentNode',
    position: { x: 360, y: 2050 },
    data: {
      emoji: '💬',
      name: 'MARCOS',
      role: 'Upsell / Suporte',
      metric: 'LTV • NPS',
      description: 'Upsell, cross-sell e suporte via WhatsApp',
      color: C.marcos.color,
      bgGradient: C.marcos.bg,
    },
  },
  {
    id: 'daniel-kpis',
    type: 'agentNode',
    position: { x: 630, y: 2050 },
    data: {
      emoji: '📊',
      name: 'DANIEL',
      role: 'Análise de KPIs',
      metric: 'ROI • ROAS • LTV',
      description: 'Consolida métricas e otimiza estratégia',
      color: C.joao.color,
      bgGradient: 'linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)',
    },
  },

  // Recovery nodes (x=960)
  {
    id: 'rec-remarketing',
    type: 'recoveryNode',
    position: { x: 960, y: 700 },
    data: {
      emoji: '🔁',
      label: 'Remarketing',
      description: 'JOSÉ reimpacta • MARIA novos criativos • PAULO novas copies',
    },
  },
  {
    id: 'rec-retargeting',
    type: 'recoveryNode',
    position: { x: 960, y: 1070 },
    data: {
      emoji: '🔁',
      label: 'Retargeting LP',
      description: 'JOSÉ retargeting • PAULO novo CTA',
    },
  },
  {
    id: 'rec-followup',
    type: 'recoveryNode',
    position: { x: 960, y: 1450 },
    data: {
      emoji: '🔁',
      label: 'Follow-up',
      description: 'MARCOS WhatsApp • JOÃO Email reativação',
    },
  },
  {
    id: 'rec-oferta',
    type: 'recoveryNode',
    position: { x: 960, y: 1830 },
    data: {
      emoji: '🔁',
      label: 'Oferta de Recuperação',
      description: 'PAULO oferta alternativa • MARCOS contorno de objeções',
    },
  },
];

// ─── Edges ────────────────────────────────────────────────────────────────────

const mk = (color: string) => ({ type: MarkerType.ArrowClosed, color });

const edges = [
  // HUB bidirectional
  {
    id: 'e-sal-dan',
    source: 'salomao',
    target: 'daniel-hub',
    animated: true,
    style: { stroke: '#f59e0b', strokeWidth: 2 },
    markerEnd: mk('#f59e0b'),
    label: 'Base de conhecimento',
    labelStyle: { fontSize: 9, fill: '#f59e0b' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
  {
    id: 'e-dan-sal',
    source: 'daniel-hub',
    sourceHandle: 'left',
    target: 'salomao',
    targetHandle: 'target-left',
    animated: true,
    style: { stroke: '#818cf8', strokeWidth: 2 },
    markerEnd: mk('#818cf8'),
    label: 'Estratégia AIDA',
    labelStyle: { fontSize: 9, fill: '#818cf8' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },

  // SALOMÃO → stage-atencao
  {
    id: 'e-sal-atencao',
    source: 'salomao',
    target: 'stage-atencao',
    style: { stroke: '#f59e0b', strokeWidth: 1.5, strokeDasharray: '5 4' },
    markerEnd: mk('#f59e0b'),
    label: 'Distribui tarefas',
    labelStyle: { fontSize: 9, fill: '#f59e0b' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },

  // stage-atencao → agents
  { id: 'e-atencao-jose-meta', source: 'stage-atencao', target: 'jose-meta', style: { stroke: '#ef4444', strokeWidth: 1.2 }, markerEnd: mk('#ef4444') },
  { id: 'e-atencao-jose-google', source: 'stage-atencao', target: 'jose-google', style: { stroke: '#ef4444', strokeWidth: 1.2 }, markerEnd: mk('#ef4444') },
  { id: 'e-atencao-davi', source: 'stage-atencao', target: 'davi', style: { stroke: '#ef4444', strokeWidth: 1.2 }, markerEnd: mk('#ef4444') },

  // agents → paulo-hooks & maria
  { id: 'e-jose-meta-paulo', source: 'jose-meta', target: 'paulo-hooks', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
  { id: 'e-jose-google-paulo', source: 'jose-google', target: 'paulo-hooks', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
  { id: 'e-jose-meta-maria', source: 'jose-meta', target: 'maria', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
  { id: 'e-davi-maria', source: 'davi', target: 'maria', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

  // → decision 1
  { id: 'e-paulo-hooks-dec1', source: 'paulo-hooks', target: 'dec-1', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
  { id: 'e-maria-dec1', source: 'maria', target: 'dec-1', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

  // dec-1 SIM → stage-interesse
  {
    id: 'e-dec1-sim',
    source: 'dec-1',
    sourceHandle: 'yes',
    target: 'stage-interesse',
    style: { stroke: '#22c55e', strokeWidth: 1.5 },
    markerEnd: mk('#22c55e'),
    label: 'SIM ✅',
    labelStyle: { fontSize: 9, fill: '#22c55e' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
  // dec-1 NÃO → rec-remarketing
  {
    id: 'e-dec1-nao',
    source: 'dec-1',
    sourceHandle: 'no',
    target: 'rec-remarketing',
    style: { stroke: '#ef4444', strokeWidth: 1.5 },
    markerEnd: mk('#ef4444'),
    label: 'NÃO ❌',
    labelStyle: { fontSize: 9, fill: '#ef4444' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
  // rec-remarketing → jose-meta (loop back)
  {
    id: 'e-rec-remarketing-loop',
    source: 'rec-remarketing',
    sourceHandle: 'loop',
    target: 'jose-meta',
    style: { stroke: '#ef4444', strokeWidth: 1.2, strokeDasharray: '5 4' },
    markerEnd: mk('#ef4444'),
  },

  // stage-interesse → agents
  { id: 'e-interesse-lucas', source: 'stage-interesse', target: 'lucas-lp', style: { stroke: '#eab308', strokeWidth: 1.2 }, markerEnd: mk('#eab308') },
  { id: 'e-interesse-paulo-lp', source: 'stage-interesse', target: 'paulo-lp', style: { stroke: '#eab308', strokeWidth: 1.2 }, markerEnd: mk('#eab308') },

  // agents → dec-2
  { id: 'e-lucas-dec2', source: 'lucas-lp', target: 'dec-2', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
  { id: 'e-paulo-lp-dec2', source: 'paulo-lp', target: 'dec-2', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

  // dec-2 SIM → stage-desejo
  {
    id: 'e-dec2-sim',
    source: 'dec-2',
    sourceHandle: 'yes',
    target: 'stage-desejo',
    style: { stroke: '#22c55e', strokeWidth: 1.5 },
    markerEnd: mk('#22c55e'),
    label: 'SIM ✅',
    labelStyle: { fontSize: 9, fill: '#22c55e' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
  // dec-2 NÃO → rec-retargeting
  {
    id: 'e-dec2-nao',
    source: 'dec-2',
    sourceHandle: 'no',
    target: 'rec-retargeting',
    style: { stroke: '#ef4444', strokeWidth: 1.5 },
    markerEnd: mk('#ef4444'),
    label: 'NÃO ❌',
    labelStyle: { fontSize: 9, fill: '#ef4444' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
  // rec-retargeting → lucas-lp (loop back)
  {
    id: 'e-rec-retargeting-loop',
    source: 'rec-retargeting',
    sourceHandle: 'loop',
    target: 'lucas-lp',
    style: { stroke: '#ef4444', strokeWidth: 1.2, strokeDasharray: '5 4' },
    markerEnd: mk('#ef4444'),
  },

  // stage-desejo → agents
  { id: 'e-desejo-marcos', source: 'stage-desejo', target: 'marcos-wpp', style: { stroke: '#10b981', strokeWidth: 1.2 }, markerEnd: mk('#10b981') },
  { id: 'e-desejo-joao', source: 'stage-desejo', target: 'joao-email', style: { stroke: '#10b981', strokeWidth: 1.2 }, markerEnd: mk('#10b981') },
  { id: 'e-desejo-paulo', source: 'stage-desejo', target: 'paulo-nurture', style: { stroke: '#10b981', strokeWidth: 1.2 }, markerEnd: mk('#10b981') },

  // agents → dec-3
  { id: 'e-marcos-wpp-dec3', source: 'marcos-wpp', target: 'dec-3', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
  { id: 'e-joao-email-dec3', source: 'joao-email', target: 'dec-3', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
  { id: 'e-paulo-nurture-dec3', source: 'paulo-nurture', target: 'dec-3', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

  // dec-3 SIM → stage-acao
  {
    id: 'e-dec3-sim',
    source: 'dec-3',
    sourceHandle: 'yes',
    target: 'stage-acao',
    style: { stroke: '#22c55e', strokeWidth: 1.5 },
    markerEnd: mk('#22c55e'),
    label: 'SIM ✅',
    labelStyle: { fontSize: 9, fill: '#22c55e' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
  // dec-3 NÃO → rec-followup
  {
    id: 'e-dec3-nao',
    source: 'dec-3',
    sourceHandle: 'no',
    target: 'rec-followup',
    style: { stroke: '#ef4444', strokeWidth: 1.5 },
    markerEnd: mk('#ef4444'),
    label: 'NÃO ❌',
    labelStyle: { fontSize: 9, fill: '#ef4444' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
  // rec-followup → marcos-wpp (loop back)
  {
    id: 'e-rec-followup-loop',
    source: 'rec-followup',
    sourceHandle: 'loop',
    target: 'marcos-wpp',
    style: { stroke: '#ef4444', strokeWidth: 1.2, strokeDasharray: '5 4' },
    markerEnd: mk('#ef4444'),
  },

  // stage-acao → agents
  { id: 'e-acao-marcos', source: 'stage-acao', target: 'marcos-fecha', style: { stroke: '#22c55e', strokeWidth: 1.2 }, markerEnd: mk('#22c55e') },
  { id: 'e-acao-paulo', source: 'stage-acao', target: 'paulo-oferta', style: { stroke: '#22c55e', strokeWidth: 1.2 }, markerEnd: mk('#22c55e') },

  // agents → dec-4
  { id: 'e-marcos-fecha-dec4', source: 'marcos-fecha', target: 'dec-4', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },
  { id: 'e-paulo-oferta-dec4', source: 'paulo-oferta', target: 'dec-4', style: { stroke: '#6b7280', strokeWidth: 1 }, markerEnd: mk('#6b7280') },

  // dec-4 SIM → stage-posvenda
  {
    id: 'e-dec4-sim',
    source: 'dec-4',
    sourceHandle: 'yes',
    target: 'stage-posvenda',
    style: { stroke: '#22c55e', strokeWidth: 1.5 },
    markerEnd: mk('#22c55e'),
    label: 'SIM ✅',
    labelStyle: { fontSize: 9, fill: '#22c55e' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
  // dec-4 NÃO → rec-oferta
  {
    id: 'e-dec4-nao',
    source: 'dec-4',
    sourceHandle: 'no',
    target: 'rec-oferta',
    style: { stroke: '#ef4444', strokeWidth: 1.5 },
    markerEnd: mk('#ef4444'),
    label: 'NÃO ❌',
    labelStyle: { fontSize: 9, fill: '#ef4444' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
  // rec-oferta → marcos-fecha (loop back)
  {
    id: 'e-rec-oferta-loop',
    source: 'rec-oferta',
    sourceHandle: 'loop',
    target: 'marcos-fecha',
    style: { stroke: '#ef4444', strokeWidth: 1.2, strokeDasharray: '5 4' },
    markerEnd: mk('#ef4444'),
  },

  // stage-posvenda → agents
  { id: 'e-posvenda-joao', source: 'stage-posvenda', target: 'joao-ret', style: { stroke: '#a78bfa', strokeWidth: 1.2 }, markerEnd: mk('#a78bfa') },
  { id: 'e-posvenda-marcos', source: 'stage-posvenda', target: 'marcos-upsell', style: { stroke: '#a78bfa', strokeWidth: 1.2 }, markerEnd: mk('#a78bfa') },
  { id: 'e-posvenda-daniel', source: 'stage-posvenda', target: 'daniel-kpis', style: { stroke: '#a78bfa', strokeWidth: 1.2 }, markerEnd: mk('#a78bfa') },

  // DANIEL KPIs → SALOMÃO (feedback loop, dashed indigo)
  {
    id: 'e-daniel-kpis-salomao',
    source: 'daniel-kpis',
    target: 'salomao',
    style: { stroke: '#818cf8', strokeWidth: 1.5, strokeDasharray: '6 4' },
    markerEnd: mk('#818cf8'),
    label: 'Ajuste de estratégia',
    labelStyle: { fontSize: 9, fill: '#818cf8' },
    labelBgStyle: { fill: '#0f172a', rx: 4 },
  },
];

// ─── Legend ───────────────────────────────────────────────────────────────────

const LEGEND = [
  { emoji: '👑', name: 'SALOMÃO', role: 'Orquestrador', color: '#f59e0b' },
  { emoji: '📊', name: 'DANIEL', role: 'Estrategista', color: '#818cf8' },
  { emoji: '🎯', name: 'JOSÉ', role: 'Tráfego Pago', color: C.jose.color },
  { emoji: '✍️', name: 'PAULO', role: 'Copywriter', color: C.paulo.color },
  { emoji: '🎨', name: 'MARIA', role: 'Design', color: C.maria.color },
  { emoji: '📱', name: 'DAVI', role: 'Social Orgânico', color: C.davi.color },
  { emoji: '📧', name: 'JOÃO', role: 'Email Marketing', color: C.joao.color },
  { emoji: '🔀', name: 'LUCAS', role: 'Funil / LPs', color: C.lucas.color },
  { emoji: '💬', name: 'MARCOS', role: 'WhatsApp + CRM', color: C.marcos.color },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export function FunnelFlowchart() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Legend */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 14px',
          padding: '10px 14px',
          background: '#0f172a',
          border: '1px solid #1e293b',
          borderRadius: 10,
        }}
      >
        {LEGEND.map((a) => (
          <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: a.color,
                boxShadow: `0 0 6px ${a.color}99`,
              }}
            />
            <span style={{ fontSize: 11, color: '#e2e8f0' }}>
              {a.emoji} <strong>{a.name}</strong>
            </span>
            <span style={{ fontSize: 10, color: '#64748b' }}>— {a.role}</span>
          </div>
        ))}
      </div>

      {/* ReactFlow canvas */}
      <div
        style={{
          width: '100%',
          height: '75vh',
          borderRadius: 12,
          border: '1px solid #1e293b',
          overflow: 'hidden',
          background: '#0a0f1e',
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          fitView
          fitViewOptions={{ padding: 0.08, maxZoom: 0.7 }}
          minZoom={0.1}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} color="#374151" gap={20} size={1} />
          <Controls
            style={{
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
            }}
          />
          <MiniMap
            style={{
              background: '#0f172a',
              border: '1px solid #1e293b',
            }}
            nodeColor={(n) => {
              if (n.type === 'stageNode') return '#374151';
              if (n.type === 'recoveryNode') return '#ef4444';
              if (n.type === 'decisionNode') return '#d97706';
              if (n.type === 'hubNode') return '#f59e0b';
              return '#4b5563';
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
