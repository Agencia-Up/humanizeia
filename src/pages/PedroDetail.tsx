import { MessageSquare } from 'lucide-react';
import { AgentDetailPage, type AgentDetailData } from '@/components/marketing/AgentDetailPage';

const PEDRO: AgentDetailData = {
  origem: 'pedro',
  nome: 'Pedro',
  cor: '#16A34A',
  bg: 'rgba(22, 163, 74, 0.10)',
  Icon: MessageSquare,
  h1: 'Pedro — o atendente que nunca dorme, nunca esquece, nunca deixa um lead esfriar.',
  sub: 'Atende, qualifica, consulta estoque e entrega o lead pronto pro time. Não é um chatbot — é um vendedor de verdade, treinado pra fechar.',

  // Vídeo: deixa null por enquanto. Quando gravar, troca pelo ID do YouTube
  // (ex.: 'abc123XYZ'). Sem URL, a página mostra o placeholder "Em breve".
  videoId: null,
  videoLegenda: 'Em breve: vídeo gravado pelo Wander mostrando o Pedro na prática.',

  pain: [
    'Você já perdeu venda porque o lead mandou mensagem às 22h e ninguém respondeu?',
    'Já passou um lead "quente" pro vendedor e descobriu que era só curioso?',
    'Já viu sua equipe gastar 80% do tempo respondendo perguntas básicas em vez de fechar?',
    'Já contou quantos leads ficaram sem follow-up no fim do dia?',
  ],
  painClose: 'Pedro acaba com isso — todos esses problemas, ao mesmo tempo.',

  responsabilidades: [
    {
      titulo: 'Atendimento no WhatsApp 24/7',
      resumo: 'O Pedro responde toda mensagem em segundos, todo dia, toda hora. Não importa se é 3h da manhã, feriado ou domingo.',
      itens: [
        { t: 'Primeiro contato em segundos', d: 'Resposta imediata pro lead — sem fila de espera, sem "vou te chamar mais tarde".' },
        { t: 'Conversa humanizada', d: 'Fala como pessoa, não como robô. Quebra mensagens, espera o lead terminar, usa o nome dele.' },
        { t: 'Entende áudio', d: 'O lead mandou áudio? Pedro escuta e entende — não exige que digite tudo de novo.' },
        { t: 'Entende foto do carro', d: 'Lead manda foto de um veículo querendo saber se você tem igual? Pedro reconhece e responde.' },
        { t: 'Conversa em vários números ao mesmo tempo', d: 'Sua operação tem 5, 10, 15 números do WhatsApp? Pedro atende em todos.' },
        { t: 'WhatsApp oficial ou QR Code', d: 'Você escolhe: API oficial do Meta (homologada) ou conexão por QR Code. Os dois funcionam.' },
      ],
    },
    {
      titulo: 'Qualificação cirúrgica com suas regras',
      resumo: 'Pedro pergunta o que importa, do jeito que você define. Lead que não tem fit, ele identifica antes de gastar o tempo do vendedor.',
      itens: [
        { t: 'Regras configuradas por você', d: 'Forma de pagamento, valor de entrada, prazo, CPF, score, e qualquer critério do seu negócio.' },
        { t: 'Identifica curioso', d: 'Distingue interesse real de quem só está perguntando — protege o tempo do seu time comercial.' },
        { t: 'Classifica em tempo real', d: 'Cada lead vai pro CRM marcado como Qualificado, Pouco qualificado, Ausente ou Carro não disponível.' },
        { t: 'Consulta estoque ao vivo (BNDV)', d: 'Responde sobre veículos disponíveis com autoridade — preço, ano, km, opcionais — direto da sua base.' },
        { t: 'Identifica origem do lead', d: 'Marketplace do Facebook, OLX, Mercado Livre, anúncio do Instagram, porta da loja, indicação.' },
        { t: 'Identifica cidade e região', d: 'Etiqueta colorida no lead — vendedor vê de cara se é local, da região ou de fora.' },
        { t: 'Lembra cada conversa', d: 'Lead voltou depois de uma semana? Pedro retoma de onde parou, sem se reapresentar.' },
      ],
    },
    {
      titulo: 'Distribuição justa pro time comercial',
      resumo: 'Quando o lead está pronto, Pedro entrega pra um vendedor específico — com briefing pronto e regras de rodízio que você definiu.',
      itens: [
        { t: 'Rodízio (round-robin) entre os vendedores', d: 'Cada lead vai pra um vendedor diferente, respeitando ordem da fila e quem estava livre.' },
        { t: 'Briefing pronto pro vendedor', d: 'Junto com o lead vai um resumo: o que ele quer, urgência, perfil, dica de abordagem.' },
        { t: 'Vendedor responsável por agente', d: 'Cada vendedor pode atender só os agentes em que está ativo (modelo matriz).' },
        { t: 'Responsável padrão por etapa', d: 'Você pode definir um vendedor padrão por coluna do CRM (ex.: "Negociação" sempre cai com fulano).' },
        { t: 'Cota e horário respeitados', d: 'Pedro entende o expediente: lead fora do horário fica reservado, não é repassado de madrugada.' },
        { t: 'Distribuição manual ou por planilha', d: 'Quando você precisa, importa lead direto, escolhe o vendedor e o Pedro abre a conversa.' },
      ],
    },
    {
      titulo: 'Transferência com confirmação e timeout',
      resumo: 'O lead foi entregue pro vendedor — mas só vira "do vendedor" depois que ele confirma. Se não confirmar, Pedro repassa pro próximo.',
      itens: [
        { t: 'Confirmação por "Ok"', d: 'Vendedor recebe a notificação e responde "Ok" pra assumir. Sem isso, o lead não é dele.' },
        { t: 'Timeout configurável', d: 'Você define o tempo: 5, 10, 15 minutos. Se o vendedor não confirma, vai pro próximo da fila.' },
        { t: 'Janela de horário comercial', d: 'Repasse só acontece dentro do horário definido. Lead da madrugada fica com o vendedor de plantão.' },
        { t: 'Vendedor recebe um lead, perdeu o lead', d: 'Mensagem clara: "Esse lead foi passado pro próximo — não entre em contato".' },
        { t: 'Histórico completo do repasse', d: 'Você vê quem recebeu, quem confirmou, quem deixou passar, com data e hora.' },
      ],
    },
    {
      titulo: 'Feedback ao gerente em tempo real',
      resumo: 'O gerente sabe na hora o que está acontecendo. Sem precisar perguntar pro time, sem precisar abrir planilha.',
      itens: [
        { t: 'Mensagem ao gerente em cada transferência', d: 'Gerente recebe um aviso curto: lead X foi pra fulano, com motivo e resumo.' },
        { t: 'Mensagem personalizável', d: 'Aba "Mensagens" do agente: você customiza o texto que vai pro vendedor e pro gerente.' },
        { t: 'Aviso de problema', d: 'Vendedor não respondeu, lead esfriou, agente sem crédito — o gerente é avisado direto.' },
        { t: 'Painel "Saúde dos agentes"', d: 'Visão geral pro dono: agentes com alerta, alucinação barrada, anúncio perdido — em 24h ou 7 dias.' },
        { t: 'Lead reativado, gerente sabe', d: 'Quando o ciclo de reativação volta a falar com um lead antigo, o gerente é notificado.' },
      ],
    },
    {
      titulo: 'Follow-up automático e reativação',
      resumo: 'Lead que não respondeu não morre. Pedro cuida — no tempo certo, com a mensagem certa, sem incomodar.',
      itens: [
        { t: 'Follow-up em 3 tempos (5/8/12 min, configurável)', d: 'Lead não respondeu? Pedro reengaja sozinho, antes do calor da conversa esfriar.' },
        { t: 'Reativação com ciclo de fila justo', d: 'Não repete o mesmo lead direto. Só volta a falar com ele depois que a fila inteira passou.' },
        { t: 'Mensagens diferentes por contexto', d: 'Lead novo, lead reativado, lead que travou na negociação — cada um recebe a mensagem certa.' },
        { t: 'Para quando vira venda ou recusa', d: 'Lead virou cliente ou disse "comprei em outro lugar"? Pedro para de mandar mensagem.' },
      ],
    },
    {
      titulo: 'CRM Kanban configurável e ao vivo',
      resumo: 'Cada lead que o Pedro qualifica entra no Kanban — em tempo real, com cor, etiqueta e responsável.',
      itens: [
        { t: 'Colunas que VOCÊ define', d: 'Crie, renomeie, recolora as etapas do seu funil. As 7 colunas do motor ficam protegidas.' },
        { t: 'Colunas por vendedor', d: 'Vendedor pode ter sua própria carteira (coluna que só ele vê) sem misturar com o time.' },
        { t: 'Painel ao Vivo (DashboardTV)', d: 'TV na loja mostrando leads chegando, vendedores no rodízio e métricas em tempo real.' },
        { t: 'Origens dinâmicas', d: 'Origem nova (campanha, indicação) vira coluna do Kanban sem programador.' },
        { t: 'Drag & drop', d: 'Toda equipe vê o mesmo funil no mesmo instante. Arrasta o lead e pronto.' },
      ],
    },
    {
      titulo: 'Métricas e auditoria do seu jeito',
      resumo: 'Você é dono — então enxerga tudo. Quanto cada agente conversa, quanto custa, onde tem problema.',
      itens: [
        { t: 'Conversas por agente', d: 'Quantos turnos, quantos leads, qual o ritmo. Por dia, semana e mês.' },
        { t: 'Custo real de IA', d: 'Quanto cada conversa custou. Por agente, por modelo, por provedor (OpenAI, DeepSeek, Anthropic).' },
        { t: 'Alertas de saúde', d: 'Fotos sem pedir, anúncio perdido, sem chave de IA, falha do provedor — tudo pego antes do cliente reclamar.' },
        { t: 'Rede de segurança ("alucinação barrada")', d: 'Quando o Pedro estaria pra falar coisa errada, o validador pega e corrige antes de mandar.' },
      ],
    },
  ],

  diferenciais: [
    { t: 'Não é chatbot genérico', d: 'Pedro foi feito pra atendimento de vendas no Brasil, com regras configuráveis e conhecimento do estoque real.' },
    { t: 'Multi-provedor com failover', d: 'Se a OpenAI falha, cai pro DeepSeek; se cair, cai pro Anthropic. Lead nunca fica sem resposta.' },
    { t: 'Sua chave de IA, seu controle', d: 'Você pode trazer sua própria chave (BYOK) — sem cota, sem limite, custo direto na sua conta.' },
    { t: 'Anti-grupo, anti-spam', d: 'Pedro não responde em grupo, não conversa com canal de difusão e não cai em phishing.' },
  ],

  promise: 'Enquanto seus concorrentes ainda estão lendo a mensagem do cliente, o seu lead já foi atendido, qualificado e está no CRM — pronto pro vendedor fechar.',
  paraQuem: 'Lojas físicas, concessionárias, imobiliárias e qualquer operação que recebe lead por WhatsApp, qualifica antes de transferir e quer rodízio justo entre vendedores.',
  ctaLabel: 'Quero o Pedro atendendo',
};

export default function PedroDetail() {
  return <AgentDetailPage data={PEDRO} />;
}
