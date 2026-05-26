# AUDIT_INSTANCIAS.md — Fase 2 da Auditoria Total (Módulo Instâncias WhatsApp)

> **Bug B3** (instância oscilando) + bugs latentes. **10 bugs identificados** (3 críticas, 5 altas, 2 médias).
> **Data:** 2026-05-26 | **NÃO corrige nada — apenas registra.**

## Resumo Executivo

B3 (oscilação) tem **dois vetores críticos simultâneos**:
1. Fallback `POST /instance/connect` em `verify-instance-status` força reconexão em loop (85% probabilidade)
2. Eventos `connection.update` no `uazapi-webhook` passam direto sem dedup (70% agravam)

Sistema carece de state machine validado, rate limiting de eventos, reset de contadores após sucesso, e validação de signature em webhooks.

---

## BUGS

### BUG-I-001 🔴 CRÍTICA — Causa raiz #1 do B3
**Arquivo:** `supabase/functions/verify-instance-status/index.ts:110-117`
**Sintoma:** Instância oscila conecta/desconecta em ciclo (5-10min); `health_score` decai permanentemente mesmo com reconexão.
**Causa raiz:** Quando `GET /instance/connectionState` falha, função faz fallback para `POST /instance/connect`, forçando reconexão na UazAPI. UazAPI dispara webhook `connection.update` → atualiza status no DB → próximo polling (5s) vê mudança → rerequests verify → **loop infinito**.
**Severidade:** Crítica (85% probabilidade)
**Correção proposta:** Remover linhas 113-117 (POST fallback). Retornar erro "API indisponível no momento" em vez de forçar reconexão. Polling já faz retry via Realtime + 5s.
**Risco de regressão:** Instâncias com UazAPI instável não conseguirão recuperar sozinhas — mas o loop atual é pior (piora status infinitamente). Risco baixo com monitoramento.

### BUG-I-002 🔴 CRÍTICA — Causa raiz #2 do B3
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:1873-1883`
**Sintoma:** Webhook recebe `connection.update` → faz UPDATE direto em `wa_instances` sem dedup. UazAPI pode mandar mesmo evento 5-10x em 1s.
**Causa raiz:** Mensagens usam `remote_message_id` para dedup (linhas 1916-1926), mas eventos de status passam sem mecanismo.
**Severidade:** Alta (70% agrava B3)
**Correção proposta:** Adicionar dedup para eventos de status: extrair `event_id` ou `timestamp` do payload; registrar em tabela nova `wa_webhook_events(event_id, instance_name, created_at)` com UNIQUE index; skip se já existe.
**Risco de regressão:** Muito baixo (apenas adiciona filtro).

### BUG-I-003 🔴 CRÍTICA — Causa raiz #3 do B3
**Arquivo:** `src/components/evolution/EvolutionConnectDialog.tsx:180-217`
**Sintoma:** Dialog monitora status com **Realtime subscription + polling simultâneos** (5s); `handleSuccess()` pode ser chamado 2x em paralelo.
**Causa raiz:** Realtime (linha 185-198) e polling (linha 201-217) rodam em paralelo sem mutex. Ambos chamam `handleSuccess()` quando status muda.
**Severidade:** Alta (65% race conditions)
**Correção proposta:** Flag `successAlreadyHandled` no state; verificar antes de chamar `handleSuccess()`. Ou usar `AbortController` pra cancelar polling ao receber Realtime UPDATE.
**Risco de regressão:** Muito baixo.

### BUG-I-004 🟠 ALTA
**Arquivo:** `supabase/migrations/20260316215501_*.sql:3-27`
**Sintoma:** `consecutive_undelivered` **nunca é resetado**. Instância recebe ban permanente mesmo após reconectar.
**Causa raiz:** `increment_consecutive_undelivered()` incrementa, atinge 10 → seta `shadow_ban_suspect=true` + `is_active=false` + reduz health 50pts. **Não há código que zere counter ao reconectar com sucesso.**
**Severidade:** Alta (40% das instâncias "zumbis")
**Correção proposta:** Em `verify-instance-status`, quando `isConnected=true`, executar UPDATE setando `consecutive_undelivered=0, shadow_ban_suspect=false`. Trigger BEFORE UPDATE também pode resetar.
**Risco de regressão:** Baixo. Melhora UX significativamente.

### BUG-I-005 🟠 ALTA
**Arquivo:** `supabase/functions/verify-instance-status/index.ts:150`
**Sintoma:** Estado `'connecting'` é tratado como `'connected'`. Instância fica ativa enquanto conectando; se falhar, status fica confuso.
**Causa raiz:** Lógica: `realStatus = state === 'connecting' ? 'connecting' : 'connected'` — mas `updateData.is_active = true` para QUALQUER `isConnected` (incluindo 'connecting').
**Severidade:** Média (50%)
**Correção proposta:** Restringir `isConnected = state === 'open' || state === 'connected'` (remover 'connecting'). Se conectando, deixar `is_active` no estado anterior.
**Risco de regressão:** Baixo.

### BUG-I-006 🟡 MÉDIA
**Arquivo:** `supabase/functions/create-evolution-instance/index.ts:178`
**Sintoma:** Limite de plano não bloqueia criação se pool já está cheio; UI permite "Conectar" mesmo com `poolUsed >= maxInstances`.
**Causa raiz:** `validatePoolLimits()` faz count de `is_active=true` mas frontend conta sem considerar desativadas.
**Severidade:** Média (30%)
**Correção proposta:** Frontend re-valida pool ANTES de mostrar botão. Edge function já retorna erro (manter).
**Risco de regressão:** Muito baixo.

### BUG-I-007 🔒 ALTA (security)
**Arquivo:** `supabase/functions/uazapi-webhook/index.ts:1873-1883`
**Sintoma:** Webhook **não valida assinatura de origem**. Qualquer POST consegue marcar instância como `connected/disconnected`.
**Causa raiz:** Handler aceita payload sem HMAC/signature. UazAPI deveria enviar header `X-Webhook-Signature` validado com `api_key_encrypted`.
**Severidade:** Alta (security)
**Correção proposta:** Extrair `api_key_encrypted` da instância; validar HMAC-SHA256 da payload. Rejeitar 401 se inválido.
**Risco de regressão:** Baixo se UazAPI suporta. Confirmar antes de prod.

### BUG-I-008 🟢 BAIXA
**Arquivo:** `supabase/migrations/20260313112448_*.sql:37-39`
**Sintoma:** `health_score` sem cap máximo automático ao reconectar.
**Causa raiz:** `GREATEST(0, score - 30)` previne negativos, mas não há `LEAST(100, score + recovery)` ao reconectar.
**Severidade:** Baixa (cosmética)
**Correção proposta:** Adicionar `LEAST(100, ...)` no UPDATE de sucesso.
**Risco de regressão:** Muito baixo.

### BUG-I-009 🟡 MÉDIA
**Arquivo:** `src/pages/WhatsAppInstances.tsx:162-204`
**Sintoma:** `verifyAllInstances()` chama edge function `audit-master-instances` que **não foi encontrada no código inspecionado**.
**Causa raiz:** Função pode ter sido deletada ou renomeada. Frontend depende dela.
**Severidade:** Média (funcionalidade quebrada)
**Correção proposta:** Implementar `audit-master-instances` OU substituir chamada por loop `verifyInstanceStatus(instance.id)`.
**Risco de regressão:** Baixo.

### BUG-I-010 🟢 BAIXA
**Arquivo:** `supabase/functions/get-evolution-qrcode/index.ts:323-343`
**Sintoma:** Cada chamada faz `POST /instance/connect`, regenerando QR mesmo quando já existe válido. Pode invalidar QR que usuário estava escaneando.
**Causa raiz:** POST /instance/connect é fallback sempre executado.
**Severidade:** Baixa (UX)
**Correção proposta:** Reordenar: GET /instance/connect/name PRIMEIRO; POST só se GET falha.
**Risco de regressão:** Muito baixo.

---

## 📋 Cenários de reprodução do B3

| # | Cenário | Esperado | Atual (com bug) |
|---|---|---|---|
| 1 | Conectar instância, esperar 5min sem interação | Status `connected` estável | Oscila a cada 5s `connected ↔ disconnected`. Health cai 30-50pts/ciclo |
| 2 | Criar 2 instâncias rápido com mesmo `instance_name` | Erro "já existe" claro | Conflito silencioso; master edita instância errada |
| 3 | Desconectar via API direta (sem UI) | Front detecta + atualiza | Polling vê mudança → força reconexão → loop |
| 4 | Reiniciar servidor UazAPI | Reconecta com backoff | Todas marcam `disconnected`; polling força reconexão paralela → flood na UazAPI |

---

## 🚩 Questões Abertas

1. Existe tabela `wa_audit_logs` ou `wa_webhook_events` para logging estruturado?
2. `audit-master-instances` edge function foi removida ou renomeada?
3. UazAPI tem rate limiting configurado pra `POST /instance/connect`?
4. Tokens em `api_key_encrypted` são regenerados em algum lugar?
