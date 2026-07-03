# R13-S1 — Agente central em shadow com memória e ferramentas (Claude executor) — 2026-07-03

> A partir do commit `05b5339e` (main). Trabalho da R12-B PRESERVADO (working tree intacto). NÃO commitado,
> NÃO deployado. Sem SQL, sem tocar Pedro v2/bridge/webhook, sem alterar o caminho ativo do piloto.
> Segue Brain/11 (autoritativo) + 02 (contratos) + 04 (invariantes).

## Decisão de escopo (honesta)
R13-S1 é uma fatia VERTICAL grande com um gate duro (replay P0 com LLM real). Fazer engine+memória+tools+cérebro
real+suíte+replay tudo correto E validado num único passo produziria entrega esparsa e sub-testada — o que o
próprio §9 do Brain/11 proíbe ("não declarar concluído só por test:all verde"). Executei na ordem do plano
(§7: **R13-A = contratos + caminho shadow primeiro**), entregando o **increment 1 provado offline** e deixando o
**increment 2 (engine runtime + real replay P0)** com desenho preciso, SEM alegar que roda ou que o replay passou.

## Increment 1 — ENTREGUE e PROVADO offline (determinístico, $0)
### Diagrama do fluxo central (alvo do increment 2; contratos deste increment)
```
bloco do lead + prompt do portal + WorkingMemory + transcript + signals(regex, só evidência)
                         v
                 TurnFrame  ──►  AgentBrainPort.proposeNextStep(frame, traces)
                         │                    │
                         │        kind:"query" (QueryCall) — autorizada por chamada (POL-STATE-011)
                         │                    │  tool devolve FATO tipado (nunca fala com o lead)
                         │        kind:"final" (AgentBrainDecision) ◄── loop limitado (maxSteps/timeout)
                         v
        compose+render (reusa ResponseRenderer) ► validateResponse (reusa PolicyEngine — só valida)
                         v
        reducer WorkingMemory (applyWorkingMemoryMutations) + reducer de estado existente
                         v
        materializeEffects — EffectGate OFF (shadow): send_message/send_media viram 'skipped'
```

### Arquivos NOVOS (aditivos)
- `src/domain/agent-brain.ts` — CONTRATOS tipados:
  - `WorkingMemoryV1` (schemaVersion, activeTopic, currentLeadIntent, unansweredLeadQuestions[], selectedVehicle,
    lastOffer, **lastPhotoAction (accepted-safe: vehicleKey/label/photoIds/effectId/acceptedAt)**, lastToolResults[],
    funnel{known/declined/deferred/suggestedObjective}, commitments[], conversationSummary, lastAgentAction,
    lastAnsweredLeadQuestion).
  - `WorkingMemoryMutation` (DISCRIMINADA, 15 ops) — a LLM propõe, o reducer é a única autoridade de escrita.
  - `TurnFrame` (block, portalPromptSha256, workingMemory, recentTranscript, `FrameSignals` = regex só como
    evidência auxiliar, nunca decide).
  - `AgentBrainPort` (`proposeNextStep`), `AgentBrainStep` (query|final), `AgentBrainDecision`
    (responsePlan+proposedEffects+memoryMutations+reason), `ToolTrace` (sanitizado).
- `src/engine/working-memory.ts` — reducer PURO: `createInitialWorkingMemory`, `loadWorkingMemory` (defaults/
  migração retrocompatível de estado antigo/parcial/ausente — nunca joga fora conversa), `applyWorkingMemoryMutations`
  (rejeita mutação inválida sem corromper; `lastPhotoAction` só via `mark_photo_action_accepted` accepted-safe),
  seletores `recallLastPhotoLabel`/`hasUnansweredInstitutional`.
- `tests/run-f2-12-working-memory.ts` (`test:f212`) — **24 OK**: inicial; migração de estado antigo/tipos errados;
  accepted-safe + recall "Nissan Kicks 2018"; rejeição de mutação inválida (não corrompe); dedup/resolve de
  perguntas; funnel merge; commitments; **replay determinístico** (mesmas mutações→mesmo estado); idempotência
  `load(dump(wm))==wm`; teto de lastToolResults.

### Gates offline (VERDES)
- `tsc --noEmit` → EXIT 0. `npm run test:all` → EXIT 0, 0 FALHA (F2.12=24 novo; R12-B e anteriores intactos).

## Increment 2 — PLANO PRECISO (NÃO implementado nesta rodada; é o gate real)
1. `src/engine/tenant-business-info-tool.ts` — QueryTool `tenant_business_info` (topic: address|hours|unit) lendo a
   fonte REAL do tenant (prompt/config/knowledge existente via `TenantRuntimeConfig`/knowledge). Sem fonte →
   resposta honesta ("vou confirmar"); NUNCA inventa endereço. Estender o QueryRunner (`createReadQueryRunner`).
2. `src/engine/turn-frame-builder.ts` — monta `TurnFrame` (bloco + prompt sha + WorkingMemory + transcript +
   signals por léxico). Signals só enriquecem; a ação é do cérebro.
3. `src/adapters/llm/fake-agent-brain.ts` — `AgentBrainPort` determinístico (scripts) p/ os testes offline §8.1.
4. `src/adapters/llm/openai-agent-brain.ts` — `AgentBrainPort` REAL reusando `PromptBoundConversationAdapter`+
   transport com prova de SHA (real-harness já tem tudo: CountingModelHttpTransport, RetryingModelHttpTransport).
5. `src/engine/central-engine.ts` — `runCentralConversationTurn` (flag `PEDRO_V3_BRAIN_MODE=central_shadow`,
   default OFF): frame → loop de tools (autorização por chamada, reusa `PolicyEngine.authorizeQuery` + QueryRunner)
   → 1 `AgentBrainDecision` → compose/render/validate (reusa) → reducers (WorkingMemory + estado) →
   materialize com EffectGate OFF. lastPhotoAction gravada só no receipt 'accepted' do send_media.
6. `tests/run-f2-13-central-shadow.ts` — §8.1: tool loop limitado; ferramenta proibida nunca executa; pergunta
   simples sem ferramenta; estoque só quando necessário; recall de foto sem send_media; pedido real de foto propõe
   send_media (dispatch OFF); pergunta da loja usa tenant_business_info; replay após restart; nenhuma tool fala com
   o lead; exatamente UMA decisão final comercial.
7. `eval/central-real-harness.ts` + `eval/run-central-eval.ts` + `npm run eval:central:real` — replay P0 do telefone
   85988323679 (10 turnos) + 3 conversas 15+ turnos, com gpt-4.1-mini real, efeitos OFF, 2 execuções/cenário,
   prova de modelo+SHA, retry/backoff 429. **Gate = as asserções determinísticas do §8.3** (Kicks nos T7/T8, zero
   reenvio de foto, endereço factual T9/T10, possuiTroca unknown, zero terminal_safe/U+FFFD/erro de veículo, ≤1
   pergunta, nenhuma tool desnecessária). Judge só diagnóstico.

## Riscos / honestidade
- **O replay P0 real ainda NÃO foi executado** — é o gate obrigatório e é increment 2. Não há alegação de sucesso.
- O `runTurn` atual já tem o loop de tools com autoridade central; o increment 2 reusa isso, mas **desviar do
  handler-chain** (photo/ranking/explicit/moreOptions/continuity) para o cérebro é o passo delicado — deve ser
  flag-gated e comparado lado-a-lado (v3 atual × central shadow) antes de qualquer ativação (R13-D, só após Codex).
- lastPhotoAction accepted-safe depende do receipt 'accepted' do send_media — o harness de eval já simula accepted;
  em produção o uazapi é capability 'none' (accepted, não delivered), então o recall funciona sem afirmar entrega.

## Recomendação (increment 1 v1 — histórico)
Fundação enviada para auditoria. **REPROVADA pelo Codex (4 P0 + 2 P1) — ver revisão abaixo.**

---

## REVISÃO pós-auditoria Codex (4 P0 + 2 P1) — 2026-07-03
Corrigi os CONTRATOS (sem construir engine/adapter/tool/replay). Gates: `tsc` EXIT 0, `test:all` EXIT 0,
**`run-f2-12` 40 OK** (todos os testes obrigatórios da auditoria).

- **P0-1 autoridade temporal:** `DecisionWorkingMemoryMutation` (commit) × `EffectOutcomeWorkingMemoryMutation`
  (só receipt). `mark_photo_action_accepted` SÓ na 2ª, carrega `effectId`, aplicada só por `applyEffectOutcomeToWorkingMemory`.
  `AgentBrainDecision.memoryMutations` é `DecisionWorkingMemoryMutation[]` (não propõe outcome). failed/outcome_uncertain
  não atualizam; accepted idempotente; delivered posterior no-op; mismatch de effectId rejeita atomicamente.
- **P0-2 efeitos:** `AgentBrainDecision.proposedEffects: ProposedEffectPlan[]` (sem effectId). Finalizer materializa
  `${turnId}:${planId}`; forjado ignorado (testado).
- **P0-3 observação factual:** `ToolTelemetry` (sanitizada) SEPARADA de `AgentToolObservation` (união por tool, ligada
  ao `QueryOutputMap`; `tenant_business_info` local até inc2). PII (nome CRM) só na observação transitória; telemetria/
  memória (só `summary`) sem PII.
- **P0-4 fonte única:** `funnel`/`selectedVehicle`/`lastOffer` = VIEW derivada read-only do ConversationState
  (`deriveCanonicalViews`), recomputada a cada load (stale ignorado). Removidos `update_funnel`/`set_selected_vehicle`/
  `set_last_offer`. `PersistedWorkingMemory` (só o WM-owned) vive no MESMO state JSONB / mesmo CAS.
- **P0-5 hardening:** validadores runtime (sem cast); loader fail-closed por campo + diagnóstico; `turnId` validado;
  known XOR declined (derivação); rejeição ATÔMICA do lote.
- **P1-6 IDs estáveis:** `UnansweredQuestion`/`Commitment` com id + createdTurnId/resolvedTurnId/status; resolve/update por ID.

### MATRIZ DE PROPRIEDADE CANÔNICA (autoridade gravável ÚNICA por campo)
| Campo | Autoridade gravável ÚNICA | Entra na WorkingMemory como | Mutação |
|---|---|---|---|
| funnel (slots known/declined/deferred/suggestedObjective) | `ConversationState.slots` + `currentObjective` | VIEW derivada read-only | — |
| selectedVehicle | `ConversationState.vehicleContext.selected` | VIEW derivada read-only | — |
| lastOffer | `ConversationState.lastRenderedOfferContext` | VIEW derivada read-only | — |
| photoLedger (delivered/read) | `ConversationState.photoLedger` (canônico existente) | não está na WM | — |
| activeTopic, currentLeadIntent, unansweredLeadQuestions, lastToolResults, commitments, conversationSummary, lastAgentAction, lastAnsweredLeadQuestion | **WorkingMemory** (no state JSONB) | reduzida no COMMIT (CAS do turno) | `DecisionWorkingMemoryMutation` |
| lastPhotoAction (accepted-safe) | **WorkingMemory** (no state JSONB) | reduzida no EffectOutcomeCommit (receipt accepted, CAS+idempotente) | `EffectOutcomeWorkingMemoryMutation` |

Regra: nunca duas autoridades graváveis. Views recomputadas a cada load → ConversationState e WorkingMemory não
divergem em funnel/oferta/foco (testado). Arquivos reescritos: `agent-brain.ts`, `working-memory.ts`, `run-f2-12`.

### Resultados reais
`npm run test:f212` → **40 OK | 0 FALHA** · `npm run test:all` → EXIT 0, 0 FALHA · `npx tsc --noEmit` → EXIT 0.

**Recomendação:** fundação revisada **PODE ir para nova auditoria Codex**. NÃO é a fase concluída — o gate segue
sendo o replay P0 real (increment 2, NÃO iniciado). Sem commit/push/deploy/SQL. Parado para auditoria.
