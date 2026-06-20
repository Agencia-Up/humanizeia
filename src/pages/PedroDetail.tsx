import { MessageSquare } from 'lucide-react';
import { AgentDetailPage, type AgentDetailData } from '@/components/marketing/AgentDetailPage';

const PEDRO: AgentDetailData = {
  origem: 'pedro',
  nome: 'Pedro',
  cor: '#16A34A',
  bg: 'rgba(22, 163, 74, 0.10)',
  Icon: MessageSquare,
  h1: 'Pedro — o atendente que nunca dorme, nunca esquece, nunca deixa um lead esfriar.',
  sub: 'Atendimento humano. Velocidade de máquina. Qualificação cirúrgica.',
  pain: [
    'Você já perdeu venda porque o lead mandou mensagem às 22h e ninguém respondeu?',
    'Já passou um lead "quente" pro vendedor e descobriu que era só curioso?',
    'Já viu sua equipe gastar 80% do tempo respondendo perguntas básicas em vez de fechar negócio?',
  ],
  painClose: 'Pedro acaba com isso.',
  features: [
    { t: 'Atende 24/7 no seu WhatsApp', d: 'Primeiro contato em segundos, todo dia, toda hora — sem fim de semana, sem feriado.' },
    { t: 'Qualifica com as regras que você definir', d: 'Forma de pagamento, entrada, prazo, e qualquer critério do seu negócio.' },
    { t: 'Classifica automaticamente no CRM', d: 'Cada lead entra marcado como Qualificado, Pouco qualificado ou Ausente.' },
    { t: 'Sabe a hora certa de transferir', d: 'Se o lead não responde, espera, reengaja e só então passa pro vendedor — no horário de expediente.' },
    { t: 'Entrega o lead com briefing pronto', d: 'Quando transfere, o vendedor já recebe um resumo da conversa.' },
    { t: 'Não se reapresenta', d: 'Pedro lembra cada conversa. O cliente não recebe "oi, sou o Pedro" duas vezes.' },
    { t: 'Consulta o estoque (BNDV)', d: 'Responde sobre os veículos disponíveis com autoridade, direto da sua base.' },
    { t: 'Distribui no rodízio do time', d: 'Round-robin justo entre os vendedores, respeitando o horário de atendimento.' },
    { t: 'Aceita lead manual e por planilha', d: 'Importação rápida, sem retrabalho e sem duplicar contato.' },
  ],
  promise: 'Enquanto seus concorrentes ainda estão lendo a mensagem do cliente, o seu lead já foi atendido, qualificado e está no CRM — pronto pro vendedor fechar.',
  paraQuem: 'Lojas físicas, concessionárias, imobiliárias, e qualquer operação que recebe lead por WhatsApp e precisa qualificar antes de transferir.',
  ctaLabel: 'Quero o Pedro atendendo',
};

export default function PedroDetail() {
  return <AgentDetailPage data={PEDRO} />;
}
