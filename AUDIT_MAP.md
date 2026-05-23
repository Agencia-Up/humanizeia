# AUDIT_MAP.md — Mapeamento estático do Logsar (LogosIA Platform)

> **Fase 1/5** do projeto de Auditoria e Correção Total de Bugs.
> **Data:** 2026-05-23 | **Gerado por:** 4 Explore agents em paralelo + consolidação manual.
> **Sistema:** CRM + plataforma de 9 agentes IA WhatsApp para concessionárias automotivas.
> **Stack:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui + Supabase (Postgres + Auth + Edge Functions Deno + Realtime).
> **Projeto Supabase PROD:** `seyljsqmhlopkcauhlor` | **STAGING:** `ezoltigtqgbmftmiwjxh`.
> **NENHUM ARQUIVO DE CÓDIGO ALTERADO NESTA FASE.**

---

## 1. ROTAS DO FRONTEND (por módulo)

Registro central: `src/App.tsx` com `lazy()` em todas as páginas.

### Públicas (sem auth)
- `/auth` → Auth | `/auth/confirm` → ConfirmEmail | `/reset-password` → ResetPassword | `/criar-senha` → SetSellerPassword
- `/checkout`, `/checkout/sucesso`, `/onboarding` → Checkout/Onboarding
- `/f/:formId` → FormPublico (formulários de captura externos)

### Protegidas (ProtectedRoute → useAuth)

**Dashboard & Painel:** `/dashboard` (AgentHub), `/metrics` (MetricsDashboard), `/niche-quiz`, `/briefing/:nicho`, `/performance` (SupportDashboard), `/perfil` (Profile).

**Agentes IA (9):** `/salomao`, `/daniel`, `/paulo` (ou `/copywriter`), `/maria` (ou `/creative-studio`), `/lucas`, `/jose`, `/davi`, `/joao`, `/marcos`, `/pedro`.

**CRM & Leads:** `/crm` (FluxCRM), `/crm/contacts`, `/crm/formularios`, `/leads`, `/agente/:agentId/funil`.

**WhatsApp:** `/whatsapp/inbox`, `/whatsapp/contacts`, `/whatsapp/broadcast`, `/whatsapp/analytics`, `/whatsapp/automations`, **`/whatsapp/instances`** (foco B3), `/whatsapp/ai-agent`, `/whatsapp/campaigns`, `/whatsapp/groups`, `/whatsapp/capi`, `/whatsapp/crm-ao-vivo`.

**Admin & Sistema (AdminRoute):** `/configuracoes/campos-dinamicos`, `/meu-plano`, `/settings`, `/integrations`, `/connect-accounts`, `/tutorials`, `/treinamento`.

---

## 2. EDGE FUNCTIONS (Supabase) — 85 totais

Pasta: `supabase/functions/`. Padrão: cada subpasta tem `index.ts` (Deno). 69 exigem JWT, 16 são webhook receivers, 12 são crons.

### Por agente / módulo

| Módulo | Funções principais |
|---|---|
| **Salomão / Orquestração** | `prompt-generator-api`, `claude-strategy`, `claude-chat` (multi-contexto) |
| **Daniel** | `daniel-strategy-api` |
| **José (Apollo / Tráfego)** | `apollo-agent`, `apollo-analyze`, `apollo-measure-outcomes`, `apollo-cron-runner`, `jose-agent`, `jose-analyze`, `meta-api`, `meta-oauth`, `meta-capi-send`, `google-ads-api`, `google-ads-oauth`, `linkedin-ads-api`, `tiktok-oauth` |
| **Paulo** | `claude-chat` (context paulo), `paulo-carousel-api` |
| **Lucas** | `lucas-funnel-api` |
| **Maria** | `generate-creative`, `edit-image`, `remove-bg` |
| **João** | `joao-email-api`, `send-email` (Resend) |
| **Davi** | `social-media-api` |
| **Marcos (WhatsApp/CRM)** | `crm-capture`, **`uazapi-webhook`** (foco B3), `wa-inbox-webhook`, `wa-send-reply`, `wa-extract-groups`, `wa-capi-track-lead`, `wa-capi-process-queue`, `process-whatsapp-queue`, **`create-evolution-instance`**, **`get-evolution-qrcode`**, **`verify-instance-status`** (foco B3), **`handle-instance-ban`** (foco B3), `sync-evolution-webhook`, `sanitize-contacts`, `extract-google-maps-leads` |
| **Campanhas** | `save-campaign`, `enqueue-campaign`, `campaign-executor`, `orchestrate-campaign`, `setup-webhooks` |
| **Feedback gerente** | `pedro-process-feedback`, `cron-flush-manager-feedbacks` |
| **Automações** | `wa-automation-runner` (Item 4 recém-criado, MVP) |
| **Vendedores** | (não encontrei `invite-seller` explícito — investigar — pode ser INSERT direto via `ai_team_members` do front) |
| **Outras** | `checkout-asaas-webhook`, `asaas-webhook`, `shopify-integration`, `knowledge-embed`, `knowledge-search`, `academy-ai`, `apply-theme`, `test-evolution-connection`, `test-integration` |

---

## 3. WEBHOOKS (entrada e saída)

### Receivers (recebem de fora)

| Função | Origem | Evento | Observação |
|---|---|---|---|
| `wa-inbox-webhook` | UazAPI / Evolution | `messages.upsert` (mensagens recebidas WhatsApp) | Lead/cliente envia msg |
| **`uazapi-webhook`** | UazAPI | `messages.*`, `connection.update`, `status`, `qr.update` | Eventos múltiplos: msg + STATUS DE INSTÂNCIA (foco B3) |
| `checkout-asaas-webhook` | Asaas | Eventos de pagamento/cobrança | Configurado no painel Asaas |
| `crm-capture` | Formulários externos | Submissões de formulários `/f/:formId` | Lead público preenche |

### Emissores (chamam APIs externas)

| Função | Destino |
|---|---|
| `meta-capi-send`, `wa-capi-track-lead` | Meta CAPI (eventos de conversão) |
| `meta-oauth`, `google-ads-oauth`, `linkedin-ads-oauth`, `tiktok-oauth` | OAuth |
| `send-email`, `joao-email-api` | Resend |
| `apollo-*`, `meta-api`, `google-ads-api` | Meta Ads, Google Ads |
| `uazapi-webhook` (handler de msg) → chama Anthropic/OpenAI | LLM providers |

---

## 4. CRONS AGENDADOS (pg_cron)

Lista em `supabase/migrations/`:

| Job | Schedule | RPC Handler | Edge Function chamada |
|---|---|---|---|
| `auto-classify-leads-hourly` | `7 * * * *` | `cron_auto_classify_all_masters()` | `auto-classify-leads` |
| `pedro-trigger-followup` | `*/15 * * * *` | `cron_pedro_trigger_followup_runner()` | `pedro-trigger-followup` |
| `flush-manager-feedbacks-5min` | `*/5 * * * *` | `cron_flush_manager_feedbacks_runner()` | `cron-flush-manager-feedbacks` |
| `auto-start-scheduled-campaigns-hourly` | `0 * * * *` | `cron_auto_start_scheduled_campaigns_runner()` | `enqueue-campaign` |
| `process-whatsapp-queue-2min` | `*/2 * * * *` | `cron_process_whatsapp_queue_runner()` | `process-whatsapp-queue` |
| `wa-automation-runner-5min` (NOVO Item 4) | `*/5 * * * *` | `cron_wa_automation_runner()` | `wa-automation-runner` |

> **⚠️ Importante:** **NENHUM cron dispara `verify-instance-status`** — é on-demand via botão no front ou cascata via outras funções. Isso é relevante pro B3.

---

## 5. TABELAS DO BANCO — 8 críticas

### `ai_team_members` (vendedores Pedro)
- `id` (UUID PK), `user_id` (FK→auth.users **CASCADE**), `auth_user_id` (UUID, login do vendedor), `agent_id` (FK→wa_ai_agents **SET NULL**), `name`, `whatsapp_number`, `is_active`, timestamps.

### `profiles` (usuários)
- `id` (PK = auth.users.id **CASCADE**), `full_name`, `company_name`, `role` (owner/seller), `manager_id` (FK→auth.users), `onboarding_completed`, timestamps.

### `wa_instances` (instâncias WhatsApp)
- `id` (UUID PK), `user_id` (FK→auth.users **RESTRICT** ⚠️), `organization_id` (FK→organizations **CASCADE**), `instance_name`, `phone_number`, `status` (`disconnected`/`connecting`/`connected`/`error`), `is_active` (bool), `seller_member_id` (FK→ai_team_members **SET NULL**), `api_url`, `api_key_encrypted`, `health_score` (int), `consecutive_undelivered` (int), `shadow_ban_suspect` (bool), timestamps.
- **PROBLEMA B3:** Sem state-machine validado por trigger — `disconnected → connected → banned` não é forçado a ser sequencial.

### `wa_ai_agents` (agentes IA WhatsApp)
- Referenciado por `ai_team_members.agent_id` e `ai_crm_leads.agent_id`.
- Campos: `gerente_phone` (telefone destinatário de feedbacks), `instance_id`, `instance_ids[]`, `is_active`.

### `ai_crm_leads` (leads Pedro)
- `id` (UUID PK), `user_id` (FK→auth.users **CASCADE**), `assigned_to_id` (FK→ai_team_members **SET NULL**), `agent_id` (FK→wa_ai_agents **SET NULL**), `instance_id`, `lead_name`, `remote_jid`, `status`, `status_crm`, `client_city`, `vehicle_interest`, `visit_scheduled`, `visit_scheduled_at` (timestamptz), `summary`, `next_followup_at`, `last_user_reply_at`, `seller_notes_count`, timestamps.

### `crm_leads` (leads Marcos)
- `id` (UUID PK), `user_id` (FK→auth.users **CASCADE**), `stage_id` (FK→crm_pipeline_stages **SET NULL**), `name`, `phone`, `assigned_to` (text — DIFERENTE do Pedro que usa FK ⚠️), `source`, `priority`, `client_city`, `vehicle_interest`, `visit_scheduled`, `visit_scheduled_at`, `custom_fields` (jsonb), timestamps.

### `wa_contacts` (contatos WhatsApp)
- `id` (UUID PK), `user_id` (FK→auth.users **CASCADE**), `list_id` (FK→wa_contact_lists **CASCADE**), `phone`, `name`, timestamps.
- **PROBLEMA:** Sem `ON DELETE` definido quando instância é removida — contatos podem ficar órfãos.

### `wa_contact_lists` + `wa_contact_list_members` (junction N:N nova do Item 4)
- `wa_contact_lists`: id, user_id (CASCADE), name, contact_count.
- `wa_contact_list_members` (Item 4): `(contact_id, list_id)` PK composto, user_id, added_at, added_by.

---

## 6. RLS POLICIES (por tabela crítica)

Padrão dominante: **`auth.uid() = user_id`** (owner manage). Algumas tabelas têm policies recursivas resolvidas via funções `SECURITY DEFINER`.

| Tabela | Policy | Cláusula |
|---|---|---|
| `ai_team_members` | "Users can manage own team members" | `auth.uid() = user_id` (master vê seus vendedores) |
| `ai_crm_leads` | "seller_view_own_leads" | EXISTS check em ai_team_members |
| `crm_leads` | "seller_view_own_marcos_crm_leads" | Usa `get_seller_master_user_id()` + `get_seller_member_ids_text()` (DEFINER — evita recursão) |
| `wa_instances` | "owner manage" | `auth.uid() = user_id` |
| `wa_ai_agents` | "owner manage" | `auth.uid() = user_id` |
| `pedro_manager_feedback` | "owner_read" / "owner_manage" | `auth.uid() = user_id` |
| `manager_feedback_config` | "owner_manage_feedback_config" | `auth.uid() = user_id` |
| `wa_automation_flows` | "owner_manage_waf" | `auth.uid() = user_id` |
| `wa_automation_runs` | "owner_read_war" | `auth.uid() = user_id` — INSERT/UPDATE/DELETE só service_role (executor) |
| `wa_contact_list_members` | "owner_manage_wclm" | `auth.uid() = user_id` |

**Migrations-chave:** `20260507000001_fix_recursive_seller_rls.sql`, `20260516173000_marcos_seller_crm_rls.sql`.

---

## 7. TRIGGERS + FUNCTIONS PG (críticos)

### Triggers
- `trg_pedro_notes_count` (AFTER INS/DEL `pedro_crm_notes`) → `sync_pedro_notes_count()` (mantém `ai_crm_leads.seller_notes_count`)
- `trg_waf_updated_at` (BEFORE UPD `wa_automation_flows`) → `tg_set_updated_at()`
- `trg_manager_feedback_config_updated_at` (BEFORE UPD `manager_feedback_config`) → `tg_set_updated_at()`
- Múltiplos triggers de auditoria em `20260520200000_dynamic_field_settings.sql` (cidades, lead_sources)

### Functions DEFINER
- `get_seller_master_user_id()` — evita recursão RLS em ai_team_members
- `get_seller_member_ids_text()` — lista IDs de membros do vendedor logado
- `claim_pedro_followup_schedules()` — fila de follow-up atômica
- `claim_marcos_followup_schedules()` — análoga para Marcos
- `increment_consecutive_undelivered(instance_id)` — incrementa contador de falhas (foco B3, threshold 10)
- `decrement_instance_health(instance_id)` — decrementa score (sem cap mínimo ⚠️)
- `cron_*_runner()` — wrappers SECURITY DEFINER pra crons (escondem service_role)

---

## 8. SUBSCRIPTIONS REALTIME

| Arquivo | Canal | Tabela(s) escutadas | Filtro | Handler |
|---|---|---|---|---|
| `src/components/whatsapp/GlobalLeadsCrm.tsx:123-135` | `'crm-realtime'` | `ai_crm_leads`, `ai_lead_transfers` (todas operações) | `user_id=eq.${effectiveUserId}` | `fetchAllRef.current()` — refetch completo |
| `src/components/evolution/EvolutionConnectDialog.tsx:185-198` | `'instance-status-${slug}'` | `wa_instances` (UPDATE) | `instance_name=eq.${slug}` | Monitora `status` + `is_active`, chama `handleSuccess()` |

> **⚠️ B3:** EvolutionConnectDialog usa Realtime **+ polling de 5s simultaneamente** → race condition potencial.

---

## 9. FLUXOS DOS 3 BUGS REPORTADOS

### B1 — Cadastrar vendedor (falha intermitente, página fica inativa)

```
[FRONT] SellerManagerTab.tsx:334 (handleAddSeller)
  → validação local (nome+phone+email)
  → setSaving(true)  ⚠️ sem timeout
  → supabase.from('ai_team_members').insert({...})
  → fetchData()  ⚠️ se travar, saving=true fica eternamente
  → setSaving(false)

[BANCO]
  ai_team_members INSERT
  → RLS "auth.uid() = user_id" valida
  → SEM trigger de cascade
  → SEM transação (se houver função RPC create_seller_with_wa_instance, ela cria auth.users → ai_team_members → wa_instances → webhook setup SEM rollback explícito)
```

**Suspeitas B1:**
- Sem timeout no `fetchData()` deixa UI eternamente em loading
- Possível `invite-seller` edge function não encontrada — investigar se é chamada de outra forma
- Se RPC `create_seller_with_wa_instance()` existe e cria `auth.users` antes de `ai_team_members`, falha mid-flow deixa user órfão
- RLS exige `auth.uid() = user_id` → novo vendedor não consegue se logar até confirmar email
- Plano PRO limita 2 vendedores ativos → erro silencioso sem mensagem clara?

---

### B2 — Remover vendedor (não funciona)

```
[FRONT] SellerManagerTab.tsx:394 (handleDelete)
  → confirm() nativo do browser
  → supabase.from('ai_team_members').delete().eq('id', id)
  ⚠️ remove do estado local ANTES de confirmar sucesso do DELETE
  ⚠️ não trata error explicitamente

[BANCO]
  ai_team_members DELETE
  → RLS valida auth.uid() = user_id
  → FK ai_crm_leads.assigned_to_id (SET NULL) — lead fica órfão sem notificação
  → FK pedro_crm_notes.member_id (SET NULL)
  → FK marcos_followup_schedules.member_id (SET NULL)
  → FK wa_instances.seller_member_id (SET NULL) — instância vira "sem dono"
  ❌ Evolution/UazAPI instance NÃO é deautenticada — fica fantasma no provedor
  ❌ wa_contacts / wa_queue / wa_campaigns vinculados à instância continuam órfãos
```

**Suspeitas B2:**
- Estado local desincronizado quando DELETE falha (UI mostra removido mas DB tem o registro)
- FK constraint potencial bloqueando DELETE silenciosamente (se algum RESTRICT existir)
- Sem cleanup da instância no provedor externo (UazAPI fica acumulando instâncias mortas)

---

### B3 — Instância WhatsApp oscilando (CRÍTICO — múltiplos vetores)

```
[FRONT] WhatsAppInstances.tsx + EvolutionConnectDialog.tsx
  → fetchInstances() AO CARREGAR PÁGINA → chama verifyAllInstances()
  → Polling a cada 5s no dialog de conectar
  → Subscription realtime na MESMA tabela wa_instances
  ⚠️ Polling + Realtime simultaneamente → handleSuccess() pode ser chamado 2x

[WEBHOOK ENTRADA] uazapi-webhook recebe { status: 'close' | 'open' | 'connecting' }
  → atualiza wa_instances.status
  ❌ SEM dedup de eventos de status (dedup só existe pra mensagens)
  ❌ SEM rate limit por instance_name

[BACKEND DISPARADO POR POLLING] verify-instance-status
  → GET /instance/status (UazAPI)
  → se falha: GET /instance/connectionState/{name}
  → se falha de novo: POST /instance/connect  ⚠️⚠️⚠️ FORÇA RECONEXÃO!
  → atualiza wa_instances.status
  → se status='connecting' marca como 'connected' (linha 150 — permissivo)

[CASCATA POTENCIAL] handle-instance-ban
  → increment_consecutive_undelivered() (threshold 10)
  → se atingir: shadow_ban_suspect=true, is_active=false, health_score -= 50
  ❌ Sem reset de consecutive_undelivered ao reconectar com sucesso
  ❌ health_score -= 50 sem cap mínimo — instância afundada permanentemente

[LOOP IDENTIFICADO]
  webhook (close) → verify-status (POST connect) → UazAPI reconecta
  → webhook (open) → verify-status retriggered
  → eventualmente threshold ban → marca como inativa
  → master/vendedor reativa → webhook (open) → loop reinicia
```

**Suspeitas B3 (ranqueadas):**
- **🔴 ALTA (85%):** `verify-instance-status` faz `POST /instance/connect` como fallback (linhas 110-117) — força reconexão na UazAPI → dispara webhook → re-verify → loop
- **🟠 ALTA (70%):** `uazapi-webhook` SEM dedup pra eventos `connection.update` — UazAPI pode mandar 10x em 1s, todos atualizam DB
- **🟠 ALTA (65%):** Polling 5s + Realtime simultâneos no dialog de conectar → `handleSuccess()` chamado em paralelo, sem lock
- **🟡 MÉDIA (50%):** `get-evolution-qrcode` regenera QR a cada chamada → invalida o anterior se usuário ainda escaneando
- **🟡 BAIXA (35%):** Sem rate limit no handler de status — se UazAPI tem bug de retentativa, oscila visível

---

## 🚩 10. SUSPEITAS INICIAIS (consolidado, ranqueado por severidade)

### Críticas (corrigir imediatamente)

1. **[B3] Loop de reconexão via `verify-instance-status` POST fallback** — `supabase/functions/verify-instance-status/index.ts:110-117`. Remover o fallback POST /instance/connect (retornar erro em vez disso).

2. **[B2] DELETE de vendedor sem cleanup** — instâncias UazAPI ficam fantasmas no provedor; wa_contacts/wa_queue órfãos; estado local UI dessincroniza.

3. **[B1] Estado UI sem timeout em `handleAddSeller`** — `SellerManagerTab.tsx:342`. Sem timeout em `fetchData()` deixa botão eternamente em loading.

4. **[B3] Dedup ausente em eventos de status no uazapi-webhook** — `uazapi-webhook/index.ts:1869-1895`. Mensagens têm dedup por `remote_message_id`, mas `connection.update` passa direto.

5. **[RLS] Recursão potencial em policies de ai_team_members** — se alguém adicionar policy nova sem usar `SECURITY DEFINER`, pode loopar.

### Altas

6. **[B3] Polling + Realtime simultâneos** — `EvolutionConnectDialog.tsx:180-217`. Race condition no `handleSuccess()`.

7. **[B3] Tokens de Evolution regenerados via POST /instance/connect** — `get-evolution-qrcode` força regenerar mesmo com QR válido.

8. **[B2] FK `wa_contacts → wa_instances` sem ON DELETE definido** — contatos órfãos após deleção.

9. **[B1] Sem rollback transacional na criação de vendedor** — auth.users criado antes de ai_team_members, sem rollback.

10. **[B3] `consecutive_undelivered` nunca resetado ao reconectar** — banimento permanente após threshold.

11. **[BACKEND] Sem validação de webhook signature em `uazapi-webhook`** — qualquer POST malicioso pode marcar instância como banned.

### Médias

12. **[DB] `health_score -= 50` sem cap mínimo** — instância pode chegar a valor negativo absurdo.

13. **[CRM] `GlobalLeadsCrm.tsx` faz refetch COMPLETO ao detectar qualquer mudança realtime** — overhead alto com volume.

14. **[CRM] Drag-and-drop do kanban (FluxCRM) — estado otimista sem rollback claro em caso de erro do DB** — investigar na Fase 2 (módulo CRM).

15. **[AUTOMAÇÕES] Builder de automação (`AutomationFlowBuilder.tsx`) tem 7 tipos de nó mas SÓ `add_to_list` é processado pelo executor (Item 4)** — outros nós são puramente visuais. Documentado mas precisa de aviso UX claro.

### Baixas

16. **[LOGS] Logs estruturados ausentes em handler de status de instância** — difícil rastrear histórico de conexão.

17. **[AUTH] Vendedor recém-criado fica "locked out" até confirmar email** — sem reconvite fácil.

18. **[PLANO] Limite PRO de 2 vendedores ativos — investigar se há erro claro ao tentar exceder** (relacionado B1).

19. **[REALTIME] Sem cleanup defensivo de canais em desmontagem de dialogs** — possíveis leaks.

---

## 📋 11. PRÓXIMOS PASSOS (Fases 2-5)

| Fase | Prompt | Foco | Entregável |
|---|---|---|---|
| **Fase 2** | Prompt 2 | Auditoria módulo Vendedores (B1, B2) | `AUDIT_VENDEDORES.md` |
| **Fase 2** | Prompt 3 | Auditoria módulo Instâncias (B3) | `AUDIT_INSTANCIAS.md` |
| **Fase 3** | Prompt 4 | Auditoria CRM/Leads/Kanban | `AUDIT_CRM.md` |
| **Fase 3** | Prompt 5 | Auditoria Agentes (Pedro/Marcos) | `AUDIT_AGENTES.md` |
| **Fase 4** | Prompt 6 | Correções (ordenadas por severidade) | `FIXES_APPLIED.md` |
| **Fase 5** | Prompt 7 | Validação + regressão final | `VALIDATION_REPORT.md` |

---

**Status desta fase:** ✅ Mapeamento estático concluído. Pronto pra Fase 2.
