# ADR-002 - Processamento atômico do turno com CAS (compare-and-swap)

- Status: **Proposto** (Fase 0).
- Data: 2026-06-26. Autor: Claude.
- Relacionado: contexto-mestre §9, §14; `02` §3, §4; POL-STATE-004, POL-TOOL-001.

## Contexto

No v2 o turno roda em **background** (`EdgeRuntime.waitUntil`) com debounce de até 45s. Se o isolate recicla ou um deploy acontece no meio, a tarefa **morre** → mensagem salva sem resposta (drop ~sistêmico). O remendo é o cron `pedro-recover-dropped`. Além disso, dois webhooks concorrentes podem criar **dois turnos** sobre o mesmo estado (anti-padrão §22). Não há controle de versão na escrita.

## Decisão

1. **Ingestão atômica = dedupe (CORREÇÃO Codex #1):** todo evento entra via `INSERT INTO v3_inbox (event_id,...) ON CONFLICT (event_id) DO NOTHING`. **O resultado do INSERT É o dedupe** — linha inserida = primeira vez (processa); conflito = já visto (no_op). Não há método `dedupe()` separado. Um processador pega o evento sob **lease** (`v3_leases`, `expires_at`).
2. **Lock por conversa**: `CoordinationStore.acquireLease(conversationId)` (Postgres agora; ADR-003). Dois eventos concorrentes da mesma conversa são serializados.
3. **Persistência CAS em transação única**: `UPDATE v3_conversation_state SET version=version+1, state=$new WHERE conversation_id=$id AND version=$expected`. Se 0 linhas afetadas → **conflito de versão** → reprocessa com estado fresco (não sobrescreve cego).
4. **Transactional outbox (CORREÇÃO Codex #3):** na **mesma transação** do CAS, grava `v3_turn_events` + `v3_decisions` + `v3_state_history` **+ os EffectIntents em `v3_effect_outbox` (status `pending`)**. Estado, decisão, eventos e intenções de efeito são consistentes ou nada é gravado.
5. **Efeitos NÃO rodam na decisão.** Um `OutboxDispatcher` separado executa os efeitos `pending` DEPOIS do commit, com `idempotency_key`, gravando `provider_receipt`, com **retry seguro** e **ordem explícita** (`order`/`depends_on` → ex.: mensagem de anúncio entregue ANTES do handoff). Em shadow, EffectGate OFF → efeitos viram `skipped`.
6. **At-least-once + effectively-once condicional (Codex r1 #9, r2 #5):** o processamento pode repetir. Não prometemos "exactly once" no processamento. `effectively-once` é **propriedade do par (efeito, provider)**, não da chave local: status do outbox = `pending/processing/succeeded/failed/outcome_uncertain/skipped`; em `outcome_uncertain` (timeout após possível aceite) a reconciliação segue a `provider_capability` — `idempotent`→retry com mesma chave; `queryable`→consulta status/receipt; `none`→**revisão/alerta** (nunca reenvia cego).
7. **Materialização tardia (Codex r2 #2):** o payload do efeito é materializado **só após** `compose`+`validate`. Se a validação de grounding falha → fallback determinístico validado ou **aborta** (evento de erro) — **nada inválido é persistido no outbox nem enviado**.
8. **Outcome só com receipt (Codex r2 #1):** o reducer aplica `EffectOutcomeMutation` (foto `sent`, pergunta `asked`, handoff `completed`) **apenas** com o receipt real do efeito — nunca no commit da decisão.
9. **Claim do inbox + recuperação (Codex r2 #7):** o burst é o conjunto EXATO de `eventIds` com `received_at <= cutoff` no momento do claim (`status='claimed'`, `claimed_by`, `turn_id`, `attempts`, `next_retry_at`); mensagens que chegam depois ficam para o próximo turno; lease renovado durante o turno e **liberado no `finally`**; claim com lease expirado volta a ser elegível e o CAS de versão garante que só um turno vença.

## Consequências

- (+) Elimina a classe de drop do v2 sem depender de cron-remendo (o recuperador vira propriedade do design).
- (+) Sem turnos duplicados; concorrência segura; replay íntegro.
- (−) Exige um loop de processamento (poll do inbox ou trigger) — definir no Kernel/Fase 2.
- (−) CAS pode gerar reprocesso sob alta contention — aceitável; medível.

## Alternativas consideradas

- **`waitUntil` + recover-dropped (v2):** rejeitado como arquitetura — é remendo; mantido só como referência de caso.
- **Fila externa (SQS/PgQueue dedicada):** possível no futuro; para Fase 0–4, `v3_inbox` em Postgres basta e mantém isolamento.
- **Advisory locks do Postgres** em vez de tabela `v3_leases`: avaliar na implementação; a interface `CoordinationStore` permite trocar sem mudar o engine.
