# F2.33 — CTWA P0-A (foto do ANO exato do anúncio) + P0-B ("algo parecido" relaxa modelo/marca)

**Data:** 2026-07-07 · **Autor:** Claude (executor) · **Achado por:** auditoria Codex (smoke real `smoke:ctwa`) · **Modo:** central_active
**Gates:** `tsc` EXIT 0 · `test:all` EXIT 0 (F2.33 **16 OK**, F2.32 **27 OK**, zero regressão) · **smoke real PASS nos 3 cenários** (compass, ranger, generic-suv; ~US$0,10)

## Contexto
O Codex criou um smoke real (`eval/run-ctwa-ad-smoke.ts`, `npm run smoke:ctwa`) que injeta `raw.adContext` no 1º evento (como o bridge) e roda o `central_active` com LLM real, efeitos OFF. Achou 2 P0 na fase CTWA (F2.32).

## P0-A — foto pronominal do veículo EXATO do anúncio (modelo+ANO)
**Bug:** anúncio "Jeep Compass 2019", estoque com Compass 2017 E 2019. Lead: "esse ainda tem?" → lista os 2; "me manda fotos dele" → **re-listava os 2, sem send_media**. O engine tratava o anúncio como "jeep Compass" (eu DROPAVA o ano), então "dele" não desambiguava.

**Fix por invariante:** `ad vehicle identity = marca/modelo/ano quando presente e ATERRADO` (não if por marca).
- `ad-context.ts` `resolveAdReferenceKey(ad, offeredItems)`: extrai o ANO do texto do anúncio; casa modelo+ano num veículo ÚNICO já apresentado (`lastRenderedOfferContext.items`) → esse é a REFERÊNCIA do anúncio. 0/>1 matches → null.
- `turn-understanding.ts`: nova fonte de alvo `source="ad_reference"` + `authorizesPhotoByAdReference(target, block)` (alvo ad_reference + verbo de foto; negação barra). Narrow, como o `turn_ordinal` (grounding máximo).
- `central-engine.ts` `resolveTargetWithAd()`: alvo EXPLÍCITO do turno sempre vence; só sem alvo + pedido PRONOMINAL de foto (`!currentHasVehicle && mentionsPhoto`) + referência exata → alvo = o veículo do anúncio. Alimenta o photo-resolve determinístico → `send_media`. (Se >1 do mesmo modelo+ano → null → pergunta qual.)

**Prova (smoke real, compass T3):** "me manda fotos dele" → `send_media(revendamais:7894915)` (o Compass **2019**), "Aqui estão as fotos do JEEP Compass 2019". 0 violações.

## P0-B — "algo parecido" depois do anúncio relaxa modelo/marca
**Bug:** anúncio "Ford Ranger XLT TD 3.2 2016" (sem estoque). T1 "tem esse?" → Ranger vazio. T2 "tem algo parecido até 100 mil?" → busca `{marca:ford, modelo:Ranger, tipo:pickup, cambio:automatic, precoMax:100000}` — **continuou preso em Ranger**; prometia alternativas mas seguia em Ranger.

**Fix por invariante:** intenção de SIMILARIDADE relaxa modelo/marca; mantém só dimensões seguras (tipo/categoria + precoMax; câmbio só se o LEAD pediu neste turno).
- `commercial-constraints.ts` `detectSimilarityIntent(block)` ("algo parecido/semelhante/similar/…") + `relaxToSimilar(c, keepCambio)` (dropa marca/modelos/anos; mantém tipo/precoMax/popular; câmbio só se keepCambio).
- `central-engine.ts`: `similarityTurn` folded em `commercialSearchTurn`/`isSearchishTurn`; relaxa `commercialConstraints` (a recuperação nomeia o TIPO — "picapes até R$ 100.000", não "Ranger").
- `enrichStockSearchCall.relaxToType`: constrói a busca SÓ do escopo relaxado (tipo/preço), IGNORA modelo/marca que o cérebro tenha posto (o engine protege o invariante).

**Prova (smoke real, ranger T2):** "tem algo parecido até 100 mil?" → "Temos algumas picapes até 100 mil que podem te interessar:" — busca por picape, sem Ranger. 0 violações.

## Testes offline — `tests/run-f2-33-ctwa-ad-refinements.ts` (16 OK)
Puros (detectSimilarityIntent, relaxToSimilar, resolveAdReferenceKey [único/ausente/>1], authorizesPhotoByAdReference) + integração: P0-A (Compass 2019 com estoque 2017+2019 → "fotos dele" envia media do 2019), P0-B (Ranger sem estoque → "parecido até 100k" busca {tipo:pickup, precoMax:100000} sem Ranger/Ford, lista Strada), correção Onix vence, institucional não usa estoque.

## Arquivos (só `services/pedro-v3/`, deploy Easypanel)
`Agent/src/engine/commercial-constraints.ts` (similaridade), `central-engine.ts` (relax + ad reference photo), `turn-understanding.ts` (ad_reference target + authorize), `ad-context.ts` (resolveAdReferenceKey), `tests/run-f2-33-*`, `package.json`. **Nenhuma mudança no bridge/edge function** (não precisa redeploy do Supabase).

## Riscos
- `resolveAdReferenceKey` usa a última oferta renderizada (não um search fresco) — cobre o fluxo comum (o lead viu a lista antes de pedir foto). Se o lead pede foto ANTES de qualquer lista, cai no "de qual carro?" honesto.
- Câmbio na similaridade: dropado salvo o lead pedir no turno atual (evita prender "automático" do anúncio).
