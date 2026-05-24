# Arquitetura

## Stack principal

- Frontend: React 18, TypeScript, Vite.
- UI: Tailwind CSS, shadcn-ui/Radix, lucide-react, framer-motion.
- Estado/dados: TanStack Query, Zustand, Supabase JS.
- Graficos: Recharts.
- Drag and drop: `@hello-pangea/dnd`.
- Planilhas/importacao: `xlsx`.
- Backend: Supabase Postgres, Auth, RLS, Edge Functions em Deno/TypeScript.
- Deploy web: Docker multi-stage + Nginx.

## Estrutura local relevante

- `src/App.tsx`: registro principal de rotas.
- `src/pages`: paginas principais, incluindo Pedro, Marcos, Dashboard, Auth e Landing.
- `src/components`: componentes por dominio (`pedro`, `marcos`, `whatsapp`, `layout`, `auth`, etc.).
- `src/integrations/supabase/client.ts`: cliente Supabase browser usando variaveis Vite.
- `src/integrations/supabase/types.ts`: tipos gerados/maintidos para o banco.
- `supabase/functions`: Edge Functions.
- `supabase/migrations`: migrations SQL.
- `scripts`: utilitarios locais para sync, Supabase, build, testes e diagnostico.
- `Dockerfile` e `nginx.conf`: build e entrega via Nginx no Easypanel.

## Rotas principais

Rotas de entrada/publicas:

- `/`: landing page.
- `/auth`: login/cadastro.
- `/auth/confirm`: confirmacao de email.
- `/reset-password`: redefinicao de senha.
- `/criar-senha`: criacao de senha de vendedor.
- `/privacy`, `/terms`: politicas.
- `/f/:formId`: formulario publico.

Rotas protegidas principais:

- `/tela-inicial`: tela inicial/hub atual do portal.
- `/dashboard`: dashboard comercial novo comparando Pedro e Marcos.
- `/metrics`: dashboard antigo de metricas/anuncios.
- `/pedro`: agente Pedro SDR.
- `/marcos`: agente Marcos CRM & Leads.
- `/jose`: Jose Trafego Pago.
- `/whatsapp/*`: inbox, contatos, broadcast, analytics, automacoes, instancias, agente IA, CRM ao Vivo, campanhas, grupos e CAPI.
- `/crm`, `/crm/contacts`, `/crm/formularios`: funil/CRM legado ou compartilhado.
- `/integrations`, `/settings`, `/perfil`, `/meu-plano`, `/treinamento`: configuracoes e operacao.
- Rotas admin: optimizer, budget, analytics, rules, ab-testing, library, reports, academy, creative-intelligence, competitor-radar, Google/LinkedIn Ads, gerador de prompt.

## Supabase

Projeto de producao referenciado em `supabase/config.toml`:

- `project_id`: `seyljsqmhlopkcauhlor`.

Variaveis esperadas no frontend/build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Variaveis esperadas em Edge Functions/ambiente Supabase (nomes, sem valores):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `LOVABLE_API_KEY`
- Variaveis de Uazapi/Evolution conforme function/integacao.
- Variaveis de Meta/Google/LinkedIn/TikTok/Asaas conforme function.

## Edge Functions importantes

Atendimento/WhatsApp/Pedro:

- `uazapi-webhook`: fluxo principal Uazapi/Pedro, IA, BNDV, transferencia e mensagens.
- `wa-inbox-webhook`: webhook/inbox WhatsApp.
- `manual-transfer`: transferencia manual.
- `bulk-transfer-leads`: transferencia em massa.
- `pedro-trigger-followup`: follow-up Pedro.
- `pedro-process-feedback`: processamento de feedback.
- `transfer-timeout-checker`: checagem de timeout/transferencia.
- `process-whatsapp-queue`: fila de envio WhatsApp.

Marcos/campanhas:

- `enqueue-campaign`: enfileira campanha.
- `campaign-executor`: executor de campanha.
- `orchestrate-campaign`: variacoes/execucao com IA.
- `preview-wa-variations`: pre-visualizacao de variacoes.
- `process-followup-queue`: fila de follow-ups.
- `wa-automation-runner`: automacoes.
- `sanitize-contacts`, `wa-extract-groups`, `wa-send-reply`.

Integracoes:

- `test-integration`: valida integracoes como BNDV.
- `bndv-stock-search`: consulta estoque BNDV.
- `meta-api`, `meta-oauth`, `meta-capi-*`.
- `google-ads-api`, `google-ads-oauth`.
- `linkedin-ads-api`, `linkedin-ads-oauth`.
- `send-email`, `shopify-integration`, `asaas-*`.

IA e agentes auxiliares:

- `claude-chat`, `claude-strategy`, `apollo-agent`, `apollo-analyze`.
- `generate-agent-funnel-prompt`, `generate-creative`, `knowledge-embed`, `knowledge-search`.
- `jose-*`, `social-media-api`, `prompt-generator-api`, `academy-ai`.

## Banco de dados

O projeto usa migrations em `supabase/migrations`. Tabelas e areas citadas no historico recente:

- `ai_crm_leads`: funil/CRM do Pedro.
- `crm_leads`: CRM manual/Marcos.
- `crm_pipeline_stages`: etapas dos CRMs.
- `crm_column_preferences`: preferencia de ordem de colunas por usuario.
- `ai_team_members`: vendedores/equipe/rodizio.
- `wa_instances`: instancias WhatsApp/Uazapi.
- `wa_campaigns`, `wa_campaign_recipients`, filas de campanha.
- `wa_contact_lists`, `wa_contact_list_members`: listas e contatos.
- `marcos_followup_schedules`: follow-ups Marcos.
- `pedro_crm_notes`, `marcos_crm_notes`: anotacoes.
- `platform_integrations`: integracoes externas como BNDV.
- `profiles`: usuarios/perfis/plano/permissoes.

## Servicos externos

- Supabase: Auth, Postgres, RLS, Edge Functions, cron, Storage/Realtime quando usado.
- Uazapi: WhatsApp/instancias/envio/recebimento.
- BNDV: estoque automotivo via GraphQL.
- OpenAI/Anthropic/Lovable: respostas/variacoes/analises de IA.
- Meta Ads/CAPI, Google Ads, LinkedIn Ads, TikTok: marketing.
- Asaas: checkout/pagamentos.
- Easypanel: deploy do frontend Docker/Nginx.
- GitHub: repositorio e gatilho de deploy.

## Observacoes de seguranca

- Existem arquivos sensiveis no repo local como `.env` e `secrets.txt`. Nao ler/copiar valores para o cerebro.
- Varias Edge Functions em `supabase/config.toml` estao com `verify_jwt = false`; isso exige validacao interna forte em cada function.
- Evitar service role no frontend. Frontend deve usar somente publishable/anon key e RLS.
- Ao mexer em RLS, testar gerente, vendedor e usuario comum.

