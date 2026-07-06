# 2026-07-06 — P0 (audit Codex F2.25→F2.26): ActiveSearchConstraints (merge entre turnos) + fim da promessa falsa

**Autor:** Claude (executor). **Estado:** implementado + gates verdes (`tsc` EXIT 0, `test:all` EXIT 0, **F2.26 22 OK**, F2.25 29, F2.24 44, zero regressão). **NÃO commitado, NÃO deployado.** `central_active` mantido. Sem SQL, sem CRM/handoff.

## O que o Codex apontou (F2.25 aprovado com ressalva)
1. **P0:** os constraints só olhavam o BLOCO ATUAL. Faltava um `ActiveSearchConstraints` persistido/derivado para compor filtros em TURNOS SEPARADOS (como um SDR humano): T1 "Palio/Gol" → T2 "até 50 mil" → T3 "volks" → T4 "automático" → T5 "mais opções".
2. **Bug:** `recovery_stock_will_search` prometia "vou procurar" SEM ação garantida — promessa falsa ao lead.

## Correção
### (A) Filtro de busca ATIVO persistido + merge conservador
- Novo tipo de DOMÍNIO `ActiveSearchConstraints` (`conversation-state.ts`) + campo `activeSearchConstraints` no estado (opcional, retrocompat). `commercial-constraints.ts` reusa a forma; `modelo` virou **`modelos: string[]`** (cobre "Palio ou Gol").
- `mergeActiveConstraints(active, current)` PURO: cada dimensão do bloco ATUAL substitui a ativa; ausente PRESERVA. Um **modelo novo "pelado" (sem marca no mesmo bloco) SOLTA a marca antiga** (nova direção: depois de VW, "tem Onix?" troca o foco). "volks" (marca sem modelo) ESTREITA sobre os modelos ativos.
- `constraintsToStockInput` (modelos[] → `modelo` + `broad` quando >1). Só turno de BUSCA (constraint novo OU "mais opções") mergeia e PERSISTE; foto/detalhe/institucional PRESERVAM o ativo.
- **GATE em `llmFirst`** (feature do central_active): legado/shadow (compose) usam só o bloco atual — F2.13/active-root intactos.
- **GATE de detalhe:** `relation === "asks_vehicle_detail"` ("quanto custa o Onix?") NÃO é busca (usa a RELATION, não regex de atributo — senão "pode ser automático" viraria detalhe). F2.21 [10] intacto.

### (B) Executor determinístico de busca → mata a promessa falsa
- Se o turno é comercial (`commercialSearchTurn` OU "mais opções") e o cérebro NÃO chamou stock_search, o ENGINE executa a busca com o filtro ATIVO (mergeado, enriquecido com excludeKeys). **GARANTE a ação**: a recuperação então LISTA de verdade (`recovery_offer`) OU é honesta sobre o vazio (`recovery_stock_empty`, nomeando o filtro). **`recovery_stock_will_search` REMOVIDO** — nunca mais "vou procurar" sem buscar.

## Casos F2.26 (todos os 9 do Codex) — 22 OK
1. Palio/Gol + "até 50 mil" preserva modelos + teto ✅ (T2)
2. "que seja volks" estreita p/ Volkswagen, NÃO lista Fiat ✅ (T3, lista Gol)
3. "mais opções" preserva marca+teto+câmbio + excludeKeys ✅ (T5)
4. "tem Onix?" depois de VW troca o foco (solta a marca) ✅
5. "me manda foto do segundo" NÃO ativa stock_search ✅
6. "onde fica a loja?" NÃO altera o filtro ativo ✅
7. "popular até 50 mil" usa popular+teto ✅
8. "até 50 mil" sem contexto busca por teto, sem reperguntar "qual modelo/tipo?" ✅
9. Nunca "vou procurar" sem executar stock_search ✅
+ 5 testes puros de `mergeActiveConstraints`.

## Regressões corrigidas no caminho
- **F2.13 [3b]** (shadow): constraint ativo vazava via enriquecimento → gate em `llmFirst`.
- **TDZ**: `llmFirst` usado antes da declaração → movido p/ cima (o active-root dava commit_failed em runtime).
- **F2.21 [10]** (detalhe "quanto custa o Onix?"): executor disparava → gate por `relation asks_vehicle_detail`.

## Arquivos
- `conversation-state.ts` (tipo + campo + init), `commercial-constraints.ts` (modelos[]+merge+toStockInput), `central-engine.ts` (merge gateado llmFirst + executor determinístico + persist + remove will_search + gate detalhe), **novo** `tests/run-f2-26-active-search-constraints.ts` (+ `test:f226`/test:all). F2.25 ajustado (INT-2 agora lista Gol; `.modelos`).

## Gates
`tsc --noEmit` EXIT 0 · `test:all` EXIT 0 (F2.26 22, F2.25 29, F2.24 44, F2.23 34, F2.22 21, F2.21 35, F2.13 + active-root OK, scan 5). `test:f226` verde.

## Próximos passos
1. Codex re-audita (merge conservador + fim da promessa falsa).
2. (Com a chave) eval real 5 turnos.
3. Commit pedro-v3 + push main quando o dono autorizar. NÃO mexer CRM/handoff.
