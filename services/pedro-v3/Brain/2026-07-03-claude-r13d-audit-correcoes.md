# R13-D.1 — Correções da auditoria Codex — Claude executor — 2026-07-03

> Resposta à AUDITORIA CODEX R13-D.1. **Sem SQL/deploy/push executado. Sem OpenAI (só testes grátis).** SQL corrigido
> entregue; parar para nova auditoria. Complementa `Brain/2026-07-03-claude-r13d-piloto-central.md`.

## 1. Allowlist + teste estrutural
- `v3_commit_working_memory_outcome` adicionada à `RPC_ALLOWLIST` do `supabase-service-gateway.ts`.
- `run-gateway-filter.ts`: a RPC entrou no loop que prova "chega no transport" — o teste **FALHA se a entrada for
  removida** (regressão). `GATEWAY FILTER: 11 OK`.

## 2. RPC redesenhada (`v3_commit_working_memory_outcome`) — patch + `v3_schema.sql` canônico
- Removido `p_next_state`; agora recebe **somente `p_next_working_memory jsonb`** (a WorkingMemory).
- Carrega o estado ATUAL no banco; valida tenant + conversation + `kind=send_media` + `status=succeeded` +
  `receipt_level in (accepted,delivered)`.
- Atualiza SOMENTE `state.workingMemory`, `state.appliedAcceptedEffectIds` (append server-side), `version`,
  `updatedAt` — **preserva byte-a-byte** todos os demais campos (jsonb_set pontual; sem re-set de envelope).
- **Idempotente**: `effect_id` já em `appliedAcceptedEffectIds` -> **NO-OP** (applied=false). Conflito de versão ->
  applied=false (o app recarrega). `DROP FUNCTION IF EXISTS` antes do `CREATE` (troca limpa do nome do parâmetro).
- Arquivos: `Brain/sql/v3_r13d_wm_outcome_patch.sql` (manual, NÃO executado) + bloco idêntico anexado ao
  `Brain/sql/v3_schema.sql` (instalações novas). **Provado em PGlite** (`test:sql`): conflito de versão, aplica
  accepted, **byte-preserve (slots/preservedMarker intactos + WM atualizada + append server-side)**, duplicado NO-OP,
  rejeita send_media sem receipt, kind-guard (send_message), cross-tenant.

## 3. Adapter envia só a WorkingMemory + fail-closed
- Porta `WorkingMemoryOutcomeStore.commitWorkingMemoryOutcome(conversationId, effectId, expectedVersion,
  **nextWorkingMemory: PersistedWorkingMemory**, at)`. Postgres envia `p_next_working_memory` (nunca state completo);
  InMemory carrega o estado atual e atualiza só as 4 chaves (mesma semântica da RPC).
- `applyAcceptedPhotoActionOutcome` envia `red.next` (a WorkingMemory), **fail-closed** se o adapter não expõe a
  capability (nunca cai num casState de estado completo). Resposta da RPC validada fail-closed (applied ausente ->
  erro). `POSTGRES ADAPTER: 27 OK` (incl. "envia SÓ WorkingMemory, p_next_state ausente" + "fail-closed em resposta inválida").

## 4. Dispatcher: não ignora o resultado + reconciliação durável
- O `OutboxDispatcher` **captura** o resultado de `applyAcceptedPhotoActionOutcome`; em falha, loga
  `pedro_v3_wm_promotion_failed` (sanitizado) e **NÃO reenvia a mídia** (já despachada) — deixa o rastro DURÁVEL.
- Rastro durável = `send_media` `succeeded` cujo `effectId` não está em `appliedAcceptedEffectIds` e tem
  `pendingPhotoAction`. Novo `reconcileAcceptedPhotoOutcomes(persistence, conversationId)` retoma (idempotente, **sem
  redispatch** — só escrita de WorkingMemory). Um scheduler/poller pode chamar; sobrevive a restart (rastro no estado).
- **Provado** (`test:f213` [E6]): falha transitória da promoção -> mídia NÃO reenviada + WM não avança; **restart**
  (nova persistence, mesmo backing) + reconcile promove a WM (Honda CRV 2010) **SEM 2º dispatch**; reconcile idempotente.

## 5. Gate conversacional OFFLINE (a-f) — sem OpenAI (`test:gate-offline`, 7 OK)
Engine central REAL + AgentBrain SCRIPTADO (decisões de um bom cérebro) + FakeLlm compose. Exige:
- **(a)** "SUV até 90 mil" respondido com OFERTA aterrada, sem pergunta de funil (nome) antes;
- **(b)** "o primeiro" resolve o 1º item da última oferta — **resolução DETERMINÍSTICA do engine** (novo:
  `resolveSelectedVehicle` exportado e ligado ao central-engine; só ordinal/modelo contra a última oferta, grounded,
  SEM inferência booleana -> não reintroduz o bug de possuiTroca);
- **(c)** "gostei" não devolve "você gostou?";
- **(d)** nome CONHECIDO não é reperguntado (POL-QUESTION-OBJECTIVE bloqueia mesmo o cérebro tentando);
- **(e)** visita + "sábado de manhã" avança o agendamento (interesseVisita + diaHorario known);
- **(f)** nenhuma fixação: nenhum slot perguntado em 3 turnos consecutivos.
- **O smoke pago NÃO é o gate.** ESTE gate offline determinístico é. A qualidade das decisões do cérebro REAL será
  validada pelo dono no WhatsApp após deploy auditado.

## 6. Gates (só grátis)
`npx tsc --noEmit` EXIT 0 · `npm run test:all` EXIT 0 (0 RED/erro): KERNEL 68, POSTGRES 27, GATEWAY 11, F2.13 40,
SHADOW 10, **GATE OFFLINE 7**, SQL SCHEMA/PGlite (checks R13-D WM), etc. Sem OpenAI, sem SQL/deploy/push.

## Arquivos alterados nesta rodada
`supabase-service-gateway.ts` (allowlist), `Brain/sql/v3_r13d_wm_outcome_patch.sql` + `v3_schema.sql` (RPC WM-only),
`ports.ts` + `in-memory-store.ts` + `postgres-store.ts` (assinatura WM-only), `central-engine.ts`
(applyAccepted WM-only + `reconcileAcceptedPhotoOutcomes` + `resolveSelectedVehicle`), `outbox-dispatcher.ts`
(captura resultado + log durável), `lead-extraction.ts` (export resolveSelectedVehicle). Testes:
`run-gateway-filter.ts`, `run-sql-schema.ts`, `run-postgres-adapter.ts`, `run-f2-13-central-shadow.ts` (+[E6]),
`run-central-gate-offline.ts` (novo) + `package.json`.

**Parado para nova auditoria Codex.** Sem commit/push/deploy/SQL executado.
