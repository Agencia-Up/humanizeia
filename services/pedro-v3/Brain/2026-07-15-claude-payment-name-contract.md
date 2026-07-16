# Handoff — Contrato semântico do turno: pagamento/consórcio, backstop humano, agendamento (Claude)

Data: 2026-07-15 · Executor: Claude · Sobre a leva WIP do Codex (`7be5d3db` + WIP não commitado de `current-turn-facts`).
**NADA commitado/pushado/deployado.** Segue o prompt do Codex ("Fechar o contrato semântico do turno atual").

## Método (antes de tocar código)

Auditoria multi-agente das 11 regras do prompt contra o WIP atual (10 lanes paralelas). Resultado:
- **enforced:** R1 (understanding obrigatório), R4 (troca fragmentada), R5 (referência "o azul"/ordinal), R11 (sem reintrodução).
- **partial:** R2 (pagamento/consórcio), R3 (pergunta entregue vence), R6 (agendamento), R7 (pedido humano), R8 (desinteresse).
- **gap:** R9/R10 (testes+smoke — o smoke real só chamava `proposeNextStep`, não o ciclo `central_active` completo).

## Fixes aplicados (todos LLM-first: engine valida + feedback+retry; a LLM redige)

### R2 — pagamento/consórcio (o INCIDENTE: "Não, carta consórcio contemplada de 53 mil" → a LLM pedia o NOME)
Causa-raiz: a guarda "não peça nome em pagamento" (central-engine `authorFromBrainDraft`) estava **gated em `applyLegacyStyleGuards = !requireBrain`** → DESLIGADA no `central_active` (virou advisory no RD1-2). O prompt ainda prometia ao LLM "o sistema BLOQUEIA pedir nome em pagamento" — garantia falsa.
- **Deny ATIVO em central_active** (novo bloco, gated em `requireBrain && paymentConductTurn`): draft que pede nome num turno de pagamento, com nome desconhecido e qualificação incompleta → `{ok:false, feedback}`. O branch `conductTurn` (já existente) molda o retry; a MESMA LLM reautora sem pedir nome. **Não** religa as outras guardas de estilo.
- **Sinal `paymentConductTurn`** (`central-engine.ts`, ~1740): `llmFirst && !explicitBuyIntent && isPaymentTurn(leadMessage) && intent≠photo/institutional`. Passado aos 2 call-sites de `authorFromBrainDraft`.
- **Bloqueio de tool comercial no consórcio ESPONTÂNEO** (`paymentConductTurn && !tradeInAnswerTurn && !financialAnswerTurn && !sufficientForStockSearch(currentConstraints)`): "tenho carta contemplada de 53 mil" (sem alvo) → stock_search bloqueado; "consórcio, tem SUV até 50 mil?" (com alvo) → NÃO bloqueado (busca legítima passa). (O caso do incidente já era `tradeInAnswerTurn`, que bloqueia stock_search desde antes.)
- **Strip de precoMax** (`commercial-constraints.ts`): "53 mil" que acompanha forma de pagamento (consórcio/carta contemplada/carta de crédito/à vista) **não semeia precoMax** quando não há orçamento explícito ("até X"). Extração de fato, escopo estreito.
- **"carta contemplada"/"carta de crédito" = consórcio em TODO lugar:** `parsePayment` (→ formaPagamento=consorcio), `PAYMENT_TURN_RX` (isPaymentTurn), e o gate de extração de `formaPagamento`. Antes só "consorcio" pelado era reconhecido.

### R7 — pedido humano bloqueia tool comercial mesmo com entendimento FRACO
Assimetria: `humanGuidanceTurn`/`humanRequested`/cadeia de handoff usam `requestsHuman(brainVU()) || leadRequestsHumanExplicitly(leadMessage)`, mas o **gate de tool comercial** (central-engine ~2491) só usava `commercialToolAllowedForHumanRequest(brainVU())` (brain-only). Fix: somar `leadRequestsHumanExplicitly(leadMessage)` (mesmo backstop determinístico já sancionado) → tool comercial não roda no turno do pedido humano; feedback+retry.

### R6 — advisory de agendamento não empurra contra a mudança de assunto
`schedulingAdvisory` (central-engine ~1946) agora é gateado por `!commercialTargetStated && !explicitBuyIntent` → num "Na verdade quero um Onix" o advisory ("acolha e pergunte só o horário") **não** é injetado (a mudança explícita vence a visita). Num "Às 15h" ambos são false → advisory permanece.

## Testes + Smoke (regras 9/10)

- **NOVO `tests/run-f2-57-payment-name-contract.ts`** (`test:f257`, na cadeia `test:all`): roda o **ciclo `central_active` COMPLETO** (`runCentralConversationTurn`, singleAuthor+llmFirst) com **cérebro scriptado que DECLARA understanding em todo passo** (NÃO usa o wrapper que "lava" o fallback regex). **13 OK/0:**
  - **[PAY]** consórcio respondendo troca: a 1ª autoria PEDE o nome → engine NEGA → RETRY → reautora sem nome; ZERO stock_search; understanding presente; formaPagamento=consorcio; texto acolhe consórcio e não pede nome.
  - **[AZUL]** "Manda a foto do azul" após lista → `send_media` do Onix azul aterrado (offer_reference por cor), ZERO stock_search.
  - **[SPON]** consórcio espontâneo → stock_search bloqueado; reautora conduzindo.
  - **[HUM]** pedido humano com understanding fraco → tool comercial NÃO roda (backstop R7).
- **Smoke real reescrito `eval/run-f256-current-turn-context-real-smoke.ts`** (`smoke:f256`): agora roda `runCentralConversation` (ciclo completo), não `proposeNextStep`. **PASS ×2** (gpt-4.1-mini real): "Tenho uma carta de consórcio contemplada de 53 mil" → intent=financing, fromBrain=true, ZERO stock_search, formaPagamento=consorcio, texto **não pede nome** ("...Você tem algum carro para dar de troca?"). Cenário B (referência+foto) best-effort.

## Gates (todos verdes)
`npx tsc --noEmit` EXIT 0 · `npm run test:all` EXIT 0 (F2.57 13 OK incluída) · `git diff --check` limpo (só avisos LF/CRLF) · smoke real `smoke:f256` PASS ×2 lido turno a turno.

## R8 — desinteresse cancela follow-up de forma DURÁVEL (FEITO nesta leva, fatia autorizada pelo Codex 2026-07-15)
Contrato de estado: **`ConversationState.optedOutAt?: Iso|null`** (aditivo/retrocompat; NÃO é `stage=closed`). Motivo terminal: **`lead_opted_out`**.
- **Set (central-engine, no `reduced.next`, idempotente):** `if (disengagedActionable && leadEngagement === "not_interested" && optedOutAt == null) optedOutAt = cutoff`. Usa o MESMO sinal `not_interested` da saga silenciosa (só o detector existente `detectDisengagement` — SEM ampliar regex). "me tira da lista"/"pare de mandar"/"não me interessa"/"não quero comprar" marcam; "não" isolado/"obrigado"/"vou pensar" NÃO (o detector já separa not_interested de low_intent/null). Evidência = bloco atual. A LLM continua autora da despedida; a infra só persiste o fato.
- **Consumo (`followup-policy.ts`):** `if (state.optedOutAt != null) return { due: null, reason: "lead_opted_out" }` — ANTES da âncora, INDEPENDENTE de stage/handoff/leadId/plannable. Idempotente (turnos posteriores não limpam).
- **Testes NOVOS `tests/run-f2-58-optout-followup.ts` (`test:f258`, 19 OK):** Parte A (evaluateFollowup puro) cobre a matriz do contrato — opt-out + leadId null/válido, handoff plannable/não, follow-up ancorado/pendente/enviado, rules on/off, sem-âncora → todos `lead_opted_out`/due=null; controle sem opt-out → due T1. Parte B (engine central_active real) — "me tira da lista"+leadId null / "pare de mandar" / "não me interessa" SETAM; "não" após troca / "não" após lista / "obrigado" NÃO setam; opt-out sobrevive a novo turno (idempotente). Gates: `test:f249` 66 OK (sem regressão) · tsc 0 · test:all 0 · diff --check limpo.
## R8.1 — endurecimento da semântica do opt-out (fatia autorizada pelo Codex, mesmo dia — SEM alterar o contrato)
O Codex apontou 3 furos no R8: (1) detector não pegava "parar de mandar"/"não quero mais nada"/"não quero receber mais mensagens"/"pode parar de me chamar"; (2) rejeição de veículo ("não me interessa esse carro, tem outro?") virava opt-out global; (3) o SET dependia de `disengagedActionable`, suprimido por filtro comercial/`mentionsMoreOptions` — "me tira da lista do SUV até 50 mil"/"me tira da lista, não quero mais opções" perdiam o opt-out. Fix (contrato `optedOutAt`/`lead_opted_out` INALTERADO):
- **Detector DEDICADO `detectExplicitOptOut` (`lead-intent.ts`)**, separado de `detectDisengagement`: `STRONG_OPTOUT_RX` (pedido inequívoco de parar — me tira da lista / (pode) parar de me mandar|enviar|chamar / não quero (mais) receber|nada / encerra o contato / sai fora — SEMPRE opt-out, mesmo com filtro comercial no bloco) + `SOFT_OPTOUT_RX` ("não me interessa"/"não quero comprar" — opt-out SÓ se NÃO houver `SEEKS_ALTERNATIVE_RX`: "outro"/"um sedan"/"esse carro"). NÃO é roteador comercial (não decide assunto/carro).
- **SET desacoplado** de `disengagedActionable`: agora `if (detectExplicitOptOut(leadMessage) && optedOutAt == null) optedOutAt = cutoff`. Persiste no MESMO CAS; idempotente; não reabre/limpa; não usa stage=closed. R3 intocado.
- **Testes NOVOS `run-f2-59-optout-semantics.ts` (`test:f259`, 37 OK):** A) detector puro — 13 opt-out (incl. novas formulações + misturados com "mais opções"/"SUV até 50 mil") todos true; 11 não-opt-out (rejeição de veículo, mudança de veículo, "não"/"obrigado"/"vou pensar", busca) todos false. B/C) engine real — opt-out global misturado com comercial SETA e bloqueia follow-up (`lead_opted_out`); rejeição/mudança de veículo NÃO setam; idempotência+persistência. Gates: `test:f258` 19 OK (sem regressão) · `test:f249` 66 OK · tsc 0 · test:all 0 · diff --check limpo.

## Buracos MAPEADOS e DEFERIDOS (recomendação p/ o Codex — não toquei; envolvem contrato de estado/assinatura)
- **R3 (pergunta entregue vence, edge):** `inferredQuestionSlot` lê só o último turno do agente; se ele for uma LISTA (statement, sem "?") e houver `currentObjective` stale, um "não" pelado gruda no slot antigo. Casos perigosos (encerrar/transferir) JÁ bloqueados. Fix: usar `WM.pendingAgentQuestion` (já escrita) como fonte da "última pergunta entregue", ou emitir advisory quando não há pergunta entregue vinculada. (Registrado separadamente conforme item 10 do contrato R8 — NÃO implementado nesta fatia.)
- **R6 fix-2 (dia-da-semana pelado):** "segunda" isolado ainda pode virar ordinal 2 em `ordinal.ts`. **Defusado** em central_active (seleção só via brain `select_vehicle`; foto exige verbo). Fix limpo exige passar `schedulingActive` a `parseOrdinal` (ripple de assinatura) — deixei latente.
- **R1 telemetria:** em turno degradado, `decision_final.understanding` grava a intenção derivada do fallback regex; distinguível por `understandingTrusted`/`understandingFromBrain`. Sugestão: gravar `null`/`provenance:fallback_hint`.

## Arquivos alterados nesta leva (Claude)
Produção: `src/engine/central-engine.ts` (paymentConductTurn + deny de nome + tool-block + R7 backstop + R6 advisory + PAYMENT_TURN_RX), `src/engine/commercial-constraints.ts` (strip precoMax), `src/engine/lead-extraction.ts` (parsePayment/gate "carta contemplada"). Testes/eval: `tests/run-f2-57-payment-name-contract.ts` (novo), `eval/run-f256-current-turn-context-real-smoke.ts` (reescrito), `package.json` (test:f257 + cadeia). **Não misturar/commitar os untracked antigos de auditorias** (`run-audit-v2-vs-v3.ts`, `run-conversation-quality-audit.ts`, Brains 07-06/07-09/07-11).
