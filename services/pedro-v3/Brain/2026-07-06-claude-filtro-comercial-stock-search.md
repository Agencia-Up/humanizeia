# 2026-07-06 — P0 (LLM-first): filtro comercial DISPARA stock_search

**Autor:** Claude (executor). **Estado:** implementado + gates verdes (`tsc` EXIT 0, `test:all` EXIT 0, **F2.25 29 OK**, F2.24 44, F2.22 21, zero regressão). **NÃO commitado, NÃO deployado** (aguarda ok do dono). `central_active` mantido. Sem SQL, sem CRM/handoff.

## Incidente (banco, tenant ecb26258)
"Até 50 mil e que seja da volks" → `recovery_stock_not_run` / "Qual modelo ou tipo de carro você procura?". O lead JÁ deu marca ("volks") + teto ("até 50 mil") e o agente reperguntou. Causa: `requiredToolBeforeFinal` forçava a busca SÓ pela semântica do cérebro (`isStockSearchTurn(brainVU())`); quando o cérebro sub-classificava, nada forçava a tool e o turno degradava em recuperação genérica.

## Correção — por INVARIANTES (não if-por-frase)
1. **Módulo puro `commercial-constraints.ts`**: `detectCommercialConstraints(bloco)` → `{marca?,modelo?,tipo?,precoMax?,cambio?,popular?}` (reusa `computeTurnFrame` do explicit-search p/ modelo/tipo/orçamento/câmbio + `detectBrand` por SINÔNIMO: volks/vw→volkswagen, chevy/gm→chevrolet, etc. + sufixo "50k"→50000 + popular dos signals). `sufficientForStockSearch(c)` = marca|modelo|tipo|precoMax|cambio|popular.
2. **Força determinística** (`central-engine`): `commercialSearchTurn = (currentTurnIntent==="search" || "other") && sufficientForStockSearch(constraints)`. `requiredToolBeforeFinal(...)` passa a exigir stock_search por `isStockSearchTurn(brainVU()) || commercialSearchTurn`. **GATE por intenção**: `deriveCurrentTurnIntent` já dá precedência foto>institucional>busca, então "me manda foto do Onix" = photo_request (NUNCA forçado a buscar — regressão F2.22 [O] coberta).
3. **`stock_search` aceita `marca`**: campo novo no input (`decision.ts`) + `StockSearchFilters` (`read-ports.ts`) + filtro por markName no `stock-source.ts` (inclusão bidirecional, tolera "volks"⊂"volkswagen") + schema no prompt do cérebro (`openai-agent-brain.ts` + `openai-chat-model.ts`) + decode (`marca` parseada).
4. **Enriquecimento da chamada EXECUTADA** (`enrichStockSearchCall`): preenche LACUNAS (marca canonicalizada, precoMax, tipo, câmbio) que o cérebro omitiu — o valor explícito do cérebro SEMPRE vence. Assim a busca aterra mesmo se a LLM esquecer um filtro.
5. **Recuperação honesta e contextual**: `searchHint` inclui `constraints` (constraint presente → recuperação vai p/ busca, não genérico). Novo `recovery_stock_will_search` ("Deixa eu procurar Volkswagen até R$ 50.000...") quando há constraint e nenhuma busca rodou (NUNCA `recovery_stock_not_run`, NUNCA "qual modelo?"). `recovery_stock_empty` NOMEIA o filtro ("Não achei Volkswagen até R$ 20.000 agora. Quer que eu amplie para opções parecidas na mesma faixa?").

## Invariantes (do pedido do dono) — todos cobertos
- (1) filtro comercial novo no bloco → `commercialConstraintDetected`. ✅ `detectCommercialConstraints`.
- (2) `sufficientForStockSearch` = marca|modelo|tipo|preçoMax|popular|câmbio + contexto. ✅
- (3) llmFirst + constraint + nenhuma stock_search → engine NEGA final com feedback. ✅ `requiredToolBeforeFinal` (feedback nomeia marca/preço/tipo).
- (4) NUNCA "qual modelo/tipo?" quando o lead já deu modelo/marca/tipo/teto. ✅ força + recovery_will_search.
- (5) constraints do turno na busca (marca VW + preçoMax 50k), sem zerar. ✅ enriquecimento (o bloco "até 50 mil e que seja da volks" carrega ambos).

## Gates
- `tsc --noEmit` EXIT 0; `test:all` EXIT 0 (F2.25 **29 OK** — 15 puros detecção/marca/enrich, INT-1 força+enriquece+lista Gol/exclui Palio+Polo, INT-2 resiste→will_search nomeia filtro, INT-3 foto não forçada, INT-4 vazio nomeia filtro; F2.24 44, F2.22 21, sem regressão). `test:f225` verde.
- **F2.25 replica DETERMINISTICAMENTE os turnos 4 e 5 do critério de aceite** (Palio/Gol força busca; "até 50 mil da volks" → stock_search marca=volkswagen+precoMax=50000 → lista Gol; vazio → honesto + alternativa; sem re-pergunta).

## Teste real barato — PENDENTE (precisa da chave)
`OPENAI_API_KEY` não está neste ambiente. O eval real gpt-4.1-mini (5 turnos: Boa tarde / Douglas / carro popular / Tem palio? Ou gol? / Até 50 mil e que seja da volks) precisa da chave do tenant/env. Rodar com a chave setada: `npm run smoke:audit` (ou script dedicado). A F2.25 já prova o comportamento offline.

## Arquivos
- **novo** `Agent/src/engine/commercial-constraints.ts`; **novo** `Agent/tests/run-f2-25-commercial-constraint-search.ts`.
- `central-engine.ts` (força + enrich + recovery), `decision.ts` (marca no input), `read-ports.ts` (marca no filtro), `adapters/read/stock-source.ts` (filtro marca), `adapters/llm/openai-agent-brain.ts` + `openai-chat-model.ts` (schema/decode marca), `package.json` (test:f225 + test:all).

## Próximos passos
1. Codex audita.
2. (Com a chave) rodar o eval real de 5 turnos.
3. Commit só pedro-v3 + push main (deploy) — quando o dono autorizar.
4. NÃO mexer em CRM/handoff.
