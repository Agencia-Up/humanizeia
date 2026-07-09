# Financial Question Context (P0) — resposta financeira NUNCA vira busca de estoque

**Data:** 2026-07-08 · **Autor:** Claude (executor) · **Estado:** FEITO + PROVADO (offline + 2/2 smoke real). **NÃO commitado — aguarda auditoria do Codex.**

## Incidente real (WhatsApp do Douglas)
Lead selecionou JEEP Compass 2017 → "Quais as condições?" → agente perguntou entrada → "tenho não" → agente perguntou
parcela → **"Até 1200"** → **BUG: o agente acionou `stock_search` e re-listou Compass 2017/2019.** "Até 1200" respondia a
PARCELA mensal, não era pedido de estoque nem orçamento de compra.

## Regra (LLM-first, P0 do dono — [[pedro-v3-llm-first-no-handler]])
O agente precisa LEMBRAR qual pergunta acabou de fazer. Se perguntou entrada/parcela/troca/pagamento, a resposta curta do
lead é interpretada nesse contexto financeiro, não como busca nova. **Sem handler que escreve resposta, sem if-por-frase, sem
recovery comercial.** O engine só: mantém/deriva o contexto da pergunta anterior; classifica a resposta no slot certo; bloqueia
tool comercial errada; dá FEEDBACK ao cérebro para reautor. A LLM conduz e redige.

## Contrato (3 helpers PUROS em `lead-extraction.ts`)
- `inferExpectedAnswerContext(state)` → `{slot, kind}` (kind: financial|trade|discovery|other) — deriva de `currentObjective`
  OU da última PERGUNTA do agente.
- `hasExplicitNewCommercialSearchIntent(msg, interp, extractor)` — COMPRA nova explícita (verbo+veículo, "tem X?", "outro
  carro"); NÃO casa valor solto/negção/pagamento. Vence o contexto financeiro (caso "na verdade quero Onix até 80 mil").
- `isAnswerToFinancialQuestion(msg, expected)` — valor / negação de entrada / forma de pagamento; não é pergunta nova.

## Fixes
1. **Extração (`lead-extraction.ts`):** `moneyByClause("Até 1200")` marcava role=**budget** (por "até") → gravava
   `faixaPreco.max=1200` (BUG). Agora, respondendo parcela/entrada pendente (sem intenção de compra nova), o valor vai ao slot
   ESPERADO — o cue "até" NÃO desvia para faixaPreco. `faixaPreco` só recebe valor fora de resposta financeira.
2. **`inferredQuestionSlot` lê a CLÁUSULA INTERROGATIVA** (`lastAgentQuestionText`), não o statement de acolhimento — "Entendi
   que você não tem entrada. Qual parcela cabe?" → parcela (antes "entrada" do acolhimento contaminava).
3. **Contexto de FINANCIAMENTO → parcela:** carro selecionado + pagamento em andamento (entrada/parcela/pagamento conhecidos) +
   valor solto sem compra nova (e não é carro de troca) → o valor é PARCELA, mesmo quando a pergunta pendente é TROCA/outra.
   Cobre o run real (lead volunteou "até 1200" enquanto o agente perguntava troca).
4. **Engine autoritativo p/ valores monetários (`central-engine.ts`):** se `extractLeadSlots` já atribuiu um slot financeiro
   ({entrada, parcelaDesejada, faixaPreco}) no turno, DESCARTA a atribuição financeira CONFLITANTE do cérebro (o LLM tinha posto
   `entrada=1200` por palpite). Slots não-financeiros do cérebro seguem intactos.
5. **`financialAnswerTurn` (`central-engine.ts`, paralelo ao `tradeInAnswerTurn`):** pergunta pendente financeira
   (parcela/entrada/pagamento) + `isAnswerToFinancialQuestion` + `!explicitBuyIntent` + não é foto/institucional/detalhe →
   BLOQUEIA stock_search/vehicle_details/vehicle_photos_resolve (feedback ao cérebro) + é `conductTurn` (condução de
   financiamento) + `commercialSearchTurn`/`searchExpectedThisTurn`/`missingTool` excluídos + `primaryIntent` reconciliado
   =`financing`.
6. **Pergunta financeira DUPLA proibida (caso F):** `financialDimensionsAsked(text)` conta dimensões {entrada, parcela, troca,
   pagamento} nas SENTENÇAS INTERROGATIVAS; >1 → deny + feedback "UMA por vez (ordem troca→entrada→parcela)". A LLM reautora.
   Feedbacks de pagamento existentes alinhados a "UMA pergunta por vez".
7. **Prompt (`openai-agent-brain.ts`):** "RESPOSTA FINANCEIRA ≠ pedido de estoque" — valor curto após pergunta financeira
   responde ESSA pergunta; "até 1200" = parcela, não faixaPreco/busca; condições de pagamento são conversa, não busca.

## Testes
- **`run-f2-40-financial-context.ts` (novo, `test:f240`): 40 OK / 0 FALHA.** PARTE 1 (pura): helpers + `extractLeadSlots`
  (casos 1/2/3/4/E + o caso REAL "pergunta troca pendente + financiamento → parcela"). PARTE 2 (engine E2E, harness estilo
  F2.39): G1 "até 1200" → 0 stock_search + parcelaDesejada=1200 + faixaPreco≠1200 + brain_*/financing; G2 "tenho não" →
  entrada=0 + 0 stock; G4 "na verdade quero Onix até 80 mil" → busca 1x (intenção nova vence); G5 pergunta dupla → deny → reautor.
- **F2.39 alinhada:** 2 responders de condução usavam pergunta DUPLA ("troca ou entrada", "entrada ou simular") — agora UMA
  pergunta (o guard novo os negava, corretamente). F2.39 56 OK.
- **Gates:** `tsc` EXIT 0, `test:all` EXIT 0 (zero regressão), `test:f240` 40 OK.
- **⭐SMOKE REAL 2/2 PASS** (`run-f240-financial-real-smoke.ts`, gpt-4.1-mini, efeitos OFF, cenário do incidente:
  "Boa tarde"→"quero um Compass"→"gostei do primeiro"→"quais as condições?"→"tenho não"→"até 1200"):
  - Run A (`f240-financial-real-smoke-2026-07-08T17-37-47`): T6 **parcelaDesejada=1200**, T5 entrada=0, T5/T6 **0 stock_search**,
    faixaPreco NÃO 1200, 6/6 LLM (brain_final=5, brain_retry=1), technical_fallback=0, commercialRecovery=0, compose=0.
  - Run B: idêntico (parcelaDesejada=1200, 0 stock, 6/6 LLM, 0 fallback/recovery).
  - **Nota do 1º run (pré-fix 3+4):** o agente conduziu entrada→TROCA (não parcela) e o cérebro pôs `entrada=1200` por palpite →
    fixes 3+4 (financiamento→parcela + engine autoritativo) corrigiram para `parcelaDesejada=1200`.

## Arquivos
`src/engine/lead-extraction.ts` (3 helpers + extração financeira + `inferredQuestionSlot` interrogativo + financiamento→parcela),
`src/engine/central-engine.ts` (`financialAnswerTurn` + bloqueio de tool + engine-autoritativo de valores + guard pergunta-dupla
+ feedbacks 1-pergunta), `src/adapters/llm/openai-agent-brain.ts` (prompt), `tests/run-f2-40-financial-context.ts` (novo),
`tests/run-f2-39-tool-contract-tradein.ts` (alinhada), `eval/run-f240-financial-real-smoke.ts` (novo), `package.json` (test:f240).

**PARADO — nada commitado. Aguarda auditoria do Codex.**
