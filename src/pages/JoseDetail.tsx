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

  videoId: null,
  videoLegenda: 'Em breve: vídeo gravado pelo Wander mostrando o José na prática.',

  pain: [
    'Você já gastou em anúncio e não soube dizer se deu venda?',
    'Já viu o gestor comemorar "clique barato" enquanto o mês fechou no vermelho?',
    'Já pagou caro por um gestor que sumia quando a campanha precisava de ajuste?',
    'Já recebeu relatório cheio de número que não diz nada do seu negócio?',
  ],
  painClose: 'José resolve isso — pensa no seu fim de mês, não no painel bonito.',

  responsabilidades: [
    {
      titulo: 'Gestão Meta Ads + Google Ads',
      resumo: 'Os dois maiores canais de mídia paga, num operador só. Sem pular de painel, sem trocar de conversa.',
      itens: [
        { t: 'Cria campanha do zero', d: 'Você diz o objetivo (lead, venda, agendamento) — José estrutura campanha, conjuntos e criativos.' },
        { t: 'Conecta com sua conta de anúncio', d: 'Login direto pelo Facebook/Google. Sem colar token, sem dor de cabeça.' },
        { t: 'Várias contas ao mesmo tempo', d: 'Mais de uma loja? Mais de um negócio? José gerencia todas em paralelo.' },
        { t: 'Histórico de mudanças', d: 'Toda alteração fica registrada: o que mudou, quando, e por quê.' },
      ],
    },
    {
      titulo: 'Análise contínua das campanhas',
      resumo: 'José olha as campanhas todo dia. Detecta o que está dando retorno e o que está furando o caixa antes do mês fechar.',
      itens: [
        { t: 'Análise diária automática', d: 'Não precisa pedir relatório. José analisa sozinho e te avisa o que importa.' },
        { t: 'Identifica vencedores', d: 'Campanha rendendo? José aponta — e sugere escalar com mais verba.' },
        { t: 'Identifica perdedores', d: 'Campanha furando caixa? José aponta — e sugere pausar antes de queimar mais dinheiro.' },
        { t: 'Análise de criativo', d: 'Olha qual anúncio (imagem, vídeo, headline) está convertendo e qual não tem fit com seu público.' },
        { t: 'Comparativo de período', d: 'Esse mês vs mês passado, semana vs semana. Mostra a curva, não só o número de hoje.' },
      ],
    },
    {
      titulo: 'Hierarquia da verdade: venda no fim do mês',
      resumo: 'José tem uma régua só: venda real. Lead qualificado vale mais que lead. Lead vale mais que clique. Clique não paga conta.',
      itens: [
        { t: 'Venda no topo da régua', d: 'A métrica que importa é a que entra no caixa. Tudo é ranqueado a partir daí.' },
        { t: 'Lead qualificado em segundo', d: 'Quando ainda não há venda, José olha o lead que o Pedro qualificou — não qualquer lead.' },
        { t: 'Métrica de superfície por último', d: 'CTR alto, CPM barato, alcance grande — bonito no painel, mas só ajuda se virar venda.' },
        { t: 'Custo por venda (CPV) acima de tudo', d: 'Não é "custo por clique". É quanto custou cada venda real que entrou.' },
      ],
    },
    {
      titulo: 'Governança financeira: você aprova',
      resumo: 'José sugere e executa, mas qualquer ação que mexe na sua verba passa por você. Sem surpresa no final do mês.',
      itens: [
        { t: 'Toda ação financeira pede aprovação', d: 'Aumentar orçamento, pausar campanha, mudar lance — você revisa e libera.' },
        { t: 'Análise antes da ação', d: 'José mostra o "porquê" da sugestão. Não é "confie em mim" — é "aqui está o número".' },
        { t: 'Limite de gasto que você define', d: 'Diz pro José até onde pode ir. Ele não passa, mesmo se a campanha parecer boa.' },
        { t: 'Aviso instantâneo de gasto fora da curva', d: 'Se uma campanha está disparando além do normal, você é avisado na hora.' },
      ],
    },
    {
      titulo: 'Atribuição correta: quem trouxe a venda?',
      resumo: 'O lead chegou — mas qual anúncio trouxe? José cruza Meta + Google + WhatsApp pra saber o que está dando retorno.',
      itens: [
        { t: 'Pixel + Conversions API', d: 'A atribuição do Meta funciona pra valer. Sem perder dado quando o navegador bloqueia.' },
        { t: 'CTWA (Click-to-WhatsApp)', d: 'Anúncio que leva pro WhatsApp é trackeado de ponta a ponta — do clique até a venda.' },
        { t: 'Envia conversão pra Meta/Google', d: 'Quando o Pedro qualifica ou fecha uma venda, José manda o sinal pras plataformas otimizarem.' },
        { t: 'Relatório real do funil', d: 'Cliques → conversas → leads qualificados → vendas. O caminho todo, não só o topo.' },
      ],
    },
    {
      titulo: 'Conversa com o Pedro',
      resumo: 'José não trabalha sozinho. Junto com o Pedro, fecha o ciclo: anúncio → atendimento → venda → otimização.',
      itens: [
        { t: 'Lead do José aparece no Pedro', d: 'Quem clicou no anúncio cai no WhatsApp e o Pedro atende sabendo de onde veio.' },
        { t: 'Pedro avisa o José quando fecha', d: 'Venda confirmada? José recebe o sinal e otimiza a campanha que trouxe essa venda.' },
        { t: 'Otimização baseada em venda real', d: 'O Meta/Google aprende com a venda no caixa — não com lead falso de "preencheu formulário".' },
      ],
    },
    {
      titulo: 'Criativo com IA (Apollo)',
      resumo: 'Quando o criativo é o gargalo, o José ajuda com criativo gerado por IA — sob sua aprovação, claro.',
      itens: [
        { t: 'Geração de criativos', d: 'Variações de imagem e copy pra testar — sem você abrir Canva nem chamar designer.' },
        { t: 'Você aprova antes de publicar', d: 'Tudo passa por você. Nenhum criativo vai no ar sem o seu "ok".' },
        { t: 'Testa o que funciona, escala', d: 'Roda em pequena escala primeiro; o que rende, vai pra mais verba. O que não, pausa.' },
      ],
    },
    {
      titulo: 'Relatórios que você entende',
      resumo: 'Sem jargão. Sem painel com 80 colunas. O que está dando retorno e o que está furando o caixa, em linguagem de dono.',
      itens: [
        { t: 'Resumo semanal e mensal', d: 'O que mudou, o que está bombando, o que precisa de atenção. Em parágrafos curtos.' },
        { t: 'Alerta no WhatsApp', d: 'Quando algo importante acontece (campanha disparou, CPV subiu), José avisa direto no seu WhatsApp.' },
        { t: 'Painel simples', d: 'Os 4-5 números que importam. Sem gráfico que ninguém olha.' },
      ],
    },
  ],

  diferenciais: [
    { t: 'Pensa como dono, não como gestor de mídia', d: 'A régua é venda no caixa. Métricas vaidosas ficam pro relatório, não pra decisão.' },
    { t: 'Junto com o Pedro, ciclo fechado', d: 'Anúncio, atendimento, venda e otimização — tudo conversa entre si automaticamente.' },
    { t: 'Você aprova qualquer mexida na verba', d: 'José nunca toma decisão sozinho com seu dinheiro. Sempre passa por você.' },
    { t: 'Atribuição que não mente', d: 'Pixel + CAPI + CTWA: o caminho do clique até a venda fica todo rastreado.' },
  ],

  promise: 'Sua verba de tráfego trabalha pelo que importa — venda no fim do mês — e você aprova cada decisão que mexe no seu dinheiro.',
  paraQuem: 'Quem investe em anúncio no Meta e no Google e quer otimização guiada por venda real, com governança e aprovação das ações financeiras.',
  ctaLabel: 'Quero o José no meu tráfego',
};

export default function JoseDetail() {
  return <AgentDetailPage data={JOSE} />;
}
