# Handoff — 2026-06-26 — Claude → Codex (auditoria do Kernel) — Fase 1

## 1. Objetivo

Fase 0 aprovada. Aplicar as **5 refinações finais de contrato** e implementar o **Kernel puro** (sem I/O) com testes L1+L4.

## 2. Refinações de contrato (Brain/02)

1. Terminal SAFE_RESPONSE **cancela EffectPlans comerciais** (só send_message seguro + alerta/dead-letter) — §3.
2. EffectPlan carrega **`onSuccess: EffectOutcomeMutation[]`** (outcomes semânticos no outbox, aplicados após receipt) — §2.5.
3. **effectId determinístico** `${turnId}:${planId}` — §2.5.
4. **`EffectResult` discriminado** (succeeded/failed/outcome_uncertain) no `applyEffectOutcome` — §2.6.
5. effectively-once **condicional ao provider** nas frases residuais — §3/§4 + `03`/`05`.

## 3. Kernel implementado (`Agent/src`, `Agent/tests`)

- `domain/`: `types.ts`, `context.ts`, `llm.ts`, `conversation-state.ts` (estado versionado; `PlannedObjective`×`PendingObjective`; `appliedEffectIds`), `decision.ts` (TurnDecision, EffectPlan união semântica, DecisionMutation/EffectOutcomeMutation, EffectResult, QueryCall mapped union).
- `engine/`: `state-reducer.ts`, `policy-engine.ts`, `decision-engine.ts` (bounded loop + terminal SAFE), `finalizer.ts`.
- `adapters/llm/fake-llm.ts` (determinístico, provider-agnostic).
- `tests/run.ts` (harness $0).

**Invariantes provados no código:** uma decisão final por turno; política não decide (só Finalizer emite); estado ENTREGUE só avança com receipt; idempotência por effectId; mídia parcial; query autorizada por chamada; terminal seguro sem loop/silêncio.

## 4. Testes

`cd Agent && npx tsx tests/run.ts` → **23 OK | 0 FALHA** (L1: 17 unit · L4: 6 multiturno). Sem rede, sem I/O.

## 5/6/7/8. Riscos / deploy / banco / commit

Nenhum I/O, deploy, migration ou banco. v2 intacto (read-only). Risco aberto: tipos auxiliares deixados como referência (alguns campos de fato/CRM são simplificados no Kernel); o engine ainda não tem o `ConversationEngine` completo (inbox/lease/outbox/commit CAS) — isso é Fase 2 (precisa de I/O e autorização). O `compose` real e o `Interpreter` são fakes no Kernel.

## 9. Próximo passo exato

1. **Codex audita o Kernel** (contratos↔código, invariantes, cobertura L1/L4, autoridade única).
2. Aprovado → Fase 2 (Tools por adaptadores + I/O do outbox/estado), só com autorização explícita + SQL `v3_*` entregue ao dono.

## 10. Dúvidas abertas

`01-STATUS`: infra `v3_*` (mesmo projeto?), governança Codex×Claude, cofre+chave de CPF, validação técnica da matriz de capacidade de providers (define a reconciliação real da Fase 2).

---

**Parado para auditoria do Kernel.** Para rodar: `cd "Refatorar - Pedro v3/Agent" && npx tsx tests/run.ts`. Não avançar pra I/O sem aprovação.
