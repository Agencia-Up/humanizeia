# AUDIT_AGENTES.md — Fase 2 da Auditoria Total (Módulo Agentes Pedro + Marcos)

> **14 bugs identificados** (1 crítica, 5 altas, 5 médias, 3 baixas).
> **Data:** 2026-05-26 | **NÃO corrige nada — apenas registra.**

## Resumo Executivo

Pedro tem 10 bugs relacionados a fallback LLM, concorrência de estado, idempotência de handoff e ausência de respeito ao `ai_paused`. Marcos tem 4 bugs em automações (executor incompleto), opt-out ausente em queue, e falta de observabilidade. Nenhum sistema tem retry com backoff configurado por padrão; memória de Pedro pode crescer sem limite.

---

## BUGS — PEDRO (10)

### BUG-P-001 🔴 CRÍTICA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:2808-2877`
**Sintoma:** Fallback OpenAI silencioso por padrão (flag `LLM_RETRY_FALLBACK` desabilitada). Se GPT-4o timeout/5xx, webhook retorna 500 e cliente fica sem resposta.
**Causa raiz:** Flag precisa ser explicitamente habilitada. Sem ela, linha 2836 faz fetch único sem retry/backoff.
**Severidade:** Crítica
**Correção proposta:** Ativar flag por padrão pra agentes novos. Implementar retry com backoff exponencial (5s/10s/20s) como padrão.
**Risco de regressão:** Baixo — feature flag mantém retrocompat.

### BUG-P-002 🟠 ALTA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:2567-2610` (`deepMerge + upsert`)
**Sintoma:** Webhooks paralelos do mesmo lead podem deixar `pedro_conversation_state` inconsistente. Fluxo: fetch state → extract delta → merge → upsert. Sem lock, 2 threads sobrescrevem dados.
**Causa raiz:** `supabase.upsert()` não usa `FOR UPDATE SKIP LOCKED`. Lógica em aplicação, não em SQL.
**Severidade:** Alta
**Correção proposta:** RPC com `FOR UPDATE` atômico, ou versioning com CAS (compare-and-swap).
**Risco de regressão:** Médio — pode aumentar latência se lock contender.

### BUG-P-003 🟠 ALTA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:3088, 3346` (`transferir_para_vendedor`)
**Sintoma:** Tool é chamada 2x em <1s, pode criar 2 transfers ou sobrescrever.
**Causa raiz:** `ignoreDuplicates=true` mas sem UNIQUE constraint em `(lead_id, transfer_status)`. Dois "pending" podem coexistir.
**Severidade:** Alta
**Correção proposta:** Garantir atomicidade no check `existingPending` (já existe em linhas 3008-3023). Adicionar UNIQUE constraint no schema.
**Risco de regressão:** Baixo.

### BUG-P-004 🟡 MÉDIA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:275-359` (`extractEntitiesWithClaude`)
**Sintoma:** Se 4 modelos Claude falham, função retorna `{ delta: {}, eco: false, objecoes: [] }` silenciosamente. Lead perde oportunidade de aprender; sem log estruturado.
**Causa raiz:** Loop de fallback entra em catch silencioso. Linha 3034 retorna vazio sem escalar.
**Severidade:** Média
**Correção proposta:** Logar erro pra observabilidade. Retornar flag `extraction_failed: true` pra webhook decidir.
**Risco de regressão:** Muito baixo.

### BUG-P-005 🟡 MÉDIA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:2630-2680`
**Sintoma:** `pedro_conversation_state.state` (JSONB) sem limite de tamanho. Conversa com 500+ turnos cresce indefinidamente. Pode estourar limite de tokens no prompt.
**Causa raiz:** Sem lógica de sliding window. `deepMerge` acumula tudo. Array de objeções pode ter 50+ itens.
**Severidade:** Média
**Correção proposta:** `maxStateSize` (ex: 50KB) com slice das conversas antigas. Ou rotacionar pra tabela `pedro_conversation_history`.
**Risco de regressão:** Médio — pode perder contexto se limite muito apertado.

### BUG-P-006 🟠 ALTA
**Arquivo:** `supabase/functions/pedro-trigger-followup/index.ts:126-130` (`claim_pedro_followup_schedules`)
**Sintoma:** Cron a cada 15min. Se 2 crons disparam em paralelo (timing edge), RPC pode retornar mesmas agendas pra ambos → 2 mensagens pro mesmo lead.
**Causa raiz:** `claim_*` usa `FOR UPDATE SKIP LOCKED`, mas sem teste de concorrência cron + botão manual simultâneos.
**Severidade:** Alta
**Correção proposta:** Distributed lock (Redlock) ou verificar `claim_*` garante atomicidade total.
**Risco de regressão:** Muito baixo.

### BUG-P-007 🟡 MÉDIA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:790-795, 2095-2099`
**Sintoma:** Handoff atualiza `ai_crm_leads.assigned_to_id` e status separadamente. Se IA falha entre os 2 updates, lead fica em estado intermediário.
**Causa raiz:** Sem transação atômica.
**Severidade:** Média
**Correção proposta:** RPC atômico OU transação Supabase.
**Risco de regressão:** Baixo.

### BUG-P-008 🟢 BAIXA
**Arquivo:** `supabase/migrations/20260515200000_pedro_conversation_state.sql:16-25`
**Sintoma:** `pedro_conversation_state` usa PK `(lead_id, agent_id)`, mas sem índice em `agent_id` sozinho. Queries "WHERE agent_id = ?" podem fazer seq scan.
**Causa raiz:** Migration só cria índices em `user_id` e `updated_at`.
**Severidade:** Baixa
**Correção proposta:** `CREATE INDEX idx_pedro_state_agent_id ON pedro_conversation_state(agent_id)`.
**Risco de regressão:** Nenhum.

### BUG-P-009 🟡 MÉDIA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:2185-2189`
**Sintoma:** Quando lead retorna após handoff, webhook **não verifica `wa_ai_agents.is_active`** nem `ai_crm_leads.ai_paused`. Agente desativado continua respondendo.
**Causa raiz:** `ai_paused` existe mas não é consultado no webhook.
**Severidade:** Média
**Correção proposta:** Validar `agent.is_active && !lead.ai_paused` antes de gerar resposta IA. Se false, pular IA e enviar fallback "IA em pausa".
**Risco de regressão:** Muito baixo.

### BUG-P-010 🟢 BAIXA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts` (geral)
**Sintoma:** Sem tracking de consumo de tokens por lead/dia. Agentes podem queimar quota sem limite.
**Causa raiz:** `wa_ai_agents.total_replies` incrementa mas sem enforcement de threshold.
**Severidade:** Baixa
**Correção proposta:** Calcular tokens estimados, manter contador, bloquear se > limite.
**Risco de regressão:** Médio — pode bloquear agentes legítimos.

---

## BUGS — MARCOS (4)

### BUG-M-001 🟠 ALTA
**Arquivo:** `supabase/functions/wa-automation-runner/index.ts:112-116`
**Sintoma:** 8 tipos de nó no builder, executor implementa **só `add_to_list`**. Outros 7 são puramente visuais.
**Causa raiz:** MVP focou em `add_to_list`. Outros 7 nós ignorados com log WARN.
**Severidade:** Alta (já documentado em AUDIT_MAP.md)
**Correção proposta:** Implementar `message` (UazAPI `send/text`) e `delay` (via cron). Marcar outros 5 como "coming soon" no builder.
**Risco de regressão:** Baixo com feature flag.

### BUG-M-002 🟡 MÉDIA
**Arquivo:** `supabase/functions/wa-automation-runner/index.ts:134-167`
**Sintoma:** Sem `claim_wa_automation_runs` RPC. Se 2 workers paralelos, mesmos contatos podem ser processados 2x.
**Causa raiz:** Check de `processedSet` é em aplicação, não em SQL.
**Severidade:** Média
**Correção proposta:** Usar UNIQUE constraint `(flow_id, contact_id)` + `ON CONFLICT DO NOTHING` (já existe). Adicionar RPC atômico pra claim.
**Risco de regressão:** Baixo.

### BUG-M-003 🟠 ALTA (compliance)
**Arquivo:** `supabase/functions/process-whatsapp-queue/index.ts:11-182`
**Sintoma:** `process-whatsapp-queue` processa em batches. **Sem check de `opt_out_status`**. Se contato se desinscreve, próxima mensagem ainda é enviada (viola LGPD/anti-spam).
**Causa raiz:** Tabela `wa_queue` sem coluna verificadora de blocklist; ou check foi removido.
**Severidade:** Alta (legal)
**Correção proposta:** Validar `contact.opted_out` ou `wa_blocklist` antes de enviar.
**Risco de regressão:** Muito baixo.

### BUG-M-004 🟡 MÉDIA
**Arquivo:** `supabase/functions/wa-automation-runner/index.ts:1-20`
**Sintoma:** Sem observabilidade. Falhas vão pra `console.log` e somem. Sem tabela de auditoria.
**Causa raiz:** MVP sem integração com `agent_executions`; sem slog ou trace_id.
**Severidade:** Média
**Correção proposta:** Inserir em `agent_executions` com `(user_id, flow_id, status, result_summary, error_message, triggered_at)`.
**Risco de regressão:** Nenhum.

---

## ✅ Já Corrigido

**Pedro Conversation State (Lote 1):**
- Migration `20260515200000` criou tabela com RLS e índices
- `extractEntitiesWithClaude` com fallback de 4 modelos
- `deepMerge` + `formatStateForPrompt` resolvem 12 bugs Roberta

**Tool Transferir (Lote 2):**
- `transferir_para_vendedor` idempotente (check `existingPending` linhas 3008-3023)
- Sync feedback confirmação de vendedor (linhas 2076-2127)
- RLS em `ai_lead_transfers` garante isolamento entre sellers

**Marcos Add_to_List (Item 4):**
- Nó executor implementado (`wa-automation-runner:153-174`)
- UNIQUE constraint via `onConflict` em `wa_contact_list_members`
- Idempotência via upsert

---

## 🚩 Questões Abertas

1. **Token Limit por Agent:** Existe threshold em `wa_ai_agents.token_limit`? Como enforcement?
2. **Observabilidade:** Há dashboard monitorando taxa de erro do `uazapi-webhook`? Latência P95 do `extractEntities`?
3. **Marcos Automações:** ETA pra implementar `message` node além de `add_to_list`?
4. **Transações SQL:** Supabase suporta `BEGIN/COMMIT` ou apenas RPC atômicas?
5. **Desativação de Agente:** Se `agent.is_active=false` durante conversa, lead recebe resposta antes ou depois da mudança?
