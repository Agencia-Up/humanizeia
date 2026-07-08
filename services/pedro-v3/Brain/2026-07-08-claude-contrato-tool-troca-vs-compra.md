# P0 — Contrato de tool comercial + resposta a pergunta pendente + veículo de TROCA

**Data:** 2026-07-08 · **Autor:** Claude (executor) · **Missão:** dono/Codex (3 incidentes reais) · **Modo:** central_active (singleAuthor+llmFirst)
**Base git:** `c59cbf37` · **Gates:** `tsc` EXIT 0 · `test:all` EXIT 0 (F2.39 **19 OK**, zero regressão) · **Sem commit** (aguarda auditoria/autorização).
Prioridade ANTES de CRM/transferência: separar interesse de COMPRA do veículo de TROCA (senão o briefing do vendedor fica errado).

## Diagnóstico por causa-raiz (auditoria via 3 Explore agents)
- **INC1 (promete buscar sem tool):** `requiredToolBeforeFinal` força stock_search em turno comercial, mas NADA barrava o TEXTO
  "vou buscar" quando a força falhava/o cérebro reincidia. E **"cadê?" não tinha detector** → caía em `currentTurnIntent="other"`
  → não retomava a busca ativa (respondia "qual modelo?").
- **INC3 (troca vira busca) — o pior:** em `llmFirst` o `currentObjective` é STRIPADO, então o "slot esperado" vem SÓ do regex
  `inferredQuestionSlot` sobre o texto do agente. E o gate de `veiculoTroca` lia `possuiTroca.value` **pré-turno** → no turno em
  que o lead confirma+dá o carro ("tenho um Renegade 2019 86km"), NÃO capturava o veículo. Pior: "Renegade" é modelo →
  `commercialSearchTurn` FORÇAVA stock_search → listava estoque + "Jeep eu não encontrei". E `"86km"` → 86 (só multiplicava com "mil"/"k").
- **INC2 (sobrenome):** "sobrenome" só existia no PROMPT (proibição), sem guard; e o guard de nome só disparava no turno 0.

## Fixes por invariante (LLM-first: engine orienta/valida/gateia tool, cérebro decide; sem handler escrevendo)
### A. Contrato de tool + "cadê?" (INC1)
- **`textPromisesSearch`** (guard em `authorFromBrainDraft`, gated por `searchExpectedThisTurn`): promessa "vou buscar/procurar/
  verificar/já busco" + nenhuma stock_search executada → deny + feedback ("chame stock_search AGORA, nunca prometa buscar depois").
- **`wantsResumeSearch`** ("cadê?/e aí?/achou?/me mostra/manda") + `activeSearchConstraints` suficiente → `resumeSearchTurn` →
  entra em `commercialSearchTurn` → força a busca com o filtro ATIVO (não repergunta). Prompt reforça.
### C/D/E/G. Veículo de troca (INC3)
- **`tradeInAnswerTurn`** = a última pergunta do agente foi de TROCA (`inferredQuestionSlot`∈{possuiTroca,veiculoTroca}) E o lead
  NÃO tem intenção de COMPRA explícita (`hasExplicitBuyIntent`: "tem X?", "quero comprar X"). Efeitos: (1) `commercialSearchTurn`
  fica FALSE (engine não força busca); (2) no loop, uma `stock_search` do cérebro num trade-answer é **BLOQUEADA** (FORBIDDEN +
  feedback, a tool não roda).
- **`lead-extraction.ts`:** captura `veiculoTroca` no MESMO turno da confirmação (`tradeContextActive` = pergunta pendente de
  troca OU já confirmou OU frase "X para/de/na troca"); km normalizado (qualquer `km < 1000` → ×1000, então "86km"→86000);
  `explicitTrade` reconhece "X para troca". Briefing pronto: `possuiTroca`+`veiculoTroca{modelo,ano,km}` (slots já existiam).
### F. Abertura / nome / sobrenome (INC2)
- **`asksLeadSurname`** guard: pedir sobrenome/nome completo → deny SEMPRE.
- Guard de nome estendido: além de `openingNeedsDiscovery`, dispara em **`noCommercialContextYet`** (sem interesse/tipo/faixa
  conhecido, sem carro ofertado/selecionado, sem anúncio) → "Sim, conheço" não vira pedido de nome.
### Observabilidade de latência (doc 2)
- `decision_final` agora tem `turnLatencyMs` (parede, RealClock em prod), `toolMs`, `firstFailureReason`, e
  `tradeInAnswerTurn/resumeSearchTurn/searchExpectedThisTurn/pendingQuestionSlot`. ⚠️ **retry/backoff 429 em produção NÃO existe**
  (server.ts injeta `FetchModelHttpTransport` cru; o `RetryingModelHttpTransport` só está no eval) — **follow-up documentado**,
  não corrigido nesta rodada (precisa teste com 429 real).

## Arquivos (só `services/pedro-v3/`)
`src/engine/lead-extraction.ts` (km, veiculoTroca same-turn, explicitTrade, export inferredQuestionSlot) ·
`src/engine/central-engine.ts` (detectores tradeInAnswerTurn/resumeSearchTurn/searchExpectedThisTurn/noCommercialContextYet;
gate commercialSearchTurn; bloqueio de stock_search em trade-answer; guards promise/sobrenome/nome; observabilidade) ·
`src/adapters/llm/openai-agent-brain.ts` (prompt: troca≠busca, sem sobrenome, cadê retoma, promessa proibida) ·
**NOVO** `tests/run-f2-39-tool-contract-tradein.ts` · `package.json`.

## Testes offline + resultado
**F2.39 19 OK / 0 FALHA:** U-1 (inferredQuestionSlot) + T1 (SUV busca+lista, nunca "vou buscar") + T2 (cadê retoma, não
repergunta) + T3 (abertura sem nome) + T4/T4b (qualificação sem nome, NUNCA sobrenome) + T5/b/c/d (troca: possuiTroca=true,
veiculoTroca Renegade/2019/86000, ZERO stock_search, sem "não encontrei") + T5-neg (cérebro tenta buscar na troca → BLOQUEADO)
+ T7 ("tem Renegade 2019?"=COMPRA busca) + T8 ("quero comprar Renegade" busca) + T9 (não tenho troca=false, 0 busca) + T10
(Onix troca + SUV compra não se misturam). `tsc`+`test:all` EXIT 0, zero regressão.

## Smoke real — ⚠️ NÃO EXECUTADO (sem chave OpenAI local)
Não há `OPENAI_API_KEY`/`.env` → não rodei a conversa real (T1 Boa noite / Sim conheço / Douglas / Aloan você tem SUV / cadê /
quero SUV / gostei do segundo / condições / Tenho um renegade 2019 86km). Os invariantes estão provados DETERMINISTICAMENTE
offline (F2.39). Rodar com chave via o harness de eval (efeitos OFF). Assim que rodar, anexar a tabela por turno.

## Follow-ups (honesto, não nesta rodada)
- **Retry/backoff 429 em produção** ausente (server.ts) → o "~2 min / attempts=2" provável = timeouts sem retry curto. Precisa
  wirar `RetryingModelHttpTransport` no runtime + tunar `proposeTimeoutMs`. Requer teste com 429 real.
- `contactName`/`pushName` do WhatsApp NÃO chega ao turno (só `crm_read.lead_name`) — usar como hint de nome é follow-up.
- Briefing/CRM (usar possuiTroca+veiculoTroca) = próxima fase, fora do escopo.

## ⭐Follow-up (audit Codex F2.39: P0 de cobertura) — buy-clause separa TROCA de COMPRA
**Furo:** `hasExplicitBuyIntent` (regex estreito) não reconhecia "quero SUV"/"quero sedan..." SEM artigo. Risco: com pergunta
de troca pendente, "tenho um Onix **para troca, mas quero SUV**" marcava `tradeInAnswerTurn=true` e **bloqueava a busca do SUV**.
O T10 era falso-verde (não semeava a pergunta de troca antes).
**Fix por invariante (não if-por-frase):** o verbo de COMPRA ("quero/procuro/busco/prefiro/gostaria") separa o ALVO DE COMPRA
do carro de troca. `buyClauseOf(block)` devolve o trecho A PARTIR do verbo → "tenho um Onix para troca, mas quero SUV" ⇒
"quero SUV" ⇒ filtro de busca = SUV (o Onix é troca, capturado à parte). `explicitBuyIntent = hasExplicitBuyIntent ||
(verbo de compra && sufficientForStockSearch(buyConstraints))` — detecta por INTENÇÃO+constraints, não regex. Em turno de
troca+compra (`tradeBuyTurn`), o `currentConstraints` da busca passa a ser o `buyConstraints` (alvo de compra), nunca o
veículo de troca. "tenho X" (posse) sozinho continua TROCA (sem verbo de compra → não busca). "não tenho troca" preservado.
**Testes CX-1..5 (com pergunta de troca semeada):** CX-1 Onix→troca + busca tipo=suv (não Onix); CX-2 só troca → 0 busca;
CX-3 "quero SUV" → busca suv; CX-4 Onix/2018/80000→troca + busca precoMax=70000 (não Onix); CX-5 "não tenho troca"→false, 0
busca. **F2.39 26 OK** (19+7 novos). tsc+test:all EXIT 0, zero regressão. Arquivos: central-engine (buyClauseOf +
buyConstraints + effective currentConstraints) + run-f2-39.

**PARADO para auditoria do Codex — nada commitado.**

## ⭐Follow-up 2 (smoke real do Codex `f239-real-smoke-…T02-09-48`): compra vs troca + dedup de stock_search
O Codex rodou LLM real e achou 3 P0 remanescentes. Diagnóstico read-only primeiro (Brain), depois fix por arquitetura:

**P0-1 — interesse CONTAMINADO (suv→renegade):** causa em `lead-extraction.ts:376` — `interesse`/`tipoVeiculo` vinham de
`detectInterestModels(leadMessage)`/`parseVehicleType(leadMessage)` no BLOCO INTEIRO. "Tenho um Renegade..." gravava
interesse=Renegade (o carro de TROCA). Isso estraga CRM/briefing. **Fix:** o verbo de compra separa o alvo de COMPRA do
carro de troca — `buyClauseOf`/`preBuyText`. interesse/tipoVeiculo vêm de `interestText` (em contexto de troca = só o alvo de
compra; nunca o carro de troca). `veiculoTroca` vem do `preBuyText` (parte de troca) com `possessionSignal` (tenho/possuo/
"para troca") — "tem Renegade?"/"quero um Renegade" (COMPRA) NÃO viram troca. `looksLikeBuyRequest` inclui "tem X?".

**P0-2 — "cadê?" rodou stock_search 6x:** os 3 sites de execução (brain execCall + forçado + cascata) não compartilhavam
dedup por FILTRO (só o `seenToolSigs` por assinatura crua). **Fix:** `stockSearchFingerprint` (filtros normalizados:
marca/modelo/tipo/preço/câmbio/anos/popular/moto/excludeKeys/broad) + wrapper `runQueryDedup` POR TURNO — buscas equivalentes
executam 1x; a 2ª+ devolve o FATO já obtido (relaxamento real = fingerprint diferente = roda). NÃO é if-por-frase.

**P0-3 — primaryIntent=search_stock na troca:** o brain rotula; o dano real (interesse/activeSearchConstraints/stock) já é
barrado (tradeInAnswerTurn não força busca, não atualiza activeSearchConstraints; interesse gated). Observabilidade
`decision_final` ganhou `tradeBuyTurn`, `buyConstraints`, `interesseBefore/After`, `veiculoTrocaAfter`,
`stockSearchFingerprintsExecuted`, `duplicateStockCallsBlocked` para o briefing ler a classificação certa.

**Testes IN-1/2/3 + os 5 CX:** IN-1 interesse/tipoVeiculo preservados (Renegade não contamina); IN-2 stock_search
equivalente 2x → 1 execução; IN-3 "tem Renegade?" = compra, não grava troca. **F2.39 32 OK.** tsc+test:all EXIT 0, zero
regressão. Arquivos: lead-extraction (buyClause/interestText/possessionSignal) + central-engine (fingerprint dedup +
observabilidade) + run-f2-39. ⚠️smoke real do Codex a re-rodar com chave (esperado: interesse preservado, 0 busca duplicada).

## ⭐Follow-up 3 (smoke REAL rodado por mim, gpt-4.1-mini) — T5 6-7x / T9 flaky / T1 control char → **PASS**
Rodei o smoke real (`EVAL_USE_PLATFORM_KEY=1`, efeitos OFF, 22 chamadas). O relatório real revelou 3 causas que os testes
scriptados NÃO pegavam (a conversa real é não-determinística e o cérebro emite dados que o mock não emite):

**T5 "cadê?" 6-7x stock_search:** o smoke conta OBSERVAÇÕES (`toolObservations`), e os FEEDBACKS DE CONTROLE
`REQUIRED_TOOL_MISSING` (branch final) e `REQUIRED_TURN_UNDERSTANDING` (gate de capability) usavam `tool:"stock_search"`.
"cadê?" não tem substantivo comercial p/ a evidence → o cérebro não consegue autorar busca válida → o gate rejeita em loop,
cada rejeição contava como busca. **Fix por invariante:** feedback de controle de stock_search vira `tool:"response"` (NÃO é
execução, não infla a contagem) + `dupStockLoopCount`/`DUP_STOCK_LOOP_CAP=3` (esgotado, a busca comercial roda
DETERMINÍSTICA na autoria — não depende de o cérebro autorar evidence). Real: T5 = `response,response,response,stock_search`
(1 busca). `wasObserved` intacto (já excluía REQUIRED_TOOL_MISSING por código).

**T9 troca não detectada (flaky):** `tradeInAnswerTurn` exigia `pendingTradeQuestion` (NÓS termos perguntado troca). No real,
o agente perguntou de FINANCIAMENTO/entrada e o lead ofereceu "Tenho um Renegade 2019 86km" → busca disparou, interesse
contaminou. **Fix por invariante (entendimento REFLETE a conversa):** `statesTradeVehiclePossession` (lead-extraction, PURA) =
posse (tenho/possuo, exceto "tenho interesse") + modelo + **km** (discriminador forte: só cita km de carro que É SEU).
`tradeInAnswerTurn = llmFirst && !explicitBuyIntent && (pendingTradeQuestion || leadOffersTradeVehicle)`. O mesmo sinal entra
em `inTradeContext` (interesse/tipoVeiculo vêm só do buyClause — não contamina) + `tradeContextActive`+possuiTroca (captura
veiculoTroca + possuiTroca=true sem termos perguntado). Real: T9 = 0 busca, intent=trade_in, veiculoTroca Renegade/2019/86000,
possuiTroca=true, interesse intacto.

**T1 caractere de controle:** o LLM emitiu 2× U+001F no texto. **Fix determinístico:** `stripControlChars` (por code-point,
mantém \t \n \r; remove C0/DEL/U+FFFD) num CHOKEPOINT ÚNICO (`outComposed`) antes de `materializeEffectPlans` + `composedText`
+ evento `response_composed`. Nunca vão pro WhatsApp/CRM.

**Prompt (nudge, o reconcile é autoritativo):** `trade_in` no enum de `primaryIntent` + instrução "turno de resposta de troca →
primaryIntent=trade_in". Também: a exigência `requiredToolBeforeFinal` NÃO força busca em `tradeInAnswerTurn` (senão contradiz
o bloqueio) + o bloqueio de troca migrou p/ ANTES do gate de capability (senão evidence inválida cai no gate que empurra
stock_search).

**Testes IN-4..IN-9 (novos):** IN-4 loop-dedup por observação (stockObs≤1) + finaliza após feedback; IN-5 loop infinito → cap +
commit; IN-6 primaryIntent reconciliado=trade_in; IN-7 posse com km SEM pergunta → troca capturada + 0 busca + intent trade_in
+ interesse intacto; IN-8 sanitização de U+001F; IN-9 rejeição de capability não infla busca. **F2.39 45 OK / 0 FALHA.** Ajuste
F2.21 [15]: o responder passou a keiar no CÓDIGO do feedback (não no label da tool). **tsc + test:all EXIT 0, zero regressão.**
**Smoke REAL: PASS** (0 falhas; `f239-real-smoke-2026-07-08T12-06-38`). Arquivos extra: central-engine (stripControlChars +
relabel + cap + reconcile), lead-extraction (statesTradeVehiclePossession + inTradeContext), agent-brain (enum trade_in),
openai-agent-brain (prompt), central-real-harness (`code` na observação p/ diagnóstico), run-f2-21, run-f2-39, run-f239-real-smoke.

**PARADO para auditoria do Codex — nada commitado (dono pediu p/ não commitar).**

## ⭐Follow-up 4 (smoke real do Codex `f239-real-smoke-…T12-13-32`, runner ENDURECIDO) — T7 seleção + T8 nome em pagamento → **PASS**
O runner do Codex passou a reprovar: T7 terminalSafe / vehicle_details repetido / volta pra discovery; T8 pede nome em pagamento.
Diagnóstico via 2 Explore (mapa de seleção ordinal + mapa de nome), fix por invariante (LLM-first: cérebro conduz, engine
gateia/aterra):

**T7 "gostei do segundo" (loop 6× vehicle_details → technical_fallback → discovery):** o cérebro tenta `vehicle_details` na
SELEÇÃO (não tem a vehicleKey; o gate de capability rejeita porque select_vehicle não autoriza vehicle_details) e SEM cap
loopava; e `buildContextualRecovery` NÃO tinha ramo de seleção → caía no discovery genérico (`recovery_ask_need`/technical_
fallback). **Fix:** (1) `vehicle_details` entra no MESMO padrão do stock_search — rejeição de capability + DUP viram
`tool:"response"` (não infla a contagem do smoke) + `dupDetailLoopCount`/cap; (2) **ramo de SELEÇÃO em
`buildContextualRecovery`** — quando `resolveSelectedVehicle` resolve E `understanding.primaryIntent==="select_vehicle"` E não
é pergunta de atributo, ACOLHE nomeando o carro escolhido (`canonicalVehicleLabel` do offer context, sem chamar
vehicle_details) + oferece fotos/detalhes/condições (`recovery_selection`, NUNCA discovery). Gate por semântica `select_vehicle`
evita "outro Compass" (=busca/alternativa) cair no acolhimento (regressão F2.38 [AD-3b] corrigida). Prompt: seleção nomeia o
carro da última lista e vai direto ao final SEM vehicle_details (só chama se ele PERGUNTAR atributo). Real: T7 = brain_final
"Ótima escolha! O Renault Duster 2015…", 0 vehicle_details, não-terminalSafe.

**T8 "condições de pagamento" (pediu nome; e "Douglas" nunca fora capturado):** `extractName` só lia nome se houvera pergunta de
nome → "Douglas" pelado virava `null` → nome nunca conhecido → nenhum guard barrava reperguntar em pagamento. **Fix por
invariante:** (1) captura OPORTUNÍSTICA em `extractName` — bloco INTEIRO = nome pelado (1-2 tokens `isNameToken`, sem outro
answer-kind, e NÃO em pergunta de cidade) → grava nome (conf 0.8); (2) guard em `authorFromBrainDraft`: pedir nome com
`nome.status==="known"` → deny (nunca repergunta); pedir nome em `isPaymentTurn(leadMessage)` (condições/pagamento/financ/
parcela/entrada/à vista/consórcio/simular) → deny + conduz troca/entrada/parcela/simulação. Prompt: gravar nome quando o lead se
apresenta + nunca pedir nome em pagamento. Real: T3 capturou `nome=Douglas`; T8 = "Douglas, …tem algum carro para dar de
troca?" (não pede nome). Teste F2.7.7 [1c] INVERTIDO (comportamento antigo "não captura" → agora "captura oportunística") +
[1c-neg] cidade não vira nome.

**Latência:** o cap de vehicle_details cortou o loop (real caiu de 21-22 → **17 chamadas**). Retry/backoff 429 em produção
segue como follow-up (server.ts usa FetchModelHttpTransport cru) — precisa 429 real.

**Testes T7/T8 + T8a/b/c (novos na F2.39):** T7 detailObs≤1 + commit sem terminalSafe; T7b recuperação nomeia o escolhido, não
discovery; T8a "Douglas" pelado → nome capturado; T8b pagamento nega nome → conduz troca/entrada; T8c nome conhecido não
repergunta. **F2.39 50 OK / 0 FALHA.** tsc + test:all EXIT 0, zero regressão (F2.7.7 22, F2.38 21). **⭐SMOKE REAL PASS**
(`f239-real-smoke-2026-07-08T12-44-41`, 17 chamadas). Arquivos extra: central-engine (dupDetailLoopCount + gate/DUP de
vehicle_details + ramo de seleção em buildContextualRecovery + guards de nome/pagamento + isPaymentTurn), lead-extraction
(extractName oportunístico + guard cidade), openai-agent-brain (prompt seleção+nome+pagamento), run-f2-7-7, run-f2-39.

**PARADO para auditoria do Codex — nada commitado.**

## ⭐Follow-up 5 (smoke real do Codex `f239-real-smoke-…T12-52-23`) — T3 turno só-nome → **PASS FINAL**
Única falha restante: T3 "Douglas" (nome capturado) caiu em `technical_fallback`/terminalSafe com o texto genérico "Me conta um
pouco mais do que você procura…" — o cérebro autorou algo negado (1 RESPONSE_REJECTED) e a recuperação caiu no default
genérico (`recovery_ask_need`, lastResort=technical_fallback), porque `buildContextualRecovery` NÃO tinha ramo para
turno-de-identificação. **Invariante:** turno que informa APENAS o nome válido = IDENTIFICAÇÃO, não falha. **Fix:** (1) ramo
`recovery_name_identified` em `buildContextualRecovery` (arg `identifiedName`, computado do `set_slot nome` deste turno via
`safeExtractedSlots`), ANTES do default genérico: acolhe pelo nome + avança a descoberta ("Prazer, Douglas! Me conta o que
você procura: um modelo, um tipo de carro ou uma faixa de preço?") — `deterministic_recovery` (lastResort=false → NÃO
technical_fallback, NÃO terminalSafe), sem tool, sem sobrenome/telefone, sem bloquear por falta de intenção. (2) Prompt: se o
lead responde só com o nome, ACOLHE + re-pergunta a descoberta (final normal sem ferramenta, nunca "não entendi"). **Testes T3/
T3b (novos na F2.39):** nome conhecido + 0 tools + não-terminalSafe + src≠technical_fallback + acolhe pelo nome. **F2.39 52 OK
/ 0 FALHA.** tsc + test:all EXIT 0, zero regressão. **⭐SMOKE REAL PASS** (`f239-real-smoke-2026-07-08T13-05-11`, 17 chamadas:
T3 real = brain_final "Douglas, qual modelo, tipo de carro ou faixa de preço…", 0 tools, nome=Douglas, não-terminalSafe — o
cérebro acertou sozinho com o nudge, e o backstop determinístico garante). **TODA a conversa T1-T9 PASSA.** Arquivos extra:
central-engine (ramo recovery_name_identified + identifiedNameThisTurn), openai-agent-brain (prompt só-nome), run-f2-39.

**PARADO para auditoria do Codex — nada commitado. TODAS as falhas do smoke real fechadas (T1/T3/T5/T7/T8/T9).**

## ⭐Follow-up 6 (CORREÇÃO DE DIREÇÃO do dono: LLM-first, engine NÃO escreve resposta comercial) — [[pedro-v3-llm-first-no-handler]]
O dono deu regra P0: Pedro v3 é LLM-first (a LLM conduz/redige; engine = memória/segurança/grounding/dedupe/feedback). PROIBIDO
recovery determinístico COMERCIAL (engine escrevendo "Ótima escolha…"/"Prazer, Douglas…"/"Encontrei estas opções…"). Minhas
rodadas 4-5 viraram handler disfarçado (`recovery_selection`, `recovery_name_identified`). **Refatoração desta rodada:**

**Auditoria dos recoveries de central-engine.ts:** MEUS (violação): `recovery_selection`, `recovery_name_identified` → REMOVIDOS.
Pré-existentes comerciais (dívida, load-bearing, NÃO removi cego): `recovery_offer`, `recovery_stock_empty(_conduct)`,
`recovery_relaxed_offer`, `recovery_stock_not_run`, `recovery_detail_*`, `recovery_photo_which`, `buildMoreOptionsScopeQuestion`,
`buildRelaxedOfferResponse`, `buildGenericAdDiscoveryResponse`, `buildEmptySearchConductingRecovery` → PROPOSTA de refatoração
faseada (feedback+retry), aguarda direção. Técnico/factual (mantidos): `recovery_stock_failed`, `recovery_vehicle_detail_fact`,
`recovery_photo_declined`, `buildInstitutionalResponse`, `buildDeterministicPhotoResponse`, `recovery_ask_need` (last-resort degradado).

**T7 (seleção) LLM-first:** removido `recovery_selection`. Quando o cérebro tenta vehicle_details numa seleção, o engine devolve
FEEDBACK com o FATO (o label aterrado do carro escolhido, via `selectionLabel`) — a LLM REDIGE o acolhimento. Real: T7=brain_final.
**T3 (só-nome) LLM-first:** removido `recovery_name_identified`. O nome entra no frame (funnel.known) + prompt manda acolher+avançar;
se a LLM erra, o guard devolve feedback e ela reescreve. Real: T3=brain_final. **Causa-raiz extra descoberta:** o guard
`detectQuestionRepetition` (caso 2) trancava a LLM de reperguntar a descoberta quando o lead deu SÓ o nome ("Douglas" não responde
"o que procura") → fix por semântica: caso 2 pula quando o turno AVANÇOU (`advancedThisTurn`=capturou slot novo); caso 1 (slot já
conhecido) segue protegendo. **T9 telefone:** a LLM pediu "telefone para contato"; a guarda `POL-PHONE-KNOWN` existe mas só liga em
canal `wa:` — o smoke usava id não-`wa:`. Fix: **smoke usa conversationId `wa:`** (reflete produção: todo lead vem do WhatsApp) →
`contactPhoneKnown=true` no frame (prompt já diz "nunca peça telefone") + policy backstop. Real: T9 pede ENTRADA, não telefone.

**Smoke agora REPORTA métricas LLM-first** (regra do dono): responseSource por turno + `llmAuthored`/`technicalFallback`/
`commercialRecovery`; technical_fallback reprova. **Real (`f239-real-smoke-2026-07-08T13-34-48`): 8/9 conduzidos pela LLM
(brain_final=7, brain_retry=1), 0 technical_fallback, 1 recovery comercial (T5 "cadê?" recovery_offer — dívida pré-existente).**
Testes T7/T3 na F2.39 reescritos p/ o padrão feedback+retry (a LLM redige com o fato do feedback; NÃO mais o texto do engine);
F2.7.7 [1c] mantido. **F2.39 52 OK, tsc+test:all EXIT 0, zero regressão** (F2.7.x/F2.24 anti-repetição intactos). Arquivos:
central-engine (remove recovery_selection/name_identified + selectionLabel + feedback de seleção + advancedThisTurn),
question-repetition (advancedThisTurn), run-f239-real-smoke (métricas + wa: id), run-f2-39.

**⏭️ PROPOSTA (aguarda direção, NÃO implementado): refatorar `recovery_offer` (T5 "cadê?") e demais comerciais pré-existentes p/
feedback+retry — a LLM autora a lista (ela JÁ faz em T4/T6). É load-bearing (garante lista aterrada no fail); fazer com teste-antes
+ fallback degradado como última linha.** PARADO para o Codex — nada commitado.

## ⭐Fase 1 (autorizada pelo dono): migrar `recovery_offer` (lista de carros) para LLM-first → **commercialRecovery 1→0**
Regra: o engine NÃO lista os carros no lugar da LLM. Se já existe resultado de stock_search (no turno OU no filtro ativo), o
engine devolve FEEDBACK ao cérebro ("Você já tem o resultado da busca; responda LISTANDO com vehicle_offer_list + pergunta
curta") e a LLM REDIGE a lista. **Causa-raiz:** a busca comercial rodava só na AUTORIA (pós-loop) e o cérebro nunca via o
resultado → `buildContextualRecovery` listava (recovery_offer). **Fix (2 gatilhos, LLM-first):** (1) **RETOMADA** ("cadê?",
`resumeSearchTurn`): o cérebro finaliza sem ter buscado → o ENGINE executa a busca com o FILTRO ATIVO DENTRO do loop + push do
resultado + feedback "liste" → retry (gated em `resumeSearchTurn` p/ não mudar fresh-search — regressão F2.21 [10]/[15]
evitada). (2) **GERAL** (fresh "você tem SUV?" + retomada): quando o cérebro é NEGADO num turno comercial COM itens de busca e o
draft NÃO tem `vehicle_offer_list`, o feedback de deny vira ESPECÍFICO ("liste o resultado com vehicle_offer_list") → a LLM
autora a lista. NÃO toquei em busca-vazia/relaxamento (fora da fatia). **Teste offline T5R** ("cadê?" com activeSearchConstraints:
brain_final/retry, lista SUVs, 1 busca, sem repergunta). **F2.39 54 OK, tsc+test:all EXIT 0, zero regressão** (F2.21 35, F2.23 34,
F2.25 29, F2.26 22, F2.29 37). **⭐SMOKE REAL PASS (`f239-real-smoke-2026-07-08T14-01-09`): 9/9 conduzidos pela LLM (brain_final=6,
brain_retry=3), technical_fallback=0, commercialRecovery=0.** T5 "cadê?"=brain_retry (lista os 5 SUVs), T4 fresh=brain_final,
T9=avaliação (sem telefone/sobrenome). Arquivos: central-engine (busca-no-loop na retomada + feedback de deny "liste"), run-f2-39
(T5R). ⏭️ Próximas fatias (aguardam direção): busca-vazia (`recovery_stock_empty`), relaxamento (`recovery_relaxed_offer`),
discovery de anúncio (`ad_generic_discovery`), escopo de "mais opções". PARADO — nada commitado.

## ⭐Fase 2 (gate repetível 2/2 — audit Codex reprovou por flakiness do gpt-4.1-mini)
O smoke do Codex reprovou (o meu passou 1x): **flakiness real do gpt-4.1-mini** — cada corrida um turno diferente degrada.
Codex viu: LLM 7/9, 1 technical_fallback (T8 pagamento → `recovery_ask_need`), 1 commercialRecovery (T4 fresh "tem SUV?" →
`recovery_offer`). Exigência do dono: **2/2 runs reais PASS, 9/9 conduzidos pela LLM (brain_final/brain_retry),
technical_fallback=0 e commercialRecovery=0 nos DOIS**, ou documentar a variação e corrigir. Regra P0 mantida: **NADA de recovery
comercial determinístico** — a LLM redige, o engine só orienta (feedback+retry).

**Causas-raiz da flakiness residual + fix (todos LLM-first, engine NÃO escreve):**
1. **T4 fresh "tem SUV?" caía em `recovery_offer`.** A Fase 1 já cobria via gatilho GERAL (deny em turno comercial COM itens →
   feedback "liste com vehicle_offer_list"), mas o cérebro às vezes NÃO era negado a tempo (listava em texto livre e o deny de
   grounding vinha depois do orçamento de retry). Sem mudança nova de código aqui além do gatilho geral da Fase 1 — a robustez
   veio do item 3 (condução) NÃO ser mais o único caminho e do teto de retry de listagem já existente. Nos 2 runs: T4=brain_final.
2. **Abertura (`keepRetrying` p/ anúncio genérico/porta fria) — REVERTIDA.** Eu havia adicionado uma branch que forçava retry na
   ABERTURA em vez de cair no `deterministic_discovery`; ela **piorou** o Run 1 (instabilidade, T9 technical_fallback) e estava
   FORA da fatia pedida ("faça só essa fatia" do dono). Removida — a abertura volta a depender do cérebro convergir sozinho (o que
   ele faz numa saudação simples); `deterministic_discovery` fica só como backstop raro.
3. **T8/T9 (CONDUÇÃO: pagamento/troca) caíam em `technical_fallback`.** O feedback de condução só disparava em `moneyDeny`
   (regex de R$/monetário no texto do deny). Quando o deny NÃO era exatamente monetário (ex.: atributo de carro sem aterrar, ou
   volta à descoberta), caía fora → break rápido → `recovery_ask_need` (technical_fallback). **Fix por INVARIANTE:** em turno de
   condução (`isPaymentTurn(leadMessage) || tradeInAnswerTurn`), **QUALQUER deny** recebe o MESMO norte — "acolha + conduza com UMA
   pergunta de avanço (entrada/parcela/avaliação); NÃO afirme valores em R$/mil; NÃO volte à descoberta" — com retry bounded
   (`LIST_MONEY_RETRY_CAP=4`). O único desfecho válido nesses turnos é acolher+conduzir, então orientar todo deny p/ lá é correto.
   `moneyHint` extra quando o deny é monetário. `central-engine.ts` ~L1663 (`else if (conductTurn)`).
4. **Gate do smoke repetível.** `run-f239-real-smoke.ts`: HARD FAIL se QUALQUER turno não for brain_final/brain_retry (9/9), com
   mensagem por turno deduplicada (technical_fallback e commercialRecovery mantêm a mensagem mais específica). Rodar 2x.

**Resultado — 2/2 runs reais PASS (critério do dono atendido nos dois):**
- **Run 1** (`f239-real-smoke-2026-07-08T15-48-36`): 9/9 LLM (brain_final=6, brain_retry=3), technical_fallback=0,
  commercialRecovery=0. T9=brain_retry (o cérebro escreveu um valor → feedback de condução → reescreveu acolhendo a troca +
  pergunta de entrada). 17 chamadas brain.
- **Run 2** (`f239-real-smoke-2026-07-08T15-50-48`): 9/9 LLM (brain_final=8, brain_retry=1), technical_fallback=0,
  commercialRecovery=0. T9=brain_final (o cérebro acertou de primeira). T2=brain_retry (guarda multi-pergunta). 15 chamadas.
- Gates grátis: **tsc EXIT 0, F2.39 56 OK/0 FALHA, test:all EXIT 0** (zero regressão; F2.21/F2.23/F2.24 anti-repetição intactos).

**Arquivos desta fase:** `central-engine.ts` (condução ampliada p/ qualquer deny em turno de pagamento/troca + REVERT da branch de
abertura), `run-f239-real-smoke.ts` (gate 9/9 hard-fail deduplicado). **Nada commitado — PARADO para auditoria do Codex.**
Sobre o resíduo: a diferença entre os runs (T9/T2 ora brain_final ora brain_retry) é a variância NATURAL do gpt-4.1-mini absorvida
pelo feedback+retry — o gate exige o desfecho (9/9 LLM, 0 degradação), não um caminho fixo. Se um run futuro degradar, o smoke
aponta o turno exato para novo feedback (nunca handler comercial).
