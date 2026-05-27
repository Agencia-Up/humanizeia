# CRM_OVERVIEW.md — Lógica completa de todos os CRMs do Logsar

> **Documento técnico+produto** explicando como cada tela de CRM funciona, qual tabela ela usa, quem é o usuário-alvo, e como elas se relacionam.
> **Data:** 2026-05-26 | **Gerado por:** 4 Explore agents em paralelo + consolidação manual.
> **Stack:** React 18 + Vite + TypeScript + Supabase. Agentes IA: Pedro (SDR) e Marcos (CRM/WhatsApp).
> **Repo:** `Agencia-Up/humanizeia`

---

## 📋 Índice rápido

| # | CRM / Tela | Rota | Arquivo | Tabela principal |
|---|---|---|---|---|
| 1 | **CRM Ao Vivo** | `/whatsapp/crm-ao-vivo` | `src/pages/CrmAoVivo.tsx` | `ai_crm_leads` |
| 2 | **WhatsApp Inbox** | `/whatsapp/inbox` | `src/pages/WhatsAppInbox.tsx` | `wa_inbox` |
| 3 | **Pedro SDR** (CRM + Performance) | `/pedro` | `src/pages/PedroSDR.tsx` | `ai_crm_leads` |
| 4 | **Marcos Leads** (CRM + Performance) | `/marcos` | `src/pages/MarcosLeads.tsx` | `crm_leads` |
| 5 | **FluxCRM** | `/crm` | `src/pages/FluxCRM.tsx` | `crm_leads` (proxy) |
| 6 | **Lead Management** | `/leads` | `src/pages/LeadManagement.tsx` | `leads` (⚠️ tabela separada) |
| 7 | **CRM Contacts** | `/crm/contacts` | `src/pages/CRMContacts.tsx` | `crm_leads` |
| 8 | **CRM Formulários** | `/crm/formularios` | `src/pages/CrmFormularios.tsx` | `capture_forms` → `crm_leads` |
| 9 | **Agent Funnel** | `/agente/:agentId/funil` | `src/pages/AgentFunnel.tsx` | `wa_ai_agents` (referência) |

---

## 🗄️ 1. Modelo de dados — quais tabelas existem

### Tabelas de leads (3 tabelas DIFERENTES — atenção)

| Tabela | Quem grava | Quem lê | Propósito |
|---|---|---|---|
| **`ai_crm_leads`** | Pedro SDR (via `uazapi-webhook` quando lead manda 1ª msg) | Pedro SDR (`/pedro`) + CrmAoVivo (`/whatsapp/crm-ao-vivo`) | Leads que chegaram via WhatsApp e foram qualificados por IA |
| **`crm_leads`** | Marcos (manual via form/CSV) + form de captura externo (`/f/:formId`) | Marcos (`/marcos`) + FluxCRM (`/crm`) + CRMContacts (`/crm/contacts`) | Leads de OUTROS canais (porta, marketplace, formulários, importação) |
| **`leads`** | LeadManagement (`/leads`) — UI separada | LeadManagement (`/leads`) somente | CRM paralelo focado em vendas (temperatura, valor, faturamento). **NÃO sincroniza com os outros** |

### Tabelas de apoio

| Tabela | Pra quê serve |
|---|---|
| `crm_pipeline_stages` | Stages customizáveis do Kanban do Marcos (per-user, 10 stages padrão) |
| `pedro_crm_notes` / `marcos_crm_notes` | Anotações do vendedor sobre o lead, separadas por agente |
| `pedro_followup_schedules` / `marcos_followup_schedules` | Mensagens WhatsApp agendadas pra disparar depois |
| `pedro_manager_feedback` | Feedback estruturado vendedor → gerente. Aceita `lead_id` (Pedro) OU `crm_lead_id` (Marcos) via XOR check |
| `manager_feedback_config` | Configuração per-master: modo auto/agendado de entrega de feedbacks |
| `ai_lead_transfers` | Log de transferências de leads entre agentes/vendedores |
| `pedro_conversation_state` | Memória estruturada da conversa Pedro com cada lead |
| `ai_team_members` | Vendedores cadastrados pelo master |
| `wa_inbox` | Histórico de mensagens WhatsApp (entrada + saída) |
| `wa_contacts` + `wa_contact_lists` + `wa_contact_list_members` | Contatos pra disparo em massa. Junction N:N (Item 4 recente) |
| `wa_instances` | Instâncias WhatsApp via UazAPI/Evolution |
| `wa_automation_flows` + `wa_automation_runs` | Fluxos visuais de automação (Item 4 recente) |
| `capture_forms` + `capture_form_submissions` | Formulários públicos de captura de leads |
| `lead_interactions` | Timeline de interações (usado SÓ pelo LeadManagement) |

---

## 1️⃣ CRM Ao Vivo (`/whatsapp/crm-ao-vivo`)

**Arquivo:** `src/pages/CrmAoVivo.tsx`

### Propósito
Tela de **atendimento em tempo real** do funil do Pedro. O vendedor vê um Kanban com leads chegando ao vivo e move entre colunas conforme conversa avança. Tem alerta sonoro (campainha) quando lead novo chega.

### Quem usa
- **Master:** vê todos os leads de todos vendedores
- **Vendedor:** vê apenas leads onde `assigned_to_id = seu_member_id`

### Fluxo de dados
1. **Ao carregar:** query em `ai_crm_leads` ordenada por `last_interaction_at DESC` + leitura de `ai_lead_transfers` (histórico)
2. **Realtime:** canal `crm-ao-vivo-{user.id}-{effectiveUserId}` escuta INSERT/UPDATE/DELETE em `ai_crm_leads` + INSERT/UPDATE em `ai_lead_transfers`
3. **Fallback:** polling a cada 30s se realtime cair
4. **Drag-and-drop:** atualiza `ai_crm_leads.status` direto no DB (silencioso, sem alerta sonoro)
5. **Transferir para vendedor:** cria row em `ai_lead_transfers` + UPDATE `assigned_to_id` + muda `status='transferido'`

### 7 colunas do Kanban
| Coluna | Cor | Origem |
|---|---|---|
| Novos Leads | cyan | Lead acabou de chegar |
| Interessados | amber | Cliente demonstrou intenção |
| Pouco Qualificados | red | IA detectou baixo potencial |
| Médio Qualificados | orange | IA detectou potencial intermediário |
| Qualificados | green | IA validou critérios BANT |
| Atendimento IA | purple | IA está conversando agora |
| Em Atendimento | blue | Vendedor humano assumiu |

### Limitações
- ❌ **Não sincroniza com Marcos** — leads do Pedro ficam isolados em `ai_crm_leads`. Não entram em `crm_leads`.
- ❌ **`ai_paused` não é respeitado** — campo existe mas nenhuma tela checa. Pause IA precisa ser implementado.
- ❌ **Janela de 30s stale** — se realtime cair sem aviso, polling demora 30s pra atualizar.

---

## 2️⃣ WhatsApp Inbox (`/whatsapp/inbox`)

**Arquivo:** `src/pages/WhatsAppInbox.tsx`

### Propósito
**Gestão de conversas WhatsApp** — vendedor abre uma conversa, lê histórico, responde manualmente. Lista de conversas agrupada por `(phone, instance_id)`.

### Diferença vs CRM Ao Vivo
| Aspecto | CRM Ao Vivo | WhatsApp Inbox |
|---|---|---|
| Visão | Kanban (status) | Lista de conversas (chat) |
| Tabela | `ai_crm_leads` | `wa_inbox` |
| Ação principal | Mover lead entre colunas | Responder mensagens |
| Cria lead? | Não (já existem) | Pode transferir → cria em `ai_crm_leads` |

### Fluxo de envio de mensagem
1. Vendedor digita no textarea + clica "Send"
2. `supabase.functions.invoke('wa-send-reply', { instance_id, phone, content })`
3. Edge function valida JWT + busca instância + chama UazAPI
4. Salva em `wa_inbox` com `direction='outgoing'`
5. Frontend faz optimistic rendering (mensagem aparece imediato; se falhar, remove)

### Seleção de instância
- Dropdown no input permite escolher qual instância usar (se vendedor tem múltiplas)
- Padrão: última usada naquela conversa, ou primeira ativa
- Mostra status (Wifi verde / vermelho)

---

## 3️⃣ Pedro SDR — `/pedro`

**Arquivo:** `src/pages/PedroSDR.tsx` (~3500 linhas — arquivo central)
**Componente core:** `CrmAvancadoTab` (compartilhado com Marcos via prop `mode`)

### Estrutura de abas
| Aba | O que faz |
|---|---|
| **Performance** | Dashboard KPIs (Total leads / Hoje / Semana / Mês / Taxa conversão / Respostas IA / Agentes ativos) + gráficos (atividade semanal / pie status / ranking vendedores / ranking agentes) |
| **Pipeline** | Kanban com 7 colunas (Novo / Lead Inativo / Carro não disponível / Agendamento / Negociação / Fechado / Perdido). Drag-and-drop muda `status_crm` |
| **Lista** | View tabular alternativa do mesmo pipeline |
| **Feedbacks** | Dashboard agregado dos feedbacks (FeedbackAnalytics) + config de modo auto/agendado (ManagerFeedbackConfigCard) |
| **Vendedores** | Criar/editar/remover vendedor, permissões por feature, limites de plano (SellerManagerTab) |
| **Agente IA Inbox** | Caixa de entrada de mensagens recebidas pelo agente (AgentInboxTab) |

### CRM Kanban Pedro (Pipeline)

**Stages hardcoded** em `PIPELINE_COLUMNS`:
```typescript
const PIPELINE_COLUMNS = [
  { id: 'novo',                title: 'Novo',                emoji: '🔰' },
  { id: 'inativo',             title: 'Lead Inativo',        emoji: '😴' },
  { id: 'carro_nao_disponivel',title: 'Carro não disponível', emoji: '🚫' },
  { id: 'em_atendimento',      title: 'Agendamento',         emoji: '📅' },
  { id: 'negociacao',          title: 'Negociação',          emoji: '🤝' },
  { id: 'fechado',             title: 'Fechado',             emoji: '✅' },
  { id: 'perdido',             title: 'Perdido',             emoji: '❌' },
];
```
> ⚠️ Pedro usa stages **hardcoded** no código. Marcos usa stages **customizáveis** em `crm_pipeline_stages`. Inconsistência arquitetural.

### Badges visuais no card (Feature A)
- 📍 Cidade (`client_city`)
- 🚗 Carro de interesse (`vehicle_interest`)
- 🚪 Origem (`origem`: porta/marketplace/instagram/outros)
- 📅 Visita marcada (`visit_scheduled` texto + `visit_scheduled_at` timestamp)
- 🟧 **Banner "VISITA HOJE"** com pulse animado quando hoje = data da visita (Item 2 recente)

### Detalhe do lead (painel lateral ao clicar card)
1. **Header:** Voltar / Nome / botão edit / Status dropdown / botão delete
2. **Feedback da IA** — transferências com texto rico (briefing) + summary IA + fallback "via cron"
3. **Anotações** — input + lista de notas (`pedro_crm_notes`), com pin fixo
4. **Agendar Follow-up** — message + buttons mídia (img/áudio/vídeo) + datetime + button. Salva em `pedro_followup_schedules`
5. **Feedback para Gerente** — form estruturado:
   - Cidade dinâmica (DynamicSelect com cadastro de nova cidade via modal)
   - Motivo: 5 categorias com 4-5 opções cada (Financeiros / Negociação / Produto / Comportamento / Outros)
   - Observações livres
   - Potencial: ❄️ Frio / 🌡️ Morno / 🔥 Quente / 🚀 Pronto pra comprar
   - Envia pra edge function `pedro-process-feedback` → salva em `pedro_manager_feedback` → notifica gerente via WhatsApp

### Edit inline do lead
Cabeçalho editável com: nome / telefone / cidade / carro / data da visita (datetime-local)

### Integração com WhatsApp + IA
1. Webhook UazAPI → `uazapi-webhook` recebe mensagem
2. Cria/atualiza lead em `ai_crm_leads` com `status_crm='novo'`
3. IA (Claude 3.5 Sonnet) processa mensagem com contexto de `pedro_conversation_state`
4. Quando IA decide qualificado, chama tool `transferir_para_vendedor`:
   - INSERT em `ai_lead_transfers` (notes = briefing rich)
   - UPDATE `ai_crm_leads.assigned_to_id`
   - Gera feedback automático em `pedro_manager_feedback`
5. Cron `cron-flush-manager-feedbacks` entrega feedbacks ao gerente conforme config

---

## 4️⃣ Marcos Leads — `/marcos`

**Arquivo:** `src/pages/MarcosLeads.tsx`
**Componente CRM:** mesmo `CrmAvancadoTab` do Pedro, com `mode='marcos'`

### Diferença fundamental Pedro vs Marcos
| Aspecto | Pedro | Marcos |
|---|---|---|
| Origem dos leads | WhatsApp inbound + IA SDR qualifica | Manual (porta, marketplace, formulário, importação CSV) |
| Tem agente IA? | Sim (Claude 3.5) | Não (humano gerencia) |
| Tabela | `ai_crm_leads` | `crm_leads` |
| Stages | Hardcoded (7) | Customizáveis (`crm_pipeline_stages`, 10 padrão) |
| Quando usar | Inbound automatizado | Outros canais / qualificação manual |

### 7 abas do Marcos
1. **CRM** — Pipeline Kanban (renderiza `CrmAvancadoTab` mode='marcos')
2. **Formulários** — `CrmFormularios` (captura via form externo)
3. **Contatos** — `WhatsAppContacts` (catálogo)
4. **Disparo em Massa** — `WhatsAppBroadcast` (campanhas)
5. **Inbox** — `WhatsAppInbox` (mensagens recebidas)
6. **Instâncias** — `WhatsAppInstances` (Evolution API)
7. **Automações** — `WhatsAppAutomations` → `AutomationFlowBuilder`

### 10 stages padrão do Kanban Marcos (Item 3 recente)
```
Novo Lead → Marketing Place → Agendamento → Proposta → Negociação
         → Fechado → Perdido → Lead Inativo → Carro não disponível → Porta
```
Customizáveis per-user via `crm_pipeline_stages` (master pode adicionar/renomear).

### Adicionar Lead manual
Form inline com: nome / telefone / origem (porta/marketplace_facebook/_olx/_mercadolivre/instagram_vendedor/outros) / cidade (DynamicSelect) / carro de interesse / data da visita (datetime-local).

### Bulk insert via Excel/CSV
- Detecta coluna `origem` automaticamente (case-insensitive)
- Default `'porta'` se não preenchida
- Validação por linha (erro claro se valor inválido de origem)

### Paridade lead detail Marcos = Pedro (entrega recente)
Desde a paridade (commit `bf291f7`), o detalhe do lead do Marcos tem **TODAS as seções do Pedro**:
- ✅ Feedback IA (vazio se Marcos não tem transferências de IA)
- ✅ Anotações (`marcos_crm_notes` em vez de `pedro_crm_notes`)
- ✅ Agendar Follow-up (`marcos_followup_schedules` em vez de `pedro_followup_schedules`)
- ✅ Feedback para Gerente (mesma edge function, envia `crm_lead_id` em vez de `lead_id`)
- ✅ Edit inline com cidade/carro/visita

### Automações (Item 4 recente)
**Arquivo:** `src/components/marcos/AutomationFlowBuilder.tsx`

**8 tipos de nó:**
| Emoji | Tipo | Status |
|---|---|---|
| 🎯 | trigger (lista de contatos) | ✅ funcional (define gatilho) |
| 💬 | message (WhatsApp) | ⚠️ SÓ VISUAL (executor não processa) |
| 📧 | email (marketing) | ⚠️ SÓ VISUAL |
| ⏱️ | delay (esperar) | ⚠️ SÓ VISUAL |
| 🔀 | condition (ramificar) | ⚠️ SÓ VISUAL |
| 🏷️ | tag (add/remove) | ⚠️ SÓ VISUAL |
| 🔗 | webhook (URL externa) | ⚠️ SÓ VISUAL |
| 📋 | **add_to_list** (Item 4 recente) | ✅ funcional (executor processa) |

**Executor:** edge function `wa-automation-runner` roda via cron a cada 5min. MVP: processa só `add_to_list`. Adiciona contato em `wa_contact_list_members` (junction N:N híbrida — preserva `wa_contacts.list_id` original).

### Feedback ao gerente do Marcos
- Mesma edge function `pedro-process-feedback`, mas frontend envia `crm_lead_id` em vez de `lead_id`
- Tabela `pedro_manager_feedback` tem CHECK constraint `lead_id XOR crm_lead_id`
- Gerente_phone: reusa o configurado em qualquer agente Pedro do master (decisão de design recente)

---

## 5️⃣ FluxCRM — `/crm`

**Arquivo:** `src/pages/FluxCRM.tsx`

**Propósito:** Wrapper de 1 linha que renderiza `<CrmAvancadoTab userId={user?.id} mode="marcos" />`.

**Status:** 🟡 **Duplicado/Legado.** Mesma tela do Marcos CRM mas em rota diferente.

**Tabela:** `crm_leads` (mesma do Marcos)

**Recomendação:** Redirect `/crm` → `/marcos?tab=crm` ou remover rota. Mantém só pra retrocompat se houver bookmarks externos.

---

## 6️⃣ Lead Management — `/leads`

**Arquivo:** `src/pages/LeadManagement.tsx`

**Propósito:** Mini-CRM **independente** com foco em vendas (temperatura, valor, faturamento mensal).

**Tabela:** **`leads`** (⚠️ DIFERENTE de `crm_leads` — tabela separada)

### 6 colunas do Kanban
Novo → Em Atendimento → Qualificado → Proposta → Venda Realizada → Perdido

### KPIs exibidos
- Taxa de conversão
- CPLQ (Custo por Lead Qualificado)
- Faturamento (mês atual)

### Funcionalidades únicas
- Lead com temperatura (frio/morno/quente)
- Valor de venda + data de venda
- Timeline de interações via `lead_interactions`
- Link direto WhatsApp (`wa.me`)

**Status:** 🟢 **Ativo, mas isolado.** Leads aqui NÃO sincronizam com Pedro/Marcos. É um CRM paralelo.

**Recomendação:** Documentar explicitamente que é "CRM paralelo focado em vendas". Considerar migração futura pra `crm_leads` com flag `is_sales_focused`.

---

## 7️⃣ CRM Contacts — `/crm/contacts`

**Arquivo:** `src/pages/CRMContacts.tsx`

**Propósito:** **View alternativa em lista** do mesmo data source do FluxCRM/Marcos. Agrupa leads por etapa do pipeline.

**Tabela:** `crm_leads` + `crm_pipeline_stages` (via hook `useFluxCRM`)

### Funcionalidades
- Lista agrupada por etapa (collapse/expand)
- Busca por nome / telefone / email / empresa
- Filtro por etapa
- KPIs: total + distribuição por etapa
- **Export CSV** dos leads filtrados
- Links WhatsApp nos cards

**Status:** 🟢 **Ativo e útil** — complementa o Kanban pra usuários que preferem tabela.

---

## 8️⃣ CRM Formulários — `/crm/formularios`

**Arquivo:** `src/pages/CrmFormularios.tsx`

**Propósito:** **Construtor de formulários de captura** com drag-and-drop, QR code e follow-up automático via WhatsApp.

**Tabelas:** `capture_forms`, `capture_form_submissions`, `followup_sequences`, `followup_sequence_steps`, `wa_contact_lists`

### Funcionalidades (master-only)
- Editor fullscreen com 4 abas: Design / Campos / Configurações / Follow-up
- **Design:** logo, capa, cor primária, nome, título, descrição
- **Campos:** 10 tipos (texto, email, telefone, select, radio, checkbox, rating, etc.)
- **Sync para CRM:** botão "Sincronizar com CRM" — submissions viram leads em `crm_leads`
- **Follow-up:** sequência de mensagens WhatsApp automáticas pós-submissão
- **QR Code:** gerador + print/download

### URL pública
`/f/:formId` → `FormPublico.tsx` (rota pública sem auth)

**Status:** 🟢 **Ativo, feature única.** Sem redundância.

---

## 9️⃣ Agent Funnel — `/agente/:agentId/funil`

**Arquivo:** `src/pages/AgentFunnel.tsx`

**Propósito:** Página dedicada pra editar o **funil de qualificação SDR** (9 blocos) de um agente WhatsApp específico. Substitui o que antes era modal.

**Tabela:** `wa_ai_agents` (lê o agente) + tabelas SDR internas (config do funil)

### Funcionalidades
- Breadcrumb pra voltar pra `/pedro?tab=agente`
- Carrega agente por ID + valida acesso (`user_id`)
- Renderiza `FunilDoAgenteTab` que edita os 9 blocos do funil

**Status:** 🟢 **Ativo, página standalone.** Melhor que modal (evita re-mounts da página inteira).

---

## 🔀 Comparativo completo dos 9 CRMs

| Rota | Quem usa | Tabela base | Status | Pode deprecar? |
|---|---|---|---|---|
| `/whatsapp/crm-ao-vivo` | Master + vendedor (atendimento) | `ai_crm_leads` | ✅ Ativo | ❌ Não |
| `/whatsapp/inbox` | Master + vendedor (chat) | `wa_inbox` | ✅ Ativo | ❌ Não |
| `/pedro` | Master + vendedor Pedro | `ai_crm_leads` | ✅ Ativo (principal) | ❌ Não |
| `/marcos` | Master + vendedor Marcos | `crm_leads` | ✅ Ativo (principal) | ❌ Não |
| `/crm` | (legado) | `crm_leads` (proxy) | 🟡 Duplicado | ⚠️ **Sim, vira redirect** |
| `/leads` | Gerente vendas | `leads` (separada!) | 🟢 Ativo isolado | ❌ Não (mas precisa decidir destino) |
| `/crm/contacts` | Master/todos | `crm_leads` | 🟢 Ativo (view alt) | ❌ Não |
| `/crm/formularios` | Master only | `capture_forms` → `crm_leads` | 🟢 Ativo (único) | ❌ Não |
| `/agente/:agentId/funil` | Master Pedro | `wa_ai_agents` ref | 🟢 Ativo | ❌ Não |

---

## 🚦 Fluxo end-to-end de um lead (mapa mental)

```
┌─ INBOUND WhatsApp ─────────────────────────────────────────┐
│                                                             │
│  Lead manda msg WhatsApp                                    │
│      ↓                                                      │
│  uazapi-webhook (edge function)                             │
│      ↓                                                      │
│  INSERT em ai_crm_leads (status='novo', agent_id=pedro)     │
│      ↓                                                      │
│  IA Pedro qualifica (Claude 3.5 Sonnet)                     │
│  pedro_conversation_state acumula contexto                  │
│      ↓                                                      │
│  IA decide → tool transferir_para_vendedor                  │
│      ↓                                                      │
│  INSERT ai_lead_transfers + UPDATE ai_crm_leads             │
│      ↓                                                      │
│  Visível em: /pedro (Pipeline) + /whatsapp/crm-ao-vivo      │
│  Vendedor conversa em: /whatsapp/inbox                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─ OUTROS CANAIS (porta, marketplace, formulário) ───────────┐
│                                                             │
│  Lead adicionado manualmente OU via /f/:formId              │
│      ↓                                                      │
│  INSERT em crm_leads (source='porta'/'marketplace'/...)     │
│      ↓                                                      │
│  Visível em: /marcos (Pipeline Kanban) +                    │
│              /crm (mesma coisa)                             │
│              /crm/contacts (lista)                          │
│              /crm/formularios (sync de submissions)         │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─ CRM PARALELO DE VENDAS ───────────────────────────────────┐
│                                                             │
│  Equipe de vendas usa /leads independente                   │
│      ↓                                                      │
│  Tabela leads (separada)                                    │
│  Foco: temperatura, valor, faturamento, CPLQ                │
│                                                             │
│  ⚠️ NÃO sincroniza com Pedro/Marcos                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚩 Inconsistências e bugs latentes descobertos

### Crítica
1. **3 tabelas de leads paralelas** (`ai_crm_leads`, `crm_leads`, `leads`) — sem foreign keys cruzadas, sem sync. Lead em `ai_crm_leads` não vê reflexo em `crm_leads`. Lead em `leads` é totalmente isolado.

### Altas
2. **FluxCRM `/crm` é wrapper duplicado** do `/marcos` — confunde usuário e gera URL ambígua.
3. **Pedro usa stages hardcoded; Marcos usa customizáveis** — inconsistência arquitetural. Master que muda algo no Kanban Marcos não impacta o Pedro.
4. **`ai_paused` nunca é checado** — campo existe em `ai_crm_leads` mas nenhuma UI respeita. Pause IA não funciona.
5. **CrmAoVivo não sincroniza com Marcos** — leads Pedro ficam isolados em `ai_crm_leads`, nunca vão pra `crm_leads`. Precisa ponte se quiser unificar funil.

### Médias
6. **WhatsApp Inbox carrega `wa_contacts.tags` sem filtro por `assigned_to_id`** — possível brecha de RLS se vendedor manipular URL.
7. **Optimistic rendering sem feedback de erro visual** no WhatsApp Inbox — só toast (passageiro).
8. **Realtime sem heartbeat** — janela de até 30s com dados stale se conexão cair silenciosamente.
9. **Status legacy vs novo** — código mantém compat com `status` antigo (Qualificado, etc.) via `STATUS_DISPLAY_MAP`. Pode confundir se dados não forem migrados.
10. **Marcos automações** — 7 de 8 tipos de nó são só visuais (não executam). Só `add_to_list` foi implementado no MVP do executor (Item 4 recente).

---

## ✅ Recomendações priorizadas

### Curto prazo (esta semana)
1. **Adicionar redirect** `/crm` → `/marcos?tab=crm` (1 linha em App.tsx)
2. **Banner amarelo "feature visual apenas"** nos 6 tipos de nó de automação que não executam (msg/email/delay/condition/tag/webhook)
3. **Documentar publicamente** que `/leads` é CRM paralelo de vendas (não confundir com Pedro/Marcos)

### Médio prazo (próximo sprint)
4. **Implementar pause IA** — checar `ai_crm_leads.ai_paused` em `uazapi-webhook` antes de chamar Claude
5. **Adicionar ponte CrmAoVivo → crm_leads** se time quiser ver leads Pedro no Marcos Kanban
6. **Unificar status enum** — migrar leads legacy de `status` pra `status_crm` e remover `STATUS_DISPLAY_MAP`

### Longo prazo (decisão de produto)
7. **Decidir destino de `leads`** — migrar pra `crm_leads` com flag de tipo OU mantê-la como CRM paralelo legado (e parar de evoluir)
8. **Unificar stages Pedro/Marcos** — Pedro adotar `crm_pipeline_stages` pra ter customização (e remover `PIPELINE_COLUMNS` hardcoded)
9. **Completar executor de automações** — implementar processamento dos outros 6 tipos de nó (msg/email/delay/condition/tag/webhook)

---

## 📂 Arquivos críticos pra consultar

| Funcionalidade | Arquivo | Linhas aprox |
|---|---|---|
| CRM Ao Vivo | `src/pages/CrmAoVivo.tsx` | ~800 |
| WhatsApp Inbox | `src/pages/WhatsAppInbox.tsx` | ~700 |
| Pedro SDR (CRM + Performance + Vendedores + Feedbacks) | `src/pages/PedroSDR.tsx` | ~3500 |
| Componente CRM compartilhado | `src/pages/PedroSDR.tsx` (export `CrmAvancadoTab`) | ~2200-3400 |
| Marcos Leads (abas) | `src/pages/MarcosLeads.tsx` | ~150 |
| FluxCRM (wrapper) | `src/pages/FluxCRM.tsx` | ~30 |
| Lead Management (CRM paralelo) | `src/pages/LeadManagement.tsx` | ~600 |
| CRM Contacts | `src/pages/CRMContacts.tsx` | ~400 |
| CRM Formulários | `src/pages/CrmFormularios.tsx` | ~1000 |
| Agent Funnel | `src/pages/AgentFunnel.tsx` | ~80 |
| Builder de automação | `src/components/marcos/AutomationFlowBuilder.tsx` | ~990 |
| Gestor de vendedores | `src/components/pedro/SellerManagerTab.tsx` | ~600 |
| Dashboard de feedbacks | `src/components/pedro/FeedbackAnalytics.tsx` | ~500 |
| Config de feedback | `src/components/pedro/ManagerFeedbackConfigCard.tsx` | ~200 |
| Edge function feedback | `supabase/functions/pedro-process-feedback/index.ts` | ~320 |
| Edge function webhook | `supabase/functions/uazapi-webhook/index.ts` | ~3700 |
| Edge function executor | `supabase/functions/wa-automation-runner/index.ts` | ~180 |
| Edge function convite | `supabase/functions/invite-seller/index.ts` | ~550 |

---

**Documento técnico de apoio:** `AUDIT_MAP.md` (mapeamento estático completo do sistema, gerado em 2026-05-23).
