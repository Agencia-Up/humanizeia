# 🧠 CONFIGS_PROJETO — Logos IA (Documentação Mestra)
> Este arquivo serve para treinar e situar novos agentes de IA sobre toda a infraestrutura e regras do projeto.
> **Última Atualização:** 24/03/2026 às 13:40

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
- **Configuração de Domínio no Easypanel:** 
  - **Host:** `logosiabrasil.com`
  - **Protocolo de Destino:** `HTTP` (Nunca mude para HTTPS no campo de destino, pois o Nginx interno não tem SSL, o SSL é feito pelo Easypanel no lado de fora).
  - **Porta de Destino:** `80`.

### 2.2 Variáveis de Ambiente (Build Args)
Devem ser configuradas no Easypanel para o Vite conseguir injetar no build:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_PROJECT_ID`

---

## 3. REGRAS DE COLABORAÇÃO (GIT)
Estamos trabalhando em duas frentes: `dev-douglas` e `dev-wander`.
**Fluxo OBRIGATÓRIO para evitar conflitos:**

1. Altere o código na sua branch `dev-X`.
2. Execute a sequência:
```powershell
git add .
git commit -m "feat: sua mensagem"
git push origin dev-X
git checkout main
git pull origin main
git merge dev-X
git push origin main
git checkout dev-X
```

---

## 4. O QUE FOI FEITO RECENTEMENTE (CONTEXTO ATUAL)

### 4.1 Rebranding
- Todo o site foi renomeado para **Logos IA**.
- Logo oficial localizado em `public/logosia-brand.png` (com fundo branco, tratado via CSS `mix-blend-multiply` no modo claro).

### 4.2 CRM e Kanban
- **Módulo:** `src/pages/FluxCRM.tsx` e `src/pages/CRMContacts.tsx`.
- **Bug Corrigido:** As colunas do Kanban estavam duplicando devido a race conditions no seeding de etapas. Agora o backend tem uma `UNIQUE constraint` e o frontend faz deduplicação por nome (`useMemo`).
- **Página de Contatos:** Lista leads agrupados por etapa do pipeline com busca e exportação CSV.

### 4.3 Captura de Leads (Novo!)
- **Edge Function:** Criei a função `crm-capture` (Deno) no Supabase para receber leads de formulários externos.
- **Integração:** Adicionado uma aba "Captura de Leads" em **Integrações**, onde o usuário vê sua URL de Webhook e o Payload necessário.

---

## 5. ESTRUTURA DE DADOS (SUPABASE)

- **Tabela `crm_pipeline_stages`**: Define as etapas do Kanban.
- **Tabela `crm_leads`**: Dados dos clientes captados. 
- **Tabela `wa_automations`**: Define webhooks para disparar mensagens no WhatsApp via n8n quando um evento (`new_lead`) ocorre.

---

## 6. INSTRUÇÕES PARA O AGENTE (CLAUDE)
Ao assumir este projeto:
1. SEMPRE verifique o arquivo `src/App.tsx` para entender as rotas.
2. NUNCA edite diretamente na `main`, use as branches de desenvolvimento.
3. SEMPRE salve as configurações novas neste arquivo ou no `CHANGELOG.md`.
4. As imagens devem ser carregadas preferencialmente da pasta `public/`.
5. Ao lidar com o CRM, lembre-se da `UNIQUE constraint` em `(user_id, name)` da tabela de stages.

---

## 7. DOMÍNIOS ATIVOS
- **Produção:** `https://logosiabrasil.com` (Usa IP fixo da VPS).
- **Temporário:** `https://logos-ia-github.pqaykh.easypanel.host` (Configuração HTTP portal 80).

---
*Este documento é a "medula espinhal" do projeto. Mantenha-o sempre atualizado.*
