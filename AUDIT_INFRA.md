# AUDIT_INFRA.md — Fase 2 da Auditoria Total (Módulo Infra / Integrações / Segurança)

> **15 bugs identificados** (4 críticas, 5 altas, 6 médias/baixas). **Foco em segurança.**
> **Data:** 2026-05-26 | **NÃO corrige nada — apenas registra.**

## Resumo Executivo

Sistema em PROD com múltiplas **vulnerabilidades de segurança ativas** + problemas estruturais em RLS, rate limiting e validação de webhook. Depende pesadamente de funções `SECURITY DEFINER` pra RLS — risco se novas policies forem adicionadas sem o padrão. **4 webhooks receivers sem validação de assinatura.**

---

## BUGS

### BUG-INF-001 🔴 CRÍTICA (B3)
**Arquivo:** `supabase/functions/verify-instance-status/index.ts:110-118`
**Sintoma:** Instâncias WhatsApp em loop de reconexão oscilante (cobre B3 — redundante com `AUDIT_INSTANCIAS.md#BUG-I-001`).
**Severidade:** Crítica
**Correção proposta:** Ver `AUDIT_INSTANCIAS.md#BUG-I-001`.

### BUG-INF-002 🟠 ALTA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:1873-1883`
**Sintoma:** Eventos `connection.update` chegam 10+ vezes em 1s, todos atualizam `wa_instances` (cobre B3 — redundante com `AUDIT_INSTANCIAS.md#BUG-I-002`).
**Severidade:** Alta
**Correção proposta:** Ver `AUDIT_INSTANCIAS.md#BUG-I-002`.

### BUG-INF-003 🔒 CRÍTICA — SECURITY
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:1869-1883`
**Sintoma:** Qualquer POST com `EventType: 'connection'` pode marcar instância como `connected/disconnected`. Atacante conhecendo `instance_name` pode simular reconexão.
**Causa raiz:** Webhook **não valida signature/token**. Apenas verifica `EventType` no payload.
**Severidade:** Crítica
**Correção proposta:** Validar HMAC-SHA256: calcular `SHA256(body + secret)` e comparar com header `x-signature`. Rejeitar 401 se inválido.
**Risco de regressão:** Se UazAPI não envia signature (versão antiga), webhook quebrará. Testar em staging.

### BUG-INF-004 🔒 CRÍTICA — SECURITY
**Arquivo:** `supabase/functions/checkout-asaas-webhook/index.ts:52-62`
**Sintoma:** Webhook Asaas aceita requisições **SEM validação** se `CHECKOUT_ASAAS_WEBHOOK_TOKEN` não estiver configurado. Log emite warning "INSEGURO em prod" mas continua.
**Causa raiz:** `if (WEBHOOK_TOKEN) { validar } else { console.warn(); continuar() }` — fallback inseguro.
**Severidade:** Crítica
**Correção proposta:** Falhar HARD com 403 se `WEBHOOK_TOKEN` não está configurado. Nunca aceitar webhook não autenticado em PROD.
**Risco de regressão:** Se secret não foi configurado, webhook quebrará até definir.

### BUG-INF-005 🟠 ALTA
**Arquivo:** `supabase/functions/crm-capture/index.ts:1-108`
**Sintoma:** Endpoint `/f/:formId` (form externo) **sem rate limit**. Atacante envia 10k req/s de leads fake.
**Causa raiz:** Edge function aceita qualquer POST sem throttle.
**Severidade:** Alta
**Correção proposta:** Rate limit por IP (Redis ou middleware Supabase, max 50/min). CAPTCHA v3 invisível como complemento.
**Risco de regressão:** Taxa legítima pode ser bloqueada se limit muito apertado.

### BUG-INF-006 🔒 CRÍTICA — SECURITY
**Arquivo:** `supabase/functions/wa-inbox-webhook/index.ts`
**Sintoma:** Recebe mensagens de quem conhece a URL. **Sem validação de assinatura UazAPI.**
**Causa raiz:** Endpoint público sem HMAC.
**Severidade:** Crítica
**Correção proposta:** Validar `x-signature: sha256=<hex>` da UazAPI.
**Risco de regressão:** Quebra se UazAPI atual não envia. Coordenar.

### BUG-INF-007 🟡 MÉDIA
**Arquivo:** `supabase/migrations/20260313112448_*.sql`
**Sintoma:** `health_score` sem cap mínimo via constraint — código previne mas migration não.
**Causa raiz:** SQL `GREATEST(0, ...)` está correto onde aplicado, mas falta CHECK CONSTRAINT.
**Severidade:** Média
**Correção proposta:** `ALTER TABLE wa_instances ADD CONSTRAINT chk_health_score CHECK (health_score >= 0 AND health_score <= 100)`.
**Risco de regressão:** Mínimo.

### BUG-INF-008 🟠 ALTA
**Arquivo:** `supabase/functions/verify-instance-status/index.ts:195-199`
**Sintoma:** Quando instância reconecta, só `health_score` é resetado para 100, **não `consecutive_undelivered`**. Banimento permanente (cobre `AUDIT_INSTANCIAS.md#BUG-I-004`).
**Severidade:** Alta
**Correção proposta:** Adicionar `consecutive_undelivered = 0` ao `updateData` quando `isConnected === true`.
**Risco de regressão:** Nenhum.

### BUG-INF-009 🟡 MÉDIA
**Arquivo:** `supabase/migrations/20260507000001_fix_recursive_seller_rls.sql:27-30`
**Sintoma:** Policy `seller_view_master_team_safe` usa `get_seller_master_user_id()` (DEFINER). Se nova policy for adicionada SEM DEFINER, volta à recursão.
**Causa raiz:** Sem enforcement de pattern. Próxima migration pode quebrar.
**Severidade:** Média
**Correção proposta:** Documentar em CLAUDE.md (seção 12 NUNCA FAZER) + comment SQL nas policies existentes.
**Risco de regressão:** Nenhum (só docs).

### BUG-INF-010 🟡 MÉDIA
**Arquivo:** `supabase/migrations/20260508000001_pedro_crm_upgrade.sql:508-515`
**Sintoma:** Trigger `trg_pedro_notes_count` faz UPDATE em `seller_notes_count`. Se 2 notas paralelas, ambas leem `seller_notes_count=5`, incrementam pra 6, sobrescrevem-se → fica 6 (deveria ser 7).
**Causa raiz:** UPDATE sem lock explícito.
**Severidade:** Média
**Correção proposta:** Usar `UPDATE ... SET seller_notes_count = seller_notes_count + 1` (já é relativo). Adicionar advisory lock se persistir.
**Risco de regressão:** Nenhum.

### BUG-INF-011 🟡 MÉDIA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:1915-1926` (dedup mensagem)
**Sintoma:** Dedup usa `remote_message_id`. Se UazAPI não envia este campo, mensagens podem duplicar.
**Causa raiz:** Fallback é empty string que pula dedup.
**Severidade:** Média
**Correção proposta:** Log de aviso se vazio. Tupla `(instance_name, remoteJid, timestamp)` como fallback.
**Risco de regressão:** Mensagens podem duplicar se fallback pior. Testar.

### BUG-INF-012 🟢 BAIXA
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:1850-1851` (`sendVehicleImage`)
**Sintoma:** Assume sucesso baseado em status HTTP, sem validar resposta JSON. Se UazAPI retorna 200 com `{error: "..."}`, função retorna true.
**Causa raiz:** `if (res.ok)` não verifica `responseBody.success`.
**Severidade:** Baixa
**Correção proposta:** Validar `responseBody.success` (ou equivalente).
**Risco de regressão:** Nenhum.

### BUG-INF-013 🟡 MÉDIA
**Arquivo:** `supabase/migrations/` (geral)
**Sintoma:** Sem log estruturado de mudanças críticas (instância deletada, RLS bypass, webhook). `wa_audit_logs` existe mas não é populada por todos os handlers.
**Causa raiz:** Logs em `console.log`, não persistidos.
**Severidade:** Média
**Correção proposta:** Função `log_security_event(event_type, details, user_id)` que INSERT em `wa_audit_logs`. Chamar em DELETE `ai_team_members`, UPDATE `wa_instances.status`, webhook receivers.
**Risco de regressão:** Overhead se não índexado bem. UNLOGGED table ou batch insert.

### BUG-INF-014 🟢 BAIXA
**Arquivo:** `supabase/functions/verify-instance-status/index.ts:40-61`
**Sintoma:** Edge function autentica manualmente via `get_seller_master_user_id()`. Se DEFINER falha, pode vazar dados entre masters.
**Causa raiz:** Não há fallback de logging em caso de autorização negada.
**Severidade:** Baixa
**Correção proposta:** Logar acesso negado pra detectar tentativas de cross-tenant.
**Risco de regressão:** Nenhum.

### BUG-INF-015 🟢 BAIXA
**Arquivo:** `supabase/functions/crm-capture/index.ts:74-93`
**Sintoma:** Chama webhooks externos sem timeout. Se webhook lento, função pendura até timeout do Supabase (~30s).
**Causa raiz:** `fetch(config.webhook_url, ...).catch(...)` sem `AbortSignal`.
**Severidade:** Baixa
**Correção proposta:** `AbortSignal.timeout(5000)`. Falha rápida.
**Risco de regressão:** Webhooks muito lentos serão abortados (preferível a hang).

---

## 🔒 Vulnerabilidades Sérias (resumo)

| # | Bug | Risco |
|---|---|---|
| 1 | **Webhooks SEM signature** (`uazapi-webhook`, `wa-inbox-webhook`) | Atacante envia eventos fake; marca instância banned, simula mensagens |
| 2 | **`verify-instance-status` força reconexão → loop** | Instâncias oscilam perpetuamente, health afundado |
| 3 | **`crm-capture` SEM rate limit** | Spam de leads fake, preenche banco |
| 4 | **`checkout-asaas-webhook` aceita sem secret** | Qualquer POST aciona webhook de pagamento |

---

## 🚩 Questões Abertas

1. **RLS Recursão:** Se nova policy é adicionada SEM DEFINER, volta à recursão. Sem guard automatizado. Recomendação: SQL assertion em migration que rejeita policies sem DEFINER.
2. **Realtime Data Leakage:** Subscriptions filtram por `user_id`. Se RLS quebra, vazamento entre tenants. `REPLICA IDENTITY FULL` configurado (bom).
3. **Health Score Permanente:** Instância banida nunca "desbane" automaticamente. Reset periódico ou redução de threshold?
4. **Logging de Sensíveis:** `claude-chat/index.ts` loga `provider: ANTHROPIC_API_KEY ? 'anthropic' : ...`. Não log o valor, mas expõe que está configurada.
