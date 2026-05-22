# CHANGELOG — Agente Pedro SDR

Registro de mudanças no agente Pedro SDR (e infraestrutura de suporte direta).
Não substitui o `git log` — é um destilado humanamente legível de o-que-mudou
+ por-que-importa, agrupado por release.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

> **Convenção de versões:** Semver não aplicável (monorepo sem tag formal).
> Usamos data + commit curto: `[YYYY-MM-DD — <sha7>]`.

---

## [Em andamento — branch `feat/fase-4-confiabilidade`]

### Adicionado

- **IT-4.3 — Logs estruturados JSON com `trace_id`** (observabilidade do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/observability/structuredLog.ts`
    com `newTraceId()`, `slog(level, event, fields)`, `makeTurnLogger()`.
  - **Resolve RISCO ALTO #2 do DIAGNOSTICO**: "Sem observabilidade de
    custo/qualidade. Pilotando às cegas."
  - `trace_id` curto (8 chars hex) gerado por turno — permite agregar por
    conversa em dashboards futuros (Datadog/Logflare/Logtail).
  - JSON 1-linha por evento: `{ ts, level, event, trace_id, ...fields }`.
  - Output via `console[level]` (Supabase Edge captura automaticamente).
  - **Eventos no webhook**:
    - `turn_start` — entrada do processMessage (instance_name, remote_jid)
    - `guardrail_block` — quando guardrail substitui resposta
    - `courtesy_sent` — quando IT-4.1 envia cortesia após retry
    - `turn_end` — latency_ms total + parts_sent + flags ativas
  - Response JSON do webhook agora inclui `trace_id` (debug + correlação).
  - Cópia inline no `uazapi-webhook` (~45 linhas) + 4 pontos de integração.
  - Atrás de flag `PEDRO_FF_STRUCTURED_LOGGING` (default OFF = logs atuais
    em texto livre permanecem).
  - Suíte: 12 testes vitest (newTraceId hex/único, slog JSON válido com
    levels, circular ref fallback, console nativo quando consoleFn não passado,
    makeTurnLogger prefixa trace_id + baseFields, fields override base).

**Fase 4 completa.** 3 features (IT-4.1 retry+cortesia, IT-4.2 guardrails,
IT-4.3 logs estruturados), todas atrás de feature flag, todas com
fallback bit-perfect quando OFF. **PLANO COMPLETO — todas as 4 fases
+ 5 pré-requisitos entregues.**

- **IT-4.2 — Guardrails de saída** (confiabilidade do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/reliability/guardrails.ts`
    com `applyGuardrails(text, state, opts)` e `SAFE_FALLBACK`.
  - 4 categorias de violação:
    1. **preco_sem_veiculo** — `R$ X` / `X mil` quando `veiculo_apresentado=false`
    2. **promessa_indevida** — entrega, frete grátis, garantia (decisão do vendedor)
    3. **km/ano_inventado** — specs numéricos sem veículo apresentado
    4. **politica / religiao / depreciacao_concorrente** — fora do escopo
  - Cópia inline no `uazapi-webhook` (~60 linhas).
  - Integração: logo após `stripIntroIfAlreadyPresented`, antes do envio.
    Quando blocked: substitui `finalText` por `SAFE_FALLBACK`, log estruturado
    da violação. Quando OK: passa sem alteração.
  - Atrás de flag `PEDRO_FF_GUARDRAILS` (default OFF).
  - Suíte: 21 testes vitest (texto vazio/null, cada regra positiva/negativa,
    opts skip, múltiplas violações, ano com '?' não bloqueia, etc.).

- **IT-4.1 — Retry com backoff + mensagem de cortesia** (confiabilidade do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/reliability/llmRetry.ts` com
    `fetchWithRetry(url, init, opts)` e `COURTESY_MESSAGE`.
  - **Resolve RISCO ALTO #1 do DIAGNOSTICO**: "Conversa morre silenciosamente
    se OpenAI falhar".
  - Retry exponencial (1s, 2s, 4s) em 5xx + 429. NÃO retry em 4xx
    (problema permanente).
  - Quando TODAS as tentativas falham (network ou 5xx): envia
    `COURTESY_MESSAGE` ao cliente via `/send/text` + registra em `wa_inbox`,
    retorna HTTP 200 em vez de HTTP 500 silencioso.
  - **Decisão arquitetural**: fallback pra Anthropic adiado (requer tradução
    de tools OpenAI→Anthropic). Retry simples cobre 80% do risco.
  - Cópia inline no `uazapi-webhook` (~35 linhas) + wrap da chamada
    OpenAI principal (linha 2495).
  - Atrás de flag `PEDRO_FF_LLM_RETRY_FALLBACK` (default OFF = comportamento
    atual: 1 tentativa, HTTP 500 se falhar).
  - Suíte: 12 testes vitest (sucesso, retry em 500/429, NÃO retry em 401/400,
    todas falham, network error, exception em todas, backoff exponencial
    correto, maxAttempts e retryableStatuses customizados; setTimeoutFn
    + fetchFn injetáveis — zero network/wait nos testes).

---

## [Concluído — branch `feat/fase-3-memoria`]

### Adicionado

- **IT-3.3 — Playbooks de objeção (Opção B: hardcoded)** (memória do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/memory/objectionPlaybooks.ts`
    com `OBJECTION_PLAYBOOKS` (8 entradas), `getRelevantPlaybooks(stateObjections)`
    e `formatObjectionPlaybooksBlock(playbooks)`.
  - **Decisão arquitetural (user)**: Opção B (hardcoded no `_shared/`) escolhida
    sobre migration + tabela. Cobre 80% dos casos reais com zero infra nova.
    Se cada master quiser playbooks próprios futuramente, evolui pra IT-3.3.5.
  - 8 playbooks cobrindo: `nao_pode_visitar`, `longe`, `esposo_decide`,
    `esposa_decide`, `nao_quer_financiar`, `orcamento_baixo`, `so_olhando`,
    `concorrente_mais_barato`. Keys batem com o que o `extractEntitiesWithClaude`
    já produz no `state.atendimento.objecoes[]`.
  - Cada playbook tem `agent_should` (estratégia) + `do_not` (anti-padrão) +
    `example_response` (exemplo curto ≤200 chars).
  - Cópia inline no `uazapi-webhook` (~50 linhas) + integração no
    `formatStateForPrompt` apendando bloco quando flag ON e há match.
  - Atrás de flag `PEDRO_FF_OBJECTION_PLAYBOOKS` (default OFF).
  - Suíte: 19 testes vitest (cobertura mínima, schema, matching
    case-insensitive, dedupe, formatação).

**Fase 3 completa.** 3 features (IT-3.1 perfil persistente, IT-3.2
sumarização hierárquica, IT-3.3 playbooks de objeção), todas atrás de
feature flag, todas com fallback bit-perfect quando OFF. Zero migration
em toda a fase.

- **IT-3.2 — Sumarização hierárquica de histórico longo** (memória do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/memory/historySummarizer.ts`
    com `splitForSummarization(history, keepRecent)`, `summarizeOldMessages(...)`,
    `buildSummarizationPrompt(...)` e `formatSummaryAsSystemMessage(...)`.
  - **Resolve "Pedro esquece" em conversas longas** do DIAGNOSTICO (histórico
    truncado em 10 msgs sem sumarização).
  - Cópia inline no `uazapi-webhook` (~75 linhas).
  - Atrás de flag `PEDRO_FF_HIERARCHICAL_SUMMARIZATION` (default OFF).
  - Quando ON: busca 30 msgs em vez de 10 → se >10, separa em [old, recent] →
    sumariza old via Claude Haiku (cascade 3 modelos) → injeta como system
    message antes das 10 cruas.
  - Modelo: Claude Haiku (mesmo cascade do extractEntities, ~$0.0001/turno).
  - **Failsafe robusto**: erro Anthropic / key ausente / response vazio →
    mantém só as 10 últimas mensagens (igual comportamento atual). Agente
    nunca trava por causa da sumarização.
  - Suíte: 18 testes vitest (split em N+keepRecent, prompt formado, summary
    como system message, cascade de modelos, fetch quebrado, key vazia,
    fetchFn injetável — zero network).

- **IT-3.1 — Perfil persistente cross-conversa** (memória do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/memory/persistentProfile.ts`
    com `derivePersistentProfile(leadRecords, stateRecords)` (pure function)
    e `formatPersistentProfileBlock(profile)`.
  - Caller faz 2 queries Supabase:
    1. `ai_crm_leads` por `remote_jid` (mesmo user_id, top 10 mais recentes)
    2. `pedro_conversation_state` por esses lead_ids
  - Agregação extrai: nome, cidade, modelos perguntados (union deduplicado),
    veículos apresentados (dedupe por modelo+ano), forma de pagamento,
    acompanhante de decisão, objeções históricas, has_been_transferred.
  - Calcula `days_since_last_seen` em runtime (formato legível: "hoje" /
    "ontem" / "N dias atrás").
  - Cópia inline no `uazapi-webhook` (~110 linhas) + integração no
    fluxo principal (entre BNDV e PERSONA_FEW_SHOTS).
  - Atrás de flag `PEDRO_FF_PERSISTENT_PROFILES` (default OFF).
  - **Sem migration** — usa tabelas existentes.
  - try/catch defensivo: query que falhar não bloqueia agente.
  - Suíte: 16 testes vitest (arrays vazios, dedup, days_since formato,
    prioridade state > lead, has_been_transferred, formatação).

---

## [Concluído — branch `feat/fase-2-qualificacao`]

### Adicionado

- **IT-2.4 — Handoff Tool V2** (qualificação do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/handoff/handoffBriefingV2.ts`
    com `buildEnrichedBriefing(input)` e types
    `HandoffMotivoCategoria` / `HandoffUrgencia` / `HandoffTransferArgs`.
  - **Schema da tool `transferir_para_vendedor` estendido** com 3 campos
    OPCIONAIS (backward-compat — V1 continua funcionando):
    - `motivo_categoria`: enum `lead_qualificado | pediu_humano |
      objecao_complexa | negociacao_preco | fora_escopo | erro_agente`
    - `urgencia`: enum `baixa | media | alta | imediata` (default `media`)
    - `proxima_acao_sugerida`: string livre pra orientar o vendedor
  - V2 do briefing inclui:
    - Header com emoji de urgência (🔴 imediata / 🟠 alta / 🟡 media / 🟢 baixa)
    - Score + tier (vindo do IT-2.2 `calcLeadScoreV2`)
    - Motivo categórico com label legível
    - Próxima ação sugerida (fallback pro `bantNextSuggestedAsk` do IT-2.1
      quando o LLM não preenche)
  - Cópia inline no `uazapi-webhook` (~95 linhas) + integração no bloco
    de handoff: quando flag `PEDRO_FF_HANDOFF_TOOL_V2=true`, usa
    `buildEnrichedBriefing`; senão usa `buildBriefingForSeller` V1.
  - **V1 mantida intacta** (zero risco de regressão quando flag OFF).
  - Suíte: 18 testes vitest cobrindo emoji por urgência, score, fallback
    de bant, troca, objeções, link wa.me limpo, label V2 final.

**Fase 2 completa.** 4 features (BANT, scoring, BNDV fallback, handoff V2),
todas atrás de feature flag, todas com fallback bit-perfect pro
comportamento atual quando OFF. Sem migration.

- **IT-2.3 — BNDV fallback: oferecer similares quando 0 resultados**
  - Fonte canônica: `supabase/functions/_shared/qualification/bndvFallback.ts`
    com `relaxBndvFilters(filters)` (gera 1-5 tentativas progressivas) e
    `trySimilarVehiclesFallback(filters, searchFn)` (helper async).
  - Cópia inline no `uazapi-webhook` (~30 linhas).
  - **Refatoração de `consultarEstoqueBndv`**: extrai `applyBndvFiltering`
    (filtro+rank reusável) e `buildBndvItem` (helper de transformação) como
    funções inline antes da função principal. Comportamento original
    100% preservado quando flag OFF.
  - Atrás de flag `PEDRO_FF_BNDV_SIMILAR_VEHICLES` (default OFF).
  - Quando ON e busca original retorna 0 itens: tenta relaxação
    progressiva (cor → câmbio → combustível → versão → ano), preservando
    SEMPRE marca+modelo. Usa o mesmo array GraphQL (1 fetch, N filtragens).
  - Items de fallback marcados com `is_fallback_suggestion=true` +
    `fallback_description` (ex: "removendo filtro de cor") +
    `agent_instruction` no result pro LLM apresentar como ALTERNATIVA
    (não como o que foi pedido literalmente).
  - **Resolve causa raiz do bug "Pedro nega estoque"** do benchmark Roberta.
  - Suíte: 14 testes vitest (relaxação, dedupe, preservação marca/modelo,
    ordem de níveis, async helper).

- **IT-2.2 — Lead scoring V2** (qualificação do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/qualification/leadScoring.ts`
    com `calcLeadScoreV2(state)` (pure function), `getLeadTier(score)` e
    `formatLeadScoreBlock(result)`.
  - 10 critérios explícitos (9 positivos + 1 penalidade) — cada um com
    `key/label/weight/passed/reason` pra debug e analytics.
  - Tiers: `cold` (0-19) / `warm` (20-49) / `hot` (50-79) / `qualified` (80+).
  - **V1 mantida** (`calcQualificationScore` original intacto) +
    wrapper `getQualificationScore(state)` que escolhe V1/V2 conforme flag.
  - 3 call sites do score (linhas 1879, 2259, 2697) migrados pro wrapper —
    quando flag OFF, escreve mesma coluna `qualificacao_score` com V1; flag
    ON usa V2 (intervalo idêntico 0-100, compat com schema).
  - Apenda bloco "## LEAD SCORE" no system prompt com breakdown completo
    (pontos coletados + penalidades + faltam coletar) — orienta o LLM a
    pedir os campos faltantes pra subir o tier.
  - Suíte: 16 testes vitest (tiers, state vazio/null, BNA, acompanhante,
    penalidade visita, clamp 0/100, breakdown integro, formatação).

- **IT-2.1 — Schema BANT derivado do state** (qualificação do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/qualification/bantSchema.ts`
    com `deriveBantFromState(state)` (pure function, deriva 4 dimensões dos
    campos já existentes no JSONB) + `formatBantBlock(bant)` (markdown pro
    system prompt).
  - **Sem migration nova** — usa `pedro_conversation_state.state` atual:
    Budget ← negociacao.forma_pagamento + valor_entrada;
    Authority ← lead.acompanhante_decisao (vazio = sole);
    Need ← interesse.modelo_desejado + veiculo_apresentado;
    Timeline ← heurística combinada.
  - Cópia inline no `uazapi-webhook` (~110 linhas) + integração no
    `formatStateForPrompt` apendendo bloco quando flag ON.
  - Atrás de flag `PEDRO_FF_BANT_QUALIFICATION` (default OFF).
  - Quando ON: LLM enxerga estágio BANT do lead + próxima ação sugerida
    (ex: "Perguntar forma de pagamento" / "Transferir pra vendedor").
  - Suíte: 16 testes vitest cobrindo todos os estágios.

---

## [Concluído — branch `feat/fase-1-humanizacao`]

### Adicionado

- **IT-1.3 — Persona consolidada + 5 few-shots** (humanização do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/prompt/personaFewShots.ts`
    com `PEDRO_PERSONA` (tom + escopo + regras), `PEDRO_FEW_SHOTS` (5
    exemplos: saudação, qualificação, objeção, fechamento, despedida) e
    `buildPersonaFewShotsBlock()`.
  - Cópia inline no `uazapi-webhook` (~35 linhas).
  - Atrás de flag `PEDRO_FF_PERSONA_FEW_SHOTS` (default OFF).
  - Quando ON: apenda bloco completo ao FINAL do system prompt (depois
    do bloco BNDV) — recency bias do GPT-4o reforça tom + regras.
  - Suíte: 14 testes vitest validando persona, few-shots e formatação.

**Fase 1 completa.** 3 features (message split, typing, persona+few-shots),
todas atrás de feature flag, todas com fallback bit-perfect pro
comportamento atual quando OFF.

- **IT-1.2 — Typing simulation** (humanização do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/humanization/typingSimulator.ts`
    com `calculateTypingDelayMs(text, opts)` (fórmula 18-28 cps com jitter,
    clamp 800ms–4s, `randomFn` injetável pra testes) +
    `sendTypingPresence(baseUrl, instKey, phone, presence)` best-effort
    (tenta 2 endpoints UazAPI: `/message/presence` e `/chat/presence`).
  - Cópia inline no `uazapi-webhook` (~50 linhas).
  - Atrás de flag `PEDRO_FF_TYPING_SIMULATION` (default OFF).
  - Quando ON: antes de cada `send/text` dispara presence "composing" +
    sleep proporcional; após envio dispara "paused". Combina com IT-1.1
    (humano-like: digitando → mensagem → pausa → digitando → ...).
  - Suíte: 12 testes vitest com `fetchFn` injetável (zero network).

- **IT-1.1 — Message splitting** (humanização do Pedro SDR)
  - Fonte canônica: `supabase/functions/_shared/humanization/messageSplit.ts`
    com algoritmo de split em pontuação forte (`.!?\\s+` ou `\\n+`),
    preserva números (`R$ 12.500,00`) e domínios (`site.com.br`), distribui
    em até 3 partes balanceadas por chars.
  - Cópia inline no `supabase/functions/uazapi-webhook/index.ts` (Edge
    Functions Supabase não importam cross-function — código duplicado
    intencionalmente, com comentário apontando pra fonte).
  - Atrás de feature flag `PEDRO_FF_MESSAGE_SPLITTING` (default OFF =
    comportamento atual idêntico).
  - Quando ON: divide em N partes, envia 1 por vez via `/send/text` com
    delay de 600ms entre cada (garante ordem no WhatsApp).
  - Suíte: 15 testes vitest (edge cases incluídos).

---

## [Concluído — branch `chore/pre-requisitos-fase-1`]

### Adicionado

- **PR-1 — Infra de feature flags** (`supabase/functions/_shared/config/features.ts`)
  — sistema central com 13 flags declaradas (Fase 1–4), leitura via
  `Deno.env.get('PEDRO_FF_*')`, default `false` (fail-safe).
- **PR-2 — `BACKLOG.md` + `CHANGELOG.md`** no root.
- **PR-3 — Smoke test do feature flag system** (`src/test/features.test.ts`).
  8 testes cobrindo fail-safe, env var, variantes case-insensitive, helpers.
- **PR-4 — Seed de 20 conversas sintéticas** (`scripts/seed-test-conversations.ts`).
  Fixtures realistas pra eval/benchmark, cobrindo saudação, estoque (existe/zero),
  fora de escopo, BANT, handoff, memória, objeção, verbosidade, sinônimos,
  fechamento. + 12 testes de integridade (`src/test/seed-conversations.test.ts`).

### Validado

- **PR-5 — Suite vitest verde:** 21/21 testes passam em ~14s.
  - `src/test/example.test.ts` (1 trivial pre-existente)
  - `src/test/features.test.ts` (8 do PR-3)
  - `src/test/seed-conversations.test.ts` (12 do PR-4)
- **TypeScript compile clean** (`tsc --noEmit --skipLibCheck` sem erros).

### Próximo

- **Aguardando aprovação pra iniciar Fase 1** (IT-1.1 message splitting,
  IT-1.2 typing simulation, IT-1.3 persona + few-shots).

---

## [2026-05-17 — `6a9a084`] DIAGNOSTICO Pedro SDR

### Adicionado

- **`DIAGNOSTICO.md`** (1053 linhas) — auditoria técnica completa do agente
  Pedro SDR. Maturidade atual: 3/5. Inclui 21-item priority plan, 3 quick-win
  diffs prontos, 4 categorias de métricas sugeridas, 6 perguntas em aberto.
- **`DIAGNOSTICO-CRM-bugs-15-05.md`** — preservação da versão anterior do
  diagnóstico (CRM bugs já corrigidos, mantido como referência histórica).

---

## [2026-05-16 — `6ba3ee5`] Toast de transferência com erro real

### Corrigido

- **CRM Vivo** — `transferir manual` mostra toast com mensagem de erro real
  do backend ao invés de "erro genérico".

---

## [2026-05-16 — `2821fec`] Pedro não se reapresenta (3 camadas)

### Corrigido

- **Race condition em UPSERT concorrente** do `pedro_conversation_state` que
  causava perda do flag `ja_apresentado=true` quando 2 webhooks chegavam no
  mesmo segundo.
- **3 camadas de defesa**:
  1. Lock otimista via `updated_at` no UPSERT
  2. Re-read antes de merge no `applyAgentSelfFlags`
  3. Detecção heurística "Eu sou o Carvalho" pra reconstruir state perdido

---

## [2026-05-16 — `886cc64`] CRM Pedro: até 500 leads

### Corrigido

- Limite de 100 leads na query do CRM master subia pra 500 quando o agente é
  do Pedro (que tem muito mais volume que Marcos).

---

## [2026-05-16 — `b0a099d`] Prompt 1.1 — campo origem do Lead

### Adicionado

- **Campo `origem` em `ai_crm_leads`** (apenas Pedro) com 6 valores:
  `porta`, `marketplace_facebook`, `marketplace_olx`,
  `marketplace_mercadolivre`, `instagram_vendedor`, `outros`.
- **Coluna `origem_outros`** (texto livre) pra detalhar quando `origem='outros'`.
- **Default `'outros'`** ao criar lead via WhatsApp (`uazapi-webhook` UPSERT).
- **Migration** `20260516120000_lead_origem.sql` com CHECK + INDEX.
- **UI Pedro SDR** — `<Select>` com 6 opções no formulário "Adicionar Lead"
  + `<Input>` condicional pra origem='outros' + suporte no bulk-insert (Excel).

### Não incluído (movido pra backlog)

- Badge visual no detalhe do lead → Prompt 5.1
- Filtro/coluna no CRM por origem → Prompt 1.3
- Replicar em `crm_leads` do Marcos → Prompt 1.1.1

---

*Mantido por: Claude Code + Agencia-Up / Logos IA Team*
