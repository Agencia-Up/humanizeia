# P0 — TRAVA DE CONTEXTO (foto resolvida virava fallback + memória velha de foto conduzia busca) — 2026-07-04

**Autor:** Claude (executor). **Auditor:** Codex. **Flag:** `PEDRO_V3_BRAIN_MODE` OFF; central_active NÃO ativado.
**Sem OpenAI paga. Sem commit/push/deploy.** Parado para auditoria Codex.

## Evidência (Codex, banco, conversa Douglas, central_active)
1. Turno "Me manda foto do 2": `lastRenderedOfferContext` item 2 = revendamais:8093653 / PEUGEOT 208 2015; a decisão
   selecionou esse veículo e `lastToolResults` tinha `vehicle_photos_resolve` + `vehicle_details` OK — mas o outbox teve
   SÓ `send_message` com `technical_fallback`. **Nenhum `send_media`.**
2. Turno seguinte "você tem SUV?": `decision.reason_code = send_vehicle_photos`, resposta "aqui estão as fotos do carro
   que você pediu"; mas o lead pediu SUV. `workingMemory.activeTopic/currentLeadIntent` ainda em `photo_request`.

## Causas-raiz
- **Bug 1 (foto→fallback):** no caminho single-author (`central_active`), quando o cérebro NÃO autora uma resposta
  aterrada, o engine caía direto em `buildTechnicalFallback()` (só texto). O `renderDeterministicResponse` que trata
  `send_media` só existia no caminho LEGACY. Logo, um pedido de foto TOTALMENTE resolvido (alvo + photoIds) nunca
  materializava `send_media` se o draft do cérebro falhasse a validação.
- **Bug 2 (memória velha conduz):** o `send_media` já era filtrado quando o turno não é foto, mas o **texto** e o
  **reasonCode** de foto sobreviviam (mentira). E nada separava a intenção do TURNO ATUAL da memória: o frame carregava
  `activeTopic/currentLeadIntent = photo_request` do turno anterior e o cérebro se ancorava nisso.

## Correção — 4 camadas determinísticas (autoria única preservada: engine valida/enriquece, não vira handler comercial)
- **P0-A `currentTurnIntent` + limpeza de foto stale** (`central-engine.ts` + `turn-frame-builder.ts` + `agent-brain.ts`):
  novo tipo `CurrentTurnIntent` (`search|photo_request|photo_memory|institutional|other`) derivado SÓ do bloco atual
  (`deriveCurrentTurnIntent`), colocado em `signals.currentTurnIntent`. Quando é `search`, `clearStalePhotoIntent` zera
  `activeTopic/currentLeadIntent` de foto **no frame que o cérebro vê** (memória PERSISTIDA intacta; o cérebro re-seta o
  tópico correto). Regra nova no protocolo do brain: `currentTurnIntent` vence a memória; só envia foto se o turno pedir.
- **P0-B guard de foto** (`authorFromBrainDraft`): num turno que NÃO pede foto (`!isPhotoRequestBlock && !isPhotoMemory`),
  QUALQUER `send_media`, reasonCode de foto (`send_(vehicle_)?photos`), ou texto que PROMETE foto (`PHOTO_PROMISE_RX`)
  -> **deny + feedback** ao MESMO cérebro ("o cliente não pediu foto; execute stock_search ou responda a busca"). O deny
  força re-decisão; nenhum efeito/texto de foto sobrevive.
- **P0-C executor determinístico de foto** (`buildDeterministicPhotoResponse`, chamado no fallback single-author ANTES do
  `buildTechnicalFallback`): pedido de foto + alvo resolvido (`resolveSelectedVehicle` ordinal/modelo da última lista, ou
  selecionado) + `vehicle_photos_resolve` OK com photoIds -> **materializa `send_media`** (nome humano via
  `canonicalVehicleLabel`). Sem alvo/sem lista -> pede QUAL veículo (não consulta arbitrário). Alvo sem photoIds ->
  honesto e específico. `responseSource="deterministic_photo"` (NÃO degradado). Nunca cai em fallback genérico num pedido
  de foto resolvido.
- **Trava do turno atual sem quebrar o SDR:** `requiredToolBeforeFinal` NÃO foi ampliado para forçar `stock_search` em toda
  busca — isso quebraria a jogada legítima "acolher + perguntar o nome sem listar" (F2.13 [3c], permitida pelo protocolo).
  A garantia de que "você tem SUV?" não vira foto vem de P0-A (limpa intent) + P0-B (bloqueia foto) — o cérebro fica livre
  para buscar OU acolher, mas NUNCA para reenviar foto.

## Observabilidade nova
`responseSource="deterministic_photo"`; `signals.currentTurnIntent`; `policyFeedback` registra o deny de foto do P0-B.

## Testes (offline, $0) — `run-f2-20-context-lock-photo.ts` (nº 19 já usado por `run-f2-19-market-taxonomy.ts` de outra sessão)
**21 OK / 0 FALHA.** UNIT: `deriveCurrentTurnIntent` (search/photo_request/photo_memory/modelo/orçamento),
`clearStalePhotoIntent` (limpa foto em search; não mexe em turno de foto nem em tópico não-foto). E2E (engine REAL,
singleAuthor, brain scriptado/responder reproduzindo os erros):
- **E1**: "me manda foto do 2" + cérebro falha auth (chave crua) -> executor determinístico ENVIA `send_media` do item 2
  (Onix), `src=deterministic_photo`, NÃO technical_fallback, texto nomeia o carro (não a chave).
- **E2**: lista->foto(seta `activeTopic=photo_request`)->"você tem SUV?": frame vê `currentTurnIntent=search` + activeTopic
  de foto LIMPO; cérebro tenta foto (antes e depois do stock) -> P0-B bloqueia -> responde SUV (Renegade), sem foto/sem
  `send_media`, reasonCode != foto, `policyFeedback` registra o deny.
- **E3**: "você tem SUV?" com cérebro adversário (SÓ promete foto) -> NUNCA `send_media`, reasonCode != foto, fallback honesto.
- **E4**: "me manda foto do 2" SEM lista -> pede QUAL veículo, SEM consultar estoque/detalhe arbitrário.

## Gates
`npx tsc --noEmit` EXIT 0. `npm run test:all` EXIT 0 (F2.20 21, F2.19 market OK, F2.13 46 recuperado — a reversão do
`requiredToolBeforeFinal` restaurou o [3c], F2.17 14, F2.18 20, F2.15/16 OK, legado sem regressão).

## Arquivos
`src/domain/agent-brain.ts` (CurrentTurnIntent + FrameSignals.currentTurnIntent), `src/engine/turn-frame-builder.ts`
(buildTurnFrame aceita currentTurnIntent), `src/engine/central-engine.ts` (helpers P0-A/B/C + wiring + responseSource),
`src/adapters/llm/openai-agent-brain.ts` (regra de protocolo), `tests/run-f2-20-context-lock-photo.ts` (novo), `package.json`.

## Estado
Working tree (uncommitted) sobre a `main` `73b3ccab`. Flag OFF, central_active NÃO ativado. **Aguarda auditoria Codex.**
