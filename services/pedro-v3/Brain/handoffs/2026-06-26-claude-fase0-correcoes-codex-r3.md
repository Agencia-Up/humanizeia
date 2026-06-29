# Handoff — 2026-06-26 — Claude → Codex (verificação final) — Fase 0 correções r3

## 1. Objetivo

Aplicar a **última rodada** de correções da auditoria Codex (rodada 3) — arquitetura quase aprovada. Só `Brain`.

## 2. Correções aplicadas (9 + matriz)

| # | Correção | Onde |
|---|---|---|
| 1 | Planejado × entregue: `PlannedObjective`(effectId) vs `currentObjective`(receipt); offer/foco/stage/handoff/fala-agente = EffectOutcomeMutation; nada visto sem receipt | `02` §2.1/2.2/2.6; POL-STATE-009 |
| 2 | EffectOutcomeCommit atômico+idempotente (`outcome_applied_at`, CAS, recupera) | `02` §3/4/6; POL-STATE-010 |
| 3 | accepted ≠ delivered (`ReceiptLevel`) | `02` §6; POL-STATE-013 |
| 4 | EffectPlan = união semântica (6 planos); payload do provider materializado depois | `02` §2.5 |
| 5 | Mídia parcial: receipt por foto; ledger só p/ confirmados (`v3_media_receipts`) | `02` §2.5/4/6; POL-STATE-009 |
| 6 | Loop por chamada: `QueryCall` mapped union + `authorizeQuery` | `02` §2.5/2.7/3; POL-STATE-011 |
| 7 | Limite de revalidação/reprocesso → safe/alerta/dead-letter | `02` §3; POL-STATE-012 |
| 8 | Limpeza: `00` alinhado (02=contrato, 00=visão); `RedactedPayload`→`Redacted<T>`; effectively-once não-incondicional | `00`,`02`,`04`,ADR-006 |
| 9 | +8 testes (R3-1..R3-8) | `05` §3 |
| Matriz | uazapi=none · CRM Supabase=idempotent(RPC/tx) · handoff=efeitos separados · agenda=idempotente só com chave única | `02` §6 |

## 3. Invariante central reforçado nesta rodada

**Tempo do estado:** o commit da decisão grava só FATOS DO INBOUND (o que o LEAD disse). Tudo que afirma que o LEAD viu/recebeu algo (pergunta ativa, oferta vista, foco apresentado, stage avançado, handoff completo, fala do agente) só entra no estado via **EffectOutcomeCommit** (tx própria, atômica, idempotente por `effectId`) APÓS o receipt real — com o nível correto (`accepted`/`delivered`). Isso fecha por design a brecha "marcou que mostrou/perguntou e não enviou".

## 4. Limpeza documental (Codex #8)

`00` alinhado: o esboço de `TurnDecision` agora reflete `decisionMutations`/`effectPlan`/`PolicyVerdict` e aponta que `02` é autoritativo. Sem `RedactedPayload`/`StatePatch`/`PolicyCheckResult`/`toolCall` nos contratos (grep confirma; restam só menções históricas nos handoffs antigos e comentários "substitui o preQuery").

## 5/6/7/8. Testes / riscos / deploy / commit

Nenhum teste (documental). v2 intacto (read-only). Sem migration/banco/deploy/commit. Risco aberto: a **matriz de providers** é conservadora e precisa de validação técnica na Fase 2 (uazapi confirma entrega? CRM RPC é idempotente de fato?). Tipos auxiliares (VehicleFact, MatchDiag, CrmWritableFields, EffectReceipt, AnswerKind, ObjectiveType) a materializar no Kernel.

## 9. Próximo passo exato

1. **Codex faz a verificação final curta.**
2. Aprovado → Fase 1 Kernel puro em `Agent/` (sem I/O), a partir dos contratos APROVADOS.

## 10. Dúvidas abertas

Ver `01-STATUS-ATUAL.md`: projeto Supabase único vs separado; governança Codex×Claude; cofre+chave de CPF; validação técnica da matriz de capacidade de providers.

---

**Parado para a verificação final do Codex.** Ordem de leitura: `00`→`01`→`02`→`03`→`04`→`05`→`06`→`decisions/*`. Não escrever código antes da aprovação.
