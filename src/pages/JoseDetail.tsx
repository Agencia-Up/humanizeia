import { Target } from 'lucide-react';
import { AgentDetailPage, type AgentDetailData } from '@/components/marketing/AgentDetailPage';

const JOSE: AgentDetailData = {
  origem: 'jose',
  nome: 'José',
  cor: '#E65100',
  bg: 'rgba(230, 81, 0, 0.10)',
  Icon: Target,
  h1: 'José — o gestor de tráfego que pensa como dono.',
  sub: 'Cria, analisa e otimiza campanhas no Meta e no Google. Decide pelo que importa: venda no fim do mês, não clique barato.',
  pain: [
    'Você já gastou em anúncio e não soube dizer se deu venda?',
    'Já viu o gestor comemorar "clique barato" enquanto o mês fechou no vermelho?',
    'Já pagou caro por um gestor que sumia quando a campanha precisava de ajuste?',
  ],
  painClose: 'José resolve isso.',
  features: [
    { t: 'Meta + Google Ads num lugar só', d: 'Cria, analisa e otimiza campanhas nas duas maiores plataformas, sem você pular de painel.' },
    { t: 'Hierarquia da verdade', d: 'Decide por venda no fim do mês > lead qualificado > métrica de superfície. Clique barato não paga conta.' },
    { t: 'Governança: você aprova', d: 'José sugere e executa, mas toda ação que mexe na sua verba passa pela sua aprovação.' },
    { t: 'Otimização contínua', d: 'Acompanha as campanhas todo dia e aponta o que pausar, escalar ou ajustar.' },
    { t: 'Pensa como dono', d: 'Olha o resultado real do negócio, não a vaidade do painel.' },
    { t: 'Relatórios que você entende', d: 'Sem jargão: o que está dando retorno e o que está furando o caixa.' },
  ],
  promise: 'Sua verba de tráfego trabalha pelo que importa — venda no fim do mês — e você aprova cada decisão que mexe no seu dinheiro.',
  paraQuem: 'Quem investe em anúncio no Meta e no Google e quer otimização guiada por venda real, com governança e aprovação das ações financeiras.',
  ctaLabel: 'Quero o José no meu tráfego',
};

export default function JoseDetail() {
  return <AgentDetailPage data={JOSE} />;
}
