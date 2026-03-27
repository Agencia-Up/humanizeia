export type AidaPhase = 'atencao' | 'interesse' | 'desejo' | 'acao' | 'posVenda' | 'hub' | 'decisao' | 'recovery';

export type AgentName = 'SALOMÃO' | 'DANIEL' | 'JOSÉ' | 'PAULO' | 'MARIA' | 'DAVI' | 'JOÃO' | 'LUCAS' | 'MARCOS' | 'Nenhum';

export interface FunnelNodeData {
  label: string;
  emoji: string;
  role: string;
  agent: AgentName;
  phase: AidaPhase;
  metric?: string;
  url?: string;
  notes?: string;
  isDecision?: boolean;
}

export interface SavedFlow {
  id?: string;
  name: string;
  nodes: any[];
  edges: any[];
}

export const PHASE_COLORS: Record<AidaPhase, { border: string; bg: string; text: string; glow: string; badge: string }> = {
  hub:       { border: '#f59e0b', bg: 'linear-gradient(135deg,#1a1a2e,#16213e)', text: '#fbbf24', glow: '#f59e0b44', badge: 'bg-amber-500/20 text-amber-300' },
  atencao:   { border: '#ef4444', bg: 'linear-gradient(135deg,#450a0a,#7f1d1d)', text: '#fca5a5', glow: '#ef444433', badge: 'bg-red-500/20 text-red-300' },
  interesse: { border: '#eab308', bg: 'linear-gradient(135deg,#422006,#713f12)', text: '#fde68a', glow: '#eab30833', badge: 'bg-yellow-500/20 text-yellow-300' },
  desejo:    { border: '#10b981', bg: 'linear-gradient(135deg,#022c22,#064e3b)', text: '#6ee7b7', glow: '#10b98133', badge: 'bg-emerald-500/20 text-emerald-300' },
  acao:      { border: '#3b82f6', bg: 'linear-gradient(135deg,#172554,#1e3a8a)', text: '#93c5fd', glow: '#3b82f633', badge: 'bg-blue-500/20 text-blue-300' },
  posVenda:  { border: '#a855f7', bg: 'linear-gradient(135deg,#2e1065,#4c1d95)', text: '#d8b4fe', glow: '#a855f733', badge: 'bg-purple-500/20 text-purple-300' },
  decisao:   { border: '#f59e0b', bg: 'linear-gradient(135deg,#1c1917,#292524)', text: '#fbbf24', glow: '#f59e0b33', badge: 'bg-amber-500/20 text-amber-300' },
  recovery:  { border: '#ef4444', bg: 'linear-gradient(135deg,#450a0a,#7f1d1d)', text: '#fca5a5', glow: '#ef444433', badge: 'bg-red-500/20 text-red-300' },
};

export const AGENTS: AgentName[] = ['SALOMÃO', 'DANIEL', 'JOSÉ', 'PAULO', 'MARIA', 'DAVI', 'JOÃO', 'LUCAS', 'MARCOS', 'Nenhum'];

export const AGENT_COLORS: Record<AgentName, string> = {
  'SALOMÃO': '#f59e0b',
  'DANIEL':  '#818cf8',
  'JOSÉ':    '#10b981',
  'PAULO':   '#3b82f6',
  'MARIA':   '#f472b6',
  'DAVI':    '#a78bfa',
  'JOÃO':    '#818cf8',
  'LUCAS':   '#fb923c',
  'MARCOS':  '#38bdf8',
  'Nenhum':  '#6b7280',
};

export const PALETTE_ITEMS = [
  { emoji: '🎯', label: 'Meta Ads',     role: 'Tráfego Pago', agent: 'JOSÉ'   as AgentName, phase: 'atencao'   as AidaPhase },
  { emoji: '🔍', label: 'Google Ads',   role: 'Tráfego Pago', agent: 'JOSÉ'   as AgentName, phase: 'atencao'   as AidaPhase },
  { emoji: '📱', label: 'Social Media', role: 'Orgânico',      agent: 'DAVI'   as AgentName, phase: 'atencao'   as AidaPhase },
  { emoji: '✍️', label: 'Copywriting',  role: 'Copy',          agent: 'PAULO'  as AgentName, phase: 'atencao'   as AidaPhase },
  { emoji: '🎨', label: 'Criativo',     role: 'Design',        agent: 'MARIA'  as AgentName, phase: 'atencao'   as AidaPhase },
  { emoji: '🌐', label: 'Landing Page', role: 'Funil',         agent: 'LUCAS'  as AgentName, phase: 'interesse' as AidaPhase },
  { emoji: '📧', label: 'Email Mkt',    role: 'Nutrição',      agent: 'JOÃO'   as AgentName, phase: 'desejo'    as AidaPhase },
  { emoji: '💬', label: 'WhatsApp',     role: 'Leads',         agent: 'MARCOS' as AgentName, phase: 'desejo'    as AidaPhase },
  { emoji: '💳', label: 'Checkout',     role: 'Conversão',     agent: 'MARCOS' as AgentName, phase: 'acao'      as AidaPhase },
  { emoji: '🤔', label: 'Decisão',      role: 'SIM / NÃO',    agent: 'Nenhum' as AgentName, phase: 'decisao'   as AidaPhase, isDecision: true },
  { emoji: '🔄', label: 'Remarketing',  role: 'Recovery',      agent: 'JOSÉ'   as AgentName, phase: 'recovery'  as AidaPhase },
  { emoji: '📊', label: 'Análise KPI',  role: 'Estratégia',    agent: 'DANIEL' as AgentName, phase: 'posVenda'  as AidaPhase },
  { emoji: '🌟', label: 'Pós-venda',    role: 'Retenção',      agent: 'MARCOS' as AgentName, phase: 'posVenda'  as AidaPhase },
  { emoji: '🚀', label: 'Upsell',       role: 'Recompra',      agent: 'MARCOS' as AgentName, phase: 'posVenda'  as AidaPhase },
];
