// Mock Data - Legacy file
// Most data has been migrated to Supabase or Meta API
// Keeping minimal types for TypeScript compatibility until full refactor is verified

export interface Campaign {
  id: string;
  name: string;
  platform: 'meta' | 'google';
  status: 'active' | 'paused' | 'ended';
  spend: number;
  conversions: number;
  cpa: number;
  roas: number;
  ctr: number;
  impressions: number;
  clicks: number;
  cpc: number;
  frequency: number;
  trend: 'up' | 'down' | 'stable';
  healthScore: number;
}

export interface KPIData {
  label: string;
  value: string | number;
  change: number;
  trend: 'up' | 'down' | 'stable';
  sparkline: number[];
}

export interface AIInsight {
  id: string;
  type: 'warning' | 'opportunity' | 'success' | 'info';
  title: string;
  description: string;
  campaign?: string;
  impact?: string;
}

export interface CopyResult {
  id: string;
  headline: string;
  description: string;
  cta: string;
  platform: 'meta' | 'google';
  score: number;
  headlineChars: number;
  descriptionChars: number;
}

// These are still used in AICopywriter for now as templates
export const mockCopyTemplates = [
  {
    id: '1',
    name: 'E-commerce - Urgência',
    category: 'ecommerce',
    platform: 'meta',
    headline: '🔥 Últimas horas! {desconto}% OFF',
    description: 'Aproveite a promoção imperdível de {produto}. Frete grátis + desconto exclusivo. Só até meia-noite!',
    cta: 'Comprar Agora',
  },
  {
    id: '2',
    name: 'Infoproduto - Autoridade',
    category: 'infoproduto',
    platform: 'meta',
    headline: 'Como {resultado} em {tempo}',
    description: 'Descubra o método que já ajudou +{numero} pessoas a {benefício}. Acesso imediato ao curso completo.',
    cta: 'Quero Aprender',
  },
  {
    id: '3',
    name: 'SaaS - Problema/Solução',
    category: 'saas',
    platform: 'google',
    headline: 'Cansado de {problema}?',
    description: '{produto} automatiza {tarefa} e economiza {tempo} horas por semana. Teste grátis por 14 dias.',
    cta: 'Começar Grátis',
  },
  {
    id: '4',
    name: 'Local - Proximidade',
    category: 'local',
    platform: 'google',
    headline: '{serviço} perto de você',
    description: 'Os melhores profissionais de {cidade} prontos para atender. Orçamento gratuito em 5 minutos.',
    cta: 'Solicitar Orçamento',
  },
];

// Kept as type definitions only, values replaced by real API data
export const mockKPIs: KPIData[] = [];
export const mockCampaigns: Campaign[] = [];
