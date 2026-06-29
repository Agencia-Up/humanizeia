# Handoff — 2026-06-26 — Claude → Codex (auditoria rodada 3) — Fase 0 correções r2

## 1. Objetivo

Incorporar as **10 correções** da auditoria Codex (rodada 2), que reconheceu progresso real mas **não autorizou o Kernel**. Trabalho 100% no `Brain`.

## 2. Correções aplicadas (todas)

| # | Correção | Onde |
|---|---|---|
| 1 | DecisionMutation (commit) × EffectOutcomeMutation (após receipt) — nada de sent/asked/completed sem confirmação | `02` §2.6; `04` POL-STATE-007; ADR-002 §8 |
| 2 | EffectPlan sem payload; decisão→compose→validate→materialize→commit; validate falha → fallback/aborta | `02` §2.5/§3; `04` POL-STATE-008 |
| 3 | PolicyEngine recebe QueryResults em 3 fases (pré/pós-query + grounding); não escolhe ação | `02` §2.7 |
| 4 | Bounded read-only query loop (`proposeNextQueryOrFinal` + limites + saída segura) | `02` §2.5/§3 |
| 5 | effectively-once por capacidade do provider + `outcome_uncertain` + reconciliação | `02` §4/§6; ADR-002 §6 |
| 6 | Contratos tipados (ProposedDecision, QueryInput/OutputMap, EffectPayloadMap, mutation por slot, EventPayloadMap); `unknown` removido | `02` §2.4–2.8 |
| 7 | Claim do inbox detalhado (eventIds/cutoff/claimed_by/turn_id/attempts/next_retry_at/finally/recuperação/msgs novas→próximo turno) | `02` §9; ADR-002 §9 |
| 8 | Refs antigas corrigidas (StatePatch, accept/reject/rewrite, uazapiSender.ts morto) | `02`,`03`,`04`,ADR-001 |
| 9 | ADR-005 por fase (F0–F3 sem efeito; F4 canary escreve CRM/handoff/WhatsApp do agente de teste, sem reusar estado interno do v2) | ADR-005 |
| 10 | 9 cenários de teste novos | `05` §3 |

## 3. Decisões de design que vale destacar

- **Autoridade única reforçada:** loop de queries (limitado por `preQuery.allowedTools`) → `postQuery` (valida vs fatos) → `Finalizer` (emite a única `TurnDecision`) → compose → `validateResponse`. Política em nenhum momento "escolhe ação".
- **Estado vs efeito desacoplados no tempo:** o commit grava só FATOS; o ledger de foto/`asked`/`completed` só avança quando o outbox confirma o receipt. Isso mata por design o "marcou enviado e não enviou".
- **Incerteza tratada como estado de primeira classe** (`outcome_uncertain` + capability), não como retry cego.

## 4. Verificação

Grep no `Brain` confirma: sem `StatePatch`/`accept-reject-rewrite`/`RedactedPayload` nos meus docs; único `queryPlan` restante é a frase "nada de queryPlan estático". O esboço `statePatch` em `00` (doc do dono) foi deixado intacto — `02` é a fonte autoritativa (anotado no `01`).

## 5/6/7/8. Testes / riscos / deploy / commit

Nenhum teste (documental). v2 intacto (read-only). Sem migration/banco/deploy/commit. Riscos abertos: confirmar capacidade de reconciliação de cada provider (uazapi/CRM) antes da Fase 2; `JsonValue`/tipos auxiliares (VehicleFact, MatchDiag, CrmWritableFields, EffectReceipt) a materializar no Kernel.

## 9. Próximo passo exato

1. **Codex audita rodada 3** (os 10 pontos + consistência dos contratos tipados).
2. Aprovado → Fase 1 Kernel puro em `Agent/` (sem I/O), a partir dos contratos APROVADOS.

## 10. Dúvidas abertas

Ver `01-STATUS-ATUAL.md`: projeto Supabase único vs separado; governança Codex×Claude; cofre+chave de CPF; tenants com CPF; matriz de capacidade de provider p/ reconciliação.

---

**Parado para auditoria (rodada 3).** Ordem de leitura: `00`→`01`→`02`→`03`→`04`→`05`→`06`→`decisions/*`. Não escrever código antes da aprovação dos contratos.
