# Anúncio específico = FOCO no veículo EXATO (não filtro amplo) — P0 CTWA

**Data:** 2026-07-08 · **Autor:** Claude (executor) · **Missão:** dono (P0 CTWA) · **Modo:** central_active (singleAuthor+llmFirst)
**Base git:** `9c9dca7e` · **Gates:** `tsc` EXIT 0 · `test:all` EXIT 0 (F2.38 **17 OK**, zero regressão) · **Sem commit** (aguarda auditoria/autorização).

## Diagnóstico (causa-raiz)
`extractAdVehicleConstraints` (ad-context.ts) **DROPAVA o ANO do anúncio** por decisão antiga ("ano é dica fraca — data da
arte"). Consequência: anúncio "Jeep Compass 2019" virava busca `{marca:jeep, modelo:compass}` SEM ano → o estoque devolvia
Compass 2017 **e** 2019 → o agente listava os dois (ou alternativas). Isso trata anúncio específico como **filtro amplo**,
não como **foco selecionado**.

## Invariante principal (a correção)
**Anúncio específico = foco inicial selecionado no veículo EXATO.** Alternativas só aparecem quando o LEAD pede.
- **`resolveAdFocusedVehicle(ad)`** (novo, ad-context.ts) → `AdFocusedVehicle {source:"ad", marca, modelo, ano?, precoMax?}`
  incluindo o ANO (via `adYears`, greeting-primário).
- **Injeção do ano na busca (engine):** `adExactFocusTurn = llmFirst && adEntryTurn && adFocus.ano != null &&
  !asksAdAlternatives && !similarityTurn`. Nesse caso `commercialConstraints.anos = [ano]` → a busca (forçada OU do cérebro,
  via `enrichStockSearchCall` que agora preenche `anos`) filtra modelo+ANO → resolve o Compass **2019** exato. O ano é RÍGIDO
  (F2.28) — 0 resultados → recuperação honesta nomeando "Compass 2019", NÃO lista outros.
- **Não vaza:** o ano injetado pelo anúncio **NÃO persiste** em `activeSearchConstraints` (removido no commit quando o lead
  não deu ano próprio). Assim os turnos seguintes não herdam 2019.
- **Alternativas / troca (automático via gates existentes):** "tem outro Compass?" nomeia o modelo → `currentHasVehicle` →
  NÃO é adEntryTurn → busca `{modelo:compass}` sem ano → lista o OUTRO (2017; o 2019 já mostrado é excluído pelo clamp de
  apresentados). "na verdade quero Onix" → `mergeActiveConstraints` solta o modelo do anúncio → busca Onix. `asksAdAlternatives`
  (novo) é trava extra contra "outro/outros/mais barato".
- **Prompt:** bloco novo "ANÚNCIO ESPECÍFICO = FOCO no veículo EXATO" — na 1ª interação fale SÓ do carro do ano do anúncio;
  liste outros anos/variações só se o cliente pedir; múltiplas unidades exatas iguais → só essas; sem match → honesto.
- **`adVehicleHint`** agora inclui o ano ("Jeep Compass 2019") → o guardrail `specificAdVehicle` e o cérebro veem a identidade exata.
- **Fotos "dele":** inalterado — `resolveAdReferenceKey` (modelo+ano entre ofertados) resolve o Compass 2019 exato + curadoria ≤5 (missão anterior).

## Arquivos (só `services/pedro-v3/`)
`src/engine/ad-context.ts` (AdFocusedVehicle + resolveAdFocusedVehicle + asksAdAlternatives) · `src/engine/central-engine.ts`
(adFocus/adExactFocusTurn; injeta anos em commercialConstraints; enrich preenche anos; adVehicleHint com ano; não persiste o
ano do anúncio) · `src/adapters/llm/openai-agent-brain.ts` (prompt foco exato) · **NOVO** `tests/run-f2-38-ad-exact-focus.ts` ·
`package.json` (test:f238) · `eval/run-ctwa-ad-smoke.ts` (cenário `ad-exact-focus` = Conversa A).

## Testes offline + resultados
**F2.38 17 OK / 0 FALHA:** U-1..4 (puro: resolveAdFocusedVehicle, asksAdAlternatives) + **AD-1** (Compass 2019 + "Olá" →
busca anos=[2019], lista 2019, NÃO 2017, sem nome/telefone) + **AD-2** (fotos dele → send_media do 2019, ≤5) + **AD-3** ("tem
outro Compass?" → sem ano, lista o outro 2017) + **AD-4** ("quero Onix" → busca Onix, anúncio não prende) + **AD-5** (Compass
2015 sem match → honesto, NÃO lista 2017/2019) + **AD-6** (anúncio genérico → discovery, não nome). `tsc`+`test:all` EXIT 0,
zero regressão (F2.33 [A-1] segue verde: assertiva checa "Compass"+"2019" = o foco exato agora).

## Relatório real por turno — ⚠️ NÃO EXECUTADO (sem chave OpenAI local)
Não há `OPENAI_API_KEY`/`.env` no ambiente → não rodei as 2 conversas reais (não vou mascarar). O gate está PRONTO no smoke
sancionado: cenário `ad-exact-focus` (Conversa A: Olá / fotos dele / tem outro compass? / quero Onix) com asserções de
qualidade (fala do Compass, foto ≤5, alternativa só quando pedida, Onix vence no T4) + `opening-photos` (Conversa B). Rodar:
`PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 CTWA_SMOKE_SCENARIO=ad-exact-focus npm run smoke:ctwa` (+ `opening-photos`).

## O que ainda pode falhar (honesto)
- **Múltiplos anos no texto do anúncio:** `adYears` pega o ÚLTIMO 4-dígitos (greeting-primário). Anúncio com 2 anos no body
  ("revisados desde 2020, Compass 2019") pode pegar o ano errado — follow-up: ancorar o ano ao modelo.
- **Versão/motor:** ainda não extraído (só marca/modelo/ano/preço). Se dois Compass 2019 de versões diferentes, ambos são
  candidatos exatos (comportamento aceitável da missão, ponto 6).
- **Real eval não executado** (chave). Assim que rodar, anexar o relatório por turno.

## ⭐Follow-up P0 (audit smoke real do dono: `ctwa-ad-smoke-…T00-14-29`, 1 violação em T3)
**Furo:** em "tem outro compass?" a resposta final ficou boa (listou 2017 via retry), MAS a 1ª `stock_search` EXECUTADA saiu
presa no ano: `{"modelo":"Compass","marca":"Jeep","anos":[2019],"excludeKeys":[…]}`. **Causa:** o CÉREBRO carimba
`anos:[2019]` (vê `adVehicle="Jeep Compass 2019"`) e o `enrichStockSearchCall` PRESERVA o valor explícito do cérebro — o
"não persiste depois" e o "corrige no retry" não bastavam; a chamada EXECUTADA já saía errada.
**Fix por invariante (antes de executar a tool):** novo `dropAdYear = llmFirst && asksAdAlternatives(leadMessage) &&
!(currentConstraints.anos?.length)`. `enrichStockSearchCall` ganhou a opção `dropAdYear` que REMOVE `anos` do input FINAL
(preserva modelo/marca/excludeKeys). Passado aos 2 sites executados (busca do cérebro + busca forçada). Se o LEAD citar ano
("tem outro Compass 2018?") → `currentConstraints.anos=[2018]` → dropAdYear=false → respeita o ano do lead.
**Polimento T1:** foco exato + 1 resultado → `buildContextualRecovery` usa texto SINGULAR "Encontrei o Jeep Compass 2019 do
anúncio:" (via novo `adVehicleLabel`), não "Encontrei estas opções".
**Testes:** F2.38 **21 OK** (+ **AD-3c** cérebro carimba anos=[2019] → chamada EXECUTADA sai SEM anos, NÃO via retry; **AD-3c2**
preserva Compass; **AD-3d** lead cita 2018 → respeita o lead; **AD-1d** texto singular "do anúncio"). tsc+test:all EXIT 0,
zero regressão. Smoke `ad-exact-focus` endurecido (T3 reprova se `anos` na chamada executada sem o lead ter citado ano).

**PARADO para auditoria do Codex — nada commitado.** ⚠️smoke real `ad-exact-focus` a re-rodar com chave (esperado 0 violações).
