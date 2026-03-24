# 🧠 CONFIGS_PROJETO — Logos IA
> Documento de onboarding completo para novos agentes ou desenvolvedores.
> **Última atualização:** 24/03/2026

---

## 1. IDENTIDADE DO PROJETO

| Item | Valor |
|------|-------|
| **Nome do Produto** | Logos IA |
| **Nome anterior** | HumanizeAI (rebrand feito em Mar/2026) |
| **Tipo** | Plataforma SaaS de Marketing com IA |
| **Repositório GitHub** | `https://github.com/Agencia-Up/humanizeia` |
| **Site de Produção** | `https://logosiabrasil.com` |
| **Pasta local do projeto** | `e:\Projetos - Antigravity\HUMANIZEIA\humanizeia\` |

---

## 2. INFRAESTRUTURA E DEPLOY

### 2.1 Onde o Site Está Hospedado
O site roda em uma **VPS própria** gerenciada pelo **Easypanel**.

- **Painel de controle:** Easypanel (acesso via navegador na URL da VPS)
- **Serviço no Easypanel:** Projeto `logos-ia` → Serviço `github`
- **Deploy automático:** Não. O deploy é **manual** — você clica em "Implantar" no Easypanel após um push para a branch `main` no GitHub.

### 2.2 Como o Code Chega ao Servidor (Fluxo Completo)

```
Desenvolvedor (local)
  │
  ▼
git push ──► GitHub (branch dev-douglas ou dev-wander)
  │
  ▼
git merge dev-X ──► branch main do GitHub
  │
  ▼
Easypanel ──► Lê o código da branch main
  │
  ▼
Docker Build ──► Executa o Dockerfile (2 estágios)
  │
  ▼
Container Nginx rodando na porta 80
  │
  ▼
Easypanel / Traefik ──► Roteia o domínio para o container
  │
  ▼
Usuário acessa https://logosiabrasil.com ✅
```

### 2.3 Estratégia de Branches

| Branch | Quem usa | Função |
|--------|----------|--------|
| `main` | CI/CD (Easypanel lê daqui) | Código de produção, nunca editar direto |
| `dev-douglas` | Douglas + Claude (conta principal) | Desenvolvimento do Douglas |
| `dev-wander` | Wander + Claude (segundo Claude) | Desenvolvimento do Wander |

### ⚠️ REGRA DE OURO: Sequência de Commit
Todo push de código **DEVE** seguir essa ordem para não criar conflito:

```powershell
git add .
git commit -m "tipo: descrição do que foi feito"
git push origin dev-douglas          # ou dev-wander conforme o desenvolvedor
git checkout main
git pull origin main
git merge dev-douglas               # resolve conflitos aqui se houver
git push origin main
git checkout dev-douglas            # volta para a branch de trabalho
```

---

## 3. CONFIGURAÇÃO DO DOCKER (Build)

O arquivo `Dockerfile` na raiz do projeto usa **2 estágios**:

### Estágio 1 — Build (Node.js)
```
FROM node:20-alpine as build
```
- Instala dependências com `npm ci`
- Recebe variáveis de ambiente do Easypanel via `--build-arg`
- Roda `npm run build` (Vite) e gera a pasta `dist/`

### Estágio 2 — Produção (Nginx)
```
FROM nginx:alpine
```
- Copia somente a pasta `dist/` gerada no estágio 1
- Usa o arquivo customizado `nginx.conf` para:
  - Servir o SPA (React Router) sem dar 404 em sub-páginas (via `try_files`)
  - Cache de 6 meses em arquivos estáticos
  - Compressão GZIP habilitada
- **Porta exposta: 80 (HTTP)**

### ⚠️ Configuração Crítica no Easypanel (Domínios)
O Easypanel é quem coloca o HTTPS/cadeado. O container fala HTTP.
Por isso, no campo "Destino" da tela de Domínios do Easypanel:
- **Protocolo destino:** `HTTP` ← NUNCA mudar para HTTPS!
- **Porta:** `80`

---

## 4. VARIÁVEIS DE AMBIENTE

Configuradas no Easypanel (Build Args), **nunca** colocar no `.env` commitado:

| Variável | Onde usar | Descrição |
|----------|-----------|-----------|
| `VITE_SUPABASE_URL` | Build | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Build | Chave anônima pública do Supabase |
| `VITE_SUPABASE_PROJECT_ID` | Build | ID do projeto Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Build | Igual à anon key (redundante, manter) |

> **Regra Vite:** Todas as variáveis de ambiente do frontend **DEVEM** começar com `VITE_`.

---

## 5. STACK TECNOLÓGICA

```
Frontend:
  ├── React 18 (com lazy loading de páginas)
  ├── TypeScript
  ├── Vite (build tool)
  ├── Tailwind CSS (estilização)
  ├── Shadcn/UI (biblioteca de componentes)
  ├── React Router v6 (rotas SPA)
  ├── TanStack Query (cache e fetching de dados)
  ├── Zustand (estado global via appStore)
  └── @hello-pangea/dnd (drag-and-drop do Kanban)

Backend / Infraestrutura:
  ├── Supabase (banco de dados PostgreSQL + Auth + Edge Functions)
  ├── Supabase Storage (arquivos e mídias)
  └── n8n (automações e webhooks — separado, cloud ou self-hosted)

Deploy:
  ├── Docker (containerização)
  ├── Nginx (servidor web no container)
  └── Easypanel (orquestrador de containers na VPS)
```

---

## 6. ESTRUTURA DE PASTAS PRINCIPAIS

```
humanizeia/
├── Dockerfile            ← Build em 2 estágios (Node → Nginx)
├── nginx.conf            ← Configuração customizada do Nginx
├── index.html            ← Entry point HTML (título, meta tags, favicon)
├── package.json          ← Dependências e scripts NPM
│
├── public/               ← Arquivos estáticos públicos
│   └── logosia-brand.png ← Logo oficial Logos IA (com fundo transparente necessário)
│
├── src/
│   ├── App.tsx           ← Roteamento principal (todas as rotas aqui)
│   ├── pages/            ← Uma página por arquivo (lazy loaded)
│   │   ├── Auth.tsx      ← Tela de login/cadastro
│   │   ├── FluxCRM.tsx   ← CRM Kanban (módulo principal de CRM)
│   │   ├── CRMContacts.tsx ← Lista de contatos agrupada por etapa
│   │   ├── WhatsApp*.tsx ← Módulos WhatsApp (Inbox, Broadcast, etc.)
│   │   └── ...
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppSidebar.tsx ← Menu lateral principal
│   │   │   └── MainLayout.tsx ← Layout wrapper que inclui a sidebar
│   │   └── crm/
│   │       ├── KanbanColumn.tsx ← Coluna do Kanban
│   │       ├── LeadCard.tsx     ← Card individual do lead
│   │       └── LeadFormDialog.tsx ← Modal para criar/editar lead
│   ├── hooks/
│   │   ├── useFluxCRM.ts ← Hook principal do CRM (stages, leads, CRUD)
│   │   ├── useAuth.ts    ← Hook de autenticação (user, session)
│   │   └── ...
│   └── integrations/
│       └── supabase/
│           └── client.ts ← Inicialização do cliente Supabase
│
└── supabase/
    ├── functions/        ← Edge Functions (APIs serverless)
    │   ├── crm-capture/  ← [PLANEJADO] Webhook receptor de leads externos
    │   └── ...
    └── migrations/       ← Migrações SQL (histórico de alterações no banco)
        ├── 20260320150000_add_whatsapp_fields.sql
        └── 20260323120000_fix_duplicate_pipeline_stages.sql
```

---

## 7. BANCO DE DADOS (Supabase)

### Tabelas Principais do CRM

#### `crm_pipeline_stages`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid | ID único |
| `user_id` | uuid | FK para o usuário autenticado |
| `name` | text | Ex: "Novo Lead", "Qualificado" |
| `color` | text | Cor hex da coluna. Ex: `#6366f1` |
| `position` | int | Ordem de exibição |
| `is_default` | bool | Se foi criada automaticamente |

**Etapas padrão criadas automaticamente:**
1. Novo Lead (`#6366f1`)
2. Qualificado (`#f59e0b`)
3. Proposta (`#3b82f6`)
4. Negociação (`#8b5cf6`)
5. Fechado (`#10b981`)

> **Constraint importante:** `UNIQUE(user_id, name)` — impede duplicatas.
> Migration: `20260323120000_fix_duplicate_pipeline_stages.sql`

#### `crm_leads`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid | ID único |
| `user_id` | uuid | FK para o usuário |
| `stage_id` | uuid | FK para `crm_pipeline_stages` |
| `name` | text | Nome do lead |
| `email` | text | Email |
| `phone` | text | WhatsApp (com DDD) |
| `company` | text | Empresa |
| `value` | numeric | Valor do negócio |
| `priority` | text | `low`, `medium`, `high` |
| `source` | text | Origem: `formulario`, `whatsapp`, `manual` |
| `follow_up_date` | timestamp | Data de follow-up |
| `utm_source` | text | UTM de rastreamento |
| `utm_campaign` | text | Campanha de rastreamento |
| `custom_fields` | jsonb | Dados extras (flexível) |
| `position` | int | Ordem dentro da coluna |
| `tags` | text[] | Array de tags |

### Tabelas de Automação WhatsApp

#### `wa_automations`
Configura gatilhos automáticos de WhatsApp.
- Campo `trigger_event`: `new_lead`, `stage_change`, etc.
- Campo `action_type`: `notify_webhook`
- Campo `action_config` (JSONB): `{ "webhook_url": "https://n8n.exemplo.com/webhook/xxx" }`

**Funcionamento:** Quando um lead é criado via `addLead()`, o hook `useFluxCRM` consulta as automações ativas com `trigger_event = 'new_lead'` e faz um POST no webhook configurado.

---

## 8. MÓDULO CRM — Como Funciona

### FluxCRM.tsx (Página Principal)
- Usa o hook `useFluxCRM()` para buscar dados
- Deduplication de stages por nome (via `useMemo`) para evitar colunas duplicadas mesmo se o banco tiver duplicatas antigas
- Drag-and-drop usando `@hello-pangea/dnd`
- Mapa canônico de stages: garante que drop em qualquer coluna persistindo o ID correto no banco

### useFluxCRM.ts (Hook de Dados)
- `fetchData()`: busca stages e leads em paralelo
- Seed automático: se não há stages, cria os 5 padrão com `upsert` (seguro contra race conditions)
- `addLead()`: cria lead + dispara webhook se houver automação `new_lead`
- `moveLead()`: otimistic update local + persiste no Supabase

### CRMContacts.tsx (Página de Contatos)
- Agrupa todos os leads por etapa (colapsível)
- KPIs no topo (total + por etapa)
- Busca por nome, telefone, email
- Filtro por etapa
- Exportação para CSV (com BOM para Excel brasileiro)
- Link rápido de WhatsApp por contato

---

## 9. IDENTIDADE VISUAL E LOGO

### Logo Logos IA
- **Arquivo:** `public/logosia-brand.png`
- **Problema conhecido:** A imagem original tem fundo branco, não transparente.
- **Solução CSS aplicada:**
  - Modo claro: `mix-blend-multiply` (remove o fundo branco visualmente)
  - Modo escuro: `dark:mix-blend-normal dark:bg-white dark:p-3 dark:rounded-2xl` (coloca fundo branco para o logo ser visível)
- **Onde é usado:**
  - `src/pages/Auth.tsx` — tela de login (tamanho: `h-24`)
  - `src/pages/LandingPage.tsx` — landing page pública
  - `src/components/layout/AppSidebar.tsx` — sidebar (colapsado: `h-10`, expandido: `h-14`)

### Tema
- Suporta **modo claro e escuro** via Tailwind + classe `dark:`
- Toggle de tema no rodapé da sidebar (`Modo Claro / Modo Escuro`)

---

## 10. ROTAS DO SISTEMA

| Rota | Componente | Descrição |
|------|-----------|-----------|
| `/` | `LandingPage` | Página pública de marketing |
| `/auth` | `Auth` | Login e Cadastro |
| `/dashboard` | `Dashboard` | Painel principal |
| `/crm` | `FluxCRM` | CRM Kanban |
| `/crm/contacts` | `CRMContacts` | Lista de contatos |
| `/whatsapp/instances` | `WhatsAppInstances` | Gestão de instâncias |
| `/whatsapp/inbox` | `WhatsAppInbox` | Caixa de entrada |
| `/whatsapp/broadcast` | `WhatsAppBroadcast` | Disparo em massa |
| `/whatsapp/automations` | `WhatsAppAutomations` | Automações |
| `/whatsapp/ai-agent` | `WhatsAppAIAgent` | Agente IA (Pedro) |
| `/apollo` | `ApolloDashboard` | Tráfego Pago (José) |
| `/salomao` | `SalomaoOrchestrator` | Orquestrador IA |
| `/settings` | `Settings` | Configurações |
| `/integrations` | `Integrations` | Integrações externas |

---

## 11. PRÓXIMAS FUNCIONALIDADES PLANEJADAS

1. **Edge Function `crm-capture`** — Endpoint público para receber leads de formulários externos
   - Aceitar POST com `{ name, email, phone, source, custom_fields }`
   - Criar o lead na etapa "Novo Lead" automaticamente
   - Retornar URL do webhook para o usuário configurar em seu formulário

2. **Gatilhos de Kanban → WhatsApp**
   - Arrastar para "Fechado" → dispara mensagem de boas-vindas pós-venda
   - Arrastar para "Negociação" → dispara follow-up

3. **Follow-up Automático por Data**
   - Cron job lê `follow_up_date` dos leads
   - Dispara reativação via WhatsApp automaticamente

---

## 12. COMANDOS ÚTEIS

```powershell
# Desenvolvimento local
npm run dev

# Verificar build antes de subir
npm run build

# Git — Fluxo completo de push para produção
git add .
git commit -m "feat/fix/style: descrição"
git push origin dev-douglas
git checkout main
git pull origin main
git merge dev-douglas
git push origin main
git checkout dev-douglas
```

---

## 13. CONTATOS E ACESSO

| Recurso | Onde acessar |
|---------|-------------|
| GitHub | `https://github.com/Agencia-Up/humanizeia` |
| Supabase | `https://supabase.com` → projeto `seyljsqmhlopkcauhlor` |
| Easypanel | URL da VPS (acesso privado do cliente) |
| Domínio | `logosiabrasil.com` (registrado separadamente) |

---

> **Nota para o Agente:** Se você é um Claude sendo iniciado nesse projeto, leia este arquivo por completo antes de começar qualquer alteração. Siga sempre o fluxo de commits da seção 2.3. Nunca edite direto na branch `main`.
