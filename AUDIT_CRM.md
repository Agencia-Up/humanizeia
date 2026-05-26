# AUDIT_CRM.md — Fase 2 da Auditoria Total (Módulo CRM / Leads / Kanban)

> **13 bugs identificados** (2 críticas, 6 altas, 4 médias, 1 baixa).
> **Data:** 2026-05-26 | **NÃO corrige nada — apenas registra.**

## Resumo Executivo

Identificados bugs críticos no CRM compartilhado (`PedroSDR.tsx` / `CrmAvancadoTab`), incluindo: inconsistências de tipos entre Pedro/Marcos (`assigned_to_id` UUID vs `assigned_to` text), falta de trigger pra `marcos_crm_notes` (contador stale), e drag-and-drop sem rollback em caso de erro. Arquitetura com **3 tabelas de leads paralelas** (`ai_crm_leads`, `crm_leads`, `leads`) sem sincronização.

---

## BUGS

### BUG-C-001
**Arquivo:** `src/pages/PedroSDR.tsx:974-990`
**Sintoma:** `assigned_to` em `crm_leads` (Marcos) é text/string, enquanto `assigned_to_id` em `ai_crm_leads` (Pedro) é UUID FK. Causa problemas de filtragem e reatribuição.
**Causa raiz:** Marcos usa `lead.assigned_to` (text histórico), Pedro usa `assigned_to_id` (UUID). Código converte em JS via `custom_fields.seller_member_id` em vez de padronizar no banco.
**Severidade:** Alta
**Correção proposta:** Migration: ADD COLUMN `assigned_to_id` (UUID FK) em `crm_leads`. Preservar `assigned_to` text pra retrocompat. UI usar `assigned_to_id` como fonte de verdade.
**Risco de regressão:** Filtro por vendedor em Marcos deixará de funcionar se queries não atualizarem.

### BUG-C-002
**Arquivo:** `src/pages/PedroSDR.tsx:2192-2215` (`handleDragEnd`)
**Sintoma:** Drag-and-drop Pedro muda `status_crm` com update otimista. Se DB falha (network/RLS/constraint), UI mostra card na coluna errada.
**Causa raiz:** Estado otimista sem try-catch/recovery — apenas `setLeads(prev => ...)` antes de `.update()`.
**Severidade:** Média
**Correção proposta:** Try-catch envolvendo update. Se erro, reverter state com status antigo + toast + refetch via `fetchData(silent=true)`.
**Risco de regressão:** Mudanças legítimas podem ser "revertidas" se user recarregar muito rápido.

### BUG-C-003
**Arquivo:** `src/pages/PedroSDR.tsx:609-611` (`normalizeStatus` + `STATUS_DISPLAY_MAP`)
**Sintoma:** Status legacy (`interessado`, `qualificado`, `medio_qualificado`, etc.) são mapeados pra `novo`. Lead com `status_crm='qualificado'` aparece em coluna "Novo". Confunde user.
**Causa raiz:** Dados antigos não migrados. Código encobre mapeando tudo pra `novo`. Pedro usa 7 stages hardcoded vs Marcos customizáveis.
**Severidade:** Média
**Correção proposta:** Data migration: `UPDATE ai_crm_leads SET status_crm='novo' WHERE status_crm IN (legacy)`. Remover `STATUS_DISPLAY_MAP`. CHECK constraint com enum válido.
**Risco de regressão:** Leads com `status_crm=NULL` precisam default explícito.

### BUG-C-004 🟠 ALTA
**Arquivo:** `supabase/migrations/20260518183000_marcos_crm_notes.sql:60` (trigger faltante)
**Sintoma:** Marcos adiciona nota em `marcos_crm_notes`, mas `crm_leads.seller_notes_count` **nunca é incrementado** (diferente do Pedro que tem `trg_pedro_notes_count`). UI não mostra "📌 2 notas" no card.
**Causa raiz:** Trigger pro Pedro existe; faltou criar equivalente pro Marcos.
**Severidade:** Alta
**Correção proposta:** Migration: `CREATE TRIGGER trg_marcos_notes_count AFTER INSERT|DELETE ON marcos_crm_notes...`. Backfill: `UPDATE crm_leads SET seller_notes_count = (SELECT COUNT(*) FROM marcos_crm_notes WHERE lead_id = crm_leads.id)`.
**Risco de regressão:** Se trigger com mesmo nome existir, DROP antes de CREATE.

### BUG-C-005
**Arquivo:** `src/pages/PedroSDR.tsx:1230-1283` (`loadLeadDetail`)
**Sintoma:** Lead em Marcos com `stage_id` NULL ou apontando pra estágio deletado aparece vazio no Kanban.
**Causa raiz:** Lead pode ser criado antes de `crm_pipeline_stages` inicializado, ou estágio foi deletado/renomeado. Sem fallback.
**Severidade:** Média
**Correção proposta:** Badge "⚠️ Sem etapa" + botão "Mover" no detalhe. Filtrar kanban por `WHERE stage_id IS NOT NULL`.
**Risco de regressão:** Leads órfãos somem da view se filtrar.

### BUG-C-006
**Arquivo:** `src/pages/PedroSDR.tsx:1047-1060` (`leadsQuery`)
**Sintoma:** Master tem `.limit(500)`, mas vendedor não tem limit. Se vendedor tem >1000 leads, Supabase pode truncar silenciosamente.
**Causa raiz:** Default Supabase limit é 1000. Vendedor query sem limit explícito.
**Severidade:** Baixa (performance)
**Correção proposta:** `.limit(1000)` em vendedor OU paginação cursor OU date filter (últimos 90 dias).
**Risco de regressão:** Leads históricos somem se aplicar date filter.

### BUG-C-007
**Arquivo:** `src/pages/PedroSDR.tsx:947` (query Marcos)
**Sintoma:** `NOT('source', 'like', 'Pedro SDR%')` pode não funcionar com LIKE em alguns drivers PostgREST. Leads Pedro podem erroneamente aparecer em Marcos.
**Causa raiz:** Sintaxe `not('source', 'like', ...)` pode ser inválida.
**Severidade:** Baixa
**Correção proposta:** Trocar por `.neq('source', 'Pedro SDR')` ou filtrar em JS após fetch.
**Risco de regressão:** Nenhum.

### BUG-C-008 🟠 ALTA
**Arquivo:** `src/pages/CrmAoVivo.tsx:741-760` (`handleDragEnd` CrmAoVivo)
**Sintoma:** CrmAoVivo usa `status` (não `status_crm`). Lead move coluna no Ao Vivo mas Pipeline Pedro mostra posição antiga.
**Causa raiz:** CrmAoVivo é tela separada com colunas próprias. Atualiza `status` em vez de `status_crm`. Sem subscription em `ai_lead_transfers`.
**Severidade:** Alta (confusão visual)
**Correção proposta:** Padronizar `status_crm` em todas as telas. Manter `status` apenas como legacy hidden. Adicionar subscription `ai_lead_transfers` em CrmAoVivo.
**Risco de regressão:** Dados históricos com `status` precisam migração.

### BUG-C-009
**Arquivo:** `src/pages/FluxCRM.tsx` (duplicação)
**Sintoma:** `/crm` é wrapper de `<CrmAvancadoTab mode="marcos" />`. Dois URLs apontam pra mesmo conteúdo.
**Causa raiz:** FluxCRM era tela legacy antes de `/marcos`. Mantido pra retrocompat.
**Severidade:** Baixa (UX)
**Correção proposta:** Documentar em CLAUDE.md OU redirect `/crm` → `/marcos?tab=crm` em App.tsx.
**Risco de regressão:** Bookmarks externos quebram sem redirect.

### BUG-C-010
**Arquivo:** `src/pages/PedroSDR.tsx:774-782` (`effectiveUserIdState`)
**Sintoma:** Se duas instâncias de `CrmAvancadoTab` renderizam paralelas (iframes/modals), podem piscar conflitos de state.
**Causa raiz:** State global ao escopo do componente, compartilhado entre instâncias.
**Severidade:** Baixa (edge case)
**Correção proposta:** Converter pra variável local derivada de `userId` a cada render. Ou `useCallback` com dependency.
**Risco de regressão:** Nenhum.

### BUG-C-011
**Arquivo:** `src/pages/PedroSDR.tsx:703` (`visit_scheduled_at`)
**Sintoma:** Banner "VISITA HOJE" só aparece pra hoje. Sem clareza pra ontem (vencido) ou amanhã. Sem timezone handling — visita 23:59 UTC pode ser "ontem" no fuso local.
**Causa raiz:** Comparação simples `date === today` sem timezone awareness.
**Severidade:** Baixa
**Correção proposta:** 3 badges: "🔴 Vencida" / "📅 Hoje" / "📅 Próxima". Usar `startOfDay()` com date-fns.
**Risco de regressão:** Nenhum.

### BUG-C-012
**Arquivo:** `src/pages/LeadManagement.tsx` (tabela `leads` separada)
**Sintoma:** LeadManagement usa tabela `leads` totalmente isolada. Lead em `/leads` nunca sincroniza com `/pedro` ou `/marcos`. CRM paralelo com dados duplicados potencialmente conflitantes.
**Causa raiz:** Decisão arquitetural sem ponte de sincronização. Gera confusão sobre "source of truth".
**Severidade:** Média
**Correção proposta:** Documentar em CLAUDE.md + UI ("💼 CRM de Vendas — Isolado"). Considerar unificar futuramente com flag.
**Risco de regressão:** Nenhum (só docs).

### BUG-C-013
**Arquivo:** `src/components/marcos/AutomationFlowBuilder.tsx` (Item 4)
**Sintoma:** 8 tipos de nó visíveis, mas executor só processa `add_to_list`. Outros 7 são **puramente visuais** — user salva fluxo, nada acontece.
**Causa raiz:** MVP Item 4 focou só em `add_to_list`. Outros nós sem implementação.
**Severidade:** Média (UX trap)
**Correção proposta:** Banner amarelo "⚠️ Apenas 'Adicionar à lista' é funcional" no builder. Desabilitar drag dos outros ou renderizar cinza.
**Risco de regressão:** Nenhum.

---

## ✅ Já Corrigido

- **Item 1** (recente): gerente_phone Marcos reusa do agente Pedro
- **Item 2** (recente): banner "VISITA HOJE" implementado com `visit_scheduled_at`
- **Item 3** (recente): Kanban Marcos reorganizado (10 stages customizáveis em `crm_pipeline_stages`)
- **Item 4** (recente): nó `add_to_list` funcional + executor (`wa-automation-runner`)
- **Paridade Marcos** (commit `bf291f7`): detalhe do lead Marcos tem todas as seções do Pedro

---

## 🚩 Questões Abertas

1. **Sincronização Pedro ↔ Marcos:** Leads Pedro em `ai_crm_leads` nunca migram automaticamente pra `crm_leads`. Intencional ou gap?
2. **Delete de lead:** Existe em UI? Soft vs hard delete? Cascade de notes/feedbacks/followups?
3. **Merge duplicados:** Detecta leads duplicados (mesmo phone)? Interface pra mesclar?
4. **Histórico de conversas:** Detalhe do lead carrega histórico de `wa_inbox`?
5. **Mover lead entre estágios:** Item 3 recente migrou leads — foi manual ou batch? Logs rastreáveis?
