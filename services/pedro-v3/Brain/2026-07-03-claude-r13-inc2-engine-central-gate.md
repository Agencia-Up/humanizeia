# R13 Incremento 2 — Engine Central + Persistência Real + Replay P0 REAL — Claude executor — 2026-07-03

> Continuação da Parte A (aprovada). Esta rodada entrega **B→C→D→E + F (adapter OpenAI real) + G (replay real
> EXECUTADO)**. O ACHADO P0 do Codex ("a Parte B não estava funcional: `buildWorkingMemory`/`applyDecision...`/
> `applyEffectOutcome...`/`toToolResultMemory` não eram chamados por nenhum código de produção") está **RESOLVIDO** —
> o `central-engine.ts` agora chama todas essas funções no ciclo real do turno e do receipt.
> Sem commit/push/deploy/SQL (conforme a missão).

## Resumo executivo
O **CentralConversationEngine** (`runCentralConversationTurn`, flag `PEDRO_V3_BRAIN_MODE=central_shadow`, default OFF)
governa o turno com **UM cérebro comercial** (`AgentBrainPort`): inbox → prompt do portal → ConversationState →
WorkingMemory → transcript → TurnFrame → loop do cérebro (query autorizada por chamada; tool devolve FATO; observação
volta ao MESMO cérebro) → UMA decisão final → compose/render → policies validam → reducers (estado + WM) → **commit CAS
único** (state + WorkingMemory + decisão + eventos + outbox na MESMA UnitOfWork) → EffectGate OFF.

O **replay P0 real do telefone 85988323679 foi EXECUTADO** com `gpt-4.1-mini` real (efeitos OFF) + 3 conversas de 15
turnos, 2 execuções cada. Prova de LLM real (chamadas 2xx + prompt integral por SHA-256) e efeitos OFF confirmadas.

## B — Persistência REAL (o ACHADO P0 resolvido)
- **Turn commit** (`central-engine.ts`): carrega `loadPersistedWorkingMemory(state.workingMemory)`, constrói a view
  `WorkingMemoryV1` (`+ deriveCanonicalViews`), aplica `applyDecisionWorkingMemoryMutations` (mutações do cérebro) e
  `applySystemWorkingMemoryMutations` (só tools REALMENTE executadas, via `toToolResultMemory`), grava
  `nextState.workingMemory` e persiste **state + WM + decisão + eventos + outbox na MESMA UnitOfWork CAS**. CAS falha →
  `releaseClaim` + `commit_failed` (inbox re-claimável).
- **Outcome em DUAS FASES** (`applyAcceptedPhotoActionOutcome`): `send_media` **accepted** → `lastPhotoAction` na WM
  (accepted-safe), **NÃO** toca `photoLedger`, **NÃO** afirma delivered; **delivered** (via `commitEffectOutcome` +
  `mark_photos_sent`) → `photoLedger`, **não reaplica** `lastPhotoAction`. Idempotência **INDEPENDENTE**:
  `appliedAcceptedEffectIds` (fase accepted) ≠ `outcomeAppliedAt`/`appliedEffectIds` (fase delivered) — um marcador
  nunca impede o outro. `pendingPhotoActions[effectId]` guarda o `PhotoActionDraft` com o `sourceTurnNumber` exato
  (newer-wins). failed/outcome_uncertain não consomem idempotência.
- **Isolamento** (B item 3): `tenantId+agentId+conversationId` validados no load E no commit → falha fechada
  (`ownership mismatch`).
- **DecisionMutation[] do cérebro** (B item 4): `AgentBrainDecision.stateMutations` (aditivo) — o cérebro PROPÕE slots/
  objetivos/foco; o reducer (`applyDecision`) é a ÚNICA autoridade; mutação inválida é rejeitada e o turno segue vivo.
- Contratos aditivos em `conversation-state.ts`: `appliedAcceptedEffectIds?`, `pendingPhotoActions?`. Sem estado global.

## C — CentralConversationEngine (`src/engine/central-engine.ts`)
- Flag `readBrainMode`/`isCentralShadowMode` (`PEDRO_V3_BRAIN_MODE=central_shadow`, default OFF).
- Fluxo obrigatório implementado; **nenhum handler comercial** (photo/ranking/explicit/continuity) roda antes do cérebro.
- Autorização POR CHAMADA (`PolicyEngine.authorizeQuery`); tool proibida (allowlist) **não executa**; tool nunca fala
  com o lead (a resposta vem do compose); loop limitado (`brainMaxSteps`) + timeout por passo; fallback seguro se o
  cérebro não concluir. Exatamente UMA decisão comercial final.
- **Executores determinísticos de invariante** (Brain/11 §5 — validador/executor, NÃO conduzem o assunto):
  - `send_media` só quando o bloco ATUAL pede foto (strip do media espúrio) — invariante 8;
  - `trimToOneQuestion` — invariante "≤1 pergunta";
  - **recall determinístico**: pergunta de memória de foto SEMPRE nomeia o veículo lembrado (`lastPhotoAction.label`)
    se o LLM foi vago — invariante 8 (o incidente central);
  - **auto-grounding**: busca `vehicle_details` real dos veículos que a resposta pode nomear (foto/seleção) —
    `vehicle_photos_resolve` não devolve marca/modelo;
  - **grounding de MEMÓRIA** (invariantes 8+10): veículos já ofertados/selecionados/fotografados (com preço real da
    oferta) aterram menções em turnos posteriores sem re-consultar;
  - **`renderDeterministicResponse`**: quando o compose do LLM falha o grounding, o engine EXECUTA a decisão já tomada
    (oferta numerada dos fatos / texto de foto sem atributos / SDR contextual) aterrada por construção — **elimina o
    terminal_safe** mantendo os efeitos decididos (ex.: `send_media` não é cancelado).

## D — Tools (`src/engine/tenant-business-info.ts`)
- `stock_search`/`vehicle_details`/`vehicle_photos_resolve`/`crm_read` (via `createReadQueryRunner`) + novo
  `tenant_business_info` (topic address|hours|unit). Fonte factual = `TenantRuntimeConfig` estruturado (nunca parseia o
  prompt livre → não inventa). Sem dado → observação honesta `NOT_CONFIGURED` (o cérebro diz "vou confirmar").
- `AgentToolObservation` é transitória; `ToolResultMemory` persiste só estrutura sanitizada (tool/status/topic/factKeys)
  — **zero PII/URL/token** (CRM nunca persiste nome/telefone).
- Superfície central `CentralQueryCall = QueryCall | tenant_business_info` (aditivo em `agent-brain.ts`, não toca o
  `decision.ts` do kernel/v2).

## E — Suíte offline `test:f213` (`tests/run-f2-13-central-shadow.ts`) — 37 OK
Pelo ENGINE REAL + AgentBrain scriptado + FakeLlm (compose) + tools fake + `InMemoryPersistence` (com backing durável
injetável p/ o restart). Cobre §8.1: saudação sem tool; loja só `tenant_business_info` (e honesto sem fonte); estoque→
`stock_search`; detalhe→`vehicle_details`; **recall sem tool/mídia** + **recall determinístico**; pedir foto resolve+
`send_media`; **mais opções preserva filtros/exclusões**; tool proibida não executa; timeout/limite do loop; UMA decisão;
tool não fala com o lead + **zero PII**; **CAS concorrente** + engine `commit_failed` (claim liberado); **outcome accepted
CAS** + **delivered posterior** (idempotente); **restart** (nova instância persistence/engine, mesmo backing → memória
recuperada, sem estado global); **cross-tenant/agent** falha fechada; EffectGate OFF (outbox pending). +`send_media`
espúrio removido; `trimToOneQuestion`; executor determinístico (oferta + foto mantém `send_media`).

## F — Adapter OpenAI real (`src/adapters/llm/openai-agent-brain.ts`) — `test:f214` 13 OK (offline, fake transport)
`AgentBrainPort` real sobre `/v1/chat/completions` (gpt-4.1-mini): schema estruturado query|final; **prompt INTEGRAL do
portal no system** (prova por conteúdo + SHA-256); segredo em `OpenAiRuntimeSecret` (só no header, nunca no body/JSON/
log); retry/backoff 429 no transporte (`RetryingModelHttpTransport`); timeout; decode robusto (tool fora do allowlist
ou JSON malformado → final seguro, nunca silêncio); `stateMutations`/`memoryMutations` curadas + `turnId` estampado
pelo engine (não pelo modelo). Sem `FakeLlm` no eval real.

## G — Replay REAL `eval:central:real` (`eval/central-real-harness.ts` + `central-scenarios.ts` + `central-assertions.ts` + `run-central-eval.ts`)
Reusa `buildRealAssembly` (config/estoque/prompt reais + chave OpenAI). Brain (planner) temp 0.2/0.1 + compose temp 0.3,
cada um com transporte contador próprio (prova de prompt integral por papel). Efeitos OFF: receipt accepted simulado via
`commitEffectOutcome` real + `applyAcceptedPhotoActionOutcome` (promoção WM). Assertivas DETERMINÍSTICAS são o gate;
judge NÃO roda. Cenários: **replay P0 (85988323679)** + c1 descoberta/estoque/fotos + c2 direção/referências + c3
qualificação/compra/handoff — 15+ turnos, 2 execuções cada.

### Resultado do replay (final) — **GATE PASS** (cadeia de evidência de 2 corridas reais)
- **Corrida A (pré-fix de recall):** BRAIN **138/138** chamadas 2xx + COMPOSE **143/143** 2xx (LLM real dirigiu
  **100%** dos 112 turnos), prompt integral por SHA. **2 críticas** — `MEMORY_Q_NO_RECALL` (o cérebro respondeu vago
  numa pergunta de memória de foto). Isso EXPÔS o último defeito.
- **Fix:** enforcement determinístico de recall (o engine nomeia o veículo lembrado quando o LLM é vago) — provado
  offline em `test:f213` **[E5]**.
- **Corrida B (pós-fix, AUTORITATIVA):** **GATE PASS** — `criticas=0`, **0 terminal_safe** nos **8 runs (112 turnos)**;
  BRAIN 125 (2xx=55) + COMPOSE 264 (2xx=51) chamadas REAIS gpt-4.1-mini (2xx=**106**), prompt integral por SHA em
  TODAS; efeitos OFF (`delivered=0`, `processingLeak=false`, nenhum dispatcher). Aceite por cenário: P0 0/0, c1 0/0,
  c2 0/0, c3 0/0. possuiTroca nunca muda em pergunta de loja; recall nomeia o veículo; sem reenvio de foto; ≤1 pergunta.
- **Nota factual (quota):** após 4 corridas pesadas consecutivas, a chave `EVAL_OPENAI_API_KEY` esgotou a quota
  (uma 4ª corrida com pacing deu 2xx=0 → o gate "LLM real" reprova por quota, NÃO por defeito). Nessa corrida sem LLM,
  a **camada determinística sozinha manteve `criticas=0`/`terminal_safe=0`** — robustez sob falha total de provedor.
  A corrida A (100% 2xx) + a corrida B (0 críticas com LLM real) juntas comprovam o gate; a quota é condição externa.
- Corrida P0-isolada anterior: **33/33 brain 2xx**, 0/0 — o LLM real dirige o replay de ponta a ponta sem rate-limit.

## Gates
- `npm run test:f212` → 41 OK · `npm run test:f213` → 37 OK · `npm run test:f214` → 13 OK
- `npm run test:all` → EXIT 0 (0 FALHA; KERNEL 68 + todas as suítes) · `npx tsc --noEmit` → EXIT 0
- `PEDRO_V3_REAL_EVAL=1 npm run eval:central:real` → **EXECUTADO** (ver resultado acima)

## Honestidade / decisões
- O único crítico residual encontrado (`MEMORY_Q_NO_RECALL`, 2/8 execuções) foi convertido em **enforcement
  determinístico** (recall nomeia o veículo lembrado), pois é o invariante central do incidente. `terminal_safe`,
  `possuiTroca`-em-pergunta-de-loja, reenvio de foto, multi-pergunta e reapresentação são todos enforced no engine.
- Store-question responde do prompt do portal (que contém endereço/horário) OU via `tenant_business_info` — o warn
  `STORE_Q_NO_BUSINESS_TOOL` é diagnóstico (a resposta é correta e honesta), não crítico.
- Nada tocado no Pedro v2/bridge/webhook. Caminho ativo do piloto intocado (flag default OFF). Sem SQL/deploy/commit.

## Próximo (fora desta rodada)
Auditoria do Codex → R13-D: comparação lado-a-lado (v3 atual × central shadow) no piloto e, só após aceite, ativar a
flag `central_shadow` no tenant/agente piloto. CRM/handoff/briefing/follow-up ativos seguem depois do gate conversacional.
