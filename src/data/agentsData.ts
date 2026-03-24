export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  emoji: string;
  color: string;
  colorVar: string;
  description: string;
  route: string;
  metrics: { label: string; value: string; trend?: string }[];
  sidebarSections: { label: string; id: string; icon: string }[];
}

export const agents: AgentConfig[] = [
  {
    id: 'salomao', name: 'Salomão', role: 'Orquestrador', emoji: '🏛️',
    color: '#f59e0b', colorVar: '--agent-salomao',
    description: 'Coordena todos os agentes e garante alinhamento estratégico da operação.',
    route: '/agents/salomao',
    metrics: [
      { label: 'Agentes Online', value: '10/10', trend: '+0' },
      { label: 'Tarefas Concluídas', value: '847', trend: '+23' },
      { label: 'Performance Geral', value: '94%', trend: '+2.1%' },
    ],
    sidebarSections: [
      { label: 'Visão Geral', id: 'overview', icon: 'LayoutDashboard' },
      { label: 'Atividade dos Agentes', id: 'activity', icon: 'Activity' },
      { label: 'Relatórios', id: 'reports', icon: 'FileText' },
      { label: 'Configurações', id: 'settings', icon: 'Settings' },
    ],
  },
  {
    id: 'jose', name: 'José', role: 'Tráfego Pago', emoji: '📊',
    color: '#7c5cfc', colorVar: '--agent-jose',
    description: 'Gerencia campanhas de tráfego pago em Meta, Google e TikTok Ads.',
    route: '/agents/jose',
    metrics: [
      { label: 'ROAS', value: '4.2x', trend: '+0.3' },
      { label: 'CPA', value: 'R$38', trend: '-R$4' },
      { label: 'Conversões', value: '284', trend: '+18' },
    ],
    sidebarSections: [
      { label: 'Visão Geral', id: 'overview', icon: 'LayoutDashboard' },
      { label: 'Campanhas', id: 'campaigns', icon: 'Megaphone' },
      { label: 'CRM de Leads', id: 'leads', icon: 'Users' },
      { label: 'Integrações', id: 'integrations', icon: 'Plug' },
    ],
  },
  {
    id: 'marcos', name: 'Marcos', role: 'Leads', emoji: '🎯',
    color: '#3b82f6', colorVar: '--agent-marcos',
    description: 'Captura, qualifica e distribui leads para o time de vendas.',
    route: '/agents/marcos',
    metrics: [
      { label: 'Total Leads', value: '1.284', trend: '+89' },
      { label: 'Leads Quentes', value: '89', trend: '+12' },
      { label: 'Taxa Qualificação', value: '34%', trend: '+3%' },
    ],
    sidebarSections: [
      { label: 'Visão Geral', id: 'overview', icon: 'LayoutDashboard' },
      { label: 'Pipeline', id: 'pipeline', icon: 'Kanban' },
      { label: 'Capturas', id: 'captures', icon: 'Target' },
      { label: 'Qualificação', id: 'qualification', icon: 'ThermometerSun' },
    ],
  },
  {
    id: 'paulo', name: 'Paulo', role: 'Copywriter', emoji: '✍️',
    color: '#22d3a0', colorVar: '--agent-paulo',
    description: 'Cria copies persuasivos otimizados por IA para anúncios e landing pages.',
    route: '/agents/paulo',
    metrics: [
      { label: 'Copies Criados', value: '24', trend: '+6' },
      { label: 'CTR Médio', value: '6.8%', trend: '+0.4%' },
      { label: 'Em Uso', value: '8', trend: '+2' },
    ],
    sidebarSections: [
      { label: 'Visão Geral', id: 'overview', icon: 'LayoutDashboard' },
      { label: 'Biblioteca', id: 'library', icon: 'Library' },
      { label: 'Criar com IA', id: 'create', icon: 'Sparkles' },
    ],
  },
  {
    id: 'maria', name: 'Maria', role: 'Design', emoji: '🎨',
    color: '#f472b6', colorVar: '--agent-maria',
    description: 'Cria e gerencia criativos visuais para campanhas de alta performance.',
    route: '/agents/maria',
    metrics: [
      { label: 'Criativos', value: '47', trend: '+8' },
      { label: 'Vídeos', value: '12', trend: '+3' },
      { label: 'Aprovados', value: '38', trend: '+5' },
    ],
    sidebarSections: [
      { label: 'Biblioteca', id: 'library', icon: 'FolderOpen' },
      { label: 'Criar com IA', id: 'create', icon: 'Sparkles' },
      { label: 'Base de Prompts', id: 'prompts', icon: 'BookOpen' },
    ],
  },
  {
    id: 'davi', name: 'Davi', role: 'Social Media', emoji: '📱',
    color: '#60a5fa', colorVar: '--agent-davi',
    description: 'Gerencia presença nas redes sociais com calendário e métricas unificadas.',
    route: '/agents/davi',
    metrics: [
      { label: 'Engajamento', value: '4.2%', trend: '+0.3%' },
      { label: 'Alcance', value: '38k', trend: '+4.2k' },
      { label: 'Posts Agendados', value: '14', trend: '+3' },
    ],
    sidebarSections: [
      { label: 'Métricas', id: 'metrics', icon: 'BarChart3' },
      { label: 'Calendário', id: 'calendar', icon: 'Calendar' },
      { label: 'Insights', id: 'insights', icon: 'Lightbulb' },
    ],
  },
  {
    id: 'lucas', name: 'Lucas', role: 'Funil', emoji: '🔀',
    color: '#fb923c', colorVar: '--agent-lucas',
    description: 'Estrutura e otimiza funis de venda com automações inteligentes.',
    route: '/agents/lucas',
    metrics: [
      { label: 'Entradas', value: '320', trend: '+45' },
      { label: 'Taxa Resposta', value: '78%', trend: '+5%' },
      { label: 'Conversão', value: '31%', trend: '+2%' },
    ],
    sidebarSections: [
      { label: 'Visão Geral', id: 'overview', icon: 'LayoutDashboard' },
      { label: 'Etapas', id: 'stages', icon: 'GitBranch' },
      { label: 'WhatsApp', id: 'whatsapp', icon: 'MessageCircle' },
      { label: 'Automações', id: 'automations', icon: 'Zap' },
    ],
  },
  {
    id: 'joao', name: 'João', role: 'Email', emoji: '📧',
    color: '#a78bfa', colorVar: '--agent-joao',
    description: 'Gerencia campanhas de email marketing com automações e sequências.',
    route: '/agents/joao',
    metrics: [
      { label: 'Emails Enviados', value: '12.4k', trend: '+1.2k' },
      { label: 'Taxa Abertura', value: '28.4%', trend: '+1.2%' },
      { label: 'Taxa Clique', value: '6.2%', trend: '+0.4%' },
    ],
    sidebarSections: [
      { label: 'Visão Geral', id: 'overview', icon: 'LayoutDashboard' },
      { label: 'Campanhas', id: 'campaigns', icon: 'Mail' },
      { label: 'Templates', id: 'templates', icon: 'FileText' },
      { label: 'Sequências', id: 'sequences', icon: 'GitBranch' },
    ],
  },
  {
    id: 'pedro', name: 'Pedro', role: 'Atendimento', emoji: '💬',
    color: '#34d399', colorVar: '--agent-pedro',
    description: 'Gerencia atendimento ao cliente via WhatsApp com scripts e IA.',
    route: '/agents/pedro',
    metrics: [
      { label: 'Conversas Hoje', value: '48', trend: '+12' },
      { label: 'Satisfação', value: '4.8/5', trend: '+0.1' },
      { label: 'Resolvidos', value: '92%', trend: '+3%' },
    ],
    sidebarSections: [
      { label: 'Visão Geral', id: 'overview', icon: 'LayoutDashboard' },
      { label: 'Inbox', id: 'inbox', icon: 'Inbox' },
      { label: 'Histórico', id: 'history', icon: 'Clock' },
      { label: 'Scripts', id: 'scripts', icon: 'FileText' },
    ],
  },
  {
    id: 'daniel', name: 'Daniel', role: 'Estratégia', emoji: '🧠',
    color: '#f87171', colorVar: '--agent-daniel',
    description: 'Define estratégias de marketing, OKRs e análise competitiva.',
    route: '/agents/daniel',
    metrics: [
      { label: 'Projetos Ativos', value: '7', trend: '+1' },
      { label: 'Metas no Prazo', value: '78%', trend: '+5%' },
      { label: 'ROI Médio', value: '4.1x', trend: '+0.2' },
    ],
    sidebarSections: [
      { label: 'Visão Geral', id: 'overview', icon: 'LayoutDashboard' },
      { label: 'Planos', id: 'plans', icon: 'Map' },
      { label: 'Análise de Mercado', id: 'market', icon: 'TrendingUp' },
      { label: 'OKRs', id: 'okrs', icon: 'Target' },
    ],
  },
];

export function getAgent(id: string) {
  return agents.find((a) => a.id === id);
}
