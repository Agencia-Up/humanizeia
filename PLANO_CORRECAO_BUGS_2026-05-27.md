# Plano de Correção dos Bugs Pendentes

**Data:** 27 de maio de 2026
**Escopo:** 9 bugs pendentes da auditoria (`AUDITORIA_BUGS_2026-05-27.md`).
**Estratégia:** 5 fases sequenciais, cada uma dependendo da anterior. Construção em ordem para evitar retrabalho.

---

## Estado Atual

✅ **10 bugs já corrigidos** em `staging` (commits `87227ae`, `d741c7a`, `bfb4b55`, `b1dbd9b`, `75b845e`).
⏳ **Aguardando validação manual de 24h** em staging antes de promover para PROD.
🛑 **Plano abaixo NÃO inicia até** validação concluída + promoção para PROD.

---

## Princípios do Plano

1. **Base primeiro**: helpers compartilhados antes de serem usados em múltiplos lugares.
2. **Mudanças invisíveis antes das visíveis**: refatorações internas antes de alterar comportamento que o usuário percebe.
3. **Cada fase = 1 commit = ponto de validação**: dá pra parar, reverter ou ajustar a qualquer momento.
4. **Validação por fase em staging**: nada vai para PROD sem aprovação explícita.

---

## Decisões Tomadas

| Tópico | Decisão |
|---|---|
| Sequenciamento | Aguardar validação dos 10 bugs atuais (24h) → promover PROD → iniciar plano em staging limpo. |
| BUG-13 (manual-transfer + assigned_to_id) | **Opção (A)**: manual não atribui até vendedor confirmar "Ok". Alinha com fluxo automático. Card fica "Aguardando confirmação" por 15min; se vendedor não responde, lead vai pro próximo do rodízio automaticamente. |

---

## Sequência de Execução

### FASE 0 — Fundação (mudanças invisíveis)

**Objetivo:** preparar helpers compartilhados. Nada muda na UI ou no comportamento.

| Item | Entregável | Risco |
|---|---|---|
| 0.1 | `_shared/transfer/buildBriefing.ts` — função única que monta briefing IA do lead (resumo + histórico recente). Substitui `buildConversationBriefing` e `buildEnrichedBriefing`. | 🟢 Nenhum |
| 0.2 | `_shared/transfer/phoneKey.ts` — `phoneKey()` + `uniqueSellersByPhone()`. Centraliza lógica duplicada em 3 arquivos. | 🟢 Nenhum |
| 0.3 | Migration `20260527_feedback_failed_attempts.sql` — colunas `failed_attempts int default 0` e `failed_at timestamptz` em `pedro_manager_feedback`. Idempotente. | 🟢 Mínimo |

**Validação:** `tsc --noEmit` sem erros + `SELECT column_name FROM information_schema.columns WHERE table_name='pedro_manager_feedback'` mostra colunas novas.

**Bloqueia:** Fases 1, 2, 4.

---

### FASE 1 — Unificar templates de transferência (resolve BUG-15)

**Objetivo:** os 5 templates diferentes que vendedores recebiam viram 1 só formato consistente.

**Arquivos tocados:**
- `supabase/functions/manual-transfer/index.ts` — usa `buildBriefing` (FASE 0.1)
- `supabase/functions/uazapi-webhook/index.ts` — 2 caminhos (tool + status) usam `buildBriefing`
- `supabase/functions/bulk-transfer-leads/index.ts` — usa `buildBriefing`
- `supabase/functions/transfer-timeout-checker/index.ts` — usa `buildBriefing`

**Risco:** 🟡 Médio. Vendedor vai notar que TODAS as mensagens de "novo lead" passaram a ter o mesmo formato.

**Validação:** disparar lead de teste em cada um dos 5 caminhos (auto via tool da IA, auto via status, manual via Inbox, manual via CRM Avançado, redistribuição em massa, timeout) — confirmar formato consistente.

**Resolve:** BUG-15.
**Bloqueia:** Fase 2 (Marcos vai usar mesma função, não pode ser exceção).

---

### FASE 2 — Marcos com briefing IA na transferência (resolve BUG-16)

**Objetivo:** quando master atribui card no Kanban Marcos, vendedor recebe briefing WhatsApp + gerente recebe relatório (igual ao Pedro hoje).

**Arquivos tocados:**
- `supabase/functions/manual-transfer/index.ts` — aceita novo parâmetro `crmLeadId`. Quando vier, busca em `crm_leads` (em vez de `ai_crm_leads`). Briefing usa `buildBriefing` (versão Marcos: usa `summary` + `custom_fields` do `crm_leads`, sem `wa_chat_history`).
- `src/pages/PedroSDR.tsx` — branch `isMarcosCrm=true` da função `reassignLead` passa a chamar `manual-transfer` com `crmLeadId` (hoje faz só UPDATE direto).
- Verificar outras UIs que atribuem vendedor no Marcos (`FluxCRM.tsx`, `MarcosLeads.tsx`) e ajustar se necessário.

**Risco:** 🟠 Alto. Vendedores que cobrem Marcos passam a receber WhatsApp ao serem atribuídos. Avise sua equipe antes de promover para PROD.

**Validação:**
1. Logado como master, criar lead novo no Marcos (origem `porta`) e atribuir vendedor pelo dropdown.
2. Confirmar que vendedor recebe WhatsApp com briefing.
3. Confirmar que gerente (configurado em `manager_feedback_config.gerente_phone_marcos`) recebe relatório.
4. Mover card pra outro vendedor — confirmar que segundo vendedor também recebe.

**Resolve:** BUG-16.

---

### FASE 3 — Robustez do manual-transfer (resolve BUG-13 + BUG-14)

**Objetivo:** evitar duplicação e alinhar comportamento entre transferência manual e automática.

**Arquivos tocados:**
- `supabase/functions/manual-transfer/index.ts`:
  - **BUG-14**: antes de criar transfer, SELECT do último < 30s pra mesmo lead/vendedor. Se existir, retorna sucesso sem duplicar mensagem.
  - **BUG-13** (decisão A): grava `assigned_to_id=null` no lead (em vez de já atribuir). Cria transfer com `is_confirmed=false` + `confirmation_timeout_at=now+15min`. Vendedor confirma com "Ok" pra atribuir oficialmente. Se não confirmar, `transfer-timeout-checker` escala pro próximo.

**Risco:** 🟡 Médio. Master vai notar que card fica "Aguardando confirmação" entre atribuir e vendedor responder.

**Validação:**
1. Clicar 2x rapidamente no botão "Transferir" → confirmar que só 1 mensagem chega ao vendedor.
2. Atribuir lead manualmente → card mostra "Aguardando confirmação". Vendedor responde "Ok" → card mostra "Em atendimento" + atribuído.
3. Atribuir lead manualmente → não responder por 15min → confirmar que timeout-checker escala pro próximo do rodízio.

**Resolve:** BUG-13, BUG-14.

---

### FASE 4 — Cron de feedback robusto (resolve BUG-09 + BUG-10 + BUG-11 + BUG-19)

**Objetivo:** feedbacks param de travar, perder ou chegar genéricos.

**Arquivos tocados:**
- `supabase/functions/cron-flush-manager-feedbacks/index.ts`:
  - **BUG-09**: detecta `fb.crm_lead_id` e busca em `crm_leads`. Marcos para de chegar como "Lead: Lead".
  - **BUG-10**: ao falhar envio, incrementa `failed_attempts`. Após 3 tentativas, marca `pending_send=false + failed_at=now()`. Feedback para de travar para sempre.
  - **BUG-19**: `last_flushed_at` marcado por feedback (não por master). Falha no meio do lote não trava resto até dia seguinte.
- `supabase/functions/pedro-process-feedback/index.ts`:
  - **BUG-11**: no modo auto, ao falhar envio à UazAPI, seta `pending_send=true` pra cron repegar no próximo ciclo.

**Risco:** 🟢 Baixo. Só melhora cobertura sem quebrar comportamento atual.

**Validação:**
1. Criar feedback Marcos em modo agendado → aguardar próximo ciclo do cron → confirmar mensagem ao gerente com nome real do lead.
2. Forçar erro de envio (ex: invalidar token UazAPI temporariamente) → confirmar que feedback recebe `failed_attempts=1, 2, 3` e depois `failed_at=now()`.
3. Verificar SQL: `SELECT count(*) FROM pedro_manager_feedback WHERE pending_send=true AND created_at < now() - interval '24 hours'` — deve ser 0 (sem feedbacks travados).

**Resolve:** BUG-09, BUG-10, BUG-11, BUG-19.

---

### FASE 5 — Limpeza (resolve BUG-17 + BUG-18)

**Objetivo:** cosmético, sem urgência.

| Item | Arquivo | Mudança |
|---|---|---|
| 5.1 | `bulk-transfer-leads/index.ts` | Filtro IN expande para `['qualificado', 'pouco_qualificado', 'medio_qualificado']`. UI ganha checkbox pra escolher quais status redistribuir. |
| 5.2 | `supabase/functions/pedro-transfer-router/` | Apaga diretório vazio. |

**Risco:** 🟢 Mínimo.

**Validação:** master clica "Redistribuir todos" → vê leads de status diversos. Estrutura do projeto sem diretório morto.

**Resolve:** BUG-17, BUG-18.

---

## Estimativa Total

| Fase | Tempo dev | Commits | Validação manual |
|---|---|---|---|
| 0 | ~30min | 1 | 5min |
| 1 | ~1h | 1 | 30min |
| 2 | ~1.5h | 1 | 30min |
| 3 | ~45min | 1 | 30min |
| 4 | ~1h | 1 | 1h (esperar cron) |
| 5 | ~15min | 1 | 5min |
| **Total** | **~5h** | **6** | **~3h** |

---

## Estratégia de Deploy

1. **Cada fase em STAGING primeiro.** Deploy via `scripts/supabase-logosia-staging.cmd functions deploy <funcao>` para edge functions; push de branch `staging` para mudanças de frontend (EasyPanel rebuild).
2. **Validação manual entre fases.** Posso pausar entre fases pra você testar, ou ir até o fim e validar tudo junto — você decide ao iniciar.
3. **Promoção para PROD somente ao final.** Cherry-pick dos 6 commits para `main` + deploy das edge functions em PROD + push. Em ~5min EasyPanel termina rebuild.

---

## Pontos de Atenção

- **Fase 2 (Marcos briefing)** muda comportamento visível para vendedores. Recomendado avisar a equipe antes de promover para PROD.
- **Fase 3 (manual-transfer alinha com auto)** muda comportamento para masters. Cards ficam temporariamente "Aguardando confirmação" — explicar nos primeiros dias.
- **Fase 4** depende de Fase 0.3 (migration). Se a migration falhar em PROD, plano para na Fase 0.
- **Manter rollback fácil**: cada fase é 1 commit. `git revert <hash>` desfaz a fase específica sem afetar outras.

---

## Pré-requisitos antes de iniciar

✅ 10 bugs atuais validados em staging
✅ 10 bugs atuais promovidos para PROD
✅ Branch `staging` limpa (apenas commits que vão entrar no plano)
✅ CLI Supabase linkada em `ezoltigtqgbmftmiwjxh` (staging)
✅ Esta decisão confirmada por escrito no chat

Quando todos os pré-requisitos estiverem atendidos, basta dizer "vamos começar o plano" e iniciamos a Fase 0.

---

*Plano gerado em 27/05/2026, baseado na auditoria de bugs do mesmo dia.*
