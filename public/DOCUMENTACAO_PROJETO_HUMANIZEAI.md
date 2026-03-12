# 📋 DOCUMENTAÇÃO COMPLETA - HumanizeAI TF

> Plataforma SaaS multi-tenant de gestão inteligente de tráfego pago com IA
> **URL:** https://humanizeia.lovable.app
> **Data:** Março 2026

---

## 📌 VISÃO GERAL

O **HumanizeAI TF** é uma plataforma web SaaS para gestores de tráfego pago (media buyers) que integra inteligência artificial para otimizar campanhas de anúncios em Meta Ads, Google Ads e TikTok Ads. É um sistema multi-tenant, onde cada empresa (organização) possui seus próprios dados isolados.

### Stack Tecnológico
- **Frontend:** React 18 + TypeScript + Vite
- **UI:** Tailwind CSS + shadcn/ui + Framer Motion
- **State:** Zustand (global) + TanStack React Query (server state)
- **Backend:** Supabase (via Lovable Cloud)
  - PostgreSQL com Row Level Security (RLS)
  - Edge Functions (Deno) para lógica server-side
  - Autenticação nativa
  - Storage para arquivos/criativos
- **IA:** Anthropic Claude (via edge function `claude-chat`)
- **Roteamento:** React Router v6
- **Gráficos:** Recharts

---

## 🏗️ ARQUITETURA

### Estrutura de Pastas
```
src/
├── App.tsx                    # Roteamento principal
├── main.tsx                   # Entry point
├── index.css                  # Design system (tokens CSS)
├── pages/                     # Páginas da aplicação
├── components/
│   ├── ui/                    # Componentes shadcn/ui
│   ├── layout/                # MainLayout, AppSidebar, Topbar
│   ├── auth/                  # ProtectedRoute
│   ├── ai/                    # AIAssistantButton (chat flutuante)
│   ├── dashboard/             # Widgets do painel
│   ├── copywriter/            # Componentes do copywriter
│   ├── creative-studio/       # Editor de imagens
│   ├── midas/                 # Formulário de dados do Apollo
│   ├── settings/              # Tabs de configurações
│   ├── reports/               # Templates de relatórios
│   ├── onboarding/            # Wizard de onboarding
│   └── evolution/             # WhatsApp via Evolution API
├── hooks/                     # Custom hooks
├── store/                     # Zustand store
├── data/                      # Mock data
├── utils/                     # Utilitários
└── integrations/supabase/     # Cliente e tipos (auto-gerados)

supabase/
└── functions/                 # Edge Functions (backend)
    ├── claude-chat/           # IA principal (Claude)
    ├── meta-api/              # Proxy Meta Graph API
    ├── meta-oauth/            # OAuth Meta Ads
    ├── google-ads-api/        # Proxy Google Ads API
    ├── google-ads-oauth/      # OAuth Google Ads
    ├── tiktok-oauth/          # OAuth TikTok Ads
    ├── generate-creative/     # Geração de imagens com IA
    ├── edit-image/            # Edição de imagens com IA
    ├── remove-bg/             # Remoção de fundo
    ├── send-whatsapp-report/  # Envio de relatórios WhatsApp
    ├── enviar-report-midas/   # Relatórios via Apollo
    ├── academy-ai/            # IA da academia
    ├── apply-theme/           # Aplicação de temas
    ├── shopify-integration/   # Integração Shopify
    ├── create-evolution-instance/ # Instância WhatsApp
    ├── get-evolution-qrcode/  # QR Code WhatsApp
    └── test-evolution-connection/ # Teste WhatsApp
```

### Fluxo de Autenticação
1. Usuário acessa `/` → Landing Page
2. Clica "Entrar" → `/auth` (apenas login, sem cadastro público)
3. Login com email/senha → Supabase Auth
4. `ProtectedRoute` verifica:
   - Se tem sessão → continua
   - Se tem `organization_id` no perfil → dashboard
   - Se NÃO tem organização → `/onboarding` (criar ou aceitar convite)
5. Todas as rotas protegidas usam `<ProtectedRoute>` wrapper

### Multi-Tenancy (Organizações)
- Cada usuário pertence a uma **organização**
- Tabelas: `organizations`, `organization_members`, `organization_invites`
- `profiles.organization_id` vincula usuário à organização
- Função `create_organization_with_owner()` cria org + membro owner + atualiza profile
- Convites por email com fluxo aceitar/recusar
- Roles: `owner` e `member`

---

## 📄 PÁGINAS E MÓDULOS

### 1. Landing Page (`/`)
- Página pública simples com hero, features e CTA
- Redireciona para `/dashboard` se já autenticado

### 2. Autenticação (`/auth`)
- Apenas login (cadastro desativado)
- Recuperação de senha com redirect para `/reset-password`
- Validação com Zod

### 3. Onboarding (`/onboarding`)
- Aparece quando usuário não tem organização
- 2 opções: criar empresa ou aceitar convite pendente

### 4. Dashboard (`/dashboard`) ⭐
- **Dados reais do Meta Ads** via API
- KPIs: Gasto, Impressões, Cliques, CTR, CPC, CPM, Conversões, ROAS
- Gráfico de tendência (últimos 7/30 dias)
- Tabela de funil por campanha
- Gráfico de gasto diário
- Melhores/piores criativos
- Heatmap por dia da semana
- Distribuição de gasto
- Gráfico de eficiência (scatter)
- Alertas de anomalias automáticos
- Insights de IA
- Filtro de período: Hoje, Ontem, 7 dias, 30 dias
- Botão de atualizar dados
- Envio de relatório rápido via WhatsApp

### 5. Agente Apollo / Midas (`/midas`) ⭐
- Chat interativo com IA (Claude) especializado em tráfego pago
- 6 contextos de IA: copywriter, assistant, optimizer, insights, creative, midas
- Chips de sugestão rápida
- Formulário de dados para análise (MidasDataForm)
- Renderização Markdown das respostas
- Streaming de respostas em tempo real
- Insights acionáveis com cards visuais

### 6. Copywriter IA (`/copywriter`)
- Geração de copies para anúncios com IA
- Fórmulas de copywriting (PAS, AIDA, BAB, etc.)
- Configurações: plataforma, tipo, tom, objetivo, emojis, CTA
- Swipe File (biblioteca de referências salvas)
- Salvamento de copies favoritas no banco

### 7. Estúdio Criativo (`/creative-studio`)
- Upload e edição de imagens
- Remoção de fundo com IA
- Redimensionamento para formatos de anúncio
- Layers de texto e overlay
- Combinação de imagens
- Galeria de imagens salvas (Supabase Storage)
- Cropping avançado

### 8. Otimizador de Campanhas (`/optimizer`)
- Cards de ações sugeridas pelo Midas/Apollo
- Otimizações de campanha

### 9. Alocador de Verba (`/budget`)
- Distribuição inteligente de orçamento entre campanhas

### 10. Análises (`/analytics`)
- Análises avançadas de performance

### 11. Regras Automáticas (`/rules`)
- Criação de regras tipo "Se CPA > X, pausar campanha"
- Tipos de ação: pausar, ativar, ajustar budget, ajustar bid, notificar, escalar
- Condições configuráveis com lógica AND/OR
- Frequência de verificação
- Log de execução

### 12. Laboratório A/B (`/ab-testing`)
- Criação e gerenciamento de testes A/B
- Variantes com métricas: impressões, cliques, conversões, CTR, CPA, ROAS
- Cálculo de significância estatística
- Declaração de vencedor

### 13. Biblioteca Criativa (`/library`)
- Galeria de criativos e anúncios de concorrentes
- Análise de concorrência

### 14. Relatórios (`/reports`)
- Templates de relatórios customizáveis
- Métricas configuráveis com emojis
- Envio via WhatsApp (Evolution API)
- Envio via Discord (webhook)
- Agendamento automático (dia/horário)
- Histórico de envios
- Destinatários configuráveis

### 15. Pixel Unificado (`/pixel`)
- Gerenciamento de pixels de rastreamento

### 16. Integrações (`/integrations`)
- Hub centralizado de conexões
- Cards: Meta Ads, Google Ads, TikTok Ads, Shopify
- Futuro: Google Sheets, Hotmart, Zapier, Webhooks
- Modal com passo a passo para OAuth

### 17. Academia IA (`/academy`)
- Conteúdo educacional sobre tráfego pago
- Tutor IA interativo
- Lições com visualizador

### 18. Configurações (`/settings`)
- **Perfil:** Nome, email, avatar, idioma, timezone
- **Empresa:** Nome, setor, nível de experiência
- **Conexões:** Status das integrações
- **Meta Ads:** Gerenciar conta conectada
- **Google Ads:** Gerenciar conta conectada
- **TikTok Ads:** Gerenciar conta conectada
- **Google Analytics:** Configuração
- **Google Tag Manager:** Configuração
- **WhatsApp:** Evolution API (instância, QR Code)
- **IA:** Provedor, modelo, criatividade
- **Sincronização:** Frequência de sync dos dados
- **Integrações:** Shopify e outras

---

## 🔌 INTEGRAÇÕES

### Meta Ads (Facebook/Instagram)
- **OAuth:** Edge function `meta-oauth` faz o fluxo OAuth2
- **API Proxy:** Edge function `meta-api` age como proxy seguro
  - Busca token criptografado da tabela `ad_accounts`
  - Faz requisições ao Graph API v21.0
  - Retorna dados ao frontend sem expor token
- **Hooks:** `useMetaConnection`, `useMetaInsights`, `useMetaCampaigns`, `useMetaDashboard`, `useMetaCachedQuery`
- **Cache:** Tabela `meta_cache` para reduzir chamadas à API
- **Dados:** Campanhas, métricas, insights, criativos

### Google Ads
- **OAuth:** Edge function `google-ads-oauth`
- **API:** Edge function `google-ads-api`
- **Hook:** `useGoogleAdsConnection`
- **Status:** Em verificação no Google (aguardando aprovação do escopo `auth/adwords`)

### TikTok Ads
- **OAuth:** Edge function `tiktok-oauth`
- **Status:** Configuração básica

### WhatsApp (Evolution API)
- **Instância:** Criar via `create-evolution-instance`
- **QR Code:** Conectar via `get-evolution-qrcode`
- **Teste:** Verificar via `test-evolution-connection`
- **Relatórios:** Enviar via `send-whatsapp-report`
- **Hook:** `useWhatsAppConfig`
- **Tabela:** `whatsapp_config`, `whatsapp_destinatarios`

### Shopify
- **Integração:** Edge function `shopify-integration`
- **Dados:** Pedidos, métricas diárias
- **Tabelas:** `shopify_orders`, `shopify_daily_metrics`
- **Hook:** `useShopifyIntegration`

---

## 🤖 INTELIGÊNCIA ARTIFICIAL

### Claude Chat (Edge Function Principal)
- **Endpoint:** `claude-chat`
- **Modelo:** Claude (Anthropic) via API key no secret `ANTHROPIC_API_KEY`
- **6 Contextos especializados:**
  1. `copywriter` - Geração de copies para anúncios
  2. `assistant` - Assistente geral de tráfego pago
  3. `optimizer` - Otimização de campanhas
  4. `insights` - Análise de dados e insights
  5. `creative` - Sugestões criativas
  6. `midas` - Super gestor de tráfego (Apollo)
- **Streaming:** Respostas em tempo real via SSE
- **System Prompts:** Cada contexto tem um prompt especializado detalhado

### AI Assistant (Chat Flutuante)
- Botão flutuante no canto inferior direito
- Disponível em todas as páginas
- Usa dados reais do Meta Ads como contexto
- Streaming de respostas

### Geração de Criativos
- **Edge function:** `generate-creative` (usa Gemini API)
- **Edição:** `edit-image`
- **Remoção de fundo:** `remove-bg` (usa Remove.bg API)

### Academia IA
- **Edge function:** `academy-ai`
- Tutor inteligente para educação em tráfego pago

---

## 🗄️ BANCO DE DADOS (PostgreSQL/Supabase)

### Tabelas Principais

| Tabela | Descrição | RLS |
|--------|-----------|-----|
| `profiles` | Perfis de usuários (vinculado a auth.users) | ✅ por user_id |
| `organizations` | Empresas/organizações | ✅ por membership |
| `organization_members` | Membros com roles (owner/member) | ✅ por org |
| `organization_invites` | Convites por email | ✅ por org/email |
| `ad_accounts` | Contas de anúncio conectadas | ✅ por user_id |
| `campaigns` | Campanhas de anúncio | ✅ por user_id |
| `campaign_metrics` | Métricas diárias por campanha | ✅ via campaign |
| `copies` | Copies geradas pelo Copywriter | ✅ por user_id |
| `copy_formulas` | Fórmulas de copywriting | ✅ público p/ default |
| `copy_performance` | Performance de copies | ✅ via copy |
| `creatives` | Criativos (imagens/vídeos) | ✅ por user_id |
| `creative_performance` | Performance de criativos | ✅ via creative |
| `ab_tests` | Testes A/B | ✅ por user_id |
| `ab_test_variants` | Variantes dos testes | ✅ via test |
| `automation_rules` | Regras automáticas | ✅ por user_id |
| `rule_execution_log` | Log de execução de regras | ✅ via rule |
| `ai_insights` | Insights gerados pela IA | ✅ por user_id |
| `ai_learnings` | Aprendizados acumulados da IA | ✅ por user_id |
| `audiences` | Audiências/públicos | ✅ por user_id |
| `competitor_ads` | Anúncios de concorrentes | ✅ por user_id |
| `notifications` | Notificações do sistema | ✅ por user_id |
| `saved_reports` | Relatórios salvos | ✅ por user_id |
| `report_templates` | Templates de relatório | ✅ por user_id |
| `report_template_destinatarios` | Destinatários dos templates | ✅ via template |
| `historico_reports` | Histórico de envios | ✅ por user_id |
| `meta_cache` | Cache de dados do Meta | ✅ por user_id |
| `activity_log` | Log de atividades | ✅ por user_id |
| `swipe_files` | Swipe files do copywriter | ✅ por user_id |
| `platform_integrations` | Integrações (Shopify, etc.) | ✅ por user_id |
| `shopify_orders` | Pedidos Shopify | ✅ por user_id |
| `shopify_daily_metrics` | Métricas diárias Shopify | ✅ por user_id |

### Funções do Banco
- `handle_new_user()` - Trigger que cria profile ao registrar
- `create_organization_with_owner(org_name)` - Cria org + membro + atualiza profile
- `is_org_member(user_id, org_id)` - Verifica membership (SECURITY DEFINER)
- `is_org_owner(user_id, org_id)` - Verifica ownership (SECURITY DEFINER)
- `get_user_email(user_id)` - Busca email do auth.users (SECURITY DEFINER)
- `update_updated_at_column()` - Trigger para updated_at automático

### Enums
- `platform_type`: meta, google, tiktok
- `campaign_status`: active, paused, draft, completed, archived, error
- `test_status`: running, completed, paused, draft
- `insight_type`: optimization, creative, audience, budget, copy, general
- `insight_category`: performance, creative, audience, budget, copy, strategy
- `copy_type`: headline, primary_text, description, full_ad, email, sms, whatsapp, landing_page
- `creative_type`: image, video, carousel, collection, story, reel
- `rule_action_type`: pause_campaign, activate_campaign, adjust_budget, adjust_bid, send_notification, scale_campaign
- `org_role`: owner, member
- `invite_status`: pending, accepted, declined

### Storage
- Bucket `creatives` (público) - Armazena imagens e vídeos de criativos

---

## 🔐 SEGURANÇA

### Autenticação
- Supabase Auth com email/senha
- Sessão persistida em localStorage
- Auto-refresh de token
- Cadastro público desativado (apenas usuários existentes)

### Row Level Security (RLS)
- **TODAS** as tabelas têm RLS ativado
- Padrão: `auth.uid() = user_id` para tabelas diretas
- Tabelas relacionadas: verificação via JOIN (ex: `campaign_metrics` verifica ownership da `campaigns`)
- Funções SECURITY DEFINER para evitar recursão em RLS

### Edge Functions
- Todas verificam `Authorization: Bearer` header
- Tokens de API (Meta, Google) armazenados criptografados na tabela `ad_accounts`
- Secrets sensíveis em Supabase Secrets (nunca no frontend)
- Proxy pattern: frontend → edge function → API externa

### Secrets Configurados
- `ANTHROPIC_API_KEY` - Claude AI
- `GEMINI_API_KEY` - Google Gemini (criativos)
- `REMOVE_BG_API_KEY` - Remove.bg
- `META_APP_ID` / `META_APP_SECRET` - Meta OAuth
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - Google OAuth
- `GOOGLE_ADS_DEVELOPER_TOKEN` - Google Ads API
- `RUNWAYML_API_KEY` - Runway ML
- `LOVABLE_API_KEY` - Lovable AI
- `SUPABASE_*` - Variáveis do Supabase (auto-configuradas)

---

## 🎨 DESIGN SYSTEM

### Tema
- **Dark mode first** com suporte a light mode
- Cores primárias: Verde-teal (HSL 168 80% 40%)
- Cores secundárias: Ciano (HSL 174 62% 47%)
- Gradientes: `gradient-primary` (verde → ciano)
- Border radius: 0.75rem
- Tokens semânticos via CSS variables em `index.css`

### Componentes UI
- Baseados em shadcn/ui (Radix primitives)
- Customizados com design tokens do projeto
- Animações com Framer Motion
- Responsivo (mobile-first)

### Layout
- `MainLayout`: Sidebar + Topbar + Conteúdo
- `AppSidebar`: Navegação lateral colapsável com seções
- `Topbar`: Breadcrumb, busca, notificações, perfil
- `AIAssistantButton`: Chat flutuante global

---

## 🔄 HOOKS PRINCIPAIS

| Hook | Função |
|------|--------|
| `useAuth` | Autenticação (user, session, signIn, signOut) |
| `useOrganization` | Gerenciar organização e convites |
| `useMetaConnection` | Status da conexão Meta Ads |
| `useMetaInsights` | Buscar insights do Meta (com React Query) |
| `useMetaCampaigns` | Listar campanhas Meta |
| `useMetaDashboard` | Dashboard completo com KPIs e gráficos |
| `useMetaCachedQuery` | Cache de dados Meta no Supabase |
| `useMetaApi` | Chamadas genéricas à Meta API |
| `useClaudeChat` | Chat com IA (streaming SSE) |
| `useGoogleAdsConnection` | Status da conexão Google Ads |
| `useWhatsAppConfig` | Configuração WhatsApp |
| `useShopifyIntegration` | Integração Shopify |
| `useCopyFormulas` | Fórmulas de copywriting |
| `useSwipeFiles` | Swipe files (referências) |
| `useCampaignNotifications` | Notificações de anomalias |
| `usePersistedState` | Estado persistido em localStorage |
| `useMobile` | Detecção de dispositivo mobile |

---

## 📡 EDGE FUNCTIONS (Backend)

### `claude-chat` (IA Principal)
- Recebe: messages[], context, config, stream
- 6 system prompts especializados
- Streaming via SSE (Server-Sent Events)
- Usa ANTHROPIC_API_KEY

### `meta-api` (Proxy Meta)
- Recebe: endpoint, params, method, body
- Busca token do ad_account do usuário
- Faz request ao Graph API v21.0
- Retorna dados sem expor token

### `meta-oauth`
- Troca code por access_token
- Salva token criptografado em ad_accounts
- Lista contas de anúncio disponíveis

### `google-ads-api` / `google-ads-oauth`
- Similar ao Meta, para Google Ads API
- Usa GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ADS_DEVELOPER_TOKEN

### `tiktok-oauth`
- OAuth para TikTok Ads

### `generate-creative`
- Gera imagens com Gemini API
- Retorna URL da imagem gerada

### `edit-image`
- Edita imagens existentes com IA

### `remove-bg`
- Remove fundo de imagens (Remove.bg API)

### `send-whatsapp-report` / `enviar-report-midas`
- Envia relatórios formatados via WhatsApp (Evolution API)

### `shopify-integration`
- Sync de pedidos e métricas do Shopify

### `academy-ai`
- Tutor IA para a Academia

---

## 🗺️ ROTAS

### Públicas
| Rota | Componente |
|------|-----------|
| `/` | LandingPage |
| `/auth` | Auth (login) |
| `/reset-password` | ResetPassword |
| `/privacy` | PrivacyPolicy |
| `/terms` | TermsOfService |
| `/onboarding` | Onboarding |

### Protegidas (requer autenticação + organização)
| Rota | Componente |
|------|-----------|
| `/dashboard` | Dashboard |
| `/midas` | MidasAgent (Apollo) |
| `/copywriter` | AICopywriter |
| `/creative-studio` | AICreativeStudio |
| `/optimizer` | CampaignOptimizer |
| `/budget` | BudgetAllocator |
| `/analytics` | Analytics |
| `/rules` | AutomatedRules |
| `/ab-testing` | ABTestingLab |
| `/library` | CreativeLibrary |
| `/reports` | Reports |
| `/pixel` | UnifiedPixel |
| `/integrations` | Integrations |
| `/academy` | AIAcademy |
| `/settings` | Settings |
| `/connect-accounts` | ConnectAccounts |

---

## 📊 MENU LATERAL (Sidebar)

### Seções:
1. **Principal:** Painel, Agente Apollo, Copywriter IA, Estúdio Criativo
2. **Otimização:** Otimizador de Campanhas, Alocador de Verba, Análises
3. **Automação:** Regras Automáticas, Laboratório A/B
4. **Biblioteca:** Biblioteca Criativa, Relatórios, Pixel Unificado, Integrações
5. **Aprender:** Academia IA, Configurações
6. **Footer:** Toggle tema (dark/light), Logout

---

## ⚙️ ESTADO GLOBAL (Zustand)

Store em `src/store/appStore.ts`:
- Tema (dark/light)
- Sidebar state
- Notificações
- Configurações do usuário

---

## 📦 DEPENDÊNCIAS PRINCIPAIS

- `@supabase/supabase-js` - Cliente Supabase
- `@tanstack/react-query` - Server state management
- `react-router-dom` - Roteamento
- `zustand` - Estado global
- `framer-motion` - Animações
- `recharts` - Gráficos
- `react-markdown` + `remark-gfm` - Renderização Markdown
- `react-advanced-cropper` - Cropping de imagens
- `zod` - Validação de dados
- `react-hook-form` - Formulários
- `sonner` - Toasts
- `lucide-react` - Ícones
- `date-fns` - Manipulação de datas
- `cmdk` - Command palette

---

## 🚀 FLUXO PRINCIPAL DO USUÁRIO

1. **Login** → `/auth`
2. **Onboarding** (se primeiro acesso) → Criar empresa
3. **Dashboard** → Ver métricas reais das campanhas
4. **Conectar Meta Ads** → Configurações ou Integrações
5. **Agente Apollo** → Conversar com IA sobre campanhas
6. **Copywriter** → Gerar copies para anúncios
7. **Estúdio Criativo** → Criar/editar imagens
8. **Regras Automáticas** → Configurar alertas
9. **Relatórios** → Configurar e enviar via WhatsApp
10. **Convidar equipe** → Configurações da empresa

---

## 🔮 FUNCIONALIDADES FUTURAS / EM DESENVOLVIMENTO

- **Super Gestor Apollo** - Criação automatizada de campanhas via IA
- **Google Ads completo** - Aguardando aprovação do OAuth
- **TikTok Ads** - Integração em desenvolvimento
- **Google Sheets** - Exportação de dados
- **Hotmart** - Integração de infoprodutos
- **Zapier / Webhooks** - Automações externas
- **Pixel Unificado** - Rastreamento cross-platform

---

## 📝 NOTAS IMPORTANTES

1. **Cadastro desativado:** Apenas usuários existentes podem acessar. Não há formulário de registro público.
2. **RLS em tudo:** Todas as tabelas têm Row Level Security. Nenhum dado é acessível sem autenticação.
3. **Tokens seguros:** Tokens de APIs externas são armazenados no banco (não no localStorage) e acessados apenas via edge functions.
4. **Idioma:** Interface 100% em português brasileiro.
5. **Moeda:** Real brasileiro (R$) como padrão.
6. **Timezone:** America/Sao_Paulo como padrão.
7. **Arquivos auto-gerados (NÃO editar):**
   - `src/integrations/supabase/client.ts`
   - `src/integrations/supabase/types.ts`
   - `supabase/config.toml`
   - `.env`
