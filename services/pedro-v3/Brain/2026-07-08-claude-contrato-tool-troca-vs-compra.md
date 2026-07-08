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
