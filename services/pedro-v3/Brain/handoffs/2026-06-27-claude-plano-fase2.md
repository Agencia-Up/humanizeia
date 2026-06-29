# Handoff — 2026-06-27 — Claude → Codex (auditoria do PLANO da Fase 2)

## 1. Objetivo

Retomar após o Antigravity/Codex (Fase 1.5.1 aprovada) e **planejar a Fase 2** — sem implementar I/O. Conforme a diretiva do Codex: entregar primeiro um **plano curto**.

## 2. O que foi feito

- Reli: `01-STATUS`, `02-CONTRATOS`, `05-PLANO-DE-TESTES`, `06-ERROS-E-LICOES`, handoff `codex-fase1.5.1`, e o contrato vigente `Agent/src/domain/decision.ts`.
- Reconfirmei o baseline: `npx tsx tests/run.ts` → **67 OK | 0 FALHA**; `tsc --noEmit` limpo.
- **Não toquei no kernel** nem em `tests/run.ts`.
- Entreguei **`Brain/07-PLANO-FASE-2.md`** (plano curto, 6 pontos) + atualizei `01-STATUS`.

## 3. Resumo do plano (detalhe em 07)

- **Arquitetura:** ports & adapters (hexagonal). Tudo nasce **fake/in-memory**; nenhum provider real, banco ou migration. O `ConversationEngine` orquestra o ciclo `02 §3` sobre interfaces; default = `InMemoryStore` + fake dispatchers; `EffectGate` OFF (shadow).
- **Arquivos novos (aditivos):** `domain/ports.ts`, `domain/effect-intent.ts`, `engine/{conversation-engine, effect-materializer, outbox-dispatcher, effect-outcome-commit, reconciler}.ts`, `adapters/persistence/in-memory-store.ts`, `adapters/effects/fake-dispatchers.ts`, `tests/run-phase2.ts`.
- **Tabelas `v3_*`:** as de `02 §4`; entregues como `Brain/sql/v3_schema.sql` PROPOSTA p/ o dono rodar (nunca executadas).
- **Testes:** R2-1..R2-9 / R3-1..R3-8 do `05`, agora end-to-end no engine in-memory (ingestão atômica, claim/cutoff/lease, commit CAS, ordem/dependsOn do outbox, EffectOutcomeCommit idempotente, mídia parcial, reconciliação por capability, accepted×delivered, shadow).
- **Sequência:** F2.0 stores → F2.1 engine/commit → F2.2 outbox/dispatch → F2.3 reconciliação/shadow → F2.4 SQL proposto → **F2.5 adapters reais (gated, só com autorização)**.

## 4. Contrato do kernel

**Sem mudança breaking prevista.** A Fase 2 consome `TurnDecision.effectPlan` + `EffectResult`/`EffectReceipt`/`ReceiptLevel`/`EffectOutcomeMutation` já existentes. Tipos novos (`EffectIntent`/`EffectStatus`/`ProviderCapability`/records) ficam em `domain/effect-intent.ts` (aditivo). Qualquer ajuste no kernel será proposto isoladamente **com justificativa, antes de implementar**.

## 5/6/7/8. Testes / riscos / banco / deploy

Nenhum teste novo ainda (etapa de plano). Sem banco/migration/deploy. v2 intacto (read-only). Riscos/decisões do dono: infra `v3_*` (projeto único?), matriz real de capability dos providers, cofre+chave de CPF, governança (um executor por área).

## 9. Próximo passo exato

1. **Codex audita o plano** (07) + dono autoriza a F2.0.
2. Aprovado → implementar **F2.0** (ports + effect-intent + in-memory-store + testes de store), mantendo os 67 verdes e `tsc` limpo, e parar para auditoria.

## 10. Regras seguidas

Sem deploy, sem escrever no banco, sem mexer no v2, sem quebrar o kernel. Brain atualizado. Parado para auditoria.

---

**Parado para auditoria do plano da Fase 2.** Ordem de leitura: `00`→`01`→`02`→`05`→`06`→`07`→`decisions/*`.
