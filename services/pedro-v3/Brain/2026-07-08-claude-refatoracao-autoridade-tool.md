# Refatoração de AUTORIDADE (P0) — a LLM decide a tool; o detector só enriquece

**Data:** 2026-07-08/09 · **Autor:** Claude (executor) · **Diagnóstico:** Codex ("dois cérebros") · **Estado:** FEITO+PROVADO (offline + 2/2 smoke real) · **✅ COMMITADO+PUSHADO `main 5f9cfdee` (2026-07-09, aprovado pelo dono + Codex; rebase limpo sobre CRM/feedback, zero conflito).**

## Incidente real (print do dono)
Lead: "tem outros?" → agente honesto. Lead: "tem corolla?" → lista 2 Corollas. Lead: **"Corolla não é um sedan? pq disse
que não tinha?"** → **BUG: o agente RE-LISTOU os Corollas** ("Encontrei estas opções pra você:") como um robô, em vez de
reconhecer a contradição e corrigir.

## Causa-raiz (estrutural, diagnóstico do Codex)
Existiam DOIS cérebros: a LLM entende o turno, e o engine RE-INTERPRETA por detectores
(`commercialSearchTurn = (currentTurnIntent search|other) && sufficientForStockSearch(constraints)`), e o segundo vencia.
O detector via "Corolla/sedan" na CONTESTAÇÃO → constraint suficiente → forçava `stock_search`
(missingTool/`requiredToolBeforeFinal` + executor determinístico F2.26) por cima do entendimento da LLM. O mesmo padrão
causava "Até 2100"→pickup, trocas viravam busca, etc. — cada fix anterior era sintoma.

## A regra nova (invariantes, sem if-por-frase)
**"tem filtro comercial suficiente → busca" MORREU. A regra é: "a LLM classificou o ato conversacional como pedido real
de estoque → pode buscar".** O extractor de filtro virou APENAS preenchedor de argumentos (enriquecimento/merge), nunca
autorizador de tool.

## Mudanças (`central-engine.ts`)
1. **`commercialSearchTurn` (autorizador heurístico) deixou de existir.** Dividido em:
   - `contextualSearchTurn`: SÓ fluxos de contexto conversacional real — entrada por anúncio, similaridade explícita
     ("algo parecido"), retomada ("cadê?" com filtro ativo). Continuam podendo esperar busca.
   - `constraintishTurn`: o sinal heurístico antigo — usado APENAS no merge/enriquecimento do filtro ativo
     (`isSearchishTurn`), sem autoridade.
2. **`brainSearchAct()`** = `lockedU.primaryIntent === "search_stock" && isStockSearchTurn(brainVU())` (ATO declarado +
   capability com evidence validada). É o que autoriza o ENGINE a agir. Capability solta NÃO basta ("quanto custa o
   Onix?" carrega capability de busca sem o ato ser busca).
3. Pontos de decisão re-gateados por `brainSearchAct() || contextualSearchTurn`: `missingTool` (força de busca),
   `searchExpectedThisTurn` (guarda anti-promessa; a parte da LLM entra no ponto da autoria), `listTurn` (feedback de
   listagem) e o **executor determinístico de busca** (F2.26 — o robô do print).
4. **Gate de INTENT CONTRADITÓRIO** (item 5 do Codex): o cérebro chama `stock_search` com `primaryIntent` conversacional
   declarado por ELE MESMO (`conversation_repair`/`financing`/`trade_in`/`smalltalk`) → nega com feedback semântico → a
   LLM responde a conversa. Não é regex de frase: usa a classificação da própria LLM como contrato.
5. **Feedbacks acionáveis (keepRetrying) novos**: (a) `repairTurn` (conversation_repair): "reconheça/corrija/conduza com
   UMA parte text; NÃO use vehicle_offer_list (a lista já foi mostrada); NÃO chame tools"; (b) `emptyStockTurn` (busca do
   turno voltou 0): "seja HONESTO em texto: não há outras opções além das mostradas; conduza; NÃO re-liste" — substitui o
   `recovery_stock_empty` (engine escrevendo) pela autoria da LLM.

## Mudanças (contrato + prompt)
- `agent-brain.ts`: **+`conversation_repair`** no PRIMARY_INTENTS (decode do adapter valida pela lista — entra grátis).
  Os demais intents que o Codex pediu já existiam com outros nomes: answer_financing→`financing`,
  answer_trade_in→`trade_in`, photo_followup→`request_photos`, selection_ack→`select_vehicle` (documentado; sem enum
  redundante).
- `turn-understanding.ts` (`deriveFallbackUnderstanding`): pergunta de ATRIBUTO ("quanto custa o Onix?") vira
  `vehicle_detail` mesmo citando modelo — o ATO vence a keyword (o hint heurístico refletia o bug).
- `openai-agent-brain.ts` (prompt): enum +conversation_repair; ⭐seção "AUTORIDADE DA FERRAMENTA" (a tool segue a INTENÇÃO
  do ato, nunca palavras-chave; na dúvida, CONVERSE); ⭐seção "CONTESTAÇÃO = conversation_repair" (reconheça/corrija/
  conduza; nunca re-liste; texto simples); busca/"mais opções" vazia → honestidade em texto.

## Testes ajustados (o contrato antigo estava codificado nas suítes)
As suítes usavam um responder `resist` com understanding "other" e ESPERAVAM que o engine forçasse busca por constraint
(o comportamento-robô). Ajuste: nos turnos de BUSCA os responders agora DECLARAM o ato (search_stock + capability +
evidence do bloco) — como a gpt-4.1-mini real faz — e continuam resistindo a chamar a tool (o executor garante a
execução; o que as suítes provam — merge/relaxamento/anos rígidos — continua provado, agora sob a autoridade da LLM):
F2.26, F2.27, F2.28, F2.29, F2.30, F2.32 (E/ADGEN-3), F2.33 (R-1), F2.34 (default + deadEnd com evidence), F2.36,
F2.39 (T7/T8/IN-3 com evidence do bloco — a quote fixa "suv" não existia em "tem Renegade 2019?"; o gate P0-2 estava
certo). **F2.25 INT-2 REESCRITO** (o caso codificava a força heurística + recovery_offer, que a regra P0 do dono já
proibia): cérebro "other" → engine NÃO busca, autoria da LLM despachada. F2.31 [I-4] reescrito (responder busca de
verdade; o alvo do caso é o guard de telefone). F2.21 [10] voltou a passar com o fix do derivador.

## Suíte nova — `run-f2-41-tool-authority.ts` (`test:f241`): **11 OK / 0 FALHA**
[A] o print: "tem corolla?" (busca ok) → contestação → 0 stock_search, sem re-lista, brain_final,
primaryIntent=conversation_repair; [B] intent contraditório: LLM classifica repair mas TENTA stock_search → negado →
re-decide e conversa; [C] constraint presente (corolla/sedan) + ato smalltalk → 0 busca, conversa despachada;
[D] autoridade positiva: LLM declara busca sem executar → engine garante (nunca promessa falsa).

## Gates
`npx tsc --noEmit` EXIT 0 · `npm run test:all` EXIT 0 (zero falha; F2.39 56, F2.40 65, F2.41 11, scan 5) ·
⭐**SMOKE REAL 2/2 PASS** (`eval/run-f241-repair-real-smoke.ts`, gpt-4.1-mini, efeitos OFF, estoque real; fluxo do print:
Boa tarde → tem sedan? → tem outros? → tem corolla? → "Corolla nao e um sedan? pq disse que nao tinha?"):
- Run 1: T5 **conversation_repair, brain_retry, 0 tools**, sem re-lista; T3 "tem outros?" **brain_final honesto**
  (antes recovery_stock_empty); 5/5 LLM, 0 technical_fallback, 0 commercialRecovery, compose=0.
- Run 2: idêntico (T5 repair/brain_retry/0 tools; T2/T3/T4 brain_final; T1 backstop de abertura deterministic_discovery
  — aceito, fora do escopo).

## Riscos restantes
- A LLM classificar MAL um pedido real de busca (ex.: "até 50 mil e que seja da volks" como "other") agora resulta em
  CONVERSA (pergunta/esclarece), não em busca forçada — trade-off DECIDIDO pelo dono ("melhor perguntar/explicar do que
  buscar estoque"). O prompt orienta a classificação; se recorrente, reforçar prompt (nunca voltar o detector).
- Abertura (T1) ainda usa backstop `deterministic_discovery`/feedback de draft ocasionalmente — fora do escopo.
- `financialAnswerTurn`/`tradeInAnswerTurn` (BLOQUEADORES por contexto) mantidos — negam tool, nunca autorizam.

**✅ COMMITADO+PUSHADO — `main 5f9cfdee` (2026-07-09). Em produção só no piloto (tenant ecb26258, PEDRO_V3_BRAIN_MODE=central_active).**

## ⭐Hardening (auditoria do Codex — 2026-07-09, aprovado p/ o caso do print, 3 pedidos)
1. **`mentionsMoreOptions` não força busca sob ato conversacional**: novo `conversationalActDeclared()` (a LLM declarou
   conversation_repair/financing/trade_in/smalltalk) gateia os 3 caminhos determinísticos que restavam: (a)
   `requiredToolBeforeFinal` ganhou o parâmetro `moreOptionsSearch` (já gateado no caller); (b) executor determinístico
   de busca; (c) executor de pergunta de escopo (`moreOptionsNeedsScope`). "Você disse que não tinha outras opções, mas
   Corolla é sedan?" casa o regex de 'mais opções' mas o ato vence — a LLM conversa.
2. **Prompt**: as 4 frases fortes antigas condicionadas ao ATO — "QUALQUER filtro → CHAME stock_search" virou "quando o
   ATO for PEDIR ESTOQUE e houver filtro..."; "use SEMPRE stock_search" virou "quando o ato é BUSCA..."; "OBRIGADO a
   devolver stock_search" ganhou a exceção explícita (contestação/financiamento/troca/smalltalk conversam); promessa de
   busca idem.
3. **Teste adversarial** F2.41 caso E: "outras opções" DENTRO de contestação → 0 stock_search (exec+obs), brain_*,
   sem pergunta de escopo determinística, primaryIntent=conversation_repair. **F2.41 agora 14 OK**.

Gates re-rodados: tsc EXIT 0, test:all EXIT 0, smoke real F2.41 PASS (5/5 LLM, 0 fallback, 0 recovery). **✅ COMMITADO `main 5f9cfdee`.**
