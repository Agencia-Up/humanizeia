# P0 — 3 incidentes do teste no WhatsApp (Douglas): reentrada do v2 + pergunta de telefone + "SUV→outros 100k"

**Data:** 2026-07-06 · **Autor:** Claude (executor) · **Audita:** Codex · **Modo:** central_active (piloto Douglas, tenant `ecb26258`)
**Gates:** `tsc` EXIT 0 · `test:all` EXIT 0 (F2.30 **12 OK**, F2.31 **12 OK**, zero regressão) · bridge offline **17 OK** · **NÃO deployado** (aguarda ok do dono)
**Evidência:** banco de produção, conversa `wa:8ed13714…189301e6…a741e41`, turnos 23:04–23:19 UTC (20:04–20:16 BRT) — **F2.29 já estava no ar** (todos os `decision_final` têm os campos F2.29).

---

## INCIDENTE 3 — "SUV → outros até 100k" não achou Compass (bug de excludeKeys)

**Print/DB:** poll-2 "SUV" listou **5 SUVs** (C3 Aircross, Duster, 2008, Renegade 16/18, todos ≤73k). poll-3 "Tem outros? de 100k" → `no_more_suv_under_budget` ("não temos outros SUVs até esse valor"). poll-4 "queria um compass" → Compass 2017 (92.990) e 2019 (96.990), JEEP SUV ≤100k.

**Causa-raiz (confirmada):** o `decision_final` do poll-3 mostra `stockSearchInputExecuted={tipo:suv, precoMax:100000, excludeKeys:[**17 keys**]}` — e as 2 keys do Compass (`rm:7745211`/`rm:7894915`) **estavam nos 17 excludeKeys**, embora só 5 tenham sido MOSTRADOS. O cérebro passou no `excludeKeys` as **17 keys que VIU no resultado da busca do poll-2**, não as 5 que exibiu. O engine confiava no `excludeKeys` do cérebro verbatim ([openai-agent-brain.ts:313](../Agent/src/adapters/llm/openai-agent-brain.ts)) → os Compass (nunca exibidos) foram escondidos.

**Fix por invariante (F2.30):** o engine **CLAMPA o excludeKeys ao que o lead REALMENTE viu**.
- `central-engine.ts` `enrichStockSearchCall`: novo `enforceShownClamp` (gated em `llmFirst`) — dropa o `excludeKeys` original do cérebro e usa só o CLAMPADO: `brainExcludes ∩ apresentado`; em "mais opções" exclui exatamente o conjunto apresentado. Shadow/legado mantêm a união antiga.
- **`offers.presentedKeys` CUMULATIVO no central_active**: populado no commit a partir das keys REALMENTE renderizadas (`computeRenderedOfferContext` lê o `vehicle_offer_list` exibido). É a fonte da verdade do "que o lead viu" (antes ficava vazio no central_active). `shownVehicleKeys = presentedKeys ∪ lastRenderedOfferContext` alimenta o clamp.
- Prompt do cérebro reforça: "use excludeKeys APENAS com os vehicleKeys que você REALMENTE MOSTROU — nunca os que a busca retornou e você não exibiu."

**Testes** `run-f2-30-exclude-shown-only` (12 OK): U-1..4 clamp puro (Compass não-mostrado descartado); I-1..5 "SUV até 75k → outros de 100k" **acha Compass** (excludeKeys = só os 5); G-1..3 o **incidente exato** (cérebro passa 5+2 Compass → executed excludeKeys = só os 5, Compass aparece).

---

## INCIDENTE 2 — agente pediu telefone, mas WhatsApp já é o telefone

**DB:** poll-7 "douglas" → `nome_recebido` → a resposta perguntou "Douglas, qual é o seu telefone para contato?".

**Causa-raiz (confirmada):** origem = **100% o LLM**. Não há slot/pergunta hardcoded de telefone no v3 (`SlotName`/`DEFAULT_QUESTIONS`/`question-classify` não têm telefone). O `toAddr` (telefone do lead) É ingerido em `pilot-ingest.ts` mas **nunca chega ao TurnFrame** → o cérebro não sabia que o canal já tem o número. (O prompt v2 `wa-inbox-webhook:1851` pede telefone em despedidas, mas o v3 não usa esse prompt.)

**Fix por invariante (F2.31):**
- `turn-domain.ts`: `contactPhoneKnownFromChannel(conversationId)` (canal "wa:") + `asksLeadContactPhone(text)` (pega "seu telefone/número", "telefone para contato", "me passa seu número"; EXCEÇÃO: número ALTERNATIVO não dispara).
- `FrameSignals.contactPhoneKnown` derivado do canal em `buildTurnFrame` → o cérebro sabe.
- `policy-engine.ts` `validateResponse` **POL-PHONE-KNOWN**: canal "wa:" + resposta pede telefone do lead → deny + retry ("não peça o telefone do lead: no WhatsApp o número já é conhecido; avance o funil"). Gated pelo canal (convId "wa:") — inerte em teste legado.
- Prompt do cérebro: "quando signals.contactPhoneKnown=true, NUNCA pergunte o telefone do cliente."

**Testes** `run-f2-31-phone-known-channel` (12 OK): P-1..8 detectores puros; I-1..2 canal wa: bloqueia a pergunta (retry); I-3 canal não-wa deixa passar (gate); I-4 sem falso-positivo.

---

## INCIDENTE 1 — v2 reentrou no meio de conversa v3 (P0 mais grave)

**DB:** o inbox v3 dessa conversa termina em "douglas" (poll-7). **O telefone "85988323679" NUNCA virou inbox v3** (`ingested:false`). Mas `v3_conversation_routing` PROVA que o v3 é dono da conversa. Então: telefone → v3 devolveu `ingested:false` → bridge classificou `pre_ingest_failure` → chamou o v2 → saudação "Oi! Aqui é o Aloan".

**Causa-raiz (confirmada):** [pedroV3Bridge.ts:242](../../../supabase/functions/_shared/pedro-v2/pedroV3Bridge.ts) + [pedro-webhook-v2/index.ts:585](../../../supabase/functions/pedro-webhook-v2/index.ts) caem pro v2 em `pre_ingest_failure` (`ingested:false` OU `commit_failed && dispatched:0`) **sem checar se o v3 já assumiu a conversa**. O path é gated na identidade do PILOTO (só Douglas) — blast radius baixo.

**Fix por invariante (STICKY ROUTING):**
- `pedroV3Bridge.ts` `shouldFallbackToPedroV2({classification, hasV3Routing, hasV3State})` PURO: fallback pro v2 SÓ se `pre_ingest_failure` **E** a conversa nunca foi assumida (sem routing/state). accepted/uncertain e os estados de sucesso (duplicate/no_op/superseded chegam como `accepted`) NUNCA caem pro v2.
- `conversationHasV3Routing(client, tenant, conv)`: SELECT em `v3_conversation_routing`. FAIL-SAFE contra o hijack: erro/exceção → true (bloqueia v2, coerente com "uncertain nunca dá double-reply"); só um resultado LIMPO sem linha libera o v2.
- `pedro-webhook-v2/index.ts`: antes do fallback, checa routing; se v3 é dono → **NÃO chama v2** + loga `v3_sticky_route_blocked_v2_fallback conversationId=… hasV3Routing=true ingested=false`.

**Testes** `pedroV3Bridge.offline-test.ts` (17 OK): classify (ingested:false/commit_failed→pre_ingest_failure; duplicate/no_op/superseded→accepted); shouldFallback (S-1..5); conversationHasV3Routing com client fake (R-1..4 incl. fail-safe); M-1..3 = os 3 cenários da missão (roteada+telefone→v2 bloqueado; roteada+commit_failed→v2 bloqueado; 1º contato sem routing→v2 responde).
Rodar: `npm run test:bridge-inc1` (do Agent).

⚠️ **DEPLOY SEPARADO:** INC1 é edge function Deno (`supabase/functions/`) — NÃO sobe no push do pedro-v3 (Easypanel). Precisa `supabase functions deploy pedro-webhook-v2`. Fica no piloto (path gated na identidade do Douglas).

**Observação (não corrigido, só sintoma):** o motivo do `ingested:false` no telefone não foi determinado (v3 pode ter tido falha transitória pós-restart/deploy). O sticky-routing corrige o SINTOMA (hijack) independentemente da causa do ingested:false — é o invariante correto ("fallback só antes de o v3 assumir").

---

## Arquivos
- **pedro-v3 (Easypanel):** `Agent/src/engine/central-engine.ts` (clamp+presentedKeys), `turn-domain.ts` (telefone+canal), `policy-engine.ts` (POL-PHONE-KNOWN), `turn-frame-builder.ts` (contactPhoneKnown), `domain/agent-brain.ts` (FrameSignals), `adapters/llm/openai-agent-brain.ts` (prompt), `tests/run-f2-30-*`, `tests/run-f2-31-*`, `package.json`.
- **edge function (deploy supabase separado):** `supabase/functions/_shared/pedro-v2/pedroV3Bridge.ts`, `supabase/functions/pedro-webhook-v2/index.ts`, `supabase/functions/_shared/pedro-v2/pedroV3Bridge.offline-test.ts`.

## Pendências
- Smoke real não rodado (sem OPENAI_API_KEY local). Os testes offline replicam os 3 cenários com engine + fake stock.
- Deploy do edge function (INC1) é manual/separado — aguarda ok do dono.
