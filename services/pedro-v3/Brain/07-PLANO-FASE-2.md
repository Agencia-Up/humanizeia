# 07 — Plano da Fase 2 (camada N8N-like real) — PROPOSTA

> Status: **F2.5.1 concluida localmente (214/214); patch Supabase e verificacao remota pendentes.**
> Autor: Claude. Data: 2026-06-27. Base: kernel Fase 1.5.1 (67 OK | tsc limpo).
> Princípio: **ports & adapters (hexagonal)**. Tudo nasce **fake/in-memory**; nenhum provider real,
> nenhum banco, nenhuma migration executada. O kernel aprovado **não muda** (ver §"Kernel").

## Objetivo

Implementar o ciclo atômico do `02 §3` (ingestão → claim → load → `runTurn` do kernel → commit CAS → outbox →
dispatch → EffectOutcomeCommit → reconciliação) **sobre interfaces (ports)**, com adapters **in-memory** que
simulam as tabelas `v3_*` e os providers. Assim o turno completo roda end-to-end **sem I/O real**, e a troca
para Postgres/uazapi/CRM reais vira apenas "plugar outro adapter" — numa sub-fase posterior, autorizada.

## 1. Arquivos a criar / alterar

**Criar (Agent/src) — todos novos, aditivos:**
- `domain/ports.ts` — interfaces de I/O puras: `StateStore`, `InboxStore`, `OutboxStore`, `EventStore`, `DecisionStore`, `LeaseStore` (CoordinationStore), `Clock`, `IdGen`, `UnitOfWork` (transação atômica com CAS).
- `domain/effect-intent.ts` — `EffectIntent`, `EffectStatus` (pending/processing/succeeded/failed/outcome_uncertain/skipped), `ProviderCapability` (idempotent/queryable/none), `InboxRecord`, `OutboxRecord` (tipos de persistência; **aditivos**, não alteram `decision.ts`).
- `engine/effect-materializer.ts` — `TurnDecision.effectPlan` + `RenderedResponse` → `EffectIntent[]` (idempotencyKey = `effectId`, `order`, payload por kind, redacted por construção).
- `engine/conversation-engine.ts` — orquestrador do ciclo atômico, **puro sobre os ports** (chama o `runTurn` do kernel).
- `engine/effect-outcome-commit.ts` — aplicação atômica+idempotente do outcome (checa `outcome_applied_at`, `applyEffectOutcome`, CAS, history+evento) — `02 §3 passo 19`.
- `engine/outbox-dispatcher.ts` — lê `pending` por `(conversation, order)`, respeita `dependsOn`, chama o `EffectDispatcher`, grava status/receipt, dispara o EffectOutcomeCommit.
- `engine/reconciler.ts` — trata `outcome_uncertain` por `ProviderCapability` (idempotent→retry; queryable→consulta; none→revisão/alerta).
- `adapters/persistence/in-memory-store.ts` — implementa **todos** os ports com Maps + um `UnitOfWork` que aplica tudo-ou-nada e CAS por versão.
- `adapters/effects/fake-dispatchers.ts` — um `EffectDispatcher` fake por kind, com saídas **scriptáveis** (accepted/delivered/failed/outcome_uncertain) e a **matriz conservadora** de capability (`02 §6`).
- `tests/run-phase2.ts` — suíte nova (engine/outbox/reconciliação), **separada** de `tests/run.ts`.

**Alterar:** apenas `Brain/*` (este plano, `01-STATUS`, handoff) e, na implementação, `package.json` (script `test:phase2`). **Nenhum arquivo do kernel** (`src/engine/{state-reducer,policy-engine,decision-engine,finalizer,response-renderer,catalog-utils}.ts`, `src/domain/{decision,conversation-state,types,...}.ts`) é tocado.

## 2. Tabelas `v3_*` necessárias (já desenhadas em `02 §4`)

`v3_conversation_state` (snapshot+version/CAS) · `v3_state_history` · `v3_turn_events` · `v3_inbox` (dedupe por `INSERT ON CONFLICT` + claim) · `v3_leases` · `v3_query_log` · `v3_effect_outbox` (status/idempotency_key/order/depends_on/provider_capability/receipt_level/**outcome_applied_at**) · `v3_media_receipts` (receipt por foto) · `v3_decisions` · `v3_messages` (shadow = "would_send") · `v3_sensitive_vault` (CPF/segredo) · `v3_shadow_comparisons`.

→ Entregue como **`Brain/sql/v3_schema.sql` (PROPOSTA)** para o **dono rodar** no SQL editor. Nunca executado pelo agente; nunca `db push` (ADR-002/005). Isolamento total: só `v3_*`, v2 read-only.

## 3. Interfaces/adapters fake/in-memory primeiro

- Todos os **ports** (§1) → `InMemoryStore` (Maps + `UnitOfWork` com CAS de versão; `INSERT ON CONFLICT` simulado por `Set` de `event_id`).
- Todos os **EffectDispatchers** → fakes scriptáveis (sem rede). `EffectGate.enabled=false` por padrão (**shadow**): efeito vira `skipped`.
- `Clock`/`IdGen` → determinísticos (relógio fixo + contador) para replays reproduzíveis.
- O `TurnInterpreter`/`ClaimExtractor` (já em `adapters`) continuam fakes do kernel.
- Os adapters **reais** (Postgres, uazapi, CRM) são **stubs vazios** nesta fase (assinam o port, lançam "not enabled") — só ganham corpo na sub-fase autorizada.

## 4. Como manter tudo SEM I/O real inicialmente

- Hexagonal: o `ConversationEngine` depende só de **interfaces**; a escolha do adapter é injeção. Default = `InMemoryStore` + fake dispatchers.
- **Sem driver de Postgres, sem `fetch`, sem rede** em nenhum arquivo da Fase 2 (regressão por `rg "fetch|pg|postgres|http"` no `src`).
- `EffectGate` OFF (shadow) → o dispatcher nunca produz efeito externo; só registra `would_send`.
- A **sub-fase de adapters reais** (Postgres/uazapi/CRM) é separada, atrás dos mesmos ports, e **só começa com autorização explícita do dono** + o SQL aplicado por ele.

## 5. Testes adicionados antes de qualquer provider real (`tests/run-phase2.ts`)

Cobrir os cenários já no `05` (R2-1..R2-9, R3-1..R3-8), agora **end-to-end no engine in-memory**:
- ingestão atômica: 2 eventos mesmo `event_id` → 1 processa, 1 no_op.
- claim do burst: cutoff; msg nova durante processamento → próximo turno; lease no `finally`; recuperação pós-lease (2 workers, só 1 vence o CAS).
- commit atômico: estado+decisão+eventos+outbox numa "tx" (tudo-ou-nada); CAS de versão.
- outbox: ordem explícita (anúncio order=1 succeeded antes de handoff order=2); `dependsOn`.
- EffectOutcomeCommit: idempotente (mesmo `effectId` 2x = no-op); `succeeded`→aplica `onSuccess`; `failed`→não avança; **mídia parcial** (3/5) via `perItem`.
- reconciliação: `outcome_uncertain` por capability (none→alerta; idempotent→retry; queryable→consulta).
- `accepted` × `delivered`: estado grava `delivery_level='accepted'` quando o provider só aceita.
- shadow: `EffectGate` OFF → nenhum efeito; `v3_messages.mode='shadow'`.
- integração: 3–4 turnos encadeados ingest→commit→dispatch→outcome sem quebra de estado.

## 6. Como preservar os 67 testes verdes + tsc

- **Aditivo:** nada do kernel é alterado; `tests/run.ts` (67) fica intacto.
- `package.json`: novo script `test:phase2`; `test` segue rodando os 67. Gate: **ambos verdes** + `tsc --noEmit` limpo antes de cada handoff.
- A cada etapa: rodar `npm test` (67) **e** `npm run test:phase2`, e `tsc --noEmit`. Se algo do kernel precisar mudar, **paro e justifico antes** (regra do dono/Codex).

## Kernel — mudança de contrato?

**Nenhuma mudança breaking prevista.** O kernel já entrega `TurnDecision.effectPlan` (com `effectId`, `onSuccess`) e os tipos `EffectResult`/`EffectReceipt`/`ReceiptLevel`/`EffectOutcomeMutation` — a Fase 2 **consome** isso. Os tipos novos (`EffectIntent`/`EffectStatus`/`ProviderCapability`/records de persistência) entram em `domain/effect-intent.ts` (**aditivo**). Se algum ajuste no kernel se mostrar necessário, será proposto isoladamente **com justificativa, antes de implementar**.

## Sequência sugerida (cada passo = handoff + parada para auditoria)

1. **F2.0** — `ports.ts` + `effect-intent.ts` + `in-memory-store.ts` + testes de store (CAS, inbox ON CONFLICT, lease). [sem engine]
2. **F2.1** — `effect-materializer` + `conversation-engine` (ingest→claim→load→runTurn→commit atômico). Testes do ciclo.
3. **F2.2** — `outbox-dispatcher` + fake dispatchers + `effect-outcome-commit` (ordem, idempotência, mídia parcial). 
4. **F2.3** — `reconciler` (outcome_uncertain por capability) + accepted×delivered + shadow.
5. **F2.4** — `Brain/sql/v3_schema.sql` (PROPOSTA, entregue ao dono) + ADR de mapeamento port→tabela.
6. **F2.5 (gated)** — adapters reais (Postgres/uazapi/CRM) atrás dos ports — **só com autorização + SQL aplicado pelo dono**.

## Riscos / decisões que precisam do dono

- **Infra `v3_*`:** mesmo projeto Supabase (`seyljsqmhlopkcauhlor`) ou separado? (proposta: mesmo, isolado).
- **Matriz de capability real** dos providers (uazapi confirma `delivered` ou só `accepted`? CRM via RPC é idempotente?) — define a reconciliação da F2.3/F2.5.
- **Cofre de CPF** (`v3_sensitive_vault`): chave/algoritmo de criptografia (ADR-006).
- **Governança:** um executor por área — confirmar que o Codex não edita os mesmos arquivos em paralelo.
---

## Progresso executado em 2026-06-27

F2.0 a F2.5.1 foram implementadas e auditadas. Persistencia de turnos e outbox ja funciona por adapters Postgres atras dos ports, com schema e RPCs testados em PostgreSQL embutido. Providers reais continuam desligados. Proximo passo somente apos o patch remoto verde: F2.5.2, QueryTools/configuracao de tenant e prompt em shadow.
