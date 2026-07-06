# 2026-07-06 — P0 Commercial Intent State + Ad Context: DIAGNÓSTICO + Phase 1 (conflito tipo↔modelo/correção)

**Autor:** Claude (executor). **Estado:** DIAGNÓSTICO completo + **Phase 1 implementada** (Evidence 1/6) + qualificação (Evidence 5) verificada. **NÃO commitado.** Missão grande e multi-fase — esta rodada entrega o gap-do-robô mais evidente + o mapa das fases restantes. `central_active` mantido. Sem SQL/CRM/handoff/deploy.

## DIAGNÓSTICO (read-only) — o que já está resolvido vs. gap novo
| Evidence | Estado |
|---|---|
| **2** — "Até 50 mil da volks" → recovery_stock_not_run | ✅ JÁ FIXO (F2.25, commit `4d7eef39`) — filtro comercial força stock_search |
| **3-C** — Palio/Gol → volks estreita | ✅ JÁ FIXO (F2.26) — merge entre turnos |
| **5** — qualificação (entrada/parcela/troca) vira fato | ✅ JÁ FUNCIONA — `lead-extraction.ts` (entrada=0 L399, parcela via moneyByClause L393, possuiTroca=false L429). Provado em F2.27 G. |
| **1** — Compass preso em SEDAN | ❌ GAP → **FIX nesta rodada** |
| **6** — "queria SUV" não limpava o modelo | ❌ GAP → **FIX nesta rodada** |
| **4** — EcoSport 13/14/15 manual (ano/câmbio rígido) | ⏳ FASE 2 (não implementado) |
| **3** — contexto de anúncio Facebook/CTWA | ⏳ FASE 3 (auditado; precisa bridge) |
| **H** — lead desinteressado | ⏳ FASE 4 (pequeno) |

## Phase 1 — CONFLITO tipo↔modelo + CORREÇÃO explícita (Evidence 1/6) — FEITO
Causa-raiz (Evidence 1): `mergeActiveConstraints` soltava a MARCA num modelo novo mas **preservava o `tipo`** → active `{tipo:sedan}` + "Tem Compass?" → merged `{tipo:sedan, modelos:[compass]}` → `stock_search Compass+sedan` → vazio → "Não achei Compass SEDAN".

Invariantes (por FATO, sem if-de-resposta):
- **Inv.1** — MODELO específico novo é mais específico que categoria: solta o TIPO antigo conflitante (Compass ≠ sedan) além da marca. `mergeActiveConstraints`: no ramo de modelos novos, `if (!current.tipo) delete next.tipo`.
- **Inv.2** — CORREÇÃO explícita: novo `detectCorrections(block)` (EXTRAÇÃO de fato) detecta "esquece o sedan", "não é sedan", "não quero sedan", "Compass não é sedan", "tira o sedan" → `removedTypes`. O merge remove esse tipo do ativo. Regex LAZY p/ pegar o tipo NEGADO mais próximo ("não quero suv, quero hatch" → remove suv, mantém hatch).
- **detectCommercialConstraints** NÃO captura um tipo NEGADO como tipo do turno (senão o merge re-injetaria); pega o 1º tipo não-negado.
- **Evidence 6** — TIPO novo é nova CATEGORIA: solta os MODELOS antigos (`if (!current.modelos?.length) delete next.modelos`). "queria SUV" após Onix → busca SUV, sem Onix.
- Uma correção também é turno de busca (`isSearchishTurn`) e persiste o filtro LIMPO (remove o tipo do ativo mesmo sem novo modelo).

**Testes F2.27 `run-f2-27-commercial-correction-conflict` — 20 OK:** 9 puros (detectCorrections, merge Inv.1/2, detect tipo-negado, Evidence 6), 3 G (qualificação), A-1/A-2/A-3 (Compass sem sedan + correção + "esquece o sedan"+Compass), E6 (tipo limpa modelo). tsc+test:all EXIT 0 (F2.27 20, F2.26 22, F2.25 29, F2.24 44, zero regressão).

**Arquivos:** `commercial-constraints.ts` (detectCorrections + merge Inv.1/2 + detect tipo-negado + import VehicleType), `central-engine.ts` (detectCorrections no merge + isSearchishTurn/persist com correção), `package.json` (test:f227+all), **novo** `tests/run-f2-27-commercial-correction-conflict.ts`.

## FASE 3 — Facebook/CTWA Ad Context (auditado, NÃO implementado; precisa bridge)
Auditoria do v2 (agente): o `externalAdReply` chega no `contextInfo` do webhook com `sourceID`(ad_id), `sourceType`, `sourceURL`, `title`, `body`, `greetingMessageBody`, `thumbnailURL`, `originalImageURL`, `conversionSource`. O v2 resolve o veículo por: saudação(0.95) > texto do copy > dicionário > LLM texto > visão da imagem (`adContext_20260525.ts`). ⚠️**bug `AAAA`** (placeholder do prompt de visão vaza). Persiste em `referencia` (memória), herda em rajada. Já existe plano v3: `Brain/09-PLANO-LEITURA-ANUNCIO-CTWA.md` (handler "Ad Intake" em camadas Ad-ID→Texto→Visão ano=null→Grounding).
**Shape proposto p/ v3** `AdReferral` { adId, source, sourceUrl, imageUrls[], title, body, greeting } → resolver → `AdReadResult` { marca, modelo, ano|null (NUNCA "AAAA"), preco, confidence, vehicleKeys[], groundedInCatalog }. **Prioridade obrigatória:** turno atual > correção > resposta a pergunta pendente > **anúncio** > ActiveSearchConstraints > memória. **Requer:** (a) bridge/webhook forwardar o `externalAdReply` p/ o v3; (b) resolver determinístico (saudação+grounding no catálogo; visão opcional); (c) `state.adReferral` + exposição no TurnFrame como fato inicial; (d) turno atual vence o anúncio. **NÃO cabe nesta rodada** (bridge + possível visão).

## FASE 2 — ano/câmbio RÍGIDO (Evidence 4), FASE 4 — desinteresse (Evidence H) — NÃO implementado
- **Fase 2:** adicionar `anos:number[]` + `rigid` aos constraints; "EcoSport 13/14/15 manual" → anos=[2013,2014,2015]+cambio=manual rígidos; se a busca não achar exato, a alternativa (EcoSport 2020 auto) tem de ser marcada "foge do que pediu", nunca match. Precisa: parse de faixa de ano, campo `ano` no stock_search + filtro, e sinal de "off-request" na recuperação.
- **Fase 4:** detectar desengajamento ("não solicitei", "não me interessa", "obrigado", "nada ok") → resposta curta, sem lista/funil. Pequeno módulo puro + gate na condução.

## ENTREGA desta rodada
1. Diagnóstico read-only ✅ (tabela acima). 2. Arquivos alterados ✅ (Phase 1). 3. Invariantes ✅ (Inv.1/2 + Evidence 6). 4. Testes offline ✅ (F2.27 20 OK, test:all EXIT 0). 5. Teste real barato ⏳ (sem `OPENAI_API_KEY` no ambiente — rodar `npm run smoke:audit` com a chave). 6. Sem falhas mascaradas. 7. Handoff ✅ (este). 8. NÃO commitado.

## Próximos passos (sua priorização)
- Aprovar Phase 1 p/ commit, OU pedir para eu seguir na Fase 2 (ano/câmbio rígido) / Fase 4 (desinteresse) antes de commitar.
- Fase 3 (Ad Context) precisa de decisão sobre o bridge (forwarding do `externalAdReply`) — é a maior.

---
## UPDATE — FASE 2 (ano/câmbio RÍGIDO) + FASE 4 (desinteresse) FEITAS (mesma rodada)

### FASE 2 — Evidence 4: ano/câmbio rígido — FEITO
- `ActiveSearchConstraints.anos?: number[]` (domínio) + campo `anos` no `stock_search` input + `StockSearchFilters` + **filtro DURO** no `stock-source.ts` (carro fora do ano nunca é match) + `anos` no decode/prompt do cérebro.
- `commercial-constraints.ts`: `detectYears` ("13/14/15"→[2013,2014,2015]; "2013 a 2015"→range; 4-díg soltos) — **normalização LEVE preservando "/"** (o `normalizeText` do catálogo troca "/" por espaço). Anos no merge (novos substituem; modelo novo pelado descarta anos antigos), `constraintsToStockInput`, `describeConstraints`.
- Câmbio já filtrava. Resultado: "EcoSport 13/14/15 manual" busca anos+cambio → EcoSport 2020 automático **excluído**; sem match → `recovery_stock_empty` nomeando "EcoSport 2013/2014/2015 manual". "Prisma manual" não retorna automático.
- ⚠️Invariante 4 (alternativa fora do filtro marcada "foge do que pediu") = via cérebro (prompt-first) sobre o resultado vazio; o ENGINE garante que a lista primária NUNCA mistura (filtro duro na busca). Não há resposta de duas camadas determinística (seria handler escrevendo).

### FASE 4 — Evidence H: desinteresse — FEITO
- Novo `lead-intent.ts` (PURO): `detectDisengagement` → `not_interested` ("não solicitei", "não me interessa", "não quero nada", "me tira da lista") | `low_intent` ("obrigado", "só olhando", "vou pensar").
- `central-engine.ts`: `disengagedActionable` = desinteresse E sem constraint comercial suficiente/mais-opções/foto/institucional (o PEDIDO vence: "obrigado, quero Onix" ainda busca). Suprime funil/lista (nenhuma busca forçada → sem fatos → cérebro não lista). `buildDisengagementResponse` (executor determinístico, NÃO-degradado, reasonCode `lead_disengaged`) responde curto e deixa a porta aberta — FALLBACK quando o cérebro não autora (prompt-first vem primeiro).

### Testes
- **F2.27 20 OK** (Phase 1: Compass/correção/tipo-limpa-modelo + qualificação G).
- **F2.28 23 OK** (Phase 2 anos rígidos + Phase 4 desinteresse + **replay do smoke turnos 4→9**: Compass sem sedan, correção, EcoSport rígido sem 2020, SUV limpa modelo, desinteresse final sem lista).
- `tsc` EXIT 0, `test:all` EXIT 0 (F2.28 23, F2.27 20, F2.26 22, F2.25 29, F2.24 44, F2.23 34, zero regressão).

### OpenAI / smoke real
Checado (sem imprimir segredo): `OPENAI_API_KEY`, `EVAL_OPENAI_API_KEY`, `EVAL_USE_PLATFORM_KEY`, `PEDRO_V3_REAL_EVAL` todos UNSET; sem `.env`. Resolução do eval = EVAL_OPENAI_API_KEY > EVAL_USE_PLATFORM_KEY(Vault) > resolveTenantOpenAiSecret. **Sem chave no ambiente local** — smoke real não rodável; a F2.28 replica o script offline.

### Arquivos alterados (Phase 1+2+4)
`commercial-constraints.ts`, `lead-intent.ts` (novo), `central-engine.ts`, `conversation-state.ts`, `decision.ts`, `read-ports.ts`, `stock-source.ts`, `openai-agent-brain.ts`, `package.json`, `tests/run-f2-27-*.ts` (novo), `tests/run-f2-28-*.ts` (novo). **FASE 3 (Ad Context) segue diagnosticada, NÃO implementada (precisa bridge).**
