// AI Academy - Conteúdo Completo de IA para Meta Ads

export interface Lesson {
  id: string;
  title: string;
  duration: string;
  type: 'video' | 'text' | 'exercise' | 'checklist';
  content: string; // markdown
  keyTakeaways: string[];
  proTips?: string[];
}

export interface AcademyModule {
  id: string;
  number: number;
  name: string;
  description: string;
  icon: string;
  level: 'Iniciante' | 'Intermediário' | 'Avançado';
  duration: string;
  lessons: Lesson[];
  locked: boolean;
}

export interface AcademyChecklist {
  id: string;
  title: string;
  category: string;
  items: { id: string; text: string; checked: boolean }[];
}

export interface AcademyPrompt {
  id: string;
  category: string;
  title: string;
  description: string;
  prompt: string;
  uses: number;
  platform: 'meta' | 'both';
}

// ═══════════════════════════════════════════════════════════
// MÓDULOS E AULAS
// ═══════════════════════════════════════════════════════════

export const academyModules: AcademyModule[] = [
  {
    id: 'mod-1',
    number: 1,
    name: 'Fundamentos de IA em Tráfego Pago',
    description: 'Entenda como a IA está revolucionando o marketing digital e as bases para dominar as ferramentas.',
    icon: '🧠',
    level: 'Iniciante',
    duration: '2h 30min',
    locked: false,
    lessons: [
      {
        id: 'mod1-l1',
        title: 'O que é IA aplicada a Mídia Paga',
        duration: '20min',
        type: 'text',
        content: `## O que é IA aplicada a Mídia Paga

A Inteligência Artificial em mídia paga não é mais o futuro — **é o presente**. O Meta já utiliza IA em praticamente todas as etapas da gestão de anúncios.

### Como a IA já funciona nos bastidores

**No Meta Ads:**
- O **algoritmo de entrega** decide para quem mostrar seu anúncio usando machine learning
- O **Advantage+ Audience** expande seus públicos automaticamente
- O **Advantage+ Creative** testa variações de criativos em tempo real
- O **Advantage+ Shopping Campaigns (ASC)** automatiza toda a estrutura de campanha

### O papel do gestor de tráfego na era da IA

> A IA faz o trabalho pesado de otimização. Seu papel é ser o **estrategista** — definir objetivos, criar criativos que convertem, e tomar decisões que a IA não consegue.

**O que a IA faz melhor que humanos:**
- Processar milhões de sinais em milissegundos
- Ajustar lances 24/7 sem fadiga
- Testar combinações de criativos em escala
- Identificar padrões em dados complexos

**O que VOCÊ faz melhor que a IA:**
- Definir a estratégia de negócio
- Criar messaging que gera conexão emocional
- Entender o contexto do mercado e da concorrência
- Tomar decisões criativas com base em intuição + dados`,
        keyTakeaways: [
          'IA já está presente em todas as etapas do Meta Ads',
          'Seu papel é ser estrategista, não operador manual',
          'O Meta usa IA para otimizar entrega, públicos e criativos',
          'O gestor que domina IA tem vantagem competitiva massiva',
        ],
      },
      {
        id: 'mod1-l2',
        title: 'Machine Learning vs Regras: Como Pensar Diferente',
        duration: '25min',
        type: 'text',
        content: `## Machine Learning vs Regras Manuais

### A mentalidade antiga (baseada em regras)
\`\`\`
SE CPA > R$80 → pausar campanha
SE CTR < 1% → trocar criativo
SE frequência > 3 → trocar público
\`\`\`

Essa abordagem funciona, mas é **reativa e limitada**. Você só reage depois que o problema já aconteceu.

### A mentalidade nova (baseada em ML)

O Machine Learning trabalha com **probabilidades e sinais**:

1. **Fase de Aprendizado**: O algoritmo coleta dados (mínimo 50 conversões em 7 dias no Meta)
2. **Otimização**: O modelo identifica padrões e otimiza a entrega
3. **Escala**: Com dados suficientes, o algoritmo toma decisões superiores a qualquer humano

### Como alimentar o algoritmo corretamente

| Ação | ❌ Errado | ✅ Correto |
|------|-----------|------------|
| Orçamento | Mudar drasticamente todo dia | Aumentar 20-30% a cada 3-5 dias |
| Públicos | Micro-segmentar em 50 ad sets | Consolidar em 3-5 ad sets broad |
| Conversões | Otimizar para cliques | Otimizar para evento mais próximo da compra |
| Criativos | 1-2 criativos por ad set | 4-6 criativos variados por ad set |
| Edições | Editar campanha 5x por dia | Esperar 3-5 dias antes de qualquer mudança |

### A regra de ouro do ML em ads

> **Quanto mais dados de qualidade você dá ao algoritmo, e quanto menos você interfere durante o aprendizado, melhor ele performa.**

Isso significa:
- **Consolidar** conversões em menos campanhas
- **Simplificar** estruturas de conta
- **Confiar** no algoritmo após o período de aprendizado
- **Alimentar** com criativos de qualidade constantemente`,
        keyTakeaways: [
          'ML supera regras manuais quando alimentado com dados suficientes',
          'Respeite a fase de aprendizado: 50 conversões em 7 dias',
          'Consolide campanhas para dar mais dados ao algoritmo',
          'Menos interferência manual = melhor performance',
        ],
        proTips: [
          'Use o evento de otimização mais próximo da compra (Purchase > Add to Cart > View Content)',
        ],
      },
      {
        id: 'mod1-l3',
        title: 'Métricas Essenciais na Era da IA',
        duration: '30min',
        type: 'text',
        content: `## Métricas que Importam na Era da IA

### Hierarquia de Métricas MIDAS

**Nível 1 — Métricas Mestre (Visão do Dono)**
- **MER (Marketing Efficiency Ratio)**: Faturamento Total ÷ Investimento Total em Ads
- **nCPA (New Customer CPA)**: Custo por Novo Cliente
- **LTV/CAC**: Lifetime Value ÷ Customer Acquisition Cost
- **Blended ROAS**: ROAS considerando TODOS os canais (não só last-click)

**Nível 2 — Métricas de Canal (Gestor)**
- **ROAS por canal**: Meta e demais canais separadamente
- **CPA por canal**: Comparar eficiência de aquisição
- **Budget Share**: % do investimento em cada canal

**Nível 3 — Métricas de Funil (Analista)**
| Etapa | Métrica | Benchmark |
|-------|---------|-----------|
| Impressão | CPM | R$15-40 (Meta) |
| Atenção | CTR | 1-2% (Meta Feed) |
| Clique | CPC | R$0.30-2.00 (Meta) |
| Engajamento | Add to Cart Rate | 5-15% |
| Conversão | Conv. Rate | 1-4% (e-commerce) |
| Compra | CPA | R$25-80 (depende do ticket) |
| Retorno | ROAS | 3x+ (mínimo), 5x+ (saudável) |

**Nível 4 — Métricas de Criativo (Creative Strategist)**
- **Hook Rate**: % que assistiu 3s+ do vídeo (bom: >30%)
- **Thumb-Stop Rate**: % que parou de scrollar (bom: >25%)
- **Hold Rate**: % que assistiu 50%+ do vídeo
- **CTR por criativo**: Identificar vencedores/perdedores

### Benchmarks MIDAS para Semáforo

| Métrica | 🟢 Escalar | 🟡 Ajustar | 🔴 Pausar |
|---------|-----------|-----------|----------|
| CPA | ≤ Meta | Meta → Meta+30% | > Meta+30% |
| CTR (Meta) | > 1.4% | 0.8-1.4% | < 0.8% |
| ROAS | > 3x | 2-3x | < 2x |
| Frequência | < 2 | 2-3 | > 3 |
| CPM | < R$25 | R$25-40 | > R$40 |`,
        keyTakeaways: [
          'MER é a métrica mais importante — visão holística do negócio',
          'Cada nível de métrica serve para um tipo de decisão diferente',
          'Use o sistema de semáforo para priorizar ações',
          'Hook Rate e Thumb-Stop Rate são as métricas que mais impactam CPA',
        ],
      },
      {
        id: 'mod1-l4',
        title: 'Estrutura de Conta Moderna: Simplificar para Escalar',
        duration: '25min',
        type: 'text',
        content: `## Estrutura de Conta na Era da IA

### A evolução da estrutura de conta

**2018-2020 (Era Manual):**
\`\`\`
Campanha 1: Lookalike 1%
  - Ad Set 1: Interesses A
  - Ad Set 2: Interesses B
  - Ad Set 3: Interesses C
Campanha 2: Lookalike 3%
  ... (20+ ad sets)
\`\`\`
❌ Fragmentação excessiva, orçamento diluído, dados insuficientes por ad set.

**2024-2025 (Era da IA):**
\`\`\`
Campanha 1: ESCALA (Advantage+ / PMax)
  - 1 Ad Set: Broad / Open targeting
  - 4-6 Criativos variados
Campanha 2: RETARGETING
  - 1 Ad Set: Custom audiences + Advantage+
  - 3-4 Criativos específicos
Campanha 3: TESTE
  - 1 Ad Set: CBO com criativos novos
  - 3-5 Criativos para teste
\`\`\`
✅ Estrutura consolidada, máximo de dados para o algoritmo.

### Framework MIDAS de Estrutura

**Meta Ads — Estrutura 3-2-1:**
1. **1 Campanha ASC (Advantage+ Shopping)** — 60-70% do budget
2. **1 Campanha Manual TOF** — 20-30% do budget (Broad targeting)
3. **1 Campanha Retargeting** — 10-15% do budget

### Regras de transição

| Sinal | Ação |
|-------|------|
| Campanha nova com < 50 conversões | Manter estrutura, não editar |
| CPA estável por 5+ dias | Pode escalar 20% |
| CPA subindo por 3+ dias | Revisar criativos, não mexer na estrutura |
| Criativo com CTR > 2x média | Isolar em ad set separado para escalar |`,
        keyTakeaways: [
          'Menos campanhas = mais dados = melhor algoritmo',
          'Use a estrutura 3-2-1 no Meta Ads',
          'ASC deve receber a maior parte do budget',
          'Nunca fragmente em micro-segmentações',
        ],
      },
      {
        id: 'mod1-l5',
        title: 'O Funil de IA: Do Primeiro Toque à Conversão',
        duration: '25min',
        type: 'text',
        content: `## Funil de Conversão Alimentado por IA

### Funil Moderno vs Funil Tradicional

O funil tradicional (TOFU → MOFU → BOFU) está sendo substituído pelo **Funil Inteligente**, onde a IA decide o momento certo de mostrar cada tipo de conteúdo.

### Funil MIDAS em 4 Fases

**Fase 1: DESCOBERTA (IA controla a distribuição)**
- Objetivo: Máxima exposição qualificada
- Canal: Meta (Reels, Stories), TikTok, YouTube Shorts
- Criativo: UGC, unboxing, review, antes/depois
- Métrica-chave: Hook Rate, CPM, Thumb-Stop Rate
- IA: Advantage+ Audience + Broad targeting

**Fase 2: CONSIDERAÇÃO (IA qualifica o interesse)**
- Objetivo: Engajar quem demonstrou interesse
- Canal: Meta (Feed, Stories)
- Criativo: Comparação, tutorial, depoimento detalhado
- Métrica-chave: CTR, CPC, Add to Cart Rate
- IA: Advantage+ Creative testa variações automaticamente

**Fase 3: DECISÃO (IA fecha a venda)**
- Objetivo: Converter intenção em compra
- Canal: Retargeting Meta, Email
- Criativo: Oferta direta, escassez, prova social
- Métrica-chave: Conv. Rate, CPA, ROAS
- IA: Otimiza para conversão final

**Fase 4: RETENÇÃO (IA fideliza)**
- Objetivo: Recompra e LTV
- Canal: Email, WhatsApp, Custom Audiences
- Criativo: Cross-sell, up-sell, exclusividade
- Métrica-chave: LTV, Repeat Purchase Rate
- IA: Lookalike dos melhores clientes

### Como configurar o tracking correto

Para o funil funcionar, **o pixel precisa estar configurado corretamente**:

\`\`\`
Meta Pixel Events (em ordem de prioridade):
1. Purchase (conversão final) ← otimize para este
2. InitiateCheckout
3. AddToCart
4. ViewContent
5. PageView
\`\`\`

> **Dica MIDAS**: Sempre otimize para o evento mais próximo da compra que tenha volume suficiente (50+/semana).`,
        keyTakeaways: [
          'O funil moderno é controlado pela IA, não por segmentação manual',
          'Cada fase tem criativos, métricas e configurações diferentes',
          'O tracking correto é FUNDAMENTAL para o algoritmo funcionar',
          'Otimize sempre para o evento mais próximo da compra com volume',
        ],
      },
      {
        id: 'mod1-l6',
        title: 'Quiz: Teste seus Fundamentos',
        duration: '15min',
        type: 'exercise',
        content: `## Quiz — Fundamentos de IA em Tráfego Pago

Teste seus conhecimentos sobre os conceitos aprendidos neste módulo.

### Pergunta 1
**Qual é o número mínimo de conversões que o Meta Ads precisa em 7 dias para sair da fase de aprendizado?**

a) 25 conversões
b) 50 conversões ✅
c) 100 conversões
d) Não existe mínimo

### Pergunta 2
**Quando o CPA da campanha sobe por 3 dias consecutivos, qual é a ação correta?**

a) Pausar a campanha imediatamente
b) Reduzir o orçamento pela metade
c) Revisar os criativos sem mexer na estrutura ✅
d) Criar 10 novos ad sets com públicos diferentes

### Pergunta 3
**Qual é a estrutura de conta recomendada pelo Framework MIDAS para Meta Ads?**

a) 10 campanhas com micro-segmentação
b) Estrutura 3-2-1: ASC + Manual TOF + Retargeting ✅
c) Uma única campanha com todos os públicos
d) Separar por gênero e idade

### Pergunta 4
**O que é MER (Marketing Efficiency Ratio)?**

a) O ROAS de uma campanha específica
b) O CPA médio de todos os canais
c) Faturamento Total ÷ Investimento Total em Ads ✅
d) Lucro líquido ÷ Investimento

### Pergunta 5
**Qual é o Hook Rate considerado BOM para vídeos de anúncio?**

a) Acima de 10%
b) Acima de 20%
c) Acima de 30% ✅
d) Acima de 50%`,
        keyTakeaways: [
          'Revisar conceitos-chave de cada aula',
          'Fixar benchmarks e métricas na memória',
        ],
      },
    ],
  },
  {
    id: 'mod-3',
    number: 2,
    name: 'IA Nativa do Meta Ads',
    description: 'Domine Advantage+, ASC, Advantage+ Creative e todas as automações do Meta.',
    icon: '📱',
    level: 'Intermediário',
    duration: '4h',
    locked: false,
    lessons: [
      {
        id: 'mod3-l1',
        title: 'Advantage+ Shopping Campaigns (ASC)',
        duration: '35min',
        type: 'text',
        content: `## Advantage+ Shopping Campaigns — O Melhor do Meta Ads

### O que é ASC?
ASC (Advantage+ Shopping Campaigns) é o tipo de campanha mais automatizado do Meta. A IA controla:
- **Targeting**: público aberto, sem segmentação manual
- **Posicionamento**: todos os placements automaticamente
- **Otimização de criativos**: testa variações e distribui budget para os vencedores
- **Lances**: otimiza para conversão em tempo real

### Por que ASC é a campanha #1 para e-commerce

1. **Mais dados para o algoritmo**: Sem fragmentação de públicos
2. **Fase de aprendizado mais rápida**: Consolida todas as conversões
3. **Budget líquido**: O dinheiro vai para onde converte mais
4. **Escala horizontal**: Adicione criativos e a IA distribui

### Configuração Passo a Passo

**Step 1: Criar campanha ASC**
- Objetivo: Sales
- Tipo: Advantage+ Shopping Campaign
- Orçamento: Mínimo R$150/dia (ideal R$300+/dia)
- Pixel: Otimizar para Purchase

**Step 2: Configurar Existing Customer Budget Cap**
- Defina 20-30% como cap para clientes existentes
- Isso garante que 70-80% do budget vai para aquisição
- Upload sua lista de clientes para o Meta identificar

**Step 3: Adicionar criativos**
- Mínimo 4 criativos, ideal 6-10
- Variedade: vídeo UGC, carrossel, imagem estática, stories
- Deixe a IA testar — não force criativos em audiences específicas

**Step 4: Configurar atribuição**
- 7-day click + 1-day view (padrão e recomendado)
- Para ticket alto: 7-day click only

### Regras de otimização pós-lançamento

| Dia | Ação |
|-----|------|
| 1-7 | NÃO TOQUE. Fase de aprendizado. |
| 7-14 | Avalie CPA e ROAS. Se dentro da meta, continue. |
| 14+ | Adicione 2-3 novos criativos por semana |
| Se CPA estável por 5 dias | Aumente budget 20% |
| Se criativo com CTR 2x média | Identifique e crie variações dele |
| Se CPA sobe 30%+ por 3 dias | Revise criativos, não a campanha |

### Erros comuns com ASC

❌ Criar múltiplas ASC na mesma conta (canibalizarão)
❌ Orçamento muito baixo (< R$100/dia)
❌ Não colocar cap de clientes existentes
❌ Editar a campanha durante fase de aprendizado
❌ Poucos criativos (< 3)`,
        keyTakeaways: [
          'ASC é a campanha mais eficiente do Meta para e-commerce',
          'Use Existing Customer Budget Cap de 20-30%',
          'Mínimo 4 criativos variados, ideal 6-10',
          'Não edite nada nos primeiros 7 dias',
        ],
        proTips: [
          'Tenha apenas 1 ASC por conta. Múltiplas ASCs competem entre si e aumentam CPMs.',
          'A melhor forma de "otimizar" ASC é adicionar criativos melhores, não mexer em configurações.',
        ],
      },
      {
        id: 'mod3-l2',
        title: 'Advantage+ Audience e Creative',
        duration: '30min',
        type: 'text',
        content: `## Advantage+ Audience & Creative — IA no Público e Criativo

### Advantage+ Audience

O Advantage+ Audience substitui o targeting manual por IA. Funciona em campanhas manuais (não ASC).

**Como funciona:**
1. Você dá **sugestões** de público (interesses, lookalikes, custom audiences)
2. A IA usa essas sugestões como **ponto de partida**
3. O algoritmo **expande** além das suas sugestões para encontrar conversões
4. Com o tempo, a IA aprende quem converte melhor

**Quando usar:**
- ✅ Campanhas de conversão com 50+ conversões/semana
- ✅ Quando broad targeting está performando bem
- ❌ Quando precisa de controle exato do público (ex: geolocalização restrita)

**Configuração:**
\`\`\`
Ad Set > Audience
├── Audience Controls (limites rígidos)
│   ├── Localização: Brasil (obrigatório)
│   ├── Idade: 18-65+ (deixe aberto)
│   └── Idioma: Português (se necessário)
│
└── Audience Suggestions (sugestões flexíveis)
    ├── Custom Audiences: Lookalike 1-5%
    ├── Interesses: 3-5 interesses amplos
    └── Comportamentos: Compradores online
\`\`\`

### Advantage+ Creative

O Advantage+ Creative aplica **otimizações automáticas** nos seus criativos:

**Otimizações disponíveis:**
- **Enhance Image**: Ajusta brilho, contraste, aspect ratio
- **Text Improvements**: Gera variações do texto automaticamente
- **Music**: Adiciona música a vídeos sem áudio
- **3D Animation**: Aplica efeito de profundidade em imagens
- **Relevant Comments**: Mostra comentários relevantes como social proof
- **Multi-advertiser ads**: Seu anúncio aparece junto com outros relevantes

**Recomendações:**
- ✅ Ative: Text Improvements, Relevant Comments
- ⚠️ Teste: Enhance Image, Music
- ❌ Desative se: Seus criativos são muito específicos e não devem ser alterados

### Advantage+ Placements

SEMPRE use todos os placements. A IA distribui impressões para onde tem melhor custo-benefício.

> **Mito derrubado**: "Stories tem CPA melhor, vou desativar Feed"
> **Realidade**: A IA já faz isso. Ao restringir placements, você reduz o alcance e AUMENTA o CPM.`,
        keyTakeaways: [
          'Advantage+ Audience usa suas sugestões como ponto de partida e expande',
          'Advantage+ Creative testa variações automaticamente',
          'Sempre use Advantage+ Placements (todos os posicionamentos)',
          'Audience Controls são limites rígidos, Suggestions são flexíveis',
        ],
      },
      {
        id: 'mod3-l3',
        title: 'Retargeting Inteligente com IA',
        duration: '25min',
        type: 'text',
        content: `## Retargeting na Era da IA

### O retargeting mudou

**Antes**: Criar 15 audiences de retargeting (visitou 3 dias, 7 dias, 14 dias, 30 dias...)
**Agora**: 1-2 audiences amplas e deixar a IA otimizar

### Estrutura MIDAS de Retargeting

\`\`\`
Campanha: RETARGETING (10-15% do budget total)
│
├── Ad Set 1: Hot Retargeting (60% do budget de retargeting)
│   ├── Audience: AddToCart 7 dias + Checkout 14 dias
│   ├── Exclusão: Purchasers 30 dias
│   ├── Advantage+ Audience: DESATIVADO (queremos controle)
│   └── Criativos: Oferta direta, depoimentos, urgência
│
└── Ad Set 2: Warm Retargeting (40% do budget)
    ├── Audience: Website visitors 30 dias + IG/FB engagers 60 dias
    ├── Exclusão: Purchasers 30 dias + Hot audience
    ├── Advantage+ Audience: ATIVADO (pode expandir)
    └── Criativos: Benefícios, comparação, UGC
\`\`\`

### Criativos para cada fase

**Hot Retargeting (quase comprou):**
- "Seu carrinho está esperando" + foto do produto
- Depoimento específico sobre o produto visto
- Oferta com prazo (frete grátis 24h, desconto relâmpago)
- Comparação com concorrentes

**Warm Retargeting (demonstrou interesse):**
- UGC de clientes usando o produto
- Antes/depois com resultados
- Conteúdo educacional sobre o produto
- Review detalhado

### Dicas avançadas

1. **Frequency Cap**: Mantenha frequência abaixo de 4 em 7 dias para retargeting
2. **Creative Rotation**: Troque criativos de retargeting a cada 2 semanas (fadiga é mais rápida)
3. **Exclusões cruzadas**: Sempre exclua compradores recentes
4. **Dynamic Product Ads (DPA)**: Para e-commerce, ative DPA no retargeting — mostra exatamente o produto que a pessoa viu`,
        keyTakeaways: [
          'Simplifique retargeting: máximo 2 ad sets',
          'Hot retargeting: oferta direta para quem quase comprou',
          'Warm retargeting: conteúdo para quem demonstrou interesse',
          'Controle a frequência — fadiga em retargeting é rápida',
        ],
      },
      {
        id: 'mod3-l4',
        title: 'Pixel, CAPI e Tracking no Meta',
        duration: '30min',
        type: 'text',
        content: `## Tracking Avançado — Pixel, CAPI e iOS 14+

### O problema do iOS 14+

Desde 2021, o iOS permite que usuários bloqueiem o tracking. Resultado:
- ~40% dos usuários de iPhone optam out
- O Pixel perde dados de conversão
- O algoritmo recebe menos dados = performance pior

### A solução: Conversions API (CAPI)

CAPI envia eventos de conversão **server-side** (do seu servidor para o Meta), complementando o Pixel:

\`\`\`
Sem CAPI:     Pixel (browser) → Meta  [dados perdidos por bloqueios]
Com CAPI:     Pixel (browser) + CAPI (server) → Meta  [dados completos]
\`\`\`

### Setup recomendado

**Nível 1 — Básico (mínimo):**
- Pixel instalado via GTM
- Eventos: PageView, ViewContent, AddToCart, Purchase
- CAPI via integração da plataforma (Shopify, WooCommerce, etc.)

**Nível 2 — Intermediário:**
- Pixel + CAPI com deduplicação (event_id)
- Enhanced Matching ativado (email, phone hashados)
- Aggregated Event Measurement configurado

**Nível 3 — Avançado (ideal):**
- Server-side GTM com CAPI
- First-party data maximizada
- Conversion Value otimizado (enviando margem, não só receita)
- Offline conversions para long sales cycles

### Prioridade de eventos (Aggregated Event Measurement)

Com iOS 14+, você tem 8 eventos priorizados por domínio:

\`\`\`
1. Purchase (MAIS alta prioridade)
2. InitiateCheckout
3. AddToCart
4. AddPaymentInfo
5. CompleteRegistration
6. Lead
7. ViewContent
8. Search (MAIS baixa prioridade)
\`\`\`

> **Dica MIDAS**: Otimize suas campanhas para Purchase sempre que possível. Se não tem volume suficiente (< 50/semana), desça um nível para AddToCart.`,
        keyTakeaways: [
          'CAPI é obrigatório em 2025 para compensar perdas do iOS 14+',
          'Deduplicação de eventos (event_id) evita contagem dupla',
          'Purchase deve ser sempre o evento #1 na prioridade',
          'Enhanced Matching melhora a taxa de match em 20-30%',
        ],
      },
      {
        id: 'mod3-l5',
        title: 'Checklist: Conta Meta Ads Otimizada para IA',
        duration: '15min',
        type: 'checklist',
        content: `## Checklist — Meta Ads Otimizado para IA

### Pixel & Tracking
- [ ] Pixel Meta instalado e funcionando
- [ ] CAPI (Conversions API) configurada
- [ ] Deduplicação com event_id ativa
- [ ] Enhanced Matching ativado
- [ ] Aggregated Event Measurement com Purchase como #1
- [ ] Domínio verificado no Business Manager

### Estrutura de Campanha
- [ ] 1 ASC como campanha principal (60-70% budget)
- [ ] 1 Campanha Manual TOF com Advantage+ Audience (20-30%)
- [ ] 1 Campanha Retargeting (10-15%)
- [ ] Existing Customer Budget Cap em 20-30% no ASC
- [ ] Advantage+ Placements ativado em todas as campanhas

### Criativos
- [ ] Mínimo 4 criativos por ad set (ideal 6-10)
- [ ] Mix de formatos: vídeo UGC + carrossel + imagem + stories
- [ ] Aspect ratios: 1:1 + 4:5 + 9:16
- [ ] Novos criativos adicionados a cada 1-2 semanas
- [ ] Advantage+ Creative ativado

### Otimização
- [ ] Otimizando para Purchase (ou evento mais próximo da compra)
- [ ] Janela de atribuição: 7-day click + 1-day view
- [ ] Sem edições durante fase de aprendizado (7 dias)
- [ ] Escala: +20% a cada 3-5 dias quando estável
- [ ] Kill criteria: 2x CPA meta sem conversão = pausar criativo`,
        keyTakeaways: [
          'Use esta checklist para auditar qualquer conta Meta Ads',
          'Tracking é a base — sem CAPI, performance será limitada',
          'Revise semanalmente e adicione criativos novos constantemente',
        ],
      },
    ],
  },
  {
    id: 'mod-4',
    number: 3,
    name: 'IA para Criação de Criativos',
    description: 'Use IA para gerar copies, imagens, vídeos e roteiros que convertem.',
    icon: '🎨',
    level: 'Intermediário',
    duration: '3h 30min',
    locked: false,
    lessons: [
      {
        id: 'mod4-l1',
        title: 'Frameworks de Copy com IA',
        duration: '30min',
        type: 'text',
        content: `## Copywriting com IA — Frameworks que Convertem

### Os 6 Frameworks Essenciais para Ads

**1. PAS (Problem → Agitate → Solution)**
Melhor para: Dores claras e urgentes

\`\`\`
Exemplo Meta Ad:
HOOK: "Seu CPA está acima de R$100? 😰"
AGITATE: "A cada dia, dinheiro escorrendo pelo ralo..."
SOLUTION: "O MIDAS analisa seus dados e encontra onde cortar custos em 5 minutos."
CTA: "Comece grátis agora"
\`\`\`

**2. AIDA (Attention → Interest → Desire → Action)**
Melhor para: Produtos novos ou desconhecidos

**3. BAB (Before → After → Bridge)**
Melhor para: Transformação/resultados

\`\`\`
BEFORE: "Gastando R$5k/mês em ads sem saber se está dando lucro..."
AFTER: "Imagina ter um dashboard que mostra EXATAMENTE seu lucro por canal em tempo real."
BRIDGE: "O MIDAS conecta com suas contas e calcula tudo automaticamente."
\`\`\`

**4. Hook-Story-Offer**
Melhor para: Vídeos e UGC

**5. 4Ps (Promise → Picture → Proof → Push)**
Melhor para: Landing pages e ads longos

**6. Pattern Interrupt**
Melhor para: Feeds saturados, parar o scroll

### Como usar IA para gerar copies

**Prompt Estruturado (copie e cole):**
\`\`\`
Atue como um copywriter sênior de resposta direta.

PRODUTO: [nome e descrição]
PÚBLICO: [avatar do cliente ideal]
PLATAFORMA: [Meta Feed / Stories / Google Search]
OBJETIVO: [venda direta / lead / awareness]
TOM: [urgente / educacional / inspirador / humorístico]

Gere 5 variações usando os frameworks:
1. PAS
2. BAB
3. Hook-Story-Offer
4. AIDA
5. Pattern Interrupt

Para cada variação, inclua:
- Headline (máx 40 chars)
- Primary Text (125-200 chars)
- CTA
- Score de persuasão (0-100)
- Gatilhos mentais usados
\`\`\`

### Regras de ouro para copy de ads

1. **Primeira linha é tudo** — ela decide se leem o resto
2. **Benefícios > Características** — "Economize 3h/dia" > "Dashboard automatizado"
3. **Números específicos** — "127 clientes" > "centenas de clientes"
4. **CTA claro** — "Teste grátis por 7 dias" > "Saiba mais"
5. **Emojis estratégicos** — máx 3, para destacar, não decorar`,
        keyTakeaways: [
          'PAS é o framework mais versátil para ads de conversão',
          'Use IA como co-piloto: dê contexto rico para outputs melhores',
          'Sempre gere 5+ variações e teste todas',
          'Primeira linha do ad é o fator #1 de performance',
        ],
      },
      {
        id: 'mod4-l2',
        title: 'Roteiros de Vídeo UGC com IA',
        duration: '30min',
        type: 'text',
        content: `## Roteiros de Vídeo UGC — IA + Estrutura que Converte

### Por que UGC funciona

- **73%** dos consumidores confiam mais em conteúdo de outros consumidores
- UGC tem **4x mais CTR** que conteúdo polished de marca
- Custo de produção é **10-50x menor** que vídeos profissionais

### Estrutura de Vídeo UGC que Converte (15-30s)

\`\`\`
[0-3s] HOOK — Pare o scroll
"Eu gastava R$5.000/mês em ads e não sabia se dava lucro..."

[3-10s] PROBLEMA — Gere identificação
"Ficava horas no Excel tentando cruzar dados do Meta com o Google..."

[10-20s] SOLUÇÃO — Apresente o produto
"Até que descobri o MIDAS. Em 5 minutos, conectei tudo e vi meu ROAS real."

[20-25s] PROVA — Mostre resultado
"No primeiro mês, cortei R$2.000 de desperdício e aumentei o ROAS de 2x para 4.5x."

[25-30s] CTA — Ação clara
"Link na bio. Teste grátis por 7 dias. Sério, vai mudar sua operação."
\`\`\`

### 5 Hooks que Param o Scroll

1. **Confissão**: "Eu quase desisti de rodar ads até descobrir isso..."
2. **Resultado chocante**: "R$47.000 de faturamento com R$3.000 de investimento. Vou mostrar como."
3. **Polêmica**: "90% dos gestores de tráfego não sabem calcular o ROAS real."
4. **Pergunta direta**: "Você sabe quanto está pagando por CADA cliente novo?"
5. **Tutorial**: "3 configurações que todo gestor de tráfego precisa ativar HOJE."

### Prompt para gerar roteiros com IA

\`\`\`
Crie um roteiro de vídeo UGC de 30 segundos para [PRODUTO].

PÚBLICO: [descrição do avatar]
FORMATO: [Reels 9:16 / Feed 4:5 / Stories]
TOM: [conversational / expert / entusiasmado]
ÂNGULO: [confissão / tutorial / resultado / polêmica]

Estrutura:
- HOOK (0-3s): Frase que para o scroll
- PROBLEMA (3-10s): Dor do público
- SOLUÇÃO (10-20s): Como o produto resolve
- PROVA (20-25s): Resultado específico
- CTA (25-30s): Ação clara

Inclua direção de câmera e expressões faciais.
\`\`\``,
        keyTakeaways: [
          'UGC tem 4x mais CTR que conteúdo polished',
          'Hook nos primeiros 3 segundos é o fator #1',
          'Estrutura: Hook → Problema → Solução → Prova → CTA',
          'Use IA para gerar 10+ variações de roteiro e teste os hooks',
        ],
      },
    ],
  },
  {
    id: 'mod-5',
    number: 4,
    name: 'Otimização Avançada com IA',
    description: 'Técnicas avançadas de escala, automação de regras e otimização de budget.',
    icon: '⚡',
    level: 'Avançado',
    duration: '3h',
    locked: false,
    lessons: [
      {
        id: 'mod5-l1',
        title: 'Framework de Escala MIDAS',
        duration: '35min',
        type: 'text',
        content: `## Framework de Escala — De R$100/dia para R$10.000/dia

### Os 3 tipos de escala

**1. Escala Vertical (mais dinheiro na mesma campanha)**
- Aumente 20-30% a cada 3-5 dias
- Só escale quando CPA estiver estável por 5+ dias
- Se CPA subir > 20% após escalar, volte ao budget anterior
- Limite: geralmente funciona até 3-5x o budget original

**2. Escala Horizontal (mais campanhas/criativos)**
- Duplique a campanha vencedora com novos criativos
- Crie variações do criativo vencedor (hooks diferentes, CTAs diferentes)
- Teste em novos formatos (se vídeo performou em Feed, teste em Reels)
- Limite: depende do volume de criativos disponíveis

**3. Escala de Canal (novos canais)**
- Se Meta está performando, replique a estratégia no TikTok
- Se Search está forte, adicione PMax e Demand Gen
- Se orgânico tem tração, amplifique com paid
- Limite: depende do fit do público com a plataforma

### Processo de Escala Semanal MIDAS

| Dia | Ação |
|-----|------|
| Segunda | Analisar dados da semana anterior. Identificar vencedores. |
| Terça | Criar variações dos criativos vencedores (3-5 novos) |
| Quarta | Adicionar novos criativos. Escalar budget +20% se estável. |
| Quinta | Monitorar. Sem mudanças. |
| Sexta | Análise mid-week. Pausar criativos com CPA > 2x meta. |
| Sáb/Dom | Sem alterações. Deixar IA otimizar com dados do fim de semana. |

### Kill Criteria — Quando Pausar

| Condição | Ação |
|----------|------|
| CPA > 2x meta por 3+ dias | Pausar criativo |
| CTR < 0.8% com 1000+ impressões | Pausar criativo |
| Frequência > 3 em 7 dias | Trocar criativo |
| ROAS < 1.5x por 5+ dias | Pausar ad set |
| Nenhuma conversão com R$100+ gastos | Pausar criativo |

### Regra de Ouro da Escala

> **Escale o que funciona. Não tente consertar o que não funciona.**
> Seu tempo é melhor gasto criando variações do vencedor do que tentando salvar o perdedor.`,
        keyTakeaways: [
          'Escala vertical: +20-30% a cada 3-5 dias',
          'Escala horizontal: variações do criativo vencedor',
          'Kill criteria claro evita desperdício de budget',
          'Nunca tente consertar o que não funciona — duplique o que funciona',
        ],
      },
      {
        id: 'mod5-l2',
        title: 'Automação de Regras e Alertas',
        duration: '25min',
        type: 'text',
        content: `## Regras Automatizadas — Seu Piloto Automático

### Por que automatizar?

- Você não pode monitorar campanhas 24/7
- A IA age em tempo real, mas não toma decisões estratégicas
- Regras automatizadas são o "meio termo" perfeito

### Regras Essenciais para Configurar

**Regra 1: Auto-pause por CPA alto**
\`\`\`
SE CPA > 2x Meta CPA
E Impressões > 1000
E Período: Últimos 3 dias
ENTÃO: Pausar anúncio + Notificar via WhatsApp
\`\`\`

**Regra 2: Auto-scale por performance**
\`\`\`
SE CPA < Meta CPA
E ROAS > 3x
E Período: Últimos 5 dias
E Gasto > R$200
ENTÃO: Aumentar budget 20% + Notificar
\`\`\`

**Regra 3: Alerta de fadiga de criativo**
\`\`\`
SE Frequência > 3
E CTR caiu > 20% vs semana anterior
ENTÃO: Notificar "Criativo em fadiga - preparar substituto"
\`\`\`

**Regra 4: Alerta de CPM alto**
\`\`\`
SE CPM > R$40
E CTR < 1%
ENTÃO: Notificar "Leilão caro - revisar segmentação"
\`\`\`

**Regra 5: Proteção de budget**
\`\`\`
SE Gasto diário > 130% do budget planejado
ENTÃO: Pausar campanha + Alerta urgente
\`\`\`

### Hierarquia de regras (ordem de prioridade)

1. 🔴 **Proteção** — Pausar gastos excessivos
2. 🟡 **Alertas** — Notificar tendências negativas
3. 🟢 **Escala** — Automatizar aumento de budget
4. 📊 **Report** — Relatório diário automático`,
        keyTakeaways: [
          'Configure pelo menos 5 regras automatizadas básicas',
          'Proteção de budget é a regra mais importante',
          'Alertas de fadiga de criativo previnem desperdício',
          'Use WhatsApp para receber alertas em tempo real',
        ],
      },
    ],
  },
  {
    id: 'mod-6',
    number: 5,
    name: 'Análise de Dados com IA',
    description: 'Use IA para extrair insights, detectar anomalias e prever resultados.',
    icon: '📊',
    level: 'Avançado',
    duration: '3h',
    locked: false,
    lessons: [
      {
        id: 'mod6-l1',
        title: 'Framework de Análise Sala de Guerra',
        duration: '30min',
        type: 'text',
        content: `## Análise Sala de Guerra — Como Ler seus Dados

### O Ritual Diário MIDAS (15 minutos)

**Manhã (9h) — Check Rápido:**
1. Abrir Dashboard MIDAS
2. Verificar semáforo geral (🟢🟡🔴)
3. Comparar CPA de ontem vs média 7 dias
4. Verificar se algum criativo disparou (bom ou ruim)
5. Decisão: MANTER / AJUSTAR / ESCALAR

**Tarde (17h) — Micro-otimização:**
1. Verificar performance do dia atual
2. Pausar criativos que gastaram R$100+ sem conversão
3. Identificar criativos com CTR acima da média
4. Anotar insights para o dia seguinte

### Framework de Diagnóstico (quando algo dá errado)

**CPA subiu?** → Siga o funil de cima para baixo:

\`\`\`
CPM subiu? → Leilão mais caro → Revisar frequência e audiência
  ↓ não
CTR caiu? → Criativo cansou → Trocar criativo
  ↓ não
CPC subiu? → Qualidade do clique caiu → Revisar targeting
  ↓ não
Conv. Rate caiu? → Problema no site/checkout → Verificar LP
  ↓ não
AOV caiu? → Produto/oferta mudou → Revisar pricing/mix
\`\`\`

### Métricas de correlação

| Se isso acontece... | Provavelmente significa... | Ação |
|---------------------|--------------------------|------|
| CPM ↑ + CTR ↓ | Criativo em fadiga | Trocar criativo |
| CPM ↑ + CTR ↑ | Competição aumentou | Manter, audiência boa |
| CPC ↓ + Conv ↓ | Tráfego de baixa qualidade | Restringir audiência |
| Freq ↑ + CTR ↓ | Saturação de audiência | Expandir público |
| ROAS ↓ + Vendas ↑ | Escala agressiva demais | Reduzir budget 10-20% |

### Como pedir análise para IA

**Prompt de Análise Completa:**
\`\`\`
Analise os dados de performance abaixo e forneça:

[DADOS DE PERFORMANCE]
- Gasto: R$ X
- Conversões: X
- CPA: R$ X
- ROAS: Xx
- CTR: X%
- CPM: R$ X
- Frequência: X

[CONTEXTO]
- Período: [hoje/ontem/7 dias]
- Meta de CPA: R$ X
- Mudanças recentes: [lista]

Forneça: Diagnóstico + Causa + Ação + Impacto esperado
Classifique: 🔴🟡🟢
\`\`\``,
        keyTakeaways: [
          'Ritual diário de 15 minutos evita surpresas',
          'Diagnostique problemas seguindo o funil de cima para baixo',
          'Correlações entre métricas revelam a causa raiz',
          'Use IA para análise — dê contexto rico para insights melhores',
        ],
      },
    ],
  },
  {
    id: 'mod-7',
    number: 6,
    name: 'Workflows e Implementação',
    description: 'Monte seu workflow completo de gestão de tráfego com IA integrada.',
    icon: '🔄',
    level: 'Avançado',
    duration: '2h 30min',
    locked: false,
    lessons: [
      {
        id: 'mod7-l1',
        title: 'Workflow Semanal do Gestor de Tráfego IA',
        duration: '30min',
        type: 'text',
        content: `## Workflow Semanal Completo — Gestão de Tráfego com IA

### Visão Geral da Semana

| Dia | Foco | Tempo |
|-----|------|-------|
| Segunda | Análise + Planejamento | 2h |
| Terça | Criativos + Copies | 3h |
| Quarta | Implementação + Lançamentos | 2h |
| Quinta | Monitoramento + Otimização | 1h |
| Sexta | Report + Análise mid-week | 1.5h |
| Sáb/Dom | Monitoramento leve (15min) | 30min |

### SEGUNDA — Dia de Análise

**Manhã (2h):**
1. Abrir MIDAS Dashboard → verificar semáforo semanal
2. Exportar relatório Sala de Guerra da semana anterior
3. Identificar top 3 criativos vencedores e top 3 perdedores
4. Calcular MER e nCPA da semana
5. Comparar com metas mensais — estamos no track?
6. Pedir análise completa para o MIDAS AI

**Decisões da segunda:**
- Quais criativos pausar?
- Quais criativos escalar?
- Precisa de novos criativos? Quantos?
- Budget precisa de ajuste?

### TERÇA — Dia de Criação

**Manhã (3h):**
1. Briefar criativos baseado na análise de segunda
2. Usar IA para gerar copies (5+ variações por ângulo)
3. Usar IA para gerar roteiros de vídeo UGC
4. Enviar briefs para equipe de criação / creators
5. Revisar e aprovar criativos prontos

**Ferramentas IA para criação:**
- MIDAS Copywriter → copies de anúncios
- ChatGPT/Claude → roteiros detalhados, storyboards
- Midjourney/DALL-E → conceitos visuais, moodboards
- CapCut → edição automatizada de vídeos

### QUARTA — Dia de Implementação

1. Subir novos criativos nas campanhas
2. Pausar criativos perdedores (CTR < 0.8%, CPA > 2x meta)
3. Escalar budget se métricas estão estáveis (+20%)
4. Lançar testes A/B planejados
5. Atualizar regras automatizadas se necessário

### QUINTA — Monitoramento

1. Check rápido de performance (15min manhã)
2. Verificar se novos criativos saíram da fase de aprendizado
3. Monitorar alertas do MIDAS
4. NÃO fazer mudanças grandes (deixar IA aprender)

### SEXTA — Report

1. Gerar relatório Sala de Guerra via MIDAS
2. Enviar report para cliente/stakeholders via WhatsApp
3. Documentar learnings da semana
4. Planejar prioridades da próxima semana

> **Princípio MIDAS**: Segunda e terça são dias de AÇÃO. Quarta a sexta são dias de OBSERVAÇÃO. O algoritmo precisa de tempo para aprender.`,
        keyTakeaways: [
          'Organize a semana: 2 dias de ação, 3 dias de observação',
          'Use IA em cada etapa: análise, criação, otimização, report',
          'Documentar learnings toda sexta para acumular conhecimento',
          'Não interfira demais — o algoritmo precisa de estabilidade',
        ],
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════
// PROMPTS LIBRARY
// ═══════════════════════════════════════════════════════════

export const academyPrompts: AcademyPrompt[] = [
  {
    id: 'p1',
    category: 'Copy',
    title: 'Gerador de Headlines para Meta Ads',
    description: 'Gera 10 headlines persuasivas usando diferentes frameworks',
    platform: 'meta',
    uses: 342,
    prompt: `Atue como copywriter sênior de Meta Ads. Gere 10 headlines (máx 40 chars cada) para:

PRODUTO: [nome]
PÚBLICO: [avatar]
ÂNGULO: [dor/benefício/curiosidade]

Para cada headline:
- Framework usado (PAS/AIDA/BAB/Hook)
- Score de persuasão (0-100)
- Gatilho mental principal`,
  },
  {
    id: 'p2',
    category: 'Copy',
    title: 'CTAs de Alta Conversão',
    description: 'Gera CTAs específicos por plataforma e formato',
    platform: 'meta',
    uses: 287,
    prompt: `Gere 15 CTAs para anúncios de [PRODUTO] considerando:

PLATAFORMA: [Meta Feed/Stories/Reels]
FORMATO: [Feed/Stories/Reels]
OBJETIVO: [compra/lead/cadastro]
TOM: [urgente/educacional/casual]

Para cada CTA inclua:
- Texto do botão
- Complemento (texto que vem antes)
- Gatilho mental usado
- Score de urgência (1-10)`,
  },
  {
    id: 'p3',
    category: 'Criativo',
    title: 'Roteiro UGC 30 Segundos',
    description: 'Gera roteiro completo para vídeo UGC com direção de câmera',
    platform: 'meta',
    uses: 256,
    prompt: `Crie roteiro de vídeo UGC de 30s para [PRODUTO]:

PÚBLICO: [avatar]
FORMATO: Reels 9:16
ÂNGULO: [confissão/tutorial/resultado/review]

Estrutura obrigatória:
- HOOK (0-3s): Frase + expressão facial + enquadramento
- PROBLEMA (3-10s): Texto + ação na tela
- SOLUÇÃO (10-20s): Demo do produto + benefício visual
- PROVA (20-25s): Resultado com número específico
- CTA (25-30s): Ação clara + texto na tela`,
  },
  {
    id: 'p4',
    category: 'Análise',
    title: 'Diagnóstico Completo de Campanha',
    description: 'Análise profunda com diagnóstico, causa raiz e plano de ação',
    platform: 'meta',
    uses: 198,
    prompt: `Analise estes dados como Analista Senior de Performance:

[DADOS DE PERFORMANCE]
Gasto: R$ [X] | Conversões: [X] | CPA: R$ [X]
ROAS: [X]x | CTR: [X]% | CPM: R$ [X] | Freq: [X]

[META] CPA alvo: R$ [X] | ROAS alvo: [X]x

Forneça:
1. Semáforo geral: 🔴🟡🟢
2. Diagnóstico (o que está acontecendo)
3. Causa raiz (por que está acontecendo)
4. Plano de ação (3 ações priorizadas por impacto)
5. Projeção (resultado esperado em 7 dias)`,
  },
  {
    id: 'p5',
    category: 'Estratégia',
    title: 'Plano de Teste A/B',
    description: 'Estrutura completa de teste A/B com hipótese e critérios de sucesso',
    platform: 'meta',
    uses: 156,
    prompt: `Monte um plano de teste A/B para [CAMPANHA]:

HIPÓTESE: [o que acredita que vai melhorar performance]
VARIÁVEL: [criativo/copy/público/lance/formato]
BUDGET DISPONÍVEL: R$ [X]/dia
DURAÇÃO MÁXIMA: [X] dias

Forneça:
1. Estrutura do teste (controle vs variante)
2. Tamanho de amostra mínimo
3. Critérios de sucesso (qual métrica, qual threshold)
4. Timeline dia a dia
5. Decisão tree: o que fazer com cada resultado`,
  },
  {
    id: 'p6',
    category: 'Estratégia',
    title: 'Alocação de Budget por Canal',
    description: 'Distribui budget entre Meta e outros canais baseado em performance',
    platform: 'meta',
    uses: 134,
    prompt: `Distribua R$ [BUDGET_MENSAL] entre canais:

PERFORMANCE ATUAL:
- Meta Ads: CPA R$[X] | ROAS [X]x | [X]% do budget
- TikTok: CPA R$[X] | ROAS [X]x | [X]% do budget

OBJETIVO: [maximizar ROAS / minimizar CPA / escalar volume]

Forneça:
1. Nova distribuição % com justificativa
2. Budget diário por canal
3. Projeção de resultado com nova alocação
4. Regras de rebalanceamento semanal`,
  },
  {
    id: 'p8',
    category: 'Análise',
    title: 'Análise de Criativos (Vencedores e Perdedores)',
    description: 'Identifica padrões em criativos que convertem e que não convertem',
    platform: 'meta',
    uses: 98,
    prompt: `Analise os criativos abaixo e identifique padrões:

VENCEDORES (top 3):
1. [Nome] | CTR: [X]% | CPA: R$[X] | Tipo: [formato] | Hook: [descrição]
2. [Nome] | CTR: [X]% | CPA: R$[X] | Tipo: [formato] | Hook: [descrição]
3. [Nome] | CTR: [X]% | CPA: R$[X] | Tipo: [formato] | Hook: [descrição]

PERDEDORES (bottom 3):
1. [Nome] | CTR: [X]% | CPA: R$[X] | Tipo: [formato] | Hook: [descrição]
2. [Nome] | CTR: [X]% | CPA: R$[X] | Tipo: [formato] | Hook: [descrição]
3. [Nome] | CTR: [X]% | CPA: R$[X] | Tipo: [formato] | Hook: [descrição]

Forneça:
1. Padrões dos vencedores (o que têm em comum)
2. Padrões dos perdedores (o que têm em comum)
3. 5 hipóteses de novos criativos baseados nos padrões
4. Priorização: qual testar primeiro`,
  },
];

// ═══════════════════════════════════════════════════════════
// CHECKLISTS
// ═══════════════════════════════════════════════════════════

export const academyChecklists: AcademyChecklist[] = [
  {
    id: 'ck1',
    title: 'Lançamento de Campanha Meta Ads',
    category: 'Meta Ads',
    items: [
      { id: 'ck1-1', text: 'Pixel Meta instalado e disparando eventos corretamente', checked: false },
      { id: 'ck1-2', text: 'CAPI configurada com deduplicação', checked: false },
      { id: 'ck1-3', text: 'Objetivo de campanha alinhado com meta de negócio', checked: false },
      { id: 'ck1-4', text: 'ASC configurada com Existing Customer Budget Cap', checked: false },
      { id: 'ck1-5', text: 'Mínimo 4 criativos variados (vídeo + imagem + carrossel)', checked: false },
      { id: 'ck1-6', text: 'Copies com hook forte na primeira linha', checked: false },
      { id: 'ck1-7', text: 'Advantage+ Placements ativado', checked: false },
      { id: 'ck1-8', text: 'Orçamento mínimo: 10x CPA alvo por dia', checked: false },
      { id: 'ck1-9', text: 'UTMs configuradas corretamente', checked: false },
      { id: 'ck1-10', text: 'Landing page otimizada e rápida (< 3s load)', checked: false },
    ],
  },
  {
    id: 'ck3',
    title: 'Auditoria Semanal de Performance',
    category: 'Otimização',
    items: [
      { id: 'ck3-1', text: 'Verificar MER e nCPA vs metas', checked: false },
      { id: 'ck3-2', text: 'Identificar top 3 e bottom 3 criativos', checked: false },
      { id: 'ck3-3', text: 'Pausar criativos com CPA > 2x meta', checked: false },
      { id: 'ck3-4', text: 'Verificar frequência (< 3 em 7 dias)', checked: false },
      { id: 'ck3-5', text: 'Comparar CPA por canal e campanhas', checked: false },
      { id: 'ck3-6', text: 'Verificar tendência de CPM (leilão ficando caro?)', checked: false },
      { id: 'ck3-7', text: 'Testar novos criativos (mínimo 2-3 por semana)', checked: false },
      { id: 'ck3-8', text: 'Escalar budget em campanhas estáveis (+20%)', checked: false },
      { id: 'ck3-9', text: 'Enviar relatório Sala de Guerra para stakeholders', checked: false },
      { id: 'ck3-10', text: 'Documentar learnings da semana', checked: false },
    ],
  },
  {
    id: 'ck4',
    title: 'Criação de Criativos que Convertem',
    category: 'Criativos',
    items: [
      { id: 'ck4-1', text: 'Hook forte nos primeiros 3 segundos (vídeo) ou primeira linha (copy)', checked: false },
      { id: 'ck4-2', text: 'Pelo menos 2 gatilhos mentais por criativo', checked: false },
      { id: 'ck4-3', text: 'CTA claro e visível', checked: false },
      { id: 'ck4-4', text: 'Formatos variados: 1:1 + 4:5 + 9:16', checked: false },
      { id: 'ck4-5', text: 'Mix de tipos: UGC + estático + carrossel', checked: false },
      { id: 'ck4-6', text: 'Texto legível em mobile (fonte grande)', checked: false },
      { id: 'ck4-7', text: 'Prova social incluída (números, depoimentos)', checked: false },
      { id: 'ck4-8', text: 'Testou variações do hook do criativo vencedor', checked: false },
    ],
  },
];
