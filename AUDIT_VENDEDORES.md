# AUDIT_VENDEDORES.md — Fase 2 da Auditoria Total (Módulo Vendedores)

> **Bugs B1 e B2** + bugs latentes. **12 bugs identificados** (3 críticas, 2 altas, 6 médias, 1 baixa).
> **Data:** 2026-05-26 | **NÃO corrige nada — apenas registra.**

## Resumo Executivo

Módulo de Vendedores (`SellerManagerTab` + `invite-seller`) está **parcialmente corrigido** (hotfix B1 em commit `1098694` deployed em prod). Apresenta 12 bugs envolvendo: estado UI sem timeout, falta de validação transacional, cascades incompletos de deleção, conflito de constraints em FK de `wa_instances`, e ausência de validação de limite de plano.

---

## BUGS

### BUG-V-001
**Arquivo:** `src/components/pedro/SellerManagerTab.tsx:334-356` (`handleAddSeller`)
**Sintoma:** Botão "Cadastrar" fica eternamente em loading se `fetchData()` (linha 352) travar.
**Causa raiz:** Sem timeout em `fetchData()`. Se `supabase.functions.invoke('invite-seller')` ou query SELECT falham silenciosamente, a Promise nunca resolve e `setSaving(false)` não executa.
**Severidade:** Média
**Correção proposta:** Adicionar `Promise.race()` com timeout de 10s. Se falhar, `setSaving(false)` no catch + toast claro.
**Risco de regressão:** Baixo — apenas adiciona robustez ao error handling.

### BUG-V-002
**Arquivo:** `src/components/pedro/SellerManagerTab.tsx:394-402` (`handleDelete`)
**Sintoma:** Estado local (`setSellers(prev => prev.filter(...))`) é atualizado **antes** da confirmação do DELETE. Se DELETE falha (RLS, FK), UI mostra vendedor removido mas registro persiste no DB.
**Causa raiz:** Ordem invertida — remove do state antes de confirmar sucesso.
**Severidade:** Crítica
**Correção proposta:** Inverter: DELETE primeiro, aguardar resposta, **só então** atualizar state. Se error, toast + não alterar state.
**Risco de regressão:** Médio — pode expor erros RLS que estavam silenciosos.

### BUG-V-003
**Arquivo:** `supabase/migrations/20260312192651_*.sql:7` + `supabase/migrations/20260320150000_add_whatsapp_fields.sql:33`
**Sintoma:** Tabela `wa_instances` tem **dois CREATE TABLE conflitantes**. 1ª migration define `user_id UUID NOT NULL` sem FK (RESTRICT implícito). 2ª redefine `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE`.
**Causa raiz:** Duplicação de CREATE TABLE IF NOT EXISTS — qual constraint está ativa em prod é ambíguo.
**Severidade:** Crítica
**Correção proposta:** Remover CREATE TABLE da migration 20260320 e manter ALTER ADD COLUMN. Auditar prod via `information_schema.table_constraints`.
**Risco de regressão:** Alto — pode revelar inconsistências de dados.

### BUG-V-004
**Arquivo:** `supabase/functions/invite-seller/index.ts:346-406`
**Sintoma:** Se `Resend.sendEmail()` falha, função retorna 500 mas `ai_team_members.auth_user_id` **já foi atualizado**. Vendedor fica com auth account criado mas sem email de convite.
**Causa raiz:** Falta de transação atômica. Email é enviado **depois** de atualizar DB.
**Severidade:** Alta
**Correção proposta:** Enviar email ANTES de atualizar `auth_user_id`. Se email falha, rollback via UPDATE `auth_user_id = NULL`.
**Risco de regressão:** Médio — pode gerar emails duplicados se Resend timeout + retry.

### BUG-V-005
**Arquivo:** `src/components/pedro/SellerManagerTab.tsx:394-402` + banco
**Sintoma:** Ao deletar vendedor, registros órfãos ficam em `wa_contacts` (sem FK definida) e `wa_queue` (sem ON DELETE) — mensagens pendentes ficam bloqueadas para sempre.
**Causa raiz:** Migrations não definiram ON DELETE para todas as FKs. Apenas `assigned_to_id` tem SET NULL.
**Severidade:** Crítica
**Correção proposta:** Migration ALTER TABLE adicionando FKs com CASCADE em `wa_contacts.member_id` e `wa_queue.seller_member_id`.
**Risco de regressão:** Médio — pode disparar cascades inesperadas em registros órfãos antigos.

### BUG-V-006
**Arquivo:** `supabase/functions/delete-evolution-instance/index.ts:102-107` + `SellerManagerTab.tsx:394`
**Sintoma:** Ao remover vendedor, instâncias UazAPI ficam **fantasma** no provedor (continuam autenticadas, consumindo créditos, impossíveis de reautenticar).
**Causa raiz:** Sem trigger/edge function chamando `delete-evolution-instance` quando `ai_team_members` é deletado.
**Severidade:** Crítica
**Correção proposta:** Trigger AFTER DELETE em `ai_team_members` → função helper que chama `delete-evolution-instance` async para cada instância órfã.
**Risco de regressão:** Médio — pode gerar muitas chamadas à Evolution API.

### BUG-V-007
**Arquivo:** `src/components/pedro/SellerManagerTab.tsx:384-391` (`handleToggleActive`)
**Sintoma:** Toggle pausar/ativar é otimista. Se UPDATE falha silenciosamente (RLS), UI mostra estado alterado mas DB não muda.
**Causa raiz:** Sem await pra confirmar sucesso do UPDATE.
**Severidade:** Média
**Correção proposta:** Toggle pessimista: aguardar resposta, só então atualizar state. Se error, toast + não alterar UI.
**Risco de regressão:** Baixo.

### BUG-V-008
**Arquivo:** `supabase/functions/invite-seller/index.ts:315-344`
**Sintoma:** Cascata de fallbacks (`authAdminCreateUser` falha → `authAdminListUsers` falha) entra em estado confuso. Vendedor pode ter conta parcialmente criada.
**Causa raiz:** Sem separação clara entre erros: 422/already-exists, network/timeout, outros.
**Severidade:** Média
**Correção proposta:** Tratamento separado: (1) 422 → reuse, (2) network → retornar "Tente novamente em 30s", (3) outros → erro genérico sem retry automático.
**Risco de regressão:** Baixo — apenas esclarece error messages.

### BUG-V-009
**Arquivo:** `src/components/pedro/SellerManagerTab.tsx:316-324` (dedup logic)
**Sintoma:** Dedup por `whatsapp_number` pode silenciosamente descartar registros legítimos se dois vendedores diferentes têm mesmo WhatsApp.
**Causa raiz:** Heurística "prefer active" pode não ser correta se vendedor foi pausado intencionalmente.
**Severidade:** Média
**Correção proposta:** Usar `(user_id, whatsapp_number, agent_id)` como chave de dedup, ou adicionar coluna `canonical_id`.
**Risco de regressão:** Alto — pode expor duplicatas escondidas.

### BUG-V-010
**Arquivo:** `src/components/pedro/SellerManagerTab.tsx:418-428` (`handleSaveEdit`)
**Sintoma:** Ao editar nome/WhatsApp, mudanças aplicam **apenas ao registro com `id` específico**. Se vendedor tem múltiplos registros (1 por agent_id), outros ficam com dados antigos.
**Causa raiz:** UPDATE via `eq('id', id)` atualiza só 1 registro, não todos do mesmo vendedor.
**Severidade:** Alta
**Correção proposta:** UPDATE com `eq('whatsapp_number', originalPhone).eq('user_id', userId)` pra pegar todos.
**Risco de regressão:** Médio — pode afetar se há filtros RLS bloqueando.

### BUG-V-011
**Arquivo:** `src/components/pedro/SellerManagerTab.tsx:460-968` (Dialog permissões)
**Sintoma:** Estado local de permissões pode vazar entre dialogs se vendedor muda de painel durante edição.
**Causa raiz:** State no componente pai (`configFeatures`, `initialFeatures`), não isolado por dialog.
**Severidade:** Média
**Correção proposta:** `useEffect` que reseta estado quando `configSellerId` muda.
**Risco de regressão:** Baixo.

### BUG-V-012
**Arquivo:** (não encontrado — falta migration de limite de plano)
**Sintoma:** **SEM verificação de limite PRO de 2 vendedores ativos**. User pode cadastrar 10 vendedores em plano PRO sem erro.
**Causa raiz:** Limite é silencioso ou apenas frontend (bypassável).
**Severidade:** Alta
**Correção proposta:** Trigger BEFORE INSERT em `ai_team_members` validando contagem por `user_id` com `is_active=true`. Mensagem clara: "Limite de 2 vendedores ativos no plano PRO".
**Risco de regressão:** Médio — pode bloquear operações legítimas se cálculo estiver errado.

---

## ✅ Já Corrigido

**B1 (Cadastro intermitente) — Hotfix em commit `1098694` (deployed PROD):**
- `invite-seller/index.ts:346-406`: tenta múltiplos tipos de link (`invite` → `recovery` → `magiclink`) com validação de token real.
- Resolve caso `generate_link('invite')` falhar silenciosamente para users já confirmados.

---

## 🚩 Questões Abertas

1. **wa_instances FK conflict (BUG-V-003):** Qual constraint está realmente ativa em PROD? `SELECT constraint_name, delete_rule FROM information_schema.table_constraints WHERE table_name='wa_instances'`
2. **Limite de plano PRO (BUG-V-012):** Implementado em algum lugar? Grep por `MAX_SELLERS`, `plan_limit`, `2.*seller`.
3. **Cascades incompletos:** Quantos registros órfãos existem em `wa_queue`, `wa_contacts` em PROD?
4. **Instâncias Evolution fantasma:** Quantas instâncias marcadas como deleted no DB mas ainda autenticadas no UazAPI?
