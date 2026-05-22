# DIAGNÓSTICO — CRM Pedro/Marcos + Saudação + Regressões

**Data:** 2026-05-15 22:30 BRT
**Investigado por:** Claude Code
**Status:** ⏸️ AGUARDANDO APROVAÇÃO antes de codar qualquer correção

---

## 0. Confirmações coletadas do banco PROD (Bruno LIRA `f49fd48a`)

```sql
-- Total de leads no banco
SELECT COUNT(*) FROM ai_crm_leads WHERE user_id='f49fd48a-...';
→ 372 (atualizado 16/05: 382)

-- Distribuição por status_crm
novo:               206
inativo:            100
perdido:             38
pouco_qualificado:   10
qualificado:          7
em_atendimento:       6  (= "Agendamento" no Kanban)
negociacao:           5
fechado:              1
```

UI mostra (print do usuário):
- Novo: **100** ❌ (deveria ser 206)
- Lead Inativo: **0** ❌ (deveria ser 100)
- Pouco Qualif: **0** ❌ (deveria ser 10)
- Qualificado: **0** ❌ (deveria ser 7)
- Agendamento: **0** ❌ (deveria ser 6)

**Diff: 272 leads sumiram da UI.**

---

## 0.5. NOVA REGRA DE NEGÓCIO (definida pelo usuário 16/05)

> **CRM Pedro** = SÓ leads atendidos pela IA via WhatsApp (tráfego pago)
> **CRM Marcos** = leads adicionados manualmente (porta, marketplace, etc.) por vendedor ou master
> **Painel do vendedor** = apenas leads atribuídos a ele (`assigned_to_id = ele`)
> **Master** = vê TUDO no CRM Pedro (atribuídos ou não)

### Decisões aprovadas
- ✅ Critério técnico "veio da IA": `instance_id IS NOT NULL`
- ✅ Botão "Adicionar Lead" sai do Pedro → vai pro Marcos (insere em `crm_leads`)
- ✅ Leads manuais existentes em `ai_crm_leads`: migrar pra `crm_leads`
- ✅ Vendedor vê só leads atribuídos (sem mudança)

### ⚠️ DESCOBERTA CRÍTICA (queries reais no banco PROD)

| Métrica | Valor |
|---|---|
| `ai_crm_leads` total | **382** |
| Com `instance_id NOT NULL` (= IA recente) | **13** |
| Sem `instance_id` (= IA antiga, ANTES da feature) | **369** |
| Com `remote_jid LIKE '%@s.whatsapp.net'` | **382 (100%)** |
| Com `origem='outros'` | 2 |
| Com `origem NULL` | 380 |
| `crm_leads` (Marcos) total | 664 |
| Período de criação | 2026-04-20 a 2026-05-16 |

**Implicação 1:** TODOS os 382 leads em `ai_crm_leads` são do WhatsApp (verificado por `remote_jid`). **Nenhum é "manual" do botão Add Lead** — porque essa feature acabou de ser deployed e ninguém usou ainda.

**Implicação 2:** A coluna `instance_id` foi populada só **depois** que a maioria dos leads já tinha sido criada. Por isso 369/382 estão sem ela, mesmo sendo IA. **Filtrar por `instance_id IS NOT NULL` agora cortaria 369 leads legítimos da IA.**

**Implicação 3:** Pra distinguir IA vs Manual de verdade, o critério mais robusto é `remote_jid LIKE '%@s.whatsapp.net'` (WhatsApp) vs algo diferente. Hoje 382/382 são WhatsApp → todos são IA → todos pertencem ao CRM Pedro.

**Implicação 4:** Não há nada pra migrar de `ai_crm_leads` → `crm_leads` no momento. A regra "Add Lead vai pro Marcos" se aplicará a leads FUTUROS criados via o botão (que ainda não foi usado).

### Plano corrigido (consequência da descoberta)

**Bug #3 fix vira simples:**
- Remover `.limit(100)` (master vê os 382 leads imediatamente)
- **NÃO** aplicar filtro `instance_id IS NOT NULL` (cortaria 369 leads válidos)
- Opcional: backfill de `instance_id` em leads antigos (mas exige saber qual instância criou cada lead — dado que pode ter sumido)

**Separação Pedro/Marcos vira trabalho de fronteira nova:**
- **Caminho A (mínimo)**: só REMOVER botão "Adicionar Lead" do Pedro. Marcos hoje mostra os mesmos leads (porque `FluxCRM.tsx` é wrapper do `CrmAvancadoTab` do Pedro) — então o botão "vai pra lugar nenhum" temporariamente. Adicionar lead manual fica indisponível até trabalho B.
- **Caminho B (completo)**: construir UI real do CRM Marcos sobre `crm_leads` (substituir o wrapper `FluxCRM.tsx`) + adicionar botão Add Lead lá. Trabalho médio/grande. Recomendado em iteração separada após estabilizar Bugs #1/#2/#3.

**Estado atual de UI** (confirmado por leitura de código):
- `MarcosLeads.tsx` → aba "CRM" renderiza `<FluxCRM embedded />`
- `FluxCRM.tsx` → 1 linha: `<CrmAvancadoTab userId={user?.id} />` (importado de `PedroSDR.tsx`)
- ⇒ CRM Marcos atualmente **MOSTRA o CRM Pedro**. Mesma UI, mesma tabela.
- `crm_leads` (Marcos real) é tabela com 664 leads, usada apenas por `CRMContacts.tsx` (página antiga "Contatos") e `src/components/crm/` (Kanban antigo desativado)

---

## 1. Tabela resumo (4 bugs)

| Bug | Arquivos envolvidos | Causa raiz | Severidade | Risco corrigir |
|-----|---|---|---|---|
| **#1** Drag-drop CRM Vivo não persiste | `src/pages/CrmAoVivo.tsx:684-705` | A determinar (provável: refetch real-time sobrescreve antes do UPDATE persistir, OU UI usa `status` mas outro componente usa `status_crm`) | 🔴 ALTA | 🟢 BAIXO |
| **#2** Pedro re-apresenta consultor | `supabase/functions/uazapi-webhook/index.ts:365 (regex), 1464+2253 (UPSERTs concorrentes), 446 (system prompt)` | (a) Race condition entre 2 UPSERTs no `pedro_conversation_state` apaga a flag `consultor_apresentado`. (b) Regex tem 3 falsos negativos. (c) Falta guard programático Camada 2. | 🔴 ALTA | 🟡 MÉDIO |
| **#3** CRM Pedro só mostra 100 leads | `src/pages/PedroSDR.tsx:822` (`.limit(100)` quando master) | `.limit(100)` hardcoded só pra master. 100 mais recentes hoje são todos `status_crm='novo'` (por causa do auto-create do webhook com `origem='outros'`). Leads antigos das outras colunas ficaram fora da janela. | 🔴 ALTA | 🟢 BAIXO |
| **#4** "Outros bugs gerais" | A listar pelo usuário | Provavelmente sintomas de #1, #2, #3. Aguardando exemplos específicos. | ❓ | ❓ |

---

## 2. Auditoria do último commit (cf44410)

Mudanças que foram pra PROD nas últimas 6h:

| Commit | Arquivos | Pode ter causado bug? |
|---|---|---|
| `b0a099d` (Prompt 1.1 origem) | migration `20260516120000_lead_origem.sql` (ADD COLUMN), `PedroSDR.tsx` (form + bulk + linha display), `uazapi-webhook` (origem='outros' no upsert), `types.ts` | **Indiretamente sim**: o webhook agora cria leads com `origem='outros'` em volume maior, deslocando leads antigos do `.limit(100)`. Não é bug do código novo, mas o efeito amplificou um bug latente. |
| `ee1fab9` (FeedbackAnalytics dashboard) | novo `src/components/pedro/FeedbackAnalytics.tsx`, `PedroSDR.tsx` (renderização condicional) | Não toca em queries de leads, drag-drop, ou conversation_state. Não causa bugs #1, #2, #3. |
| Migration `20260514143000_fix_profiles_rls_recursion.sql` | RLS de `public.profiles` | Não toca em `ai_crm_leads` nem em conversation_state. RLS profiles não cascata pra leads. |

**Nada do commit cf44410 quebrou DIRETAMENTE as features.** Bug #3 já existia (latente) e foi amplificado pelo volume. Bugs #1 e #2 já existiam.

---

## 3. Bug #1 — CRM Vivo não permite transição

### Trecho do código atual

`src/pages/CrmAoVivo.tsx:684-705`:
```ts
const handleDragEnd = useCallback(async (result: DropResult) => {
  const { draggableId, destination, source } = result;
  if (!destination || destination.droppableId === source.droppableId) return;

  const newStatus = destination.droppableId;
  const leadId = draggableId;

  // Optimistic update — move card imediatamente na UI
  setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: newStatus } : l));

  // Persistir no banco
  const { error } = await (supabase as any)
    .from('ai_crm_leads')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', leadId);

  if (error) {
    console.error('Erro ao atualizar status do lead:', error);
    toast.error('Erro ao mover lead — revertendo');
    fetchLiveDataRef.current(); // rollback via refetch
  }
}, []);
```

### O que está errado (hipóteses ranqueadas)

**Hipótese A (mais provável):** O CrmAoVivo subscreveu Realtime em `ai_crm_leads`. Quando UPDATE persiste, dispara evento que chama `fetchLiveDataRef.current()` AUTOMATICAMENTE — que pode estar sobrescrevendo o state com versão pré-UPDATE se houver lag de propagação. Resultado: card "volta" pra coluna original em ~500ms.

**Hipótese B:** Coluna escrita é `status` (legacy, ainda existe). Outra parte do código (filtros do Kanban do Pedro CRM Avançado) usa `status_crm`. Drag-drop persiste em `status` mas `status_crm` fica desatualizado. CrmAoVivo mostra a mudança, mas Pedro CRM Avançado não.

**Hipótese C:** `useCallback` com deps vazias `[]` faz `handleDragEnd` capturar valores antigos de `setLeads` na 1ª render. Se o estado mudar, callback usa snapshot antigo — não impacta a query, mas pode causar UI inconsistente.

**Pra confirmar qual é:** preciso de log do console no momento do drag (ou eu adicionar telemetria temporária).

### Não há erro de banco
- RLS de `ai_crm_leads`: **OFF** (`relrowsecurity = false`). UPDATE não é bloqueado.
- Não há CHECK constraint em `status` ou `status_crm`. Aceita qualquer texto.
- Único CHECK constraint em `ai_crm_leads` é `ai_crm_leads_origem_check` (origem aceita só 6 valores) — não afeta drag-drop.

---

## 4. Bug #2 — Saudação re-apresentada

### Mecanismo atual (Lote 1)
1. Webhook recebe mensagem do cliente
2. Busca `pedro_conversation_state.state` (lê flag `atendimento.consultor_apresentado`)
3. Monta system prompt com `formatStateForPrompt()` que injeta regra "❌ NÃO se reapresente como 'Sou o Carvalho...'"
4. Chama OpenAI
5. Após resposta, `applyAgentSelfFlags()` faz regex na resposta: detecta auto-apresentação → marca flag `true`
6. UPSERT no `pedro_conversation_state`

### 3 causas raiz identificadas

**Causa A — Race condition entre 2 UPSERTs concorrentes:**
- `uazapi-webhook/index.ts` linha **1464**: UPSERT durante extração de entidades (executa em paralelo)
- `uazapi-webhook/index.ts` linha **2253**: UPSERT após resposta do agente (com flag de auto-apresentação)
- Se UPSERT #1 (extração) terminar DEPOIS do UPSERT #2 (auto-flag), sobrescreve o `state` e **APAGA** `consultor_apresentado=true`
- Próxima mensagem: flag está `false` → Pedro se reapresenta de novo

**Causa B — Regex cobre só 6 variações:**
```ts
/sou (o|a)\s+\w+|eu sou\s+\w+|me chamo\s+\w+|aqui é\s+(o|a)\s+\w+/i
```
Não pega:
- "Consultor da BNDV..."
- "Sou Carvalho" (sem o/a)
- "Sou consultor da loja"

Quando Pedro responde com qualquer dessas variações, flag NUNCA é setada.

**Causa C — Falta guard programático Camada 2:**
- Hoje só tem regra "soft" no system prompt (recomendação)
- Não há código que VERIFIQUE a resposta antes de enviar
- LLM ignora a regra esporadicamente (alucinação)

### Não há bug nas mudanças recentes
- `aca7d63` (few-shots) e `df557e7` (sinônimos BNDV) NÃO tocaram em `applyAgentSelfFlags` nem em `formatStateForPrompt`. A regra anti-reapresentação continua presente (linha 446).
- Bug é PRÉ-EXISTENTE desde o Lote 1 (`5faf869`), só virou visível depois de mais conversas.

---

## 5. Bug #3 — CRM Pedro só mostra 100 leads (master)

### Causa raiz CONFIRMADA
`src/pages/PedroSDR.tsx` linha 816-825:
```ts
const leadsQuery = (supabase as any)
  .from('ai_crm_leads')
  .select('id, lead_name, remote_jid, status_crm, summary, ...')
  .eq('user_id', effectiveUserId)
  .order('created_at', { ascending: false });
if (isSeller && memberIds.length > 0) {
  leadsQuery.in('assigned_to_id', memberIds);
} else {
  leadsQuery.limit(100);  // ← MASTER LIMITADO A 100
}
```

### Por que só agora explodiu
- `.limit(100)` existe há semanas (commit `b41da06`).
- Antes, master tinha tipicamente <100 leads no total → não era um problema.
- Hoje: 372 leads. 206 com `status_crm='novo'` (criados pelo webhook nos últimos dias com `origem='outros'`).
- Os 100 mais recentes ordenados por `created_at DESC` são TODOS `novo`.
- Leads antigos das colunas Inativo/Pouco/Qualif/Agendamento/Negociação/Fechado/Perdido ficaram fora.

### Importante saber
- A query de **count** (KPIs no topo) NÃO tem limit — por isso "Total Leads: 372" aparece correto.
- A query de **lista** TEM limit — por isso só vê 100 cards.
- Vendedor (`isSeller`) NÃO tem limit (puxa todos os atribuídos a ele).

---

## 6. Bug #4 — Outros bugs (aguardando exemplos do usuário)

Não tenho dados concretos. Hipótese: muitos sintomas que o usuário viu são manifestações de #1, #2, #3 (ex: "leads somem" = bug #3, "Pedro burro" = bug #2, "kanban quebrado" = bug #1).

**Pedirei pra o usuário listar exemplos específicos antes de tratar como bug #4 separado.**

---

## 7. O que pretendo MUDAR (proposta — aguardando aprovação)

### Bug #1 (CRM Vivo drag-drop)
- Adicionar **telemetria temporária** no `handleDragEnd` (console.log com payload + result do UPDATE)
- Pedir pro usuário fazer 1 drag e me mandar console
- Identificada hipótese real (A/B/C), corrigir cirurgicamente
- **Defesa em profundidade:** atualizar **AMBAS** colunas (`status` E `status_crm`) na mesma operação pra evitar dessync
- **Fix do refetch real-time:** ignorar evento próprio (filtrar por `payload.new.updated_at` recente do nosso UPDATE)

### Bug #2 (Saudação)
- **Camada 1 (race):** Antes do UPSERT #2 (linha 2253), fazer SELECT do state mais recente do banco e MERGE com o que já temos em memória — evita sobrescrever flag setada pelo UPSERT #1.
- **Camada 2 (regex):** Expandir regex pra cobrir os 3 falsos negativos identificados.
- **Camada 3 (guard programático novo):** Função `validateNotReintroducing(text, state)` que roda ANTES de `fetch /send/text` ao cliente. Se `consultor_apresentado=true` E texto bate regex de apresentação → loga warning + REGENERA resposta com instrução reforçada (1 retry max). Se ainda re-apresentar, REMOVE só o trecho da apresentação e envia o resto.
- **Migration aditiva (opcional):** `ai_crm_leads.assumed_consultor_apresentado` column ou backfill: pra leads ANTIGOS com >= 1 mensagem de assistant em `wa_chat_history`, setar `state.atendimento.consultor_apresentado=true` no `pedro_conversation_state`.

### Bug #3 (CRM Pedro 100 leads) — versão REVISADA (16/05)
- **Remover `.limit(100)`** OU substituir por `.limit(500)` (margem segura pra masters de até ~500 leads sem paginação real)
- **NÃO aplicar filtro `instance_id IS NOT NULL`** — descoberta na seção 0.5 mostra que cortaria 369 leads válidos da IA antiga
- **Manter performance:** já existe index em `(user_id, created_at)` no banco
- **Opcional (separado da Bug #3):** remover botão "Adicionar Lead" do Pedro → Caminho A da seção 0.5

### Bug #4
- Nada concreto até receber exemplos do usuário.

---

## 8. O que NÃO vou tocar (preservar)

- ✅ Migration `20260516120000_lead_origem.sql` (origem) — coluna boa, fica
- ✅ Migration `20260514143000_fix_profiles_rls_recursion.sql` — fix correto, não afeta nada
- ✅ Edge function `uazapi-webhook` (lógica de criação de lead, RLS, transferir_para_vendedor) — funcional
- ✅ Frontend `PedroSDR.tsx` (formulário Adicionar Lead com origem, painel lateral, bulk insert) — funcional
- ✅ `FeedbackAnalytics.tsx` (novo dashboard) — funcional
- ✅ `pedro_conversation_state` schema — só vou ler/escrever, não mudar
- ✅ Outras edge functions (cron-lead-followup, process-whatsapp-queue, save-campaign etc) — não mexer
- ✅ Lógica de transferência de lead (`transferir_para_vendedor`) — funcional
- ✅ Briefing pro vendedor após qualificação — funcional
- ✅ Notas pessoais, feedback estruturado, follow-up agendamento — não tocar
- ✅ Inbox, instâncias, disparo em massa — não tocar
- ✅ Lote 2 Fase 1 e 2 (verbosidade + sinônimos BNDV) — funcional, não tocar

---

## 9. Plano de execução proposto (ordem) — REVISADO 16/05

| Ordem | Bug | Justificativa |
|---|---|---|
| 1º | **#3** (limit 100) | Mudança de 1 linha (`.limit(100)` → `.limit(500)`), risco mínimo, impacto enorme. **NÃO incluir filtro instance_id (cortaria 369 leads válidos da IA antiga — descoberta na seção 0.5)** |
| 2º | **#1** (drag-drop) | Precisa telemetria pra identificar hipótese real. Após identificar, fix isolado. |
| 3º | **#2** (saudação) | Fix em 3 camadas, requer mais cuidado. Faço por último com tempo. |
| 4º | **Caminho A** (separar Pedro/Marcos mínimo) | Remover botão "Add Lead" do Pedro. Lead manual fica indisponível até trabalho B. |
| 5º | **#4** (outros) | Aguardando exemplos do usuário pra priorizar. |
| 6º (futuro) | **Caminho B** (UI Marcos real) | Construir UI completa do Marcos sobre `crm_leads`. Trabalho médio/grande. Iteração separada. |

**1 commit por bug, deploy em STAGING primeiro, validação manual, depois PROD.**

---

## 🛑 PARE — Aguardando aprovação (versão revisada 16/05)

A nova regra de negócio mudou a fix do Bug #3 — leia a seção 0.5 antes de aprovar.

Confirme quais correções autoriza:

- [ ] **Bug #3** (`.limit(100)` → 500) **SEM** filtro instance_id — master vê 382 leads
- [ ] **Bug #1** (telemetria + fix drag-drop)
- [ ] **Bug #2** (3 camadas de defesa contra re-apresentação)
- [ ] **Caminho A** (remover botão "Add Lead" do Pedro, lead manual fica indisponível até Caminho B)
- [ ] **Caminho B** (construir UI Marcos real — trabalho grande, iteração separada após estabilizar)
- [ ] **Bug #4** (você liste exemplos primeiro)

E confirme se concorda com o que **NÃO vou tocar** (Seção 8).
