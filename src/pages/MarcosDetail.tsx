import { Database } from 'lucide-react';
import { AgentDetailPage, type AgentDetailData } from '@/components/marketing/AgentDetailPage';

const MARCOS: AgentDetailData = {
  origem: 'marcos',
  nome: 'Marcos',
  cor: '#8B5CF6',
  bg: 'rgba(139, 92, 246, 0.10)',
  Icon: Database,
  h1: 'Marcos — disparo em massa que não queima base. CRM que conversa com o WhatsApp.',
  sub: 'Centraliza sua base, dispara campanha sem espalhar, organiza o funil em Kanban ao vivo e cuida da saúde do seu número pra você não cair no banimento.',

  videoId: null,
  videoLegenda: 'Em breve: vídeo gravado pelo Wander mostrando o Marcos na prática.',

  pain: [
    'Você já mandou disparo em massa e bloquearam seu número?',
    'Já mandou a mesma promoção pro mesmo lead 3 vezes?',
    'Já viu sua base espalhada em planilha, no celular do vendedor e numa ferramenta que ninguém abre?',
    'Já fez recall de cliente antigo e descobriu que o número já estava na automação?',
  ],
  painClose: 'Marcos resolve isso de uma vez — disparo, base e CRM no mesmo lugar.',

  responsabilidades: [
    {
      titulo: 'Disparo em massa inteligente',
      resumo: 'Marcos dispara pra quem importa, no ritmo certo, sem repetir lead e sem chamar a atenção do WhatsApp.',
      itens: [
        { t: 'Segmentação antes do disparo', d: 'Filtra por origem (Marketplace, Porta, anúncio), status do funil, cidade, vendedor, data de entrada.' },
        { t: 'Não envia pra quem já recebeu', d: 'Se o lead já entrou nessa automação, Marcos não reenvia. Sua base não esquenta.' },
        { t: 'Mídia + texto na mesma campanha', d: 'Manda imagem, vídeo ou áudio com a mensagem. Sem precisar fazer dois disparos.' },
        { t: 'Programação por data', d: 'Agenda a campanha pra rodar amanhã, domingo, ou na sexta às 9h. Marcos executa sozinho.' },
        { t: 'Pausar e retomar', d: 'Notou que a entrega não foi bem? Pausa, ajusta e retoma do mesmo ponto.' },
        { t: 'Importação manual, planilha ou Pedro', d: 'Escolhe a origem, joga na lista e segue o jogo.' },
      ],
    },
    {
      titulo: 'Proteção anti-banimento (saúde do número)',
      resumo: 'O segredo do disparo não é mandar muito — é mandar do jeito que o WhatsApp não vê como spam. Marcos cuida disso.',
      itens: [
        { t: 'Ritmo de envio variado', d: 'Não dispara tudo em rajada. Espalha no tempo pra simular conversa humana.' },
        { t: 'Rotação entre números (pool)', d: 'Você conecta vários números — Marcos distribui a campanha entre eles pra não sobrecarregar nenhum.' },
        { t: 'Aquecimento de números novos', d: 'Número recém-conectado começa devagar, vai subindo conforme ganha "histórico" no WhatsApp.' },
        { t: 'Detecta sinais de risco', d: 'Mensagem não entregue, contato bloqueando — Marcos pega rápido e segura o disparo do número em risco.' },
        { t: 'Status real do envio', d: 'Você vê quem recebeu, quem leu, quem bloqueou. Sem ficar adivinhando.' },
        { t: 'Limites diários por número', d: 'Cada conexão tem um teto saudável que Marcos respeita — sem você ter que pensar.' },
      ],
    },
    {
      titulo: 'CRM com Kanban ao vivo',
      resumo: 'Sua base toda num funil visual, em tempo real. Arrasta, marca, transfere — toda a equipe vê o mesmo no mesmo instante.',
      itens: [
        { t: 'Colunas configuráveis', d: 'Você cria, renomeia, recolora as etapas do seu funil. Sem programador, sem suporte.' },
        { t: 'Carteira por vendedor', d: 'Vendedor pode ter colunas só dele (carteira). Cada um vê o que importa pra ele.' },
        { t: 'Origens dinâmicas', d: 'Origem nova entra como coluna do Kanban automaticamente. Marketplace, Indicação, Anúncio Meta — tudo organizado.' },
        { t: 'Drag & drop em tempo real', d: 'Arrasta o lead pra outra etapa — sincronia instantânea pra toda a equipe.' },
        { t: 'Filtros + busca', d: 'Acha o lead por nome, telefone, cidade, status. Em um clique.' },
        { t: 'Painel ao Vivo (DashboardTV)', d: 'TV na loja mostrando o funil em tempo real, com origens, vendedores e métricas.' },
      ],
    },
    {
      titulo: 'Sincronia total com o Pedro',
      resumo: 'Lead que o Pedro qualifica entra no Marcos sem você apertar nada. Lead que o Marcos importa pode virar conversa do Pedro.',
      itens: [
        { t: 'Pedro alimenta o Marcos', d: 'Toda conversa qualificada pelo Pedro chega no CRM do Marcos com etiqueta, status e origem.' },
        { t: 'Marcos alimenta o Pedro', d: 'Lead importado por planilha vira contato do Pedro — pronto pra receber a próxima campanha ou mensagem.' },
        { t: 'Histórico unificado', d: 'Cada lead tem um histórico só, do primeiro "oi" até a venda fechada. Sem dois sistemas, sem duplicar.' },
        { t: 'CTWA — atribuição de anúncio', d: 'Lead que veio de anúncio do Facebook é marcado com qual anúncio o trouxe. Você vê o que está convertendo.' },
      ],
    },
    {
      titulo: 'Gestão da base e listas',
      resumo: 'Sua base é o seu ativo. Marcos trata como ativo.',
      itens: [
        { t: 'Listas com rastreabilidade total', d: 'Cada lista tem nome, data, origem e quantidade. Você sabe o que tem na mão.' },
        { t: 'Deduplicação automática', d: 'Lead repetido em duas listas? Marcos identifica e não trata como dois.' },
        { t: 'Importação por planilha', d: 'Sobe um Excel/CSV, mapeia as colunas e pronto. Sem retrabalho.' },
        { t: 'Exportação fácil', d: 'Precisa levar a base pra outro lugar? Exporta filtrada — só os leads que importam.' },
        { t: 'Sanitização dos contatos', d: 'Marcos limpa duplicatas, formatos errados e contatos inválidos antes de você disparar.' },
        { t: 'Tags e segmentos', d: 'Marca leads com etiquetas (VIP, frio, retorno em 30 dias) e usa nos próximos disparos.' },
      ],
    },
    {
      titulo: 'Equipe e permissões',
      resumo: 'Cada vendedor enxerga só o que precisa enxergar. Sem confusão, sem lead "vazando" pra todo mundo.',
      itens: [
        { t: 'Modelo matriz: vendedor em vários agentes', d: 'Um vendedor pode atender no Pedro de duas lojas diferentes, com chave on/off por agente.' },
        { t: 'Gerente x vendedor', d: 'Gerente vê tudo da conta; vendedor vê só os leads dele. Permissões controladas no portal.' },
        { t: 'Lead muda de mão com histórico', d: 'Transferência manual mantém todo o histórico — quem atendeu antes, o que foi dito.' },
      ],
    },
    {
      titulo: 'Conexões oficiais e seguras',
      resumo: 'Você escolhe como conectar. As duas vias funcionam — e o cliente nunca sabe qual.',
      itens: [
        { t: 'WhatsApp Cloud API oficial (Meta)', d: 'Login direto no Facebook, sem QR Code. Conexão homologada, número 100% seu.' },
        { t: 'Conexão por QR Code (UAZAPI)', d: 'Para quem prefere a via tradicional. Mesmo nível de funcionalidade.' },
        { t: 'Várias conexões ao mesmo tempo', d: 'Conecte 5, 10, 15 números — todos rodando no pool de disparo e atendimento.' },
        { t: 'Vendedor com WhatsApp próprio', d: 'Vendedor conecta o número dele pro atendimento manual; o Pedro não responde por ele.' },
      ],
    },
  ],

  diferenciais: [
    { t: 'Disparo + CRM no mesmo lugar', d: 'Você não pula entre ferramenta de disparo, planilha e CRM. Tudo numa tela só.' },
    { t: 'Saúde do número primeiro', d: 'Marcos prefere mandar menos hoje pra você não perder o número amanhã.' },
    { t: 'Kanban ao vivo', d: 'A equipe inteira vê a mesma realidade no mesmo segundo. Sem "deixa eu atualizar a planilha".' },
    { t: 'Conversa com o Pedro de verdade', d: 'Não é "integração" — é o mesmo sistema. Lead que chega num, aparece no outro instantaneamente.' },
  ],

  promise: 'Você manda a oferta certa pra pessoa certa, no momento certo — sem queimar contato e sem inflar o número de "mortos" na sua base.',
  paraQuem: 'Empresas que fazem campanhas recorrentes (promoções, lançamentos, recall), gestores de tráfego que precisam reativar base, e times comerciais que querem ver o funil ao vivo.',
  ctaLabel: 'Quero o Marcos no meu CRM',
};

export default function MarcosDetail() {
  return <AgentDetailPage data={MARCOS} />;
}
