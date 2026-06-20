import { Database } from 'lucide-react';
import { AgentDetailPage, type AgentDetailData } from '@/components/marketing/AgentDetailPage';

const MARCOS: AgentDetailData = {
  origem: 'marcos',
  nome: 'Marcos',
  cor: '#8B5CF6',
  bg: 'rgba(139, 92, 246, 0.10)',
  Icon: Database,
  h1: 'Marcos — disparo em massa que não queima base. CRM que conversa com o WhatsApp.',
  sub: 'Acabe com listas duplicadas, envios duplicados e CRM esquecido. Marcos centraliza disparo, segmentação e funil em um lugar só.',
  pain: [
    'Você já mandou disparo em massa e bloquearam seu número?',
    'Já mandou a mesma promoção pro mesmo lead 3 vezes?',
    'Já viu sua base espalhada em planilha, no celular do vendedor e numa ferramenta que ninguém abre?',
  ],
  painClose: 'Marcos resolve isso de uma vez.',
  features: [
    { t: 'Proteção anti-banimento', d: 'Cuida da saúde do número (ritmo de envio, aquecimento) pra você não cair no bloqueio do WhatsApp.' },
    { t: 'Disparo em massa inteligente', d: 'Segmenta por origem, status do funil e cidade. Manda só pra quem importa.' },
    { t: 'Não envia pra quem já recebeu', d: 'Se um lead já entrou na automação, Marcos não reenvia. Sua base não esquenta.' },
    { t: 'Listas com rastreabilidade total', d: 'Cada lista tem nome, data, origem e quantidade.' },
    { t: 'Sincroniza automático com o Pedro', d: 'Lead que chega no Pedro aparece sozinho nas listas do Marcos.' },
    { t: 'CRM ao vivo (Kanban em tempo real)', d: 'Arraste o lead entre etapas. Toda a equipe vê o mesmo funil no mesmo instante.' },
    { t: 'Segmentação por origem e por funil', d: 'Por origem (Porta, Marketplace) e por status (Ausente, Qualificado, Negociação).' },
    { t: 'Filtros antes do disparo', d: 'Antes de enviar, escolhe o recorte exato. Não dispara cego.' },
  ],
  promise: 'Você manda a oferta certa pra pessoa certa, no momento certo — sem queimar contato e sem inflar o número de "mortos" na sua base.',
  paraQuem: 'Empresas que fazem campanhas recorrentes (promoções, lançamentos, recall), gestores de tráfego que precisam reativar base, e times comerciais que querem ver o funil ao vivo.',
  ctaLabel: 'Quero o Marcos no meu CRM',
};

export default function MarcosDetail() {
  return <AgentDetailPage data={MARCOS} />;
}
