# Financial value vs year (P0) — "Até 2100" respondendo parcela NÃO pode virar busca

**Data:** 2026-07-08 · **Autor:** Claude (completou WIP do Codex) · **Estado:** FEITO+PROVADO (offline + 2/2 smoke real). **NÃO commitado.**

## Incidente real (WhatsApp)
Agente conduziu bem até financiamento: "Você tem valor para dar de entrada?" → "Tenho 8k" → "Qual parcela mensal
caberia?" → **"Até 2100 ta bom"** → **BUG: acionou stock_search e respondeu "PICKUP até R$ 2.100 eu não encontrei nessa
faixa, mas tenho estas do mesmo tipo..."**. O lead estava respondendo a PARCELA, não pedindo estoque/pickup.

## Causa-raiz
`moneySpans` tem uma proteção **global** correta: número em 1900–2100 sem R$/mil = ANO, não dinheiro ("Compass 2019").
Mas **2100 cai nesse range** → "Até 2100" tinha o valor **descartado** como ano → `moneyByClause` vazio → o valor NÃO
virava parcela → o turno era classificado como busca (herdando o tipo pickup do contexto) → stock_search com precoMax.
O WIP do Codex (relaxar o ano com cue financeiro) estava **quebrado por mojibake**: o regex de cue era `at[eÃ©]`/`por
m[eÃª]s` (é→Ã©, double-encoding) → nunca casava "até"/"por mês"; e não cobria "2100" pelado nem travava referência a veículo.

## Invariante (contextual, sem handler / sem if-por-frase)
Um número no range de ANO (1900–2100, sem separador/mult/R$) é **VALOR financeiro** quando:
1. há **cue financeiro colado** no texto (até/parcela/entrada/R$/por mês/sinal), OU
2. o **contexto da conversa é financeiro** (`financialContext`): respondendo parcela/entrada/pagamento pendente, OU
   financiamento em andamento (carro selecionado + entrada/pagamento/parcela conhecidos);
**E** a fala **não referencia um veículo** (tipo/modelo). Senão continua sendo ANO ("Compass 2019"/"Onix 2020").

## Fixes (arquivos)
`src/engine/lead-extraction.ts`:
- `moneySpans(message, financialContext=false)`: km-check ANTES do ano; `hasSep` computado antes; guarda de ano vira
  `!mult && !hasCurrency && !hasSep && 1900..2100 && !financialCue && !financialContext`. **Mojibake corrigido**
  (`at[eé]`, `por m[eê]s`). "2.100" (com separador) e "até 2100" (cue) já viram valor; contexto libera "2100" pelado.
- `moneyByClause(message, financialContext=false)`: propaga o flag.
- `isAnswerToFinancialQuestion(msg, expected, interpretation?, claimExtractor?)`: se a pergunta pendente é financeira,
  `financialContext = !hasVehicleRef` (parseVehicleType + detectInterestModels) → "2100" respondendo parcela é valor;
  "Compass 2019" (tem veículo) fica ano.
- `isFinancialValueDuringSelectedFinancing(...)` (helper do Codex, **completado**): financiamento em andamento + sem
  compra nova + **sem referência a veículo** + `moneyByClause(msg, /*financialContext*/ true)` não-vazio. Trava "Compass 2019".
- `extractLeadSlots`: computa `financialContext = !newBuyIntent && !msgHasVehicleRef && (expectedIsFinancial ||
  paymentInProgress)` e passa a `moneyByClause`; `financingValue` idem. Assim "Até 2100"/"2100"/"uns 2100"/"até 2.100"
  respondendo parcela → `parcelaDesejada`, e `faixaPreco` NUNCA recebe o valor de resposta financeira.

`src/engine/central-engine.ts` (WIP do Codex, mantido/ajustado): `financialValueInProgress` +
`financialAnswerTurn = ((pendingFinancialQuestion && isAnswerToFinancialQuestion) || financialValueInProgress) && ...` +
`financialAnswerSlot` no feedback de bloqueio. `isAnswerToFinancialQuestion` agora recebe interpretation+claimExtractor.
Em turno financeiro o engine BLOQUEIA stock_search/vehicle_details/vehicle_photos_resolve com feedback semântico (a LLM
reautora conduzindo o financiamento) e reconcilia `primaryIntent=financing`. **O engine NÃO escreve a resposta comercial.**

## Gates
- `npm run test:f240` → **65 OK / 0 FALHA** (novos: P-progress-3/4 [Compass 2019=false, 2100=true]; E-2100/b/c/d/e
  ["Até 2100"/"2100"/"uns 2100"/"até 2.100" → parcela=2100, sem faixaPreco]; E-8k [8000]; E-ano/b [Compass/Onix ano ≠ valor];
  E-busca [pickup 90 mil = faixaPreco]; **G-2100-a..g E2E do print** [0 tools comerciais, parcela=2100, entrada=8000
  preservada, faixaPreco≠2100, primaryIntent=financing, brain_*]).
- `npm run test:f239` → **56 OK**. `npx tsc --noEmit` → **EXIT 0**. `npm run test:all` → **EXIT 0** (zero regressão).
- **⭐SMOKE REAL 2/2 PASS** (`eval/run-f240-2100-real-smoke.ts`, gpt-4.1-mini, efeitos OFF; fluxo do print:
  Boa tarde → quero um Compass → gostei do primeiro → quais as condições? → **Tenho 8k** → **Ate 2100 ta bom**):
  - Run 1 (`...T23-01-52`): T5 **entrada=8000**, T6 **parcelaDesejada=2100**, T5/T6 **0 stock_search**, faixaPreco≠2100,
    6/6 LLM (final=3, retry=3), technical_fallback=0, commercialRecovery=0, compose=0.
  - Run 2: idêntico (entrada=8000, parcela=2100, 0 stock_search, 6/6 LLM, 0 fallback/recovery). T6=brain_retry (o cérebro
    escreveu um valor → feedback de condução → reescreveu). T1 exercitou o guard de encoding do Codex (corrupção→reautora).

## Riscos restantes
- gpt-4.1-mini às vezes escreve valor em R$/mil na condução → feedback+retry corrige (brain_retry), mas custa 1 passo.
- Se o lead disser "2100" **e** citar um carro no MESMO turno ("Compass 2100"), o número fica ano (trava de veículo) —
  correto p/ o incidente, mas um caso raro "quero X, parcela 2100" cairia como ano; não observado, aceitável por ora.
- Números fora do range de ano (ex.: "1200", "8k", "90 mil") nunca dependeram desse fix — inalterados.

**PARADO — nada commitado. Aguarda autorização do dono.** WIP do Codex auditado e completado (mojibake + bare-2100 +
trava de veículo + testes + smoke).
