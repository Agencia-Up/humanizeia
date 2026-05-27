# CRM_CHECKLIST.md — Status das Entregas

> **Documento de status** das 2 frentes de trabalho recentes:
> - **CRM ao Vivo (nova versão = Dashboard TV)**
> - **Tabelas do CRM Marcos (colunas customizáveis do Kanban)**
> **Data:** 2026-05-26 | **Branch:** staging (com 1 commit aguardando promover prod)

---

## 🔵 PARTE A — CRM ao Vivo (Dashboard TV)

### ✅ O que foi feito

#### 1. Schema base (Etapa 1) — commit `619cd09` — **PROD**
- [x] `ai_team_members.profile_picture TEXT` (foto do vendedor)
- [x] `profiles.dashboard_tv_logo_url TEXT` (logo customizável)
- [x] `profiles.dashboard_tv_company_name TEXT` (nome empresa customizável)
- [x] `profiles.dashboard_tv_primary_color TEXT` (cor primária, default `#3b82f6`)
- [x] `profiles.dashboard_tv_secondary_color TEXT` (cor secundária, default `#f59e0b`)
- [x] `crm_leads.origem TEXT` (coluna nova, separada de `source` pra retrocompat)
- [x] Backfill `crm_leads.origem` a partir de `source` (ILIKE patterns)
- [x] Simplificação `ai_crm_leads.origem` (marketplace_facebook → marketplace, etc.)
- [x] CHECK constraint em ambas: 7 valores (`porta`, `olx`, `marketplace`, `instagram`, `consignado`, `indicacao`, `outros`)
- [x] Indices parciais `idx_crm_leads_origem` e `idx_ai_crm_leads_origem`

#### 2. Tela DashboardTV (Etapa 2) — commit `804ba2f` — **PROD**
- [x] Rota nova `/dashboard-tv` (master only, oculto do menu)
- [x] Layout fullscreen tema escuro
- [x] Header: logo + nome empresa + data/hora live (relógio atualiza a cada 1s)
- [x] Bloco "Leads Gerais" (número grande central)
- [x] 6 cards de origem horizontais (Tráfego Pago, Porta, OLX, Marketplace, Indicação, Consignado) com % e barra de progresso
- [x] Grid 5×2 top 10 vendedores ranqueados
- [x] Card de vendedor com: rank colorido, avatar, breakdown por origem, total destacado
- [x] Badge "Destaque do Dia" fixo no rodapé (top 1)
- [x] Polling automático 30s
- [x] Queries paralelas (profiles + ai_team_members + ai_crm_leads + crm_leads)

#### 3. UI Settings → Dashboard TV (Etapa 3) — commit `5d773c7` — **PROD**
- [x] Tab nova "Dashboard TV" em /settings (ícone 📺)
- [x] Bloco de info + botão "Abrir Dashboard" (nova aba)
- [x] Seção Branding: logo URL + nome empresa + 2 color pickers + preview live do header
- [x] Validação hex `#RRGGBB` antes de salvar
- [x] Seção Fotos dos vendedores (inicialmente só URL)

#### 4. Substituir CRM ao Vivo do Pedro — commit `f28eb1e` — **PROD**
- [x] Tab "CRM ao Vivo" dentro de `/pedro?tab=ao-vivo` agora renderiza DashboardTV embedded
- [x] Prop `embedded?: boolean` no DashboardTV pra adaptar layout (min-h-full vs min-h-screen)
- [x] Rota standalone `/whatsapp/crm-ao-vivo` preservada (Kanban antigo, retrocompat)

#### 5. Fix bucket avatars + upload — commit `635fdfb` — **PROD**
- [x] Bucket `avatars` criado em Supabase Storage (público, 2MB max)
- [x] 2 policies: `avatars_public_read` + `avatars_user_write`
- [x] Fix path em `/perfil` (`{user.id}/avatar.ext` em vez de `avatars/{user.id}.ext`)
- [x] Botão Upload de arquivo na lista de vendedores (substitui o URL puro)
- [x] Botão URL alternativo (caso queira URL externa)
- [x] Botão Remover (master pode tirar foto que ele subiu)

#### 6. Vendedor logado vê só ele — commit `765a39e` — **PROD**
- [x] `useSellerProfile` integrado pra detectar `isSeller` + `masterUserId` + `seller.id`
- [x] Queries filtram quando vendedor: `ai_team_members.id`, `ai_crm_leads.assigned_to_id`, `crm_leads.assigned_to`
- [x] Branding sempre do master (mesmo pra vendedor)
- [x] KPIs (Leads Gerais + 6 origens com %) refletem só o vendedor logado
- [x] Grid de vendedores: master vê todos; vendedor vê só 1 card (ele)
- [x] Tirado redirect — vendedor agora pode acessar `/dashboard-tv`
- [x] Foto com prioridade: `profiles.avatar_url` > `ai_team_members.profile_picture` > iniciais
- [x] UI Settings → Dashboard TV mostra badges coloridas indicando qual foto está sendo usada

#### 7. Filtros + Tela Cheia + Realtime — commit `ca8c7e7` — ⏳ **STAGING (aguarda promover)**
- [x] Toolbar nova abaixo do header com filtro de período
- [x] 4 botões de período: Hoje / 7 dias / 30 dias / Personalizado
- [x] Custom: 2 date inputs (start/end) com validação min/max
- [x] Período persiste em localStorage (PERIOD_STORAGE_KEY)
- [x] Label "Leads Gerais" reflete período selecionado
- [x] Botão Tela Cheia (Maximize2/Minimize2) usando Fullscreen API nativa
- [x] Listener `fullscreenchange` pra atualizar ícone quando sai com ESC
- [x] Botão Refresh manual (RefreshCw com animação)
- [x] Supabase Realtime subscription em 3 tabelas (`ai_team_members`, `ai_crm_leads`, `crm_leads`)
- [x] Debounce 1s no reload pra evitar reload-storm
- [x] Cleanup correto no unmount (removeChannel + clearInterval + clearTimeout)

### ❌ Pendências conhecidas

| # | Item | Severidade | Estimativa |
|---|---|---|---|
| A1 | Promover commit `ca8c7e7` (filtros + fullscreen + realtime) pra PROD | Pequena | 5 min |
| A2 | Tab "CRM ao Vivo" dentro do Pedro mostra Dashboard COM sidebar/topbar do app — Fullscreen ali só estica o div interno (não esconde menu). Em rota standalone `/dashboard-tv` funciona perfeito | Baixa | — |
| A3 | Realtime fica aguardando subscription após `effectiveUserId` resolver — se conexão Supabase Realtime cair silenciosamente, polling 30s cobre. Sem retry de reconexão explícita | Baixa | 30 min se implementar |
| A4 | Vendedor cuja conta NÃO foi resolvida pelo `useSellerProfile` (sem `auth_user_id` em ai_team_members) é redirecionado — UX poderia ser melhor (mensagem explicativa) | Baixa | 15 min |
| A5 | Dashboard sempre filtra leads por `user_id = master_id` — RLS bloquearia vendedor de ver leads de outros masters, mas sem mensagem se algo der errado | Baixa | — |

### 🚀 Melhorias futuras (não pedidas, ficam de sugestão)

- Animação de transição quando vendedor muda de posição no ranking (Framer Motion)
- Destaque visual (confetti + som) quando 1º colocado muda
- Hide menu lateral do app quando fullscreen (precisa renderizar fora do MainLayout)
- Scroll automático se passar de 10 vendedores
- Exportar snapshot do dashboard como PDF
- Pedro lead com `origem='trafego_pago'` explícito (hoje conta TODOS Pedro com assigned_to_id como tráfego — assume que Pedro = tráfego pago)
- Comparativo período atual vs anterior (ex: "Hoje: 45 leads vs Ontem: 38 ↑18%")
- Tendência por hora (gráfico horizontal pequeno)

---

## 🟣 PARTE B — Tabelas do CRM Marcos (Kanban + UI de gerenciar)

### ✅ O que foi feito

#### 1. Reorganização inicial Item 3 — commit `ca37d44` — **PROD** (depreciado pelo v2)
- [x] 10 stages padrão criadas pra masters que tinham 7 stages antigos
- [x] Migration migrou leads de "Qualificado" pra "Negociação"
- [x] Aplicou só a users com set padrão (3 masters)

#### 2. Kanban Marcos v2 — commit `b80186f` — **PROD**
- [x] Reorganização final pra **7 colunas na ordem definitiva:**
  1. Leads Inativos
  2. Marketing Place
  3. Porta/loja
  4. Não tem no Estoque
  5. Agendamento
  6. Negociação
  7. Fechado
- [x] Migrou leads de "Novo Lead", "Proposta", "Perdido" → "Leads Inativos"
- [x] Renomeou 3 stages: Lead Inativo → Leads Inativos (plural) / Porta → Porta/loja / Carro não disponível → Não tem no Estoque
- [x] Reordenou positions (0 a 6)
- [x] Migration aplicou só a users com set padrão de 10 stages do Item 3 (3 masters)
- [x] Users com set incompleto (3 masters com só 2 stages) ficaram intocados
- [x] UI nova: Settings → tab "Kanban Marcos" (ícone KanbanSquare)
- [x] Lista colunas atuais ordenadas com numeração 1..N
- [x] Renomear inline (botão lápis → input → Enter salva)
- [x] Mover ↑/↓ (swap de position com adjacente)
- [x] Deletar (botão 🗑️ só habilita se 0 leads na coluna; bloqueia com mensagem se tem leads)
- [x] Adicionar nova coluna (input nome → INSERT na fim com `position = max + 1`)
- [x] Validação: nome obrigatório, não duplicado (case-insensitive)
- [x] Indicador de cor (quadrado 12×12 baseado em `crm_pipeline_stages.color`)
- [x] Contador de leads por coluna em tempo real (re-conta ao carregar)
- [x] Confirmation dialog antes de deletar

#### 3. Sync automático com vendedores — **já existia + documentado**
- [x] Vendedor lê `crm_pipeline_stages WHERE user_id = master_id` (via `effectiveUserId`)
- [x] Quando master adiciona/edita/deleta coluna, vendedor vê na próxima query (sem código adicional)
- [x] CrmAvancadoTab.tsx INTOCADO (já era 100% dinâmico desde Item 3)

### ❌ Pendências conhecidas

| # | Item | Severidade | Estimativa |
|---|---|---|---|
| B1 | Sync entre master e vendedor é via query (polling/reload). Master adiciona coluna nova → vendedor precisa F5 ou esperar próximo reload do CrmAvancadoTab pra ver | Média | 1-2h (adicionar realtime subscription em `crm_pipeline_stages` no CrmAvancadoTab) |
| B2 | 3 masters de teste em PROD têm set INCOMPLETO (só "Carro não disponível" + "Porta") — não receberam o set novo de 7 stages porque a migration foi conservadora (só aplicou a quem tinha o set padrão de 10). Vão precisar criar manualmente via UI | Baixa | 5 min por master (manual) |
| B3 | Cor da coluna nova é fixa em `#64748b` (slate-500). Master não pode escolher cor ao criar | Baixa | 30 min (adicionar color picker no form de adicionar) |
| B4 | Reordenar é via botões ↑/↓ (swap com adjacente). Pra mover do 1º pro 5º precisa clicar ↓ 4 vezes | Baixa | 1h (drag-and-drop com @hello-pangea/dnd) |
| B5 | Sem proteção especial pra "Leads Inativos" (coluna que é destino default da migration). Se master deletar, próxima migration falha | Média | 15 min (flag `is_protected` no schema ou hardcode no front) |
| B6 | Sem auditoria de mudanças (quem mudou, quando) — `crm_pipeline_stages` não tem trigger de log | Baixa | 30 min |
| B7 | Sem templates de stages (ex: master novo poderia escolher "Setor Auto", "Setor Imobiliário", etc.) | Baixa | 2-3h |

### 🚀 Melhorias futuras

- Drag-and-drop pra reordenar (substitui ↑/↓)
- Color picker no form de adicionar coluna (decidir cor desde a criação)
- Realtime sub em `crm_pipeline_stages` no CrmAvancadoTab (vendedor vê mudança em <1s)
- Coluna "Leads Inativos" protegida contra delete (flag `is_protected boolean` no schema)
- Bulk operations: "Mover todos os leads desta coluna pra outra"
- Templates de stages por setor
- Auditoria de mudanças (log de quem mudou, quando)
- Configurar SLA por coluna (ex: lead na coluna "Negociação" > 7 dias → alerta)
- Limite de WIP (Work In Progress) por coluna

---

## 📊 Resumo geral

### Status de cada item

| Frente | Itens | Em PROD | Em STAGING | Faltando |
|---|---|---|---|---|
| **A — Dashboard TV** | 7 entregas | 6 | 1 (filtros+fullscreen+realtime) | 5 pendências baixa/média |
| **B — Kanban Marcos** | 2 entregas | 2 | 0 | 7 pendências mistas |

### Próximos passos sugeridos

1. **Imediato:** promover commit `ca8c7e7` (filtros + fullscreen + realtime do Dashboard TV) pra PROD
2. **Curto prazo (esta semana):**
   - B1: realtime sub em `crm_pipeline_stages` no CrmAvancadoTab (sync master↔vendedor sem F5)
   - B5: proteger coluna "Leads Inativos" contra delete
3. **Médio prazo (próximo sprint):**
   - B3: color picker pra coluna nova
   - B4: drag-and-drop pra reordenar
   - A2: hide sidebar no fullscreen
4. **Longo prazo (backlog):**
   - Animações, exportar PDF, comparativos de período (A)
   - Templates de stages, auditoria, SLA (B)

---

## 📂 Arquivos críticos por frente

### Frente A — Dashboard TV
- `src/pages/DashboardTV.tsx` (~620 linhas) — tela principal
- `src/components/settings/DashboardTVSettingsTab.tsx` (~440 linhas) — UI configuração
- `src/pages/PedroSDR.tsx:3833` — substituição na tab CRM ao Vivo
- `supabase/migrations/20260526120000_dashboard_tv_etapa1.sql` — schema base
- `supabase/migrations/20260526150000_fix_avatars_bucket.sql` — bucket de fotos

### Frente B — Kanban Marcos
- `src/components/settings/KanbanSettingsTab.tsx` (~280 linhas) — UI master
- `src/pages/PedroSDR.tsx` (CrmAvancadoTab) — leitura dinâmica das stages (sem mudança)
- `supabase/migrations/20260522120000_marcos_reorganize_stages.sql` — Item 3 (depreciado)
- `supabase/migrations/20260526170000_kanban_marcos_v2.sql` — v2 final

### Documentos de apoio
- `AUDIT_MAP.md` (raiz) — mapeamento completo do sistema
- `CRM_OVERVIEW.md` (raiz) — descrição de todos os CRMs do projeto
- `AUDIT_*.md` (5 arquivos) — auditoria detalhada por módulo

---

**Última atualização:** 2026-05-26 | Sessão Claude Code
