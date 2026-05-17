# CHANGELOG — Agente Pedro SDR

Registro de mudanças no agente Pedro SDR (e infraestrutura de suporte direta).
Não substitui o `git log` — é um destilado humanamente legível de o-que-mudou
+ por-que-importa, agrupado por release.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

> **Convenção de versões:** Semver não aplicável (monorepo sem tag formal).
> Usamos data + commit curto: `[YYYY-MM-DD — <sha7>]`.

---

## [Em andamento — branch `feat/fase-1-humanizacao`]

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
