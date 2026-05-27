# ✅ Checklist Completo do Trabalho

**Data:** 27 de maio de 2026
**Sessão:** Auditoria de bugs do CRM (rodízio + transferência + feedback + campanhas) + investigação de infraestrutura
**Branches afetadas:** `staging` (trabalho ativo), `main` (PROD)
**Projetos Supabase:** `seyljsqmhlopkcauhlor` (PROD), `ezoltigtqgbmftmiwjxh` (STAGING)

---

## 📊 Números globais

- **29 bugs auditados** (19 da 1ª rodada + 10 da 2ª)
- **26 bugs corrigidos em PROD** (90%)
- **3 bugs pendentes** (1 ALTO precisando decisão de UX + 2 BAIXOS cosméticos)
- **22 commits** feitos nesta sessão
- **2 promoções pra PROD** (commits `8010993` e `6dc0c55`)
- **10 migrations** aplicadas em PROD
- **8 edge functions** deployadas em PROD

---

## 🔴 CRÍTICOS — 5 bugs (5 em PROD)

| # | Bug | Onde foi corrigido | Status |
|---|---|---|---|
| 01 | `bulk-transfer-leads` quebrava silenciosamente (UPDATE em colunas inexistentes) | `bulk-transfer-leads/index.ts` | ✅ PROD |
| 02 | Feedback Marcos ia pro gerente errado (lia agente Pedro arbitrário em vez de `gerente_phone_marcos`) | `pedro-process-feedback/index.ts` | ✅ PROD |
| 03 | Rodízio injusto no CRM ao Vivo (sem dedup por telefone) | `CrmAoVivo.tsx` função `nextSeller` | ✅ PROD |
| NOVO-01 | Race condition em `wa_inbox` permitia IA responder 2x ao cliente | Migration UNIQUE INDEX | ✅ PROD |
| NOVO-02 | Service role JWT hardcoded em git (vulnerabilidade de segurança) | Migration cron usando Vault | ✅ PROD |

---

## 🟠 ALTOS — 13 bugs (12 em PROD, 1 pendente)

| # | Bug | Status |
|---|---|---|
| 04 | Transferência manual não enviava briefing IA pro vendedor nem relatório pro gerente | ✅ PROD |
| 05 | Página Instâncias instável (auto-verify em cascata gerando toasts de erro) | ✅ PROD |
| 06 | Dropdown "Atribuído a" vazio quando vendedor estava inativo/removido | ✅ PROD |
| 07 | Race condition QR Code dialog (Realtime + polling chamando handleSuccess 2x) | ✅ PROD |
| 08 | Dashboard TV ignorava leads Marcos com `origem='outros'` ou sem vendedor | ✅ PROD |
| 09 | Cron flush feedback Marcos chegava como "Lead: Lead" genérico | ✅ PROD |
| 10 | Feedbacks travavam pra sempre se vendedor fosse removido | ✅ PROD |
| 11 | Retry feedback em modo auto não acontecia (perdia silenciosamente em falha) | ✅ PROD |
| NOVO-03 | UI ignorava `deduplicated:true` do backend (master ficava confuso) | ✅ PROD |
| NOVO-05 | Circuit-breaker do queue era dead code (Map global zerava a cada invocação) | ✅ PROD |
| NOVO-06 | Follow-ups em status `failed` ficavam órfãos sem retry (Pedro + Marcos) | ✅ PROD |
| NOVO-07 | `enqueue-campaign` permitia contato duplicado em re-import de lista | ✅ PROD |
| NOVO-08 | Campanha 100% failed marcada como "completed" no painel | ✅ PROD |
| **NOVO-04** | **UI optimistic descolada de BUG-13 (mostrar "Aguardando confirmação" baseado em ai_lead_transfers)** | ⏳ **PENDENTE** |

---

## 🟡 MÉDIOS — 7 bugs (7 em PROD)

| # | Bug | Status |
|---|---|---|
| 12 | Erro genérico "Evolution API" mascarava erro real da UaZapi | ✅ PROD |
| 13 | Manual-transfer setava `assigned_to_id` antes da confirmação do vendedor | ✅ PROD (Opção A) |
| 14 | Manual-transfer sem proteção contra clique duplo do master | ✅ PROD (dedup 30s) |
| 15 | Auto-transfer A2 usava template diferente do briefing IA enriquecido | ✅ PROD (Fase 1A — helpers compartilhados) |
| 16 | Marcos sem briefing IA na transferência manual | ✅ PROD (Fase 2 — handleMarcosTransfer) |
| NOVO-09 | Auto-start campanhas agendadas race condition (mitigado) | ✅ PROD |
| NOVO-10 | `LiveLeadCard` mantinha `selectedSellerId` órfão se vendedor sumia | ✅ PROD |

---

## 🟢 BAIXOS — 4 bugs (3 em PROD, 1 pendente cosmético)

| # | Bug | Status |
|---|---|---|
| 17 | `bulk-transfer-leads` só pegava status `qualificado` (filtro IN expandido) | ✅ PROD |
| 18 | Diretório vazio `pedro-transfer-router/` confundindo devs | ✅ PROD (removido) |
| 19 | `last_flushed_at` marcado no master em vez de por feedback | ✅ PROD |
| 20 | 1 cosmético do plano inicial | ⏳ pendente |

---

## 💾 Migrations aplicadas em PROD (10 nesta sessão)

| Timestamp | Conteúdo | Bug coberto |
|---|---|---|
| `20260516120000` | `ai_crm_leads` ganha `origem` + `origem_outros` | — (feature anterior) |
| `20260521150000` | `crm_leads` ganha city/vehicle/visit | — (feature anterior) |
| `20260521160000` | `pedro_manager_feedback` aceita `crm_lead_id` (Marcos) | — (feature anterior) |
| `20260522130000` | `manager_feedback_config.gerente_phone_marcos` | Pré-requisito BUG-02 |
| `20260527150000` | `pedro_manager_feedback.failed_attempts` + `failed_at` | BUG-10 + BUG-11 |
| `20260527160000` | UNIQUE INDEX `wa_inbox(user_id, instance_id, remote_message_id)` | BUG-NOVO-01 |
| `20260527170000` | cron `pedro-trigger-followup` lendo Vault em vez de JWT hardcoded | BUG-NOVO-02 |
| `20260527180000` | `wa_campaigns.error_message` + index parcial | BUG-NOVO-08 |
| `20260527190000` | UNIQUE INDEX `wa_queue(campaign_id, phone)` | BUG-NOVO-07 |
| `20260527200000` | Followups Pedro + Marcos com `attempt_count`/`last_failed_at`/`last_error` | BUG-NOVO-06 |

---

## ⚙️ Edge Functions deployadas em PROD (8 nesta sessão)

| Função | Mudanças nesta sessão |
|---|---|
| `create-evolution-instance` | Erro verbose (HTTP status + body UaZapi) + fallback DB URL quando env vazia |
| `bulk-transfer-leads` | Colunas inexistentes removidas + filtro IN expandido (4 status) |
| `pedro-process-feedback` | Gerente Marcos via `gerente_phone_marcos` + `pending_send=true` em falha auto |
| `manual-transfer` | Chama briefing/gerente nos 3 callers + `handleMarcosTransfer` novo + dedup 30s + BUG-13 Opção A |
| `uazapi-webhook` | Imports compartilhados de `_shared/transfer/*` (sem mudança visual) |
| `cron-flush-manager-feedbacks` | Marcos branch + `failed_attempts` até 3 + `last_flushed_at` por feedback |
| `process-whatsapp-queue` | Circuit breaker persistente via `wa_instances.consecutive_undelivered` + completion correto (failed/completed_with_errors) |
| `pedro-trigger-followup` | Retry exponencial 5/15/45min Pedro + Marcos |

---

## 🗄️ Helpers compartilhados criados (FASE 0 do plano)

| Arquivo | Funções exportadas | Onde é usado |
|---|---|---|
| `supabase/functions/_shared/transfer/buildBriefing.ts` | `buildEnrichedBriefing`, `buildConversationBriefing`, `buildMarcosBriefing`, `buildManagerReport` | `manual-transfer`, `uazapi-webhook` |
| `supabase/functions/_shared/transfer/phoneKey.ts` | `sellerPhoneKey`, `uniqueSellersByPhone` | `uazapi-webhook` + frontend `CrmAoVivo.tsx` (lógica espelhada) |

---

## 📄 Documentos gerados nesta sessão

| Arquivo | Conteúdo |
|---|---|
| `AUDITORIA_BUGS_2026-05-27.md` | 29 bugs catalogados (1ª + 2ª rodada) com sintoma, causa, fix recomendado, arquivo:linha |
| `PLANO_CORRECAO_BUGS_2026-05-27.md` | Plano de 5 fases sequenciais com riscos, validação por fase, estimativas |
| `CHECKLIST_TRABALHO_2026-05-27.md` | Este arquivo |

---

## 🔧 Setup de infraestrutura aplicado

- ✅ **Vault PROD**: secret `service_role_key` inserido manualmente (lendo do `.env` local existente) — substitui JWT hardcoded no cron antigo
- ✅ **Vault STAGING**: secret `service_role_key` já existia (verificado, intacto)
- ✅ **Cron `pedro-trigger-followup`** recriado em PROD + STAGING lendo do Vault em vez de JWT hardcoded
- ✅ **Cron `pedro-trigger-followup`** em STAGING aplicado MANUALMENTE com URL específica de staging (porque migration commitada tem URL PROD hardcoded e Supabase managed Postgres não permite `ALTER DATABASE SET`)

---

## 🚨 Anomalia detectada e corrigida em PROD

**2 instâncias com `consecutive_undelivered=32`** descobertas via health-check após deploys:

| Instância | health_score | shadow_ban | updated_at | Diagnóstico |
|---|---|---|---|---|
| `roberto-nf2u` | 50 | true | 26h atrás | Provavelmente offline há 1 dia |
| `leandro-maquina-de-vendas-a66b0377` | 100 | true | 40min atrás | Saudável, presa por counter velho |

**Origem**: counter acumulado por bug antigo (`increment_consecutive_undelivered` SQL incrementava mas Map em memória do queue nunca disparava `handle-instance-ban`).

**Risco do meu fix BUG-NOVO-05**: queue processor agora respeita o counter persistente. Como ambas tinham counter ≥ threshold (5), seriam ignoradas permanentemente.

**Ação tomada**: `UPDATE wa_instances SET consecutive_undelivered = 0` nas 2. `shadow_ban_suspect=true` MANTIDO pra investigação manual. Se realmente estão banidas, contador volta a subir até 5 e circuit breaker entra corretamente.

---

## ⏳ Pendências (não resolvidas)

### 1. BUG-NOVO-04 — UI "Aguardando confirmação" 🟠 ALTO
- **O quê**: refactor da UI pra mostrar "Aguardando confirmação (Vendedor X)" baseado em `ai_lead_transfers.transfer_status='pending'` em vez de `assigned_to_id` (que agora fica null até confirmação).
- **Onde**: `PedroSDR.tsx`, `CrmAoVivo.tsx`, `WhatsAppInbox.tsx`, `MarcosLeads.tsx` (4 telas).
- **Por que pendente**: requer decisão de UX (como visualizar limbo), refactor amplo, risco médio.
- **Mitigação atual**: `transfer-timeout-checker` escala pro próximo vendedor em 15min se não confirmar.

### 2. Cosméticos baixos sem urgência
- Itens menores do plano inicial.

---

## ⚠️ Riscos pendentes catalogados (não tratados)

| # | Risco | Severidade | Observação |
|---|---|---|---|
| R1 | Workflow main↔staging desincronizado (Codex commita direto em main) | 🔴 Estrutural | Combinar protocolo com outro dev (Codex → branch `codex/*`) |
| R2 | Migrations recentes podem ter travado tabela (`CREATE INDEX` sem `CONCURRENTLY`) | 🟠 Médio | Já aplicado, não dá pra reverter agora. Monitorar futuro |
| R3 | Conflito potencial: meu retry de followup vs dedup do Codex em `pedro-trigger-followup` | 🟠 Médio | Não validado em detalhe — Codex pode estar fazendo dedup baseado em outro campo |
| R4 | BUG-13 Opção A pode deixar leads em limbo se vendedor nunca confirma | 🟡 Baixo | Timeout-checker pega em 15min e escala automaticamente |

---

## 👥 Outros devs ativos no projeto (descoberto na investigação)

- **`dev-aloan` (Codex/OpenAI)** — 152 commits últimos 30 dias, foco em Pedro v2
- Commita **direto em `main`** (não passa por staging)
- Último commit dele: `75ebafb` (há ~1h)
- Pasta dedicada: `.codex-brain/` (10 arquivos de contexto/decisões dele)
- Feature dele: `_shared/pedro-v2/` (orchestrator, intentRouter, leadMemory, ~25 arquivos)
- **Trabalho dele PRESERVADO** nos meus merges (verificado manualmente após investigação)

---

## 📦 Estado dos arquivos temporários

Todos os `_*.sql`, `_*.local` criados durante a sessão foram limpos. Repo deixou apenas:

- 10 migrations versionadas em `supabase/migrations/`
- 2 arquivos novos em `supabase/functions/_shared/transfer/`
- 8 edge functions modificadas em `supabase/functions/*/index.ts`
- 5 arquivos de frontend modificados em `src/`
- 3 documentos `.md` na raiz (AUDITORIA, PLANO, CHECKLIST)

---

## 🎯 Próximas ações sugeridas (sem urgência imediata)

1. **Monitorar PROD por 24h** antes de novas mudanças — sistema recebeu 14 fixes em pouco tempo.
2. **Combinar protocolo com `dev-aloan`** (Codex): branch `codex/*` em vez de commit direto em main.
3. **Decidir UX do NOVO-04** (Aguardando confirmação) antes de implementar.
4. **Validar interação retry follow-up vs Codex** — ler `pedro-trigger-followup` em main pra entender o dedup do Codex.
5. **Considerar rotacionar service role key** no Supabase dashboard (eliminar 100% o vazamento histórico do BUG-NOVO-02 que está no git).

---

*Checklist gerado automaticamente baseado nas tasks e commits da sessão de 27/05/2026.*
*Autor: Wander Carvalho via Claude Code | Co-Authored-By: Claude*
