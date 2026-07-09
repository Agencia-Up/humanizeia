# Missão P0 — Eliminar contradições internas do engine (fatos frescos × catálogo) + varredura exige-e-proíbe (F2.43)

**Data:** 2026-07-09 · **Autor:** Claude (executor) · **Espec:** Codex/dono (missão "contradições internas + SDR antes do CRM") · **Estado:** FEITO+PROVADO (offline 30 OK + smokes 2/2 PASS) · **✅ APROVADO pelo Codex (2 rodadas) e COMMITADO+PUSHADO `main ac529080` (2026-07-09).**

## 1. Causa-raiz técnica (P0 principal)
`ConversationTurnContextPreparer.prepare` carrega o catálogo com `stock.search(ref, {})` e **falha-fechado para
`{entries: []}`** quando o feed soluça — SILENCIOSAMENTE. As policies validavam oferta contra ESSE snapshot
(`isVehicleKeyInCatalog`): com snapshot vazio, o engine entrava em auto-contradição — o feedback de LISTAGEM entregava
à LLM a vehicleKey vinda da **stock_search do próprio turno** e o validador rejeitava a MESMA key ("fora do catálogo
do tenant") → loop → recovery_offer/fallback (o agente "sem noção"). Visto ao vivo no run 1 do smoke F2.42 (T2).

## 2. Contradições encontradas (mapa exige-e-proíbe)
| # | Exigência | Bloqueio | Severidade | Status |
|---|-----------|----------|------------|--------|
| 1 | Feedback de LISTAGEM/P0-3 entrega keys da busca do turno | POL-CATALOG-OFFER + validateResponse (vehicle_ref/money_ref/offer_list) rejeitam com snapshot vazio/falho | **P0** (fallback real, visto em prod-smoke) | ✅ corrigido (fatos frescos) |
| 2 | Falha do loadCatalog | engolida em silêncio (catálogo vazio sem sinal) | **P0** (observabilidade) | ✅ corrigido (catalogDegraded em decision_final) |
| 3 | Feedback de LISTAGEM entrega TODAS as keys | POL-STOCK-003 nega item acima do teto (faixaPreco.max) do lead | **P1** (loop possível) | ✅ corrigido (feedback filtra pelo teto; todas acima → honestidade) |
| 4 | missingTool/executor exigem busca na perna CONTEXTUAL (anúncio/similaridade/retomada) | gate de INTENT CONTRADITÓRIO nega stock_search sob ato conversacional declarado | **P1** (raro; anúncio+contestação) | ✅ corrigido (`!conversationalActDeclared()` nas 2 pernas — mesmo helper do F2.41) |
| 5 | Deny em turno de SELEÇÃO (feedback acionável SELECTION_ATTR) | fingerprint de deny repetido derruba p/ technical_fallback na 2ª insistência | **P1** (visto no smoke: T4 "gostei do segundo") | ✅ corrigido (selectionTurn = keepRetrying bounded, como list/conduct/repair/empty) |
| 6 | Completude cobra foto pedida | guard exige photoVU do cérebro | P2 (convergível: o cérebro corrige o understanding no retry) | documentado, sem mudança |
| 7 | Retomada "cadê?" em turno financeiro | — (regex de retomada não casa resposta financeira) | P2 teórico | documentado, sem mudança |

Verificados SEM contradição: vehicle_details (needDetail já gateado F2.42; systemDetailKeys autoriza o exigido),
tenant_business_info (nada bloqueia), foto (offeredVehicleKeys = só record_offer; catálogo não valida send_media),
trade-in/financeiro (gates F2.40/42), "mais opções" (excludeKeys já herdado), falha REAL de tool (wasObserved conta
erro — não re-exige; provado no caso J).

## 3. Correções (por arquitetura, nunca por frase)
1. **`catalog-utils.ts` — `isVehicleKeyGrounded(catalog, facts, key)`**: key vinda de stock_search/vehicle_details OK
   **DESTE turno** é catálogo válido (a tool é tenant-scoped por construção — mais fresca que o snapshot); senão cai
   no snapshot. Key inventada/de outro tenant nunca aparece em nenhum dos dois → segue bloqueada.
2. **`policy-engine.ts`**: os 4 pontos de validação por catálogo (POL-CATALOG-OFFER no postQuery; vehicle_ref,
   money_ref e vehicle_offer_list no validateResponse) usam o helper. POL-GROUND-STOCK (oferta exige fato do turno)
   INTOCADA — memória antiga sem fato atual continua não autorizando oferta.
3. **`turn-context-preparer.ts` + `domain/context.ts`**: falha do loadCatalog vira `catalogDegraded: true` (campo
   opcional no TurnContextPreparation) — **`central-engine.ts` loga `catalogEntries` + `catalogDegraded` no
   decision_final** (observável, nunca silencioso).
4. **`central-engine.ts` — listTurn respeita o teto**: o feedback de LISTAGEM só entrega keys com preço ≤
   faixaPreco.max (quando conhecida); todas acima → feedback de honestidade+condução (ampliar faixa/outro tipo/consultor).
5. **`central-engine.ts` — perna contextual respeita o ato**: `contextualSearchTurn && !conversationalActDeclared()`
   no missingTool e no executor determinístico (consistente com o hardening F2.41).
6. **`central-engine.ts` — seleção com retry acionável**: deny em selectionTurn = keepRetrying bounded
   (LIST_MONEY_RETRY_CAP), como listagem/condução/repair/vazio. A LLM redige; o engine nunca escreve.
7. **`openai-agent-brain.ts` (prompt, P2 SDR)**: bullet "MAIS fotos = MESMO veículo (o sistema pula as já enviadas);
   nunca busca". Checklist SDR restante da missão JÁ estava coberto (abertura fria, anúncio específico/genérico,
   condução 1-pergunta troca→entrada→parcela→visita, contestação, troca, mais opções, sem-estoque→alternativa,
   proibições telefone/sobrenome/CPF-cedo/nome-cedo/"vou buscar") — nenhuma linha redundante adicionada.

## 4. Arquivos alterados
`src/engine/catalog-utils.ts` · `src/engine/policy-engine.ts` · `src/engine/turn-context-preparer.ts` ·
`src/domain/context.ts` · `src/engine/central-engine.ts` · `src/adapters/llm/openai-agent-brain.ts` ·
`package.json` (test:f243) · NOVOS: `tests/run-f2-43-fresh-facts-catalog.ts`, `eval/run-f243-conv-real-smoke.ts`,
este handoff.

## 5. Gates offline
- **`run-f2-43-fresh-facts-catalog.ts` (test:f243): 26 OK / 0 FALHA** — P-1..4 (helper puro); A snapshot vazio + busca
  com itens → lista PASSA; B key inventada bloqueada (LLM re-autora); C key de outro tenant bloqueada (corrige p/ keys
  da tool); D mais opções com snapshot vazio (excludeKeys só dos mostrados; novos passam); E anúncio específico com
  snapshot vazio (Compass 2019 + foto "dele"; o seed do anúncio roda 1 busca de ATERRAMENTO — grounding interno, não
  desvio); F troca nomeia mas NÃO oferta; G financeiro 8k/2100 sem busca; H contestação com snapshot vazio; I mais
  fotos = próximo lote do MESMO Onix; J falha REAL da tool → LLM honesta (brain_final), sem inventar.
- `npx tsc --noEmit` EXIT 0 · `npm run test:all` EXIT 0 (**2044 OK**, zero regressão — F2.41 14, F2.42 20 intactas).

## 6/7. Smokes reais (gpt-4.1-mini, efeitos OFF, estoque real) + métricas LLM-first
**Conversa 1 (10 turnos, jornada SDR)** — `eval/run-f243-conv-real-smoke.ts` → **PASS**
(relatório `eval/reports/f243-conv-real-smoke-2026-07-09T17-22-59-193Z.md`):
- Fluxo: Boa tarde → SUV até 100 mil → tem outros? → gostei do segundo → fotos → mais fotos → condições → "Tenho uma
  Hilux 2020 85km" → "8k de entrada" → "até 2100 de parcela".
- Busca SÓ nos turnos comerciais (T2, T3); T3 herdou escopo (excludeKeys); T4 seleção brain_final; T5/T6 fotos do
  MESMO veículo (lotes de 5, sem repetir); T8 troca 0 tools + veiculoTroca{Hilux,Toyota,2020,85000}; T9 entrada=8000;
  T10 parcelaDesejada=2100 (faixaPreco intacta).
- **Métricas: 8/10 brain_final|brain_retry + 2 deterministic_photo (invariante aterrado de foto, por desenho);
  technical_fallback=0; commercialRecovery=0; compose=0; 26 chamadas.**
- Run 1 (pré-fix #5) reprovou APENAS T4 (seleção → technical_fallback por deny repetido) — exatamente a contradição
  #5 da tabela; corrigida e re-provada no run 2.
**Conversa 2 (anúncio CTWA)** — `eval/run-ctwa-ad-smoke.ts` cenário `compass` → **PASS, 0 violações** (19 chamadas,
~US$0,08; relatório `eval/reports/ctwa-ad-smoke-2026-07-09T17-25-29-179Z.md`):
- T1/T2 falam do **Jeep Compass 2019 exato do anúncio** (preço/km reais); T3 "fotos dele" → send_media do Compass
  (5 fotos); T4 "na verdade quero Onix" → busca Onix (anúncio NÃO prende); T5 "onde fica a loja?" → institucional
  correto SEM estoque. Observação honesta: T1/T2 usaram o backstop determinístico ATERRADO de abertura de anúncio
  (deterministic_recovery com a lista real) — classe "abertura", já conhecida e fora do escopo desta missão.

## 8. Riscos restantes
- Abertura (T1) segue usando backstop determinístico com alguma frequência (fora do escopo, aterrado e honesto).
- `deterministic_photo` é o executor-invariante de foto (aterrado); a LLM às vezes não emite o understanding de foto
  válido no retry (feedback existe). Aceito por desenho — não é fallback.
- O T1 corrompido (encoding) segue aparecendo 1x/run e o guard corrige no retry (classe do Codex `ed44db17`).
- `catalogDegraded` depende do preparer real repassar o campo (implementado no ConversationTurnContextPreparer; fakes
  de teste não precisam).

## 9. O que NÃO foi feito (disciplina)
Nenhum handler comercial novo, nenhum if-por-frase, nenhum refactor grande; P2s da tabela (##6/7) documentados sem
mudança; paginação de foto NÃO recriada (já existia; só prompt); backstop de abertura intocado.

## 10. Recomendação
**Commitar/pushar após auditoria do Codex** (mesmo rito das levas anteriores). Stage sugerido: os 6 arquivos de
src/domain + package.json + 2 novos de teste/eval + este handoff. NÃO incluir eval/reports/ nem untracked antigos.

**PARADO — nada commitado. Aguarda auditoria do Codex.**

## ⭐Rodada 2 — Reprova do Codex (T9/T10 technical_fallback) + correções (2026-07-09, noite)
**Reprova:** no smoke do Codex, T9 "Tenho 8k de entrada" e T10 "Até 2100 de parcela" capturaram os slots certos MAS
caíram em `technical_fallback` (deny monetário/genérico repetido até o cap). Diagnóstico com `PEDRO_V3_DENY_DEBUG=1`
(novo, env-gated) revelou **4 causas empilhadas** — todas da mesma família "o engine pede X e derruba X":

1. **Proveniência de valores do LEAD (o pedido central do Codex):** `isLeadValue` só lia `ctx.state.slots` — valor
   capturado NESTE turno podia não estar no estado na hora da validação (o `safeCommitSlots` é TUDO-OU-NADA: uma
   mutation ruim no lote descarta todas; e a mutation do CÉREBRO re-preenchia o slot no fim — o slotsDelta "mentia").
   **Fix duplo:** (a) `leadStatedMoneyValues(bloco)` exportado de `lead-extraction` (MESMO parser da extração,
   `financialContext=true`) somado ao `leadMoney` da validação — ecoar valor escrito no bloco ATUAL nunca é invenção;
   (b) **validationState**: os slots FINANCEIROS extraídos (fonte autoritativa = `extractLeadSlots`, nunca a LLM) são
   projetados INDIVIDUALMENTE no contextState quando o lote falha — render (`money_ref slot_value`) e `isLeadValue`
   enxergam o valor do turno sem commitar nada. Valor INVENTADO/calculado pela LLM segue sem aterro → deny (teste M).
2. **BUG REAL de extração (achado pelo teste K):** "Tenho **8k de entrada**" respondendo à pergunta de TROCA gravava
   `possuiTroca=true` FANTASMA (`parseBooleanAnswer` casava o "tenho" do DINHEIRO) → briefing/CRM errados + o
   anti-repetição derrubava a resposta que re-perguntava troca. **Fix:** `looksLikeMoneyAnswer` (paralelo do R11-A1
   de compra): valor monetário no bloco SEM menção a carro/troca/modelo → não infere posse.
3. **`moneyDeny` rotulava tudo:** o regex casava a instrução padrão "via vehicle_ref/money_ref" presente em TODO
   feedback de validação → hint monetário errado em denies não-monetários. **Fix:** casa só violação real
   ("valor monetário livre" / "preço não-aterrado" / "money_ref:").
4. **Loop do money_ref malformado:** a LLM tentava `money_ref` p/ o valor do lead (prompt PROIBIA dinheiro em texto),
   errava o shape → decode rejeitava o draft INTEIRO → o feedback a re-empurrava pro formato estruturado → loop.
   **Fixes:** prompt ganhou a EXCEÇÃO (valor que o CLIENTE informou vai em TEXTO simples; `money_ref` é para preço de
   veículo do estoque); feedback de condução com deny de formato orienta "UMA part text com o valor do lead ESCRITO"
   e o hint monetário virou "remova só o valor CALCULADO; o valor que o cliente disse você PODE repetir".
5. **(varredura, mesma classe) Nome em pagamento por FASE:** o guard "pagamento → NUNCA peça nome" vetava também a
   fase FINAL — com troca+entrada+parcela CONHECIDAS, pedir o nome é o avanço legítimo do funil (handoff EXIGE nome,
   POL-HANDOFF-001). O veto agora vale só com a qualificação financeira INCOMPLETA.
6. **(varredura, mesma classe) listTurn sem a perna de mais-opções:** a busca do executor determinístico de "tem
   outros?" não recebia o feedback de LISTAGEM com as keys → draft sem offer_list caía no fingerprint → recovery_offer
   (T3 de um run). A perna `mentionsMoreOptions && !conversationalActDeclared()` entrou no listTurn.

**Testes novos (F2.43 → 30 OK):** K eco "R$ 8.000" com pergunta de TROCA pendente (o cenário-gap completo) · L eco
"R$ 2.100" da parcela · M adversarial (LLM inventa "R$ 54.000" calculado → negado; eco do valor do lead passa no retry).
**Gates re-rodados:** tsc EXIT 0 · test:f243 30 OK · test:f239 56 OK · test:f240 65 OK · test:f242 20 OK ·
test:all EXIT 0 (**2048 OK**).
**Smoke real (critério do Codex):** ✅**2/2 PASS consecutivos** — T8/T9/T10 = brain_final nos DOIS runs (T9 run2:
"entrada informada" 0 feedback; T10 run2: 0 feedback), 0 technical_fallback, 0 commercialRecovery, compose=0,
8/10 LLM + 2 deterministic_photo (invariante de foto). Runs intermediários do diagnóstico (B/C) documentados nos
reports em eval/reports/.
**Observabilidade nova:** `PEDRO_V3_DENY_DEBUG=1` imprime o feedback CRU de cada deny de autoria (foi o que revelou
as causas 2 e 4 — mantido, env-gated, zero custo em produção).

**✅ COMMITADO+PUSHADO — `main ac529080` (2026-07-09, pós re-auditoria do Codex). Em produção só no piloto (tenant ecb26258).**
