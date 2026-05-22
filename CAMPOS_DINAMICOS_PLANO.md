# Fase 6 — Campos Dinâmicos: Cidade + Origem do Lead

> **Status:** 6.1 Diagnóstico concluído. Aguardando aprovação antes de 6.2 (Migration).
> **Data:** 2026-05-20
> **Branch:** `feature/campos-dinamicos` (a partir de `staging`)
> **Projeto Supabase staging:** `ezoltigtqgbmftmiwjxh` (todo o diagnóstico foi feito aqui — prod intacto)

---

## 1. Estado Atual

### 1.1 Cidade

| Onde | Como está | Detalhe |
|---|---|---|
| **DB** `ai_crm_leads.client_city` | `text` nullable, sem constraint | 333 leads total, **0 preenchidos** |
| **DB** `pedro_manager_feedback.city` | `text` nullable | Salvo pelo form de feedback do vendedor |
| **DB** `crm_leads` (Marcos) | **não tem coluna de cidade** | — |
| **Frontend** lista de opções | Constante hardcoded `FEEDBACK_CITIES` | `src/pages/PedroSDR.tsx:516-520` |
| **Frontend** consumido em | Form "Feedback IA" do vendedor | `PedroSDR.tsx:2025-2043` |

**11 cidades hardcoded** (Vale do Paraíba/SP):
`Pindamonhangaba, Taubaté, Tremembé, Caçapava, São Luís do Paraitinga, Redenção da Serra, Jacareí, São José dos Campos, Guaratinguetá, Campos do Jordão, Lorena`

Vendedor pode escolher "Outros..." e digitar texto livre (vai pro `fbCityCustom`). Não há validação, dedup ou padronização — então "ubatuba", "Ubatuba" e "UBATUBA" entram como 3 cidades distintas no banco.

### 1.2 Origem do Lead

| Onde | Como está | Detalhe |
|---|---|---|
| **DB** `ai_crm_leads.origem` | `text` nullable + **CHECK constraint** | 6 valores fixos. 333 leads, **1 valor distinto usado** |
| **DB** `ai_crm_leads.origem_outros` | `text` nullable | Preenchido quando `origem='outros'` |
| **DB** `crm_leads.source` (Marcos) | `text` nullable, **sem constraint** | 550 leads, **8 valores distintos** |
| **DB** `crm_leads.utm_source` (Marcos) | `text` nullable | Tracking de campanhas |
| **Frontend** lista de opções | Constante `LEAD_ORIGEM_OPTIONS` | `src/pages/PedroSDR.tsx:586-593` |
| **Frontend** consumido em | Form "Adicionar Lead Manual" do Pedro | `PedroSDR.tsx:2340-2350` |
| **Frontend** display | Painel lateral do lead | `PedroSDR.tsx:1635` |

**CHECK constraint atual** (migration `20260516120000_lead_origem.sql`):
```
CHECK (origem IS NULL OR origem IN (
  'porta', 'marketplace_facebook', 'marketplace_olx',
  'marketplace_mercadolivre', 'instagram_vendedor', 'outros'
))
```

**8 valores reais no `crm_leads.source` (Marcos):**

| Valor | Leads | Tipo |
|---|---|---|
| `Pedro SDR — Carvalho` | 166 | **automático** (criado pelo agente) |
| `Importacao manual - Marcos` | 111 | **automático** (importação Excel) |
| `form:Icom Day` | 50 | **automático** (form externo) |
| `porta` | 8 | manual (vendedor escolhe) |
| `outros` | 7 | manual |
| `marketplace_facebook` | 3 | manual |
| `marketplace_olx` | 1 | manual |

⚠️ **Mistura crítica**: `crm_leads.source` tem origens AUTOMÁTICAS (criadas pelo sistema) misturadas com MANUAIS (escolhidas pelo vendedor). Migração precisa distinguir.

### 1.3 Outras referências (não fazem parte do escopo, mas mapeadas)

- `FeedbackAnalytics.tsx` agrega top cidades de `pedro_manager_feedback.city` pra dashboard (read-only)
- `SegmentKnowledgeBase.tsx` (José) tem "cidades" como segmento de anúncio — **constante separada, não tocar**
- `GoogleAnalyticsSettingsTab.tsx` menciona "Cidades" como dimensão GA — **não relacionado**

### 1.4 Multi-tenancy atual

**Não existe tabela `accounts`** no projeto. O multi-tenant funciona via:
- `user_id` (do master, `profiles.role='owner'`)
- Vendedores subordinados têm `profiles.manager_id = master_user_id`
- RLS baseado em `user_id` ou `is_org_member()`

Para a Fase 6, **`account_id` do plano original mapeia para `user_id` do master** (a quem o agente IA pertence). Cada master tem seu próprio set de cidades + origens.

---

## 2. Arquivos que consomem hoje

| Arquivo | Como consome | Impacto da migração |
|---|---|---|
| `src/pages/PedroSDR.tsx:516-520` | Define `FEEDBACK_CITIES` (const) | **Substituir** por hook `useDynamicCities(userId)` |
| `src/pages/PedroSDR.tsx:586-594` | Define `LEAD_ORIGEM_OPTIONS` (const) | **Substituir** por hook `useDynamicLeadSources(userId)` |
| `src/pages/PedroSDR.tsx:1635` | Display da origem no painel lateral | Trocar `LEAD_ORIGEM_OPTIONS.find(...)` por lookup na lista do hook |
| `src/pages/PedroSDR.tsx:2025-2043` | Select de cidade no form de feedback | Trocar por `<DynamicSelect entity='city'>` |
| `src/pages/PedroSDR.tsx:2340-2372` | Select de origem no form "Adicionar lead" | Trocar por `<DynamicSelect entity='lead_source'>` |
| `src/pages/PedroSDR.tsx:1487-1488` | Insert: `origem`, `origem_outros` | Mudar pra `source_id` (uuid) — mantém legacy temporariamente |
| `src/pages/PedroSDR.tsx:1131-1170` | Validação + insert feedback | Trocar string livre por `city_id` (uuid) — mantém legacy |
| `src/components/pedro/FeedbackAnalytics.tsx:138-302` | Agrega cidade pra dashboard | **Sem impacto** se mantemos `pedro_manager_feedback.city` (text) populado por trigger |
| `src/integrations/supabase/types.ts` | Tipos gerados do banco | **Regenerar** após migration |
| `src/preview/previewFeatures.test.ts` | Testes ref. `client_city` | Não bloqueante — vitest fixture |
| `src/test/persistentProfile.test.ts` | Testes ref. `client_city` | Não bloqueante |

**Conclusão:** todo o impacto está em **1 arquivo principal** (`PedroSDR.tsx`) + regen de types + componente novo `<DynamicSelect>` reusável.

---

## 3. Proposta de Migração

### 3.1 Estratégia geral

**3 fases internas:**
1. **Criar tabelas + backfill** (migration única, idempotente). Coexistem com colunas legacy `origem`/`client_city`.
2. **Trocar UI** pra usar `<DynamicSelect>` lendo das novas tabelas. Inserts gravam `city_id`/`source_id` E mantêm campos legacy preenchidos (dupla escrita).
3. **Deprecate legacy** (semanas depois, com tudo estável): dropar `origem`/`client_city` em migration separada.

### 3.2 Schema proposto

#### Tabela `cities`
```sql
CREATE TABLE IF NOT EXISTS cities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,                  -- display: "São José dos Campos"
  normalized_name text NOT NULL,                  -- dedup: "sao jose dos campos"
  state_uf        char(2),                        -- opcional, recomendado pro contexto
  status          text NOT NULL DEFAULT 'active', -- active | pending_review | archived | rejected
  is_system_default boolean DEFAULT false,        -- veio do seed
  created_by      uuid REFERENCES profiles(id),
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,
  usage_count     int DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, normalized_name)
);
CREATE INDEX idx_cities_user_status ON cities (user_id, status);
CREATE INDEX idx_cities_normalized_trgm ON cities USING gin (normalized_name gin_trgm_ops);
```

#### Tabela `lead_sources`
```sql
CREATE TABLE IF NOT EXISTS lead_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  normalized_name text NOT NULL,
  category        text NOT NULL DEFAULT 'manual',  -- manual | automatic | marketplace | paid | event | other
  icon            text,                            -- emoji ou nome lucide-icon
  status          text NOT NULL DEFAULT 'active',
  is_system_default boolean DEFAULT false,
  created_by      uuid REFERENCES profiles(id),
  approved_by     uuid REFERENCES profiles(id),
  approved_at     timestamptz,
  usage_count     int DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, normalized_name)
);
CREATE INDEX idx_lead_sources_user_status ON lead_sources (user_id, status);
CREATE INDEX idx_lead_sources_normalized_trgm ON lead_sources USING gin (normalized_name gin_trgm_ops);
```

#### Alterações em `ai_crm_leads` e `crm_leads`
```sql
ALTER TABLE ai_crm_leads
  ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES cities(id),
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES lead_sources(id);

ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES lead_sources(id);
```
**Mantém** `ai_crm_leads.client_city`, `ai_crm_leads.origem`, `ai_crm_leads.origem_outros`, `crm_leads.source` (legacy, deprecate depois).

**A CHECK constraint atual** `ai_crm_leads_origem_check` será **dropada** porque novo schema permite valores arbitrários (com aprovação se config exigir).

#### Tabela `dynamic_fields_audit_log` (já no plano 6.6 — mas adianto a definição aqui)
```sql
CREATE TABLE IF NOT EXISTS dynamic_fields_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  entity_type     text NOT NULL,           -- 'city' | 'lead_source'
  entity_id       uuid NOT NULL,
  action          text NOT NULL,           -- 'created' | 'approved' | 'rejected' | 'edited' | 'merged' | 'archived'
  performed_by    uuid REFERENCES profiles(id),
  payload         jsonb,                   -- snapshot before/after
  created_at      timestamptz DEFAULT now()
);
```

### 3.3 Plano de Backfill

**Cidades:**
1. Pegar `DISTINCT name FROM (SELECT client_city FROM ai_crm_leads UNION SELECT city FROM pedro_manager_feedback)` agrupado por `user_id` (do lead).
2. Para cada (user_id, name) único + non-empty: inserir em `cities` com `status='active'`, `is_system_default=true`, `state_uf='SP'` (assumido).
3. Atualizar `ai_crm_leads.city_id` apontando pra row criada (match por `normalized_name`).
4. Como `ai_crm_leads.client_city` está VAZIO no staging (0 preenchidos), o backfill é trivial pra esta tabela.

**Seed inicial das 11 cidades hardcoded** — pra CADA `user_id` que tem agente Pedro ativo, criar as 11 cidades como `is_system_default=true`:
```sql
INSERT INTO cities (user_id, name, normalized_name, state_uf, status, is_system_default)
SELECT
  a.user_id,
  c.name,
  -- normalização aplicada via função util_normalize
  lower(unaccent(c.name)) AS normalized_name,
  'SP'::char(2),
  'active',
  true
FROM wa_ai_agents a
CROSS JOIN (VALUES
  ('Pindamonhangaba'), ('Taubaté'), ('Tremembé'), ('Caçapava'),
  ('São Luís do Paraitinga'), ('Redenção da Serra'), ('Jacareí'),
  ('São José dos Campos'), ('Guaratinguetá'), ('Campos do Jordão'), ('Lorena')
) AS c(name)
WHERE a.is_active = true
ON CONFLICT (user_id, normalized_name) DO NOTHING;
```

**Origens (Pedro `ai_crm_leads.origem`):**
1. Pra cada user_id que tem leads, seed as 6 origens fixas como `is_system_default=true`.
2. Atualizar `ai_crm_leads.source_id` mapeando o valor legacy → row criada.

**Origens (Marcos `crm_leads.source`):**
1. Pra cada user_id que tem leads, agrupar por `source` distinct.
2. Inserir como `lead_sources` com:
   - `category='automatic'` para "Pedro SDR — Carvalho", "Importacao manual - Marcos", "form:Icom Day"
   - `category='manual'` para "porta", "outros", "marketplace_facebook", "marketplace_olx"
3. Atualizar `crm_leads.source_id`.

**Em batches de 500 leads** pra não travar tabela durante backfill.

---

## 4. Riscos identificados

| Risco | Impacto | Mitigação |
|---|---|---|
| **R1** — Backfill em prod com tabela grande (milhares de leads) trava INSERT | Alto | Batch de 500 + `pg_advisory_lock` + executar fora do horário comercial |
| **R2** — `pg_trgm` similarity threshold mal calibrado retorna sugestões irrelevantes | Médio | Testar com 20+ pares conhecidos antes de fixar threshold (proposta: 0.7) |
| **R3** — Vendedor cria cidade com erro de digitação E aprova "Adicionar mesmo assim" | Médio | Tela de revisão pro gerente mesclar depois (Prompt 6.5) |
| **R4** — Cidade rejeitada deixa leads órfãos | Médio | UI mostra aviso "esta cidade foi descontinuada — atualize" no lead afetado |
| **R5** — `crm_leads.source` automático ("Pedro SDR — Carvalho") aparece no select pro vendedor (visual ruim) | Baixo | Filtrar `WHERE category = 'manual'` na consulta do `<DynamicSelect>` |
| **R6** — Webhook do `uazapi-webhook` cria lead com origem nova on-the-fly | Médio | Edge function chama mesma `validateAndCreateCity()` do service — autoaprovação se config ON |
| **R7** — Dropar `ai_crm_leads_origem_check` em prod sem rollback testado | Alto | Migration UP/DOWN testada no staging; rollback documentado |
| **R8** — RLS quebrada permite usuário A ver cidades de B | Crítico | Policy explícita `USING (user_id = auth.uid() OR user_id IN (SELECT manager_id FROM profiles WHERE id = auth.uid()))` |
| **R9** — Frontend cacheia lista antiga e não vê novas cidades | Baixo | React Query invalidate após `createCity` + Realtime subscription opcional |
| **R10** — Importação de planilha (Marcos bulk insert) com cidade nova não aprovada | Médio | Bulk insert respeita config: `auto_approve=true` cria diretamente; senão, marca como `pending_review` |

---

## 5. Estimativa de Complexidade

| Item | Complexidade | Estimativa (sem ajustes) |
|---|---|---|
| 6.2 Migration + backfill | **Média** | 1 sessão |
| 6.3 Service de validação (`cityService.ts` + `leadSourceService.ts` + testes vitest) | **Média** | 1 sessão |
| 6.4 UI `<DynamicSelect>` + `<AddDynamicModal>` + plug no `PedroSDR.tsx` | **Média-Alta** | 1-2 sessões |
| 6.5 Tela de revisão `/configuracoes/campos-dinamicos` + toggle config | **Média** | 1 sessão |
| 6.6 Auditoria + mini-dashboard | **Baixa** | 0.5 sessão |
| 6.7 Testes manuais + regressão staging | **Média** | 0.5 sessão + 24-48h de uso real |
| **TOTAL** | | **~5-6 sessões** + janela de validação |

**Complexidade geral:** Média. Sem nenhum bloqueador técnico identificado. Maior risco é R1 (backfill em prod) e R10 (integração com bulk insert).

---

## 6. Decisões pendentes (do plano original)

| # | Decisão | Minha recomendação | Justificativa |
|---|---|---|---|
| 1 | Aprovação automática default? | **Sim** | Fluidez do dia-a-dia. Master toggle OFF quando quiser revisar. |
| 2 | Quem pode criar? | **Qualquer vendedor**, com auditoria | Vendedor já tem CRUD em leads — adicionar opção de campo segue o padrão |
| 3 | Origem aceita números? | **Sim** | "Facebook Ads 2025", "Campanha Q4" são origens legítimas |
| 4 | Cidades sem UF? | **UF opcional**, mas sugerida | Cliente do Vale do Paraíba já tem 11 cidades-base. Se UF vazio, assume SP no seed |
| 5 | Estender pra outros campos (categoria, tag)? | **Não agora** | Faz dos 2 primeiro, generaliza depois (princípio YAGNI) |
| 6 | IA/LLM na validação? | **Não agora** | pg_trgm + regras simples cobrem 95% dos casos. IA fica como fallback futuro se métricas mostrarem necessidade |

---

## 7. Próximo passo

Aguardo aprovação deste documento pra começar **6.2 Migration**.

A migration vai:
1. Habilitar `pg_trgm` + `unaccent`
2. Criar `cities` + `lead_sources` + `dynamic_fields_audit_log`
3. Adicionar `city_id` + `source_id` em `ai_crm_leads` e `crm_leads` (nullable, sem dropar nada)
4. Seed 11 cidades + 6 origens base por user_id de master ativo
5. Backfill `source_id` em `crm_leads` (550 leads)
6. RLS configurada
7. **Apenas STAGING.** Prod intacto.

**Reversibilidade:** migration DOWN deletando tabelas + colunas adicionadas.

---

*Documento gerado por diagnóstico read-only no Supabase staging `ezoltigtqgbmftmiwjxh`. Nenhuma alteração de schema foi feita.*
