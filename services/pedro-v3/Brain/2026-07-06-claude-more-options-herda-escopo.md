# F2.29 — "Mais opções" herda o ESCOPO REAL da última oferta + MOTO fora de lista de carro

**Data:** 2026-07-06 · **Autor:** Claude (executor) · **Audita:** Codex · **Modo:** central_active (piloto Douglas, tenant `ecb26258`)
**Gates:** `tsc --noEmit` EXIT 0 · `test:all` EXIT 0 (F2.29 **37 OK**; nenhuma regressão) · **NÃO deployado ainda** (aguarda ok do dono)

## Incidente (evidência real, tenant ecb26258)
- **T1** lead `"conheço\nVocê tem sedan?"` → `reason_code=list_sedan_options`, lista de sedans correta, **mas `activeSearchConstraints=null`**.
- **T2** lead `"Tem outros?"` → `reason_code=list_more_options` → **lista GENÉRICA barata**, incluindo **HONDA CB 2024 (uma MOTO)**.

**Causa-raiz:** o escopo comercial (`activeSearchConstraints`) NÃO era persistido a partir da busca EXECUTADA — só do texto do bloco atual. Como "Você tem sedan?" listava via caminho que não gravava o filtro, o próximo turno ("tem outros?") não tinha de onde herdar tipo=sedan → o engine caía em busca ampla → lista genérica + moto.

## Solução (por INVARIANTE, não if-de-resposta-pronta)
Estado comercial ativo + escopo da última oferta + taxonomia default excluindo não-carros. O cérebro decide e redige; o **engine GARANTE** que "mais opções/outros" não roda sem escopo.

### Fix 1 — persistir o escopo da busca EXECUTADA (causa-raiz)
`commercial-constraints.ts` → **`activeConstraintsFromStockInput(filtersUsed)`**: extrai o escopo comercial (marca/modelos/tipo/precoMax/câmbio/anos/popular) do INPUT REAL da `stock_search` (ignora excludeKeys/broad/includeMotorcycles). No commit (`central-engine.ts`), a fonte de verdade passa a ser a última `stock_search` dos `facts` (`filtersUsed`); fallback = filtro do texto. Assim T1 sedan grava `{tipo:sedan}` e T2 herda.

### Fix 2 — MOTO nunca em lista de carro (default exclui; opt-in se o lead pede moto)
- `read-ports.ts`/`decision.ts`: novo campo `includeMotorcycles?` no filtro de busca.
- `stock-source.ts`: **`isMotorcycleVehicle(category, bodyType, modelName)`** (fato da fonte + modelo de moto conhecido — CB/CG/Biz/Titan/Fan/Bros/XRE/CBR/Twister/Hornet/Fazer/YBR/Factor/XTZ/NMax/PCX…). Filtro DEFAULT `if (!filters.includeMotorcycles) exclui moto`, ANTES do filtro de tipo. A taxonomia de carro não conhece moto (`resolveVehicleTypeFromTaxonomy => null`), então um CB com categoria errada ("carro") ainda é pego pelo modelo — **o fato/heurística vence um `tipo` errado da API**.
- `commercial-constraints.ts` → **`mentionsMotorcycle(block)`** (palavra "moto/scooter/…", conservador, não infere por modelo). O engine só passa `includeMotorcycles=true` quando o lead pede moto (`enrichStockSearchCall.wantsMotorcycle`).

### Fix 3 — derivar tipo de oferta HOMOGÊNEA (invariante 3)
- `conversation-state.ts`: `RenderedOfferItem.tipo?` (aterrado do fato) + `offer-context.ts` popula.
- `commercial-constraints.ts` → **`deriveScopeFromHomogeneousOffer(items)`**: 5 sedans → `{tipo:sedan}`; tipos mistos OU algum sem tipo → `null` (não inventa).

### Fix 5 — "mais opções" sem escopo recuperável → PERGUNTA (nunca lista genérico)
- `central-engine.ts`: `moreOptionsDerivedScope` (deriva da oferta homogênea) → `effectiveSearchScope` (comercial se suficiente; senão derivado) → `moreOptionsNeedsScope` (nem comercial nem derivável).
- Executor de busca determinístico usa `effectiveSearchScope` (só busca COM escopo).
- `requiredToolBeforeFinal` **NÃO força busca** de "mais opções" quando `moreOptionsNeedsScope` (senão devolveria a lista genérica).
- Novo executor determinístico **`buildMoreOptionsScopeQuestion`** (reason_code `more_options_needs_scope`): "…você quer ver outros de qual tipo (SUV, sedan, hatch, picape) ou faixa de valor?" — dispara no else-branch (fallback quando o cérebro não autora), antes da recuperação.

### Invariante 7 (teto/marca/câmbio/ano preservados)
`mergeActiveConstraints` já preserva por dimensão; o merge roda sobre o escopo persistido (Fix 1) → "SUV automático até 90 mil" → "tem mais?" herda tipo+câmbio+precoMax + excludeKeys.

### MORE_RX estendido (invariante 2)
`turn-frame-builder.ts`: cobre "tem mais?"/"mais algum(a)" além de "tem outros/outras opções/mais opções", **exceto** "tem mais informações/detalhe/sobre/dados" (pedido de INFO do carro atual, não de outros veículos).

### Fix 4 — observabilidade em `decision_final`
`activeSearchConstraintsBefore/After`, `stockSearchInputExecuted` (=filtersUsed real), `moreOptions`, `moreOptionsNeedsScope`, `moreOptionsInheritedScope`.

## Testes — `tests/run-f2-29-more-options-scope.ts` (37 OK)
- **Puros:** deriveScope (homogêneo/misto/sem-tipo/vazio), mentionsMotorcycle, activeConstraintsFromStockInput, MORE_RX (tem outros/tem mais/tem mais informações/outras opções).
- **A (regressão do print):** sedan → persiste `{tipo:sedan}`; "tem outros?" herda tipo=sedan + excludeKeys, **sem moto/SUV/hatch**.
- **B (teto):** SUV até 90 mil → "tem mais?" herda tipo+precoMax.
- **C (SUV/câmbio):** SUV automático até 90 mil → "tem outros?" herda tipo+câmbio+teto.
- **D (sem escopo):** "tem outros?" no vácuo → `more_options_needs_scope`, pergunta tipo/faixa, **sem stock_search**, sem lista; resist → engine não força busca genérica.
- **E (moto):** "tem Honda?" lista Civic e **não** a CB; opt-in `includeMotorcycles=true` traz a CB; busca ≤40k **exclui** a CB (32k).
- **F (observabilidade):** activeAfter persistido + input executado herdado.

## Arquivos tocados (só `services/pedro-v3/`)
`Agent/src/engine/commercial-constraints.ts`, `central-engine.ts`, `offer-context.ts`, `turn-frame-builder.ts`, `Agent/src/domain/conversation-state.ts`, `decision.ts`, `read-ports.ts`, `Agent/src/adapters/read/stock-source.ts`, `Agent/tests/run-f2-29-more-options-scope.ts`, `Agent/package.json`.

## Pendências
- Smoke real 6 turnos **não rodado** (sem `OPENAI_API_KEY` local; sem `.env`; resolução via `EVAL_OPENAI_API_KEY`/Vault indisponível offline). Os testes offline replicam o cenário do print com engine + estoque reais (fake stock + LLM scriptado).
- Aguardando auditoria Codex + ok do dono para push/deploy.
