# Auditoria de Bugs — Plataforma LogosIA

**Data:** 27 de maio de 2026
**Escopo:** Fluxos de rodízio de leads, transferência para vendedores, feedback ao gerente, página de Instâncias WhatsApp, Dashboard TV (CRM ao vivo).
**Ambiente auditado:** branch `staging` (espelho de produção + correções recentes ainda em validação).

---

## 1. Sumário Executivo

Foram identificados **19 bugs** distribuídos em 5 áreas. Destes:

| Severidade | Total | Corrigidos em staging | Pendentes |
|---|---|---|---|
| 🔴 CRÍTICA | 3 | 3 | 0 |
| 🟠 ALTA | 7 | 4 | 3 |
| 🟡 MÉDIA | 5 | 3 | 2 |
| 🟢 BAIXA | 4 | 0 | 4 |
| **TOTAL** | **19** | **10** | **9** |

**O que está OK na base:**
- Rodízio automático (auto-transfer feito pela IA do Pedro).
- Confirmação por "Ok" do vendedor no WhatsApp.
- Cron de janela horária de Brasília (transfer-timeout-checker).
- Edge function `manual-transfer` envia briefing e relatório corretamente quando chamada.

**Áreas críticas que precisavam de atenção:**
- 3 caminhos de transferência (Inbox, CRM Avançado, CRM ao Vivo) não enviavam briefing nem notificavam gerente — só atualizavam o banco. **Corrigido.**
- "Redistribuir todos leads qualificados" quebrava silenciosamente — toast verde, nada acontecia. **Corrigido.**
- Feedback do gerente do Marcos podia ir pro número errado quando havia múltiplos agentes Pedro. **Corrigido.**
- Dashboard TV não contava o que o vendedor cadastrava no Marcos com origem "outros" (default) — 381 leads invisíveis em staging. **Corrigido.**
- Página de Instâncias instável (auto-verify em loop) e dropdown vazio quando vendedor era inativo. **Corrigido.**

**O que ainda precisa ser feito (9 bugs):**
- Marcos não envia briefing IA pra vendedor (já planejado, pendente de implementação).
- Manual-transfer sem proteção contra clique duplo.
- Inconsistência entre 5 templates de mensagem "novo lead" para vendedores.
- Outras correções de menor impacto operacional listadas abaixo.

---

## 2. Bugs Críticos (sistema em produção pode falhar silenciosamente)

### BUG-01 🔴 CRÍTICA — "Redistribuir todos" quebrava sem aviso
**Status:** ✅ Corrigido em staging (commit `75b845e`)

- **Sintoma observado:** master clicava "Redistribuir todos leads qualificados" no painel, recebia toast verde de sucesso, mas **nenhum lead era atribuído**. Vendedores não recebiam mensagens. Gerente não era notificado.
- **Causa raiz:** a edge function `bulk-transfer-leads` tentava gravar 3 colunas que não existem no banco:
  - `ai_crm_leads.transferred_at` (a coluna `transferred_at` vive em `ai_lead_transfers`, não no lead em si)
  - `ai_crm_leads.transfer_reason` (idem)
  - `ai_team_members.total_leads_received`
- O PostgreSQL rejeitava o UPDATE silenciosamente, a função engolia o erro e retornava sucesso.
- **Local técnico:** `supabase/functions/bulk-transfer-leads/index.ts:182-206`.
- **Correção aplicada:** removidas as 3 colunas inválidas. Agora propaga erros explicitamente em vez de engolir.

---

### BUG-02 🔴 CRÍTICA — Feedback Marcos podia ir pro gerente errado
**Status:** ✅ Corrigido em staging (commit `75b845e`)

- **Sintoma observado:** quando vendedor enviava feedback de um lead do Marcos, a mensagem chegava num gerente arbitrário — não no gerente configurado para o CRM do Marcos.
- **Causa raiz:** existe uma coluna dedicada `manager_feedback_config.gerente_phone_marcos` (criada na migration `20260522130000`) justamente para isso, mas o código da edge function `pedro-process-feedback` **nunca lia essa coluna**. Em vez disso, pegava o `gerente_phone` do "primeiro agente Pedro" do master com `LIMIT 1` sem ordenação determinística.
- Se o master tinha 2 ou mais agentes Pedro cada um com gerente_phone diferente, o feedback Marcos podia ir pra qualquer um deles, de forma não-determinística.
- **Local técnico:** `supabase/functions/pedro-process-feedback/index.ts:165-181`.
- **Correção aplicada:** agora lê primeiro `manager_feedback_config.gerente_phone_marcos`. Se vazio, mantém o fallback antigo (para compatibilidade com masters que ainda não configuraram).

---

### BUG-03 🔴 CRÍTICA — Rodízio injusto no CRM ao Vivo
**Status:** ✅ Corrigido em staging (commit `75b845e`)

- **Sintoma observado:** no painel CRM ao Vivo, o botão "Transferir para [vendedor]" mostrava sempre o mesmo vendedor como próximo da fila, mesmo após várias transferências. Vendedor X recebia desproporcionalmente mais leads que outros.
- **Causa raiz:** um vendedor pode ter múltiplas linhas em `ai_team_members` (uma por agente IA que ele cobre). O backend tem uma função `uniqueSellersByPhone` que deduplica essas linhas por telefone, mas a UI do CRM ao Vivo não usava essa lógica. Resultado: vendedor com 3 linhas aparecia 3x na fila, e como o backend só atualiza `last_lead_received_at` em 1 linha, as outras 2 ficavam permanentemente com timestamp antigo e dominavam o rodízio.
- **Local técnico:** `src/pages/CrmAoVivo.tsx:648-657`.
- **Correção aplicada:** mesma lógica de deduplicação por telefone (últimos 10 dígitos, sem "9" inicial) aplicada na UI. Espelha o comportamento do backend.

---

## 3. Bugs Altos (impacto operacional significativo)

### BUG-04 🟠 ALTA — Transferência manual não enviava briefing IA pro vendedor
**Status:** ✅ Corrigido em staging (commit `b1dbd9b`)

- **Sintoma:** master atribuía vendedor manualmente a um lead (via Inbox, CRM Avançado ou CRM ao Vivo) e o vendedor não recebia mensagem nenhuma. Gerente também não era notificado.
- **Causa raiz:** 3 caminhos de transferência manual (`reassignLead` no PedroSDR, `handleTransfer` no WhatsAppInbox, e o caminho do CrmAoVivo sem escolha de vendedor) faziam apenas `UPDATE` no banco. A edge function `manual-transfer` — que já existia e envia briefing + relatório — não era chamada.
- **Correção aplicada:**
  - `WhatsAppInbox.tsx`: `handleTransfer` agora invoca `manual-transfer`.
  - `PedroSDR.tsx`: `reassignLead` agora invoca `manual-transfer` quando atribui vendedor (desatribuir continua só UPDATE).
  - `CrmAoVivo.tsx`: adicionado `<select>` de vendedor (não só round-robin); permite master escolher pra quem mandar.

---

### BUG-05 🟠 ALTA — Página de Instâncias instável (bugava aleatoriamente)
**Status:** ✅ Corrigido em staging (commit `d741c7a`)

- **Sintoma:** ao abrir a aba "Instâncias", a página gerava toasts de erro aleatórios, mostrava status incorreto, e parecia "travar" por alguns segundos.
- **Causa raiz:** 500ms após a aba abrir, executava automaticamente `verifyAllInstances` → chamava `audit-master-instances` → fazia 1 request à UaZapi por instância (N requests). Cada falha gerava um toast. Em masters com várias instâncias, era uma cascata de chamadas pesadas e erros visuais.
- **Local técnico:** `src/pages/WhatsAppInstances.tsx:200-203`.
- **Correção aplicada:** auto-verify removido. O botão "Verificar Todos" continua disponível para quando o master quiser checar manualmente.

---

### BUG-06 🟠 ALTA — Dropdown "Atribuído a" vazio quando vendedor era inativo
**Status:** ✅ Corrigido em staging (commit `d741c7a`)

- **Sintoma:** alguns cards de instância mostravam badge "vendedor" mas o dropdown estava em branco — não dava pra ver quem era nem pra reatribuir.
- **Causa raiz:** o componente carregava apenas vendedores `is_active=true`. Quando uma instância estava atribuída a um vendedor que foi desativado/removido, o select não tinha esse ID na lista e ficava em branco.
- **Local técnico:** `src/pages/WhatsAppInstances.tsx:213-232`.
- **Correção aplicada:**
  - Carrega TODOS os vendedores (ativos e inativos), com sufixo "(inativo)" no label.
  - Se a instância referencia um vendedor que sumiu da lista, mostra opção em âmbar "Vendedor removido (desatribua)" pra master conseguir limpar.

---

### BUG-07 🟠 ALTA — Race condition no QR Code (Realtime + polling)
**Status:** ✅ Corrigido em staging (commit `d741c7a`)

- **Sintoma:** ao escanear QR de uma nova instância, ocasionalmente o sistema disparava 2 chamadas duplicadas — invalidate de queries dobrado, webhook sincronizado em duplicata.
- **Causa raiz:** o modal de conexão monitora status do QR via Realtime subscription E polling a cada 5s. Quando o status virava "connected", os 2 canais disparavam `handleSuccess()` em paralelo sem mutex.
- **Local técnico:** `src/components/evolution/EvolutionConnectDialog.tsx:180-217`.
- **Correção aplicada:** flag `successHandledRef` adicionada como mutex. Primeiro canal que dispara marca o flag; segundo retorna sem fazer nada.

---

### BUG-08 🟠 ALTA — Dashboard TV ignorava leads do Marcos sem vendedor
**Status:** ✅ Corrigido em staging (commit `bfb4b55`)

- **Sintoma:** no CRM ao Vivo (TV), o KPI "Leads Gerais" não refletia tudo que o vendedor cadastrava no Marcos. Em particular, 381 leads em staging com `origem='outros'` (default do formulário Marcos) eram completamente invisíveis. Também leads do Marcos sem vendedor atribuído eram ignorados.
- **Causa raiz:** o Dashboard TV tinha 6 categorias hardcoded (`trafico_pago`, `porta`, `olx`, `marketplace`, `consignado`, `indicacao`) e descartava qualquer lead que não batesse. O default "outros" do form Marcos nunca tinha lugar pra cair. Leads sem `assigned_to` também eram pulados silenciosamente.
- **Local técnico:** `src/pages/DashboardTV.tsx:393-407`.
- **Correção aplicada:**
  - Nova 7ª categoria "Outros" (ícone Tag, cinza) cobre o default e qualquer origem desconhecida.
  - Leads sem vendedor atribuído agora somam no KPI "Leads Gerais" com sub-label âmbar "(N sem vendedor atribuído)".
  - Grid de origens passou de 6 → 7 colunas.
  - VendedorCard ganhou linha "Outros" no breakdown.

---

### BUG-09 🟠 ALTA — Cron flush de feedbacks mostra lead Marcos como "Lead"
**Status:** ⏳ Pendente

- **Sintoma:** quando feedback Marcos é enviado em modo agendado (batch via cron), a mensagem que chega no WhatsApp do gerente mostra "*Lead: Lead*" — sem nome do lead, sem contexto.
- **Causa raiz:** o cron `cron-flush-manager-feedbacks` busca o lead apenas em `ai_crm_leads` (Pedro). Pra feedbacks com `crm_lead_id` (Marcos), `lead` retorna null e a mensagem cai no fallback genérico.
- **Local técnico:** `supabase/functions/cron-flush-manager-feedbacks/index.ts:153-160`.
- **Correção proposta:** detectar `fb.crm_lead_id` e buscar em `crm_leads` quando aplicável.

---

### BUG-10 🟠 ALTA — Feedbacks travam se vendedor for removido
**Status:** ⏳ Pendente

- **Sintoma:** alguns feedbacks ficam permanentemente `pending_send=true` no banco, sem nunca chegarem ao gerente.
- **Causa raiz:** o cron exige que o `member_id` do feedback tenha `agent_id` válido pra resolver gerente. Se vendedor foi reativado em outro agente, ou removido, o feedback fica órfão. O cron pula e nunca marca como "falhou definitivamente".
- **Local técnico:** `supabase/functions/cron-flush-manager-feedbacks/index.ts:162-163`.
- **Correção proposta:** após N tentativas (ex: 3), marcar `pending_send=false` + `failed_at=now()`. OU usar fallback de `wa_ai_agents` por `user_id` igual ao `pedro-process-feedback`.

---

### BUG-11 🟠 ALTA — Retry de feedback (modo auto) não existe
**Status:** ⏳ Pendente

- **Sintoma:** se a UazAPI retorna erro ao enviar feedback em modo automático, o feedback se perde sem retry.
- **Causa raiz:** em `pedro-process-feedback`, se o envio falha, `sent_to_manager_at` fica null mas `pending_send` permanece `false` (default do modo auto). Como o cron só pega `pending_send=true`, esses feedbacks nunca são reenviados.
- **Local técnico:** `supabase/functions/pedro-process-feedback/index.ts:313-318`.
- **Correção proposta:** no modo auto, ao detectar falha de envio, setar `pending_send=true` pra que o cron repegue no próximo ciclo.

---

## 4. Bugs Médios e Menores

### BUG-12 🟡 MÉDIA — Erro genérico "Evolution API" mascarava o real
**Status:** ✅ Corrigido em staging + produção (commit `87227ae`)

- **Sintoma:** ao tentar conectar nova instância via modal, master via toast genérico "Erro ao criar instância na Evolution API" sem detalhes.
- **Causa raiz:** a edge function `create-evolution-instance` retornava mensagem hardcoded mesmo quando a UaZapi devolvia detalhes precisos do erro.
- **Local técnico:** `supabase/functions/create-evolution-instance/index.ts:525`.
- **Correção aplicada:** mensagem agora inclui HTTP status, host real, body retornado pela UaZapi (300 chars), hint específico ("token inválido"/"URL errada"/"servidor down"), e lista dos endpoints tentados.
- **Observação:** este foi o único deploy aplicado em produção fora do fluxo staging→main padrão. Mudança é exclusivamente de mensagem (não altera comportamento) e foi feita para diagnosticar um problema reportado pelo cliente.

---

### BUG-13 🟡 MÉDIA — Manual-transfer setava vendedor antes da confirmação
**Status:** ⏳ Pendente

- **Sintoma:** após transferência manual, lead aparece como "atribuído" ao vendedor imediatamente, mesmo antes dele confirmar com "Ok". Causa ambiguidade no fluxo de timeout.
- **Causa raiz:** `manual-transfer` grava `assigned_to_id=member.id` direto, enquanto a auto-transfer da IA deixa `assigned_to_id=null` até o vendedor confirmar. Quando o `transfer-timeout-checker` escala um lead em manual-transfer, o `assigned_to_id` original permanece — fica ambíguo qual vendedor é o dono.
- **Local técnico:** `supabase/functions/manual-transfer/index.ts:526-543`.
- **Correção proposta (a discutir):**
  - Opção A: alinhar com auto (não atribuir até confirmação).
  - Opção B: manter atribuição firme e desabilitar timeout-checker para transfers manuais.

---

### BUG-14 🟡 MÉDIA — Manual-transfer sem proteção contra clique duplo
**Status:** ⏳ Pendente

- **Sintoma:** se master clica 2x rapidamente no botão "Transferir", o sistema cria 2 transfers, manda 2 mensagens pro vendedor, 2 relatórios pro gerente.
- **Causa raiz:** edge function não verifica se já existe transfer recente pra mesmo lead/vendedor antes de inserir.
- **Correção proposta:** SELECT do último transfer < 30s antes de inserir; se existir, retorna sucesso sem duplicar.

---

### BUG-15 🟡 MÉDIA — Auto-transfer A2 usa template diferente do briefing IA
**Status:** ⏳ Pendente

- **Sintoma:** vendedor recebe mensagens visualmente diferentes dependendo de como a IA decidiu transferir (via tool `transferir_para_vendedor` vs. via mudança de status para "qualificado").
- **Causa raiz:** o caminho de qualificação por status usa template inline simples, enquanto o caminho via tool usa `buildEnrichedBriefing` (mais completo).
- **Correção proposta:** unificar em função compartilhada `buildBriefingForSeller`.

---

### BUG-16 🟡 MÉDIA — Marcos não envia briefing IA na transferência
**Status:** ⏳ Pendente (já discutido, será implementado em lote separado)

- **Sintoma:** master atribui card no Kanban do Marcos a um vendedor, vendedor recebe lead "no escuro" — nenhuma mensagem WhatsApp com contexto.
- **Causa raiz:** a edge function `manual-transfer` só suporta `ai_crm_leads` (Pedro). Pra leads em `crm_leads` (Marcos), o frontend faz UPDATE direto.
- **Correção proposta:** estender `manual-transfer` pra aceitar `crm_lead_id`. Já tem precedente: `pedro-process-feedback` faz isso.

---

### BUG-17 🟢 BAIXA — `bulk-transfer-leads` só pega leads "qualificado"
**Status:** ⏳ Pendente

- **Sintoma:** master clica "redistribuir todos" e não vê leads com status `pouco_qualificado`, `medio_qualificado` ou `transferido` órfãos.
- **Local técnico:** `supabase/functions/bulk-transfer-leads/index.ts:99-101`.
- **Correção proposta:** expandir o filtro IN para incluir mais status (decisão de produto).

---

### BUG-18 🟢 BAIXA — Diretório `pedro-transfer-router/` vazio
**Status:** ⏳ Pendente

- **Sintoma:** existe um diretório `supabase/functions/pedro-transfer-router/` sem arquivo `index.ts` dentro. Confunde devs e sugere refatoração abandonada.
- **Correção proposta:** apagar diretório OU finalizar implementação como ponto único de transferência.

---

### BUG-19 🟢 BAIXA — Cron flush marca `last_flushed_at` no master, não no feedback
**Status:** ⏳ Pendente

- **Sintoma:** se o cron falha no meio de um lote, alguns feedbacks são enviados, outros ficam órfãos. Como `last_flushed_at` é marcado no master após qualquer execução, na próxima rodada (mesmo dia) o master fica inelegível e os feedbacks órfãos esperam 24h.
- **Local técnico:** `supabase/functions/cron-flush-manager-feedbacks/index.ts`.
- **Correção proposta:** marcar `last_flushed_at` por feedback individual, ou implementar retry imediato em falhas.

---

## 5. Resumo Visual por Severidade

```
🔴 CRÍTICOS    [████████████████████] 100%   (3/3 corrigidos)
🟠 ALTOS       [██████████████░░░░░░]  57%   (4/7 corrigidos)
🟡 MÉDIOS      [████████████░░░░░░░░]  60%   (3/5 corrigidos)
🟢 BAIXOS      [░░░░░░░░░░░░░░░░░░░░]   0%   (0/4 corrigidos)
```

---

## 6. Próximos Passos Recomendados

### Imediato (próximas 24h)
- Validar em staging os 10 bugs corrigidos (commits acumulados: `87227ae`, `d741c7a`, `bfb4b55`, `b1dbd9b`, `75b845e`).
- Em caso de aprovação, promover para produção via merge `staging → main`.

### Curto prazo (esta semana)
- Implementar Marcos com briefing IA (BUG-16) — escopo bem definido, baixo risco.
- Corrigir cron flush de feedbacks Marcos (BUG-09 e BUG-10) — ambos mexem no mesmo arquivo.

### Médio prazo (próxima sprint)
- Unificar templates de mensagem para vendedor (BUG-15).
- Proteção contra clique duplo na transferência (BUG-14).
- Alinhar comportamento de `assigned_to_id` entre manual e automático (BUG-13).

### Limpeza (sem urgência)
- Apagar diretório `pedro-transfer-router/` vazio (BUG-18).
- Revisar cobertura de status em `bulk-transfer-leads` (BUG-17).
- Melhorar lógica de `last_flushed_at` no cron (BUG-19).

---

## 7. Referência Técnica — Arquivos Mais Tocados

| Arquivo | Bugs relacionados |
|---|---|
| `supabase/functions/bulk-transfer-leads/index.ts` | BUG-01, BUG-17 |
| `supabase/functions/pedro-process-feedback/index.ts` | BUG-02, BUG-11 |
| `supabase/functions/cron-flush-manager-feedbacks/index.ts` | BUG-09, BUG-10, BUG-19 |
| `supabase/functions/manual-transfer/index.ts` | BUG-13, BUG-14, BUG-16 |
| `supabase/functions/uazapi-webhook/index.ts` | BUG-15 |
| `supabase/functions/create-evolution-instance/index.ts` | BUG-12 |
| `src/pages/CrmAoVivo.tsx` | BUG-03, BUG-04 |
| `src/pages/PedroSDR.tsx` | BUG-04 |
| `src/pages/WhatsAppInbox.tsx` | BUG-04 |
| `src/pages/WhatsAppInstances.tsx` | BUG-05, BUG-06 |
| `src/pages/DashboardTV.tsx` | BUG-08 |
| `src/components/evolution/EvolutionConnectDialog.tsx` | BUG-07 |

---

*Documento gerado automaticamente a partir da auditoria técnica conduzida em 27/05/2026.*

---

## 📊 Segunda rodada de auditoria — 10 bugs novos (27/05/2026 pós-promoção)

Após promover os 19 bugs anteriores para PROD, uma nova varredura encontrou bugs em áreas que NÃO tinham sido auditadas (campanhas, follow-up, webhook de mensagens, segurança).

### 🔴 BUG-NOVO-01 — Race condition em webhook permite IA responder 2x
**Status:** ⏳ Pendente
**Severidade:** 🔴 CRÍTICA
- **Arquivo:** `supabase/functions/uazapi-webhook/index.ts:1856-1865` (UAZAPI) + `:1903-1913` (Evolution) + `wa-inbox-webhook/index.ts:568-584`
- **Sintoma:** dedup é SELECT-then-INSERT sem `UNIQUE INDEX` em `wa_inbox.remote_message_id`. Se UazAPI repete o evento (retry), ambos os webhooks passam o SELECT (lead ainda não existe) e INSERT. IA responde 2x ao cliente. Cliente vê 2 mensagens idênticas.
- **Fix recomendado:** migration `CREATE UNIQUE INDEX wa_inbox_remote_msg_unique ON wa_inbox(user_id, instance_id, remote_message_id) WHERE remote_message_id IS NOT NULL` + `ON CONFLICT DO NOTHING` nos inserts.

### 🔴 BUG-NOVO-02 — Service role JWT hardcoded em migration versionada (SEGURANÇA)
**Status:** ⚠️ Requer ação do usuário (rotação de service key)
**Severidade:** 🔴 CRÍTICA
- **Arquivo:** `supabase/migrations/20260509000001_cron_pedro_trigger_followup.sql:10`
- **Sintoma:** o cron pg_cron `pedro-trigger-followup` usa `Bearer <service_role_jwt>` hardcoded. Token tem `exp:2089` (60+ anos). Qualquer pessoa com acesso ao repo bypassa RLS, lê/escreve qualquer tabela, lê segredos.
- **Fix recomendado:** (1) Master rotaciona a service role key no Supabase dashboard de PROD. (2) Nova migration cria cron usando `vault.decrypted_secrets` (mesmo padrão de `cron_wa_automation_runner.sql`). (3) Mesmo padrão verificado em STAGING.

### 🟠 BUG-NOVO-03 — UI ignora `deduplicated: true` da edge function manual-transfer
**Status:** ⏳ Pendente
**Severidade:** 🟠 ALTA
- **Arquivos:** `src/pages/WhatsAppInbox.tsx`, `src/pages/PedroSDR.tsx` (2 caminhos), `src/pages/CrmAoVivo.tsx`
- **Sintoma:** backend retorna `{success: true, deduplicated: true}` mas frontend mostra toast genérico "Lead transferido!". Master clica 2x rapidamente, recebe 2 toasts iguais, fica confuso e vai conferir se vendedor recebeu 2 mensagens.
- **Fix recomendado:** ler `data?.deduplicated` na resposta. Se true, mostrar toast neutro "Lead já estava atribuído (clique anterior detectado)".

### 🟠 BUG-NOVO-04 — `reassignLead` UI optimistic descolada de BUG-13 fix
**Status:** ⏳ Pendente
**Severidade:** 🟠 ALTA
- **Arquivos:** `src/pages/PedroSDR.tsx:1782-1793`, `WhatsAppInbox.tsx:473`, `CrmAoVivo.tsx:866`
- **Sintoma:** após o fix do BUG-13 (Opção A), backend não seta `assigned_to_id` até vendedor confirmar "Ok". MAS frontend força optimistic `assigned_to_id = newMemberId`. Próximo refresh recebe `null` do banco e card "volta" pra "Sem vendedor", confundindo master.
- **Fix recomendado:** UI mostra "Aguardando confirmação (Vendedor X)" baseado em `ai_lead_transfers` mais recente com `transfer_status='pending'`, não em `assigned_to_id`.

### 🟠 BUG-NOVO-05 — Circuit-breaker do queue nunca dispara
**Status:** ⏳ Pendente
**Severidade:** 🟠 ALTA
- **Arquivo:** `supabase/functions/process-whatsapp-queue/index.ts:28` + linhas 702-730
- **Sintoma:** `instanceFailures = new Map()` em escopo de módulo. Deno Deploy cria nova instância de runtime a cada invocação. Com `BATCH_SIZE=3` e `CIRCUIT_BREAKER_THRESHOLD=5`, mesmo se todos os 3 da batch falharem o counter zera na próxima call. `handle-instance-ban` nunca é chamado automaticamente — failover é dead code.
- **Fix recomendado:** persistir contador em `wa_instances.consecutive_failures` ou tabela própria; resetar a cada `sent` bem-sucedido.

### 🟠 BUG-NOVO-06 — Follow-ups em `status='failed'` órfãos pra sempre
**Status:** ⏳ Pendente
**Severidade:** 🟠 ALTA
- **Arquivos:** `pedro-trigger-followup/index.ts:248-254` + `:396-402`
- **Sintoma:** `claim_pedro_followup_schedules` só recupera `status='pending'`. Falha pontual (timeout UazAPI) marca `status='failed'` sem retry. Lead nunca recebe follow-up. Mesma issue em `marcos_followup_schedules`.
- **Fix recomendado:** `attempt_count++` até 3 tentativas antes de marcar failed definitivo. OU re-claim de `failed` antigos > N minutos.

### 🟠 BUG-NOVO-07 — `enqueue-campaign` permite contato duplicado em re-import
**Status:** ⏳ Pendente
**Severidade:** 🟠 ALTA
- **Arquivo:** `enqueue-campaign/index.ts:266-274` + `:347-391`
- **Sintoma:** dedup por phone só dentro da query atual. Em retomada, se master adicionou nova lista com mesmo telefone mas `contact_id` diferente (re-import CSV), telefone duplica. Constraint `(campaign_id, contact_id)` não pega.
- **Fix recomendado:** `UNIQUE INDEX wa_queue_campaign_phone_unique ON wa_queue(campaign_id, phone) WHERE campaign_id IS NOT NULL`.

### 🟠 BUG-NOVO-08 — Campanha 100% failed marcada como "completed"
**Status:** ⏳ Pendente
**Severidade:** 🟠 ALTA
- **Arquivo:** `process-whatsapp-queue/index.ts:752-764`
- **Sintoma:** check de completion conta só `pending/processing`. Se todos caíram em `failed`, count=0 → status='completed'. Master vê "✅ Concluído" com 0 mensagens enviadas.
- **Fix recomendado:** se ALL itens são `failed`, marcar campanha como `failed` (não completed), com `error_message` agregado.

### 🟡 BUG-NOVO-09 — Auto-start campanhas agendadas pode disparar 2x
**Status:** ⏳ Pendente
**Severidade:** 🟡 MÉDIA
- **Arquivo:** `process-whatsapp-queue/index.ts:89-161` `autoStartDueScheduledCampaigns`
- **Sintoma:** SELECT + fetch sem claim atômico. Crons sobrepostos podem ver mesma campanha. Segunda tentativa só perde no UPDATE condicional do enqueue, mas gera ruído. Se enqueue retorna 500, campanha fica `scheduled` indefinidamente.
- **Fix recomendado:** atomic claim antes do fetch + marcar `failed` se enqueue !200.

### 🟡 BUG-NOVO-10 — `LiveLeadCard` mantém `selectedSellerId` órfão
**Status:** ⏳ Pendente
**Severidade:** 🟡 MÉDIA
- **Arquivo:** `src/pages/CrmAoVivo.tsx:113`
- **Sintoma:** state local `selectedSellerId` persiste através de re-renders. Se vendedor é desativado enquanto master ainda olha o card, `<select value>` perde o option, browser mostra primeira opção visualmente, mas state guarda o ID antigo. Clique em "Transferir" manda pro vendedor inativo, recebe erro confuso.
- **Fix recomendado:** `useEffect(() => { if (selectedSellerId && !activeMembers?.some(m => m.id === selectedSellerId)) setSelectedSellerId(''); }, [activeMembers, selectedSellerId]);` no `LiveLeadCard`.

---

## 📈 Status atualizado (pós-promoção + nova auditoria)

| Severidade | Auditoria 1 | + Novos | Total | Corrigidos | Pendentes |
|---|---|---|---|---|---|
| 🔴 CRÍTICA | 3 | +2 | 5 | 3 | **2** |
| 🟠 ALTA | 7 | +6 | 13 | 7 | **6** |
| 🟡 MÉDIA | 5 | +2 | 7 | 5 | **2** |
| 🟢 BAIXA | 4 | 0 | 4 | 0 | 4 |
| **TOTAL** | **19** | **+10** | **29** | **15** | **14** |

Próximo lote de correções: priorizar 🔴 BUG-NOVO-02 (rotação service key) + 🔴 BUG-NOVO-01 (UNIQUE INDEX wa_inbox).

*Atualização: 27/05/2026 — segunda rodada de auditoria após promoção em PROD.*
