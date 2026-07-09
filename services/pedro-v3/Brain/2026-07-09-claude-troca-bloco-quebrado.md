# Missão P0 — Resposta de TROCA em bloco quebrado não cai em fallback nem vira busca/descoberta (F2.42)

**Data:** 2026-07-09 · **Autor:** Claude (executor) · **Espec:** Codex (missão P0 troca-em-bloco) · **Estado:** FEITO+PROVADO (offline 20 OK + smoke real PASS; turno-alvo perfeito 2/2). **NÃO commitado — aguarda auditoria do Codex.**

## Incidente real (WhatsApp, piloto Douglas, 2026-07-09 ~12:13 BRT)
Agente: "Douglas, tem algum carro para dar de troca?" → lead em rajada: **"tenho" / "Uma hillux 2020" / "85km rodados"**
→ agente: **"Me conta um pouco mais do que você procura que eu já te ajudo. 😊"** (regrediu à descoberta).

## Diagnóstico (obrigatório, feito NO BANCO + código)
Turno real `poll-11-625a8d1c…` (v3_decisions + v3_turn_events + v3_query_log):
- O bloco chegou JUNTO (1 turno, 3 eventIds) e a **LLM classificou CERTO**: `primaryIntent=trade_in`, 0 tools chamadas.
- A extração JÁ gravava `possuiTroca=true` e `veiculoTroca={km:85000, ano:2020}` (85km→85000 já normalizava) — **mas SEM `modelo`** ("hillux" com typo não está em taxonomia/catálogo).
- Telemetria da falha: `brainSteps=5` (teto), `brainRetries=0`, `policyFeedback=[]`, `toolsExecuted=[]`, `responseSource=technical_fallback` (`recovery_ask_need`).

**Causa-raiz (RC-1, a que derrubou o turno):** `requireVehicleDetailBeforeFinal` (B2) casa o regex de atributo
(`\bkm\b|rodad|…`) com **"85km rodados"** e passou a EXIGIR `vehicle_details` do **Nivus SELECIONADO** antes do final —
num turno de RESPOSTA DE TROCA, onde km/ano descrevem o carro DO LEAD. O cérebro (correto) re-emitia o final de troca,
o engine barrava com `REQUIRED_TOOL_MISSING vehicle_details` → `continue` — um caminho que consome passos **sem
policyFeedback e sem brainRetries** (por isso a telemetria "vazia") — até esgotar os 5 passos → `recovery_ask_need`.
Mesmo padrão "dois cérebros" da F2.41: um detector re-interpretando o turno por keyword POR CIMA da LLM.

**RC-2:** `tradeVehicle()` só preenchia `modelo` via claims da taxonomia/catálogo — o carro DO LEAD não precisa existir
em nenhum dos dois ("hillux", "fusca", etc.) → briefing incompleto e `statesTradeVehiclePossession` (posse+modelo+km)
enfraquecido para oferta espontânea.

**RC-3 (latente, ia estourar ao consertar RC-1):** nomear o carro de troca na resposta ("Anotei sua Hilux 2020…") era
NEGADO pelo grounding de catálogo (POL-GROUND-STOCK: "modelo não-aterrado") sempre que o modelo do lead existisse na
taxonomia/catálogo — o carro do LEAD nunca está no estoque. Ironia: "Hilux" (certo) negado, "hillux" (typo) passava.

## Fixes (por invariante, sem if-por-frase, LLM-first — engine NÃO escreve resposta comercial)
1. **central-engine.ts** — `needDetail` NÃO roda em `tradeInAnswerTurn`/`financialAnswerTurn`:
   `const needDetail = (tradeInAnswerTurn || financialAnswerTurn) ? null : requireVehicleDetailBeforeFinal(…)`.
   Invariante: **o engine NUNCA exige uma tool que o contexto do turno proíbe/reinterpreta** (mesmo princípio do
   "proíbe-e-exige" do stock_search; em turno financeiro `vehicle_details` é PROIBIDA na linha de gate — exigir seria contradição).
2. **lead-extraction.ts** — extração do modelo de troca em 3 camadas GENÉRICAS: (a) claims (como era);
   (b) **taxonomia de MERCADO com letras colapsadas** (`collapseLetters`: "hillux"→"hilux" → canônico **Hilux + marca
   Toyota**; typo de letra dobrada nos 2 sentidos); (c) **descritor LIVRE** adjacente à posse/ano ("tenho uma X", "X
   2020") com stopset de palavras genéricas (carro/sedan/diesel/…) — o carro do lead vira briefing mesmo fora de
   qualquer taxonomia ("fusca"). km<1000 → milhar (já existia, coberto por teste agora).
3. **policy-engine.ts** — **proveniência do LEAD** no `validateResponse`: o veículo de TROCA (`slots.veiculoTroca`,
   que JÁ inclui a extração DESTE turno via `safeCommitSlots`) aterra marca/modelo em texto livre (paralelo ao
   `isLeadValue` de dinheiro), com forma colapsada p/ typo. **A isenção é SÓ para o NOME em texto** —
   vehicle_ref/offer_list seguem exigindo catálogo (troca nunca vira oferta).
4. **openai-agent-brain.ts (prompt)** — completado o bullet de troca: acolha NOMEANDO o carro do lead (é dado do
   CLIENTE, não oferta), confirme que anotou p/ avaliação, avance com UMA pergunta (entrada/parcela/avaliação); NUNCA
   volte à descoberta depois da resposta de troca.

## Provas
- **`run-f2-42-trade-block-burst.ts` (test:f242): 20 OK / 0 FALHA** — [A] incidente real E2E (bloco 3 linhas, Nivus
  selecionado): 0 busca, **0 obs de vehicle_details (needDetail não dispara)**, brain_final, acolhe nomeando Hilux,
  `veiculoTroca={Hilux, Toyota, 2020, 85000}`, selecionado segue Nivus, interesse não contamina; [B] rajada
  "tenho/um renegade/2019/86km" → 86000; [C] compra explícita vence (troca registrada + busca suv≤100k); [D] compra
  pura "tem Hilux 2020?" → busca, sem veiculoTroca; [E] negação → possuiTroca=false; [F] "tenho 8k de entrada" pós-troca
  → entrada=8000, veiculoTroca preservado; [G] **colisão com catálogo** (troca=Onix numa loja que vende Onix, nunca
  ofertado) → nomear o carro do lead PASSA (a prova do RC-3).
- Gates: `npx tsc --noEmit` EXIT 0 · `npm run test:all` EXIT 0 (2018 OK, zero falha, F2.42 no chain).
- **SMOKE REAL** (`eval/run-f242-trade-real-smoke.ts`, gpt-4.1-mini, efeitos OFF, estoque real, roteiro do incidente:
  Boa tarde → quero um Nivus → gostei → tem garantia? → vou querer → Douglas → rajada "tenho/uma hillux 2020/85km rodados"):
  - **T7 (o incidente) PERFEITO nos 2 runs**: `brain_final`, `primaryIntent=trade_in`, **0 tools, 0 policyFeedback**,
    resposta real: **"Perfeito! Anotei sua Hilux 2020 com 85 mil km para avaliação na troca. Você tem algum valor para
    dar de entrada?"** + slots `possuiTroca=true`, `veiculoTroca={modelo:"Hilux", marca:"Toyota", ano:2020, km:85000}`.
  - Run 2 **PASS integral**: 7/7 turnos LLM (brain_final/brain_retry), 0 technical_fallback, 0 commercialRecovery,
    compose=0. Relatório por turno: `eval/reports/f242-trade-real-smoke-2026-07-09T16-09-34-007Z.md`.
  - Run 1: T7 perfeito, mas **T2 FAIL por bug PRÉ-EXISTENTE fora do escopo** (abaixo).

## ⚠️Achado NOVO fora do escopo (para o Codex auditar — NÃO mexi)
**Auto-contradição listagem×catálogo em soluço do feed:** `ConversationTurnContextPreparer.prepare` faz
`loadCatalog = stock.search(ref, {})` e **falha-fechado para catálogo VAZIO** (`{entries: []}`). No run 1/T2 o feed
soluçou no prepare → catálogo vazio → o ENGINE mandou a LLM listar a key `revendamais:8143536` (feedback de LISTAGEM,
vinda da stock_search EXECUTADA no mesmo turno) e o validador REJEITOU a MESMA key ("fora do catálogo do tenant",
POL-CATALOG-OFFER/`isVehicleKeyInCatalog`) → loop → `recovery_offer` (engine listou no lugar da LLM). Classe
"exige-e-proíbe" de novo, agora entre feedback e validador. Sugestão p/ auditoria: fato de `stock_search` do PRÓPRIO
tenant NO turno deveria contar como grounding de catálogo (é o catálogo, mais fresco que o snapshot) OU o snapshot
vazio deveria degradar diferente. Transitório (run 2 passou), mas estrutural.

## Não fiz (disciplina da missão)
Nenhum handler comercial, nenhum if de frase/"hillux", nenhum texto do engine, nenhuma mudança no lastResort, nenhum
cap novo no loop (precisa-detalhe gateado resolve o incidente), e o achado do catálogo ficou intocado (fora do escopo).

**PARADO — nada commitado. Aguarda auditoria do Codex.**
