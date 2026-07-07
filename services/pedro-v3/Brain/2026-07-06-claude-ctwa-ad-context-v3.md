# F2.32 — CTWA / Facebook Ads: contexto de anúncio no Pedro v3 (central_active)

**Data:** 2026-07-06 · **Autor:** Claude (executor) · **Audita:** Codex · **Modo:** central_active (piloto Douglas, tenant `ecb26258`)
**Gates:** `tsc` EXIT 0 · `test:all` EXIT 0 (F2.32 **27 OK**, zero regressão) · bridge CTWA offline **9 OK** · bridge INC1 **21 OK** · **NÃO commitado/deployado** (aguarda ok do dono)
**Base:** diagnóstico prévio `Brain/09-PLANO-LEITURA-ANUNCIO-CTWA.md` + audit read-only do v2 nesta sessão.

## Objetivo
O Pedro v3 ler o contexto de anúncio Click-to-WhatsApp e usá-lo como INTENÇÃO INICIAL da conversa — sem inventar, sem travar o funil, LLM-first. Anúncio = CONTEXTO (não resposta do lead). O turno atual e as correções SEMPRE vencem.

## Diagnóstico do v2 (como recebe CTWA)
O `externalAdReply` do Meta chega no payload uazapi em vários níveis (`message.extendedTextMessage.contextInfo.externalAdReply`, `…content.contextInfo…`, `data.message.content.contextInfo…`). Campos (com aliases): **`greetingMessageBody`** (autoritativo — costuma nomear o carro: "Quer saber mais sobre a Ranger XLT TD 3.2 2016?"), `title`, `body`/`description`, `sourceId`/`source_id`/`ad_id`, `sourceUrl`/`source_url`, `sourceApp`, `contextInfo.conversionSource` (FB_Ads), `originalImageURL`/`thumbnailUrl`/`mediaUrl`, `jpegThumbnail` (blob — descartado). O v2 resolve o veículo por greeting>texto>visão; a visão tem o **bug do ano `AAAA`** (placeholder do prompt vaza) e falha em anúncios institucionais. `ctwaDiag.ts` captura o payload cru em `ctwa_diag_capture`.

## Decisão de arquitetura (esta fase)
**Resolução do veículo do anúncio pelo TEXTO** (greeting/title/body), aterrada no **catálogo da loja** (precisão em estoque) + **taxonomia de MERCADO** (`vehicle-taxonomy.ts`) para veículos FORA do estoque (ex.: anúncio de Kicks numa loja sem Kicks → busca honesta + alternativas). **Sem visão (Layer 2) nesta fase** — as imagens ficam guardadas (`imageUrls`) para um follow-up. Reusa TODA a máquina comercial já existente (F2.25/26/28/29/30): o anúncio só SEED-a o escopo; força de `stock_search`, recuperação honesta, "nunca carro aleatório", clamp de excludeKeys, exclusão de moto — tudo herdado.

**Prioridade (imposta no engine): atual > correção > anúncio > filtro ativo antigo.** O anúncio DIRIGE o turno só se: (a) há veículo no anúncio, (b) NÃO é institucional/desinteresse, (c) o bloco atual NÃO nomeia um veículo diferente. Entrada de anúncio = "esse ainda tem?"/"vi o anúncio", saudação curta, foto/detalhe do anunciado, ou refino de preço.

## O que mudou
### Pedro v3 (deploy Easypanel no push)
- `domain/conversation-state.ts`: tipo **`AdContext`** {adId/source/sourceUrl/title/body/greeting/imageUrls/capturedAtTurn} + campo `adContext?` no estado (persiste + herda em rajada) + `createInitialState`.
- `engine/ad-context.ts` **(novo, puro)**: `extractAdVehicleConstraints` (catálogo + mercado, DROPA o ano — dica fraca), `resolveAdVehicleFromMarket` (taxonomia de mercado, longest-model-first), `refersToAd`, `isBareGreeting`, `sanitizeAdContext`, `adHasVehicle`, `adText`.
- `engine/central-engine.ts`: `adContextFromInbox` (lê `raw.adContext` da rajada); bloco do anúncio (`effectiveAdContext` burst∪state, `adConstraints`, `adDrivesTurn`, `adEntryTurn`) folded em `commercialSearchTurn`/`searchBase`/`commercialConstraints`; persiste `adContext` no commit (stamp de turno); `adVehicleHint` p/ o frame.
- `engine/turn-frame-builder.ts` + `domain/agent-brain.ts`: `signals.adVehicle` (o cérebro vê o veículo do anúncio).
- `adapters/llm/openai-agent-brain.ts`: nota no protocolo (anúncio=contexto; "esse ainda tem?"→busca o do anúncio; nunca "qual modelo?"; atual/correção vencem; sem handoff por vir de anúncio).
- `engine/pilot-ingest.ts` + `runtime/pilot-http-app.ts` + `runtime/server.ts`: threading do `adReferral` (HTTP → `raw.adContext` do inbox).

### Bridge (edge function — deploy `supabase functions deploy pedro-webhook-v2` SEPARADO)
- `supabase/functions/_shared/pedro-v2/pedroV3Bridge.ts`: **`extractAdReferral(payload)`** (lookup em cascata do externalAdReply, aliases, sem blob) + `adReferral` no `PedroV3BridgeTurn` + `buildPedroV3BridgeTurn` popula. O turno já é forwardado como JSON → chega ao `/v1/pilot/turn`.

## Testes offline
- `tests/run-f2-32-ctwa-ad-context.ts` (**27 OK**): puros (extract Compass/SUV/institucional/Kicks-out-of-stock, market longest-first, refersToAd, isBareGreeting, sanitize) + **os 8 cenários da missão**: A Compass "tem esse?"→busca Compass sem perguntar modelo; B Onix "quero fotos"→resolve Onix (2 Onix→lista, nunca carro errado); C SUV genérico+"até 100k"→busca SUV até 100k; D Kicks fora de estoque→honesto+sem carro aleatório; E correção "quero Onix"→Onix vence; F institucional→não força estoque; G desinteresse→não lista; H saudação de anúncio→entra no Compass, sem handoff, sem telefone.
- `pedroV3Bridge.ctwa-test.ts` (**9 OK**): extração do externalAdReply de múltiplos níveis + aliases + sem blob + null sem anúncio. Rodar: `npm run test:bridge-ctwa`.

## Riscos / limitações
- **Sem visão (Layer 2):** anúncios INSTITUCIONAIS (carro só na imagem) resolvem como "sem veículo" → contexto leve (o v3 acolhe/qualifica, não inventa). O ano é sempre dropado (dica fraca). Follow-up: adapter de visão isolado + prompt sem `AAAA` (ano=null).
- **Detecção de "refere-se ao anúncio"** é por regex conservador (`refersToAd`) — pode não pegar toda variação; o cérebro (LLM) complementa via `signals.adVehicle`.
- **Smoke real NÃO rodado** (sem `OPENAI_API_KEY` local). A F2.32 replica os 6 turnos offline com engine + estoque fake + cérebro scriptado. Quando houver chave: rodar 1 smoke ≤6 turnos (Compass ad → "boa tarde" → "esse ainda tem?" → "me manda fotos" → "e tem outro até 100k?" → "onde fica a loja?"), efeitos OFF.
- **Deploy do bridge é separado** (edge function; não sobe no push do pedro-v3).

## Próximos passos
1. Auditoria Codex (especialmente o contrato de state `adContext` + a precedência).
2. Deploy: pedro-v3 (Easypanel no push) + `supabase functions deploy pedro-webhook-v2`.
3. 1 smoke real quando houver chave.
4. Layer 2 (visão) para anúncios institucionais + Layer 0 (ad_id→veículo por mapa/campanha).
