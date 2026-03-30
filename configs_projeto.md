# 🧠 CONFIGS_PROJETO — Logos IA (Documentação Mestra)
> Este arquivo serve para treinar e situar novos agentes de IA sobre toda a infraestrutura e regras do projeto.
> **Última Atualização:** 24/03/2026 às 21:15

---

## 1. RESUMO GERAL DO PROJETO
- **Nome:** Logos IA (Anteriormente HumanizeAI).
- **O que é:** Plataforma SaaS de Marketing e Vendas com Agentes de IA integrados.
- **Tecnologias:** React (Vite), TypeScript, Tailwind CSS, Shadcn/UI (Frontend) e Supabase (Backend/Auth/DB).
- **Repositório:** `https://github.com/Agencia-Up/humanizeia`
- **Infra:** VPS própria com Easypanel + Docker + Nginx.

---

## 2. INFRAESTRUTURA E DEPLOY (CRÍTICO)

### 2.1 Fluxo de Deploy
- O projeto usa um **Dockerfile de 2 estágios** (Build com Node e Produção com Nginx).
- **Branch de Deploy:** O Easypanel puxa da branch `main`.
- **Porta interna:** O container Nginx roda na **porta 80 (HTTP)**.
- **Configuração de Domínio no Easypanel (Service -> Domains):** 
  - **Host:** `logosiabrasil.com` e `www.logosiabrasil.com`.
  - **Protocolo de Destino:** `HTTP` (O SSL é gerado pelo Let's Encrypt do Easypanel na borda).
  - **Porta de Destino:** `80`.

### 2.2 DNS e SSL (Troubleshooting)
- **SSL Error (404/ERR_SSL_UNRECOGNIZED_NAME_ALERT):** Resolvido ao remover a entrada "Parked" no DNS do GoDaddy que conflitava com o IP real.
- **IP do Servidor:** `72.62.140.186` (Atualizado Março/2026).
- **Importante:** Sempre garanta que não há entradas "A" fantasmas ou marcadas como "Parked" no painel de DNS.

---

## 3. PERFORMANCE (TANSTACK QUERY)
O projeto foi refatorado para usar o **TanStack Query (React Query)** nos hooks globais para evitar loops de requisições e lentidão extrema:
- **`useOrganization.ts`**: Agora faz cache do `organization_id` por 5 minutos.
- **`useFluxCRM.ts`**: Faz cache e invalidação automática dos leads e estágios.
- **Regra:** Sempre que adicionar uma nova busca de dados global, use `useQuery` para não pesar o carregamento inicial.

---

## 4. O QUE FOI FEITO RECENTEMENTE (CONTEXTO ATUAL)

### 4.1 Notificações e IA
- **Bug 400 (Bad Request):** Corrigido na tabela `notifications`. O campo `reference_id` deve ser **TEXT** (e não UUID), pois a IA envia IDs como "anomaly-cpc".
- **Hook:** `useCampaignNotifications.ts`.

### 4.2 CRM e Kanban
- **Módulo:** `src/pages/FluxCRM.tsx` e `src/pages/CRMContacts.tsx`.
- **Bug 404:** A rota `/crm/contacts` foi restaurada no `App.tsx` após ser perdida em um merge.
- **Deduplicação:** O backend tem `UNIQUE constraint` nos nomes das etapas por usuário para evitar duplicidade.

### 4.3 Captura de Leads
- **Edge Function:** `crm-capture` (Deno) no Supabase. Recebe JSON de formulários externos e insere no CRM.
- **Integração:** URL de Webhook visível em **/integrations**.

---

## 5. REGRAS DE COLABORAÇÃO (GIT)
Estamos trabalhando em duas frentes: `dev-douglas` e `dev-wander`.
**Fluxo OBRIGATÓRIO para evitar conflitos:**

1. Altere o código na sua branch `dev-X`.
2. Push para sua branch.
3. Merge na `main` para disparar o deploy no Easypanel.

---

## 6. INSTRUÇÕES PARA O PRÓXIMO AGENTE (CLAUDE)
Ao assumir este projeto:
1. **Verifique o `App.tsx`**: É o mapa de todas as rotas ativas.
2. **Respeite o Design System**: Use as cores do LogosIA (Azul profundo `#1A237E` e Ouro `#DAA520`) definidas em `index.css`.
3. **Não remova o React Query**: O site é pesado e depende de cache para não cair em "loop" de carregamento.
4. **Deploy:** Se o site der 404 em produção mas estiver OK local, force um "Rebuild" no Easypanel.
5. **Supabase:** Qualquer alteração no banco de dados (migrations) deve ser enviada para o usuário subir manualmente.


---

## 7. DOMÍNIOS ATIVOS
- **Produção:** `https://logosiabrasil.com`
- **Backup:** `https://logos-ia-github.pqaykh.easypanel.host`

---
*Este documento é a "medula espinhal" do projeto. Mantenha-o sempre atualizado para o próximo agente.*

