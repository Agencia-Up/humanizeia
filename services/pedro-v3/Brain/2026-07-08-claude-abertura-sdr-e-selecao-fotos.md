# Abertura SDR melhor (PARTE A) + Seleção inteligente de fotos (PARTE B) + eval real staged (PARTE C)

**Data:** 2026-07-08 · **Autor:** Claude (executor) · **Missão:** dono · **Modo:** central_active (singleAuthor+llmFirst)
**Base git:** `bcfbfd1b` (P0-3/P0-4) · **Gates:** `tsc` EXIT 0 · `test:all` EXIT 0 (F2.37 **24 OK**, zero regressão) · **Sem commit** (aguarda Codex).
**Princípio mantido:** sem handler-first, sem resposta hardcoded por frase, sem policy decidindo a conversa. O cérebro é AUTOR; o engine orienta (sinais no frame + prompt), valida (deny+feedback) e executa tools com segurança (curadoria de mídia).

## PARTE A — Abertura SDR
**Diagnóstico:** o `adGenericEntry`+backstop (Fix B anterior) só cobriam ANÚNCIO genérico. Faltava (1) a "porta fria" — 1º
contato SEM anúncio ("Boa tarde" cru); (2) um sinal de ENTRADA por anúncio ESPECÍFICO; e o guardrail era substituição
determinística (a missão pede deny+feedback → o cérebro reescreve).

**Fix (invariantes):**
- 2 sinais novos no `FrameSignals` (`agent-brain.ts`) + computados no engine (`central-engine.ts`, ao lado de `adGenericEntry`):
  - `firstContactNoCommercialTarget` = `isOpeningTurn` (turnNumber 0 / nenhum turno do agente) **&& sem anúncio** && sem
    veículo/constraint/seleção && não-institucional && não-desengajado. Cobre a porta fria.
  - `specificAdEntry` = `isOpeningTurn` && anúncio COM veículo (adVehicle) && bloco atual sem veículo próprio.
  - Ambos threadados por `turn-frame-builder.ts` (spread condicional) → chegam ao cérebro.
- **Prompt** (`openai-agent-brain.ts`, BRAIN_PROTOCOL): orientação para `firstContactNoCommercialTarget` (cumprimenta,
  apresenta-se conforme o prompt, UMA pergunta de descoberta comercial — modelo/tipo/faixa — NUNCA nome/telefone/troca; não
  lista estoque sem intenção) e `specificAdEntry` (fala do veículo do anúncio e oferece fotos/detalhes/condições).
- **Guardrail deny+feedback** (`authorFromBrainDraft`, novo arg `openingNeedsDiscovery = adGenericEntry ||
  firstContactNoCommercialTarget`): se a abertura pede NOME sem descoberta comercial (e sem send_media/offer_list) → deny +
  feedback → **o cérebro RE-AUTORA** (LLM-first). Telefone já barrado por POL-PHONE-KNOWN.
- **Backstop determinístico** (último recurso, generalizado): se a abertura sem alvo degrada em `technical_fallback` OU
  ainda pede nome sem descoberta, o engine entrega a DESCOBERTA enumerada (modelo/tipo/SUV/faixa) — não o "me conta mais".

### P0 (follow-up Codex): `specificAdEntry` deixou de ser só advisory — virou INVARIANTE
**Incidente:** no smoke real `compass`, T1 (anúncio "Jeep Compass 2019") respondeu saudação genérica ("você conhece a loja?")
sem falar do Compass, e o gate passou (falso-verde: o assert só exigia Compass em T1 OU T2). **Fix por invariante** (o engine
NÃO escreve a resposta, só NEGA + feedback → o cérebro re-autora): guard em `authorFromBrainDraft` (arg `specificAdVehicle` =
`adVehicleHint` quando `specificAdEntry`): se o draft NÃO mostra/lista/oferece o veículo (`send_media`/`vehicle_offer_list`) E
NÃO cita a marca/modelo do anúncio conduzindo sobre ele (`mentionsAdVehicle` + `conductsAboutAdVehicle`) → deny + feedback
nomeando o veículo do anúncio. Aterramento: o caminho válido da abertura é `stock_search` do veículo do anúncio + `offer_list`
(mencionar o modelo em texto sem fato é barrado antes por POL-GROUND-STOCK/P0-3 — o que garante que a menção seja aterrada).
**Gate do smoke endurecido:** `run-ctwa-ad-smoke.ts` cenário `compass` agora REPROVA T1 se a abertura for saudação genérica
que não reconhece/conduz o Compass/Jeep (antes o `t12.some` mascarava com o T2). PASS por qualidade conversacional, não só
tool/effect. Testes `run-f2-37` [PA-3c] (mostra HB20 → aceito), [PA-3d] (genérica negada → re-autora mostrando HB20),
[PA-3e] (genérica insistente NUNCA entregue). **tsc+test:all EXIT 0, F2.37 27 OK, zero regressão** (F2.32/F2.33 intactos: no
caso com `stock_search` forçada o P0-3 nega antes; o guard cobre a abertura que não buscou).

## PARTE B — Seleção inteligente de fotos
**Diagnóstico:** `vehicle_photos_resolve` só devolve IDs OPACOS (sem ângulo/categoria; ordem = principal-primeiro).
`buildDeterministicPhotoResponse` mandava TODAS (`[...photos.data.photoIds]`) — 10+ de primeira. O ledger só populava no
caminho do cérebro (o determinístico usava `onSuccess:[]`).

**Fix (invariantes):**
- Módulo PURO `photo-selection.ts`: `selectPhotos({availablePhotoIds, alreadySentPhotoIds, max=5})` → até 5, EXCLUINDO já
  enviadas, priorizando DIVERSIDADE via `spaceIndices` (mantém a principal índice 0 + espaça uniformemente; sem metadado de
  ângulo é a heurística conservadora possível). `reason` = all_available/capped_diverse/next_batch/next_batch_capped/exhausted.
  (Se o adapter um dia expuser ângulo/categoria, é o ponto ÚNICO para trocar por classificação real.)
- **Chokepoint ÚNICO** no engine: `capPhotoEffects(decision, state, wm)` aplicado na `decision` FINALIZADA (llmFirst), ANTES
  do `pendingPhotoActions` (registra os IDs enviados) e do `materializeEffectPlans`. Dedup = `photoLedger.sentByVehicle` ∪
  `lastPhotoAction.photoIds` (mesmo veículo). NÃO muda a decisão do cérebro — só recorta/dedupa o payload de mídia e reescreve
  o `onSuccess mark_photos_sent` para os IDs realmente enviados. "manda mais" = próximo lote sem repetir.
- `buildDeterministicPhotoResponse` passou a anexar `mark_photos_sent` (antes `onSuccess:[]`) → o ledger ACUMULA no caminho
  determinístico também (dedup durável de múltiplos "manda mais").

## Arquivos (só `services/pedro-v3/`)
`src/domain/agent-brain.ts` (2 sinais) · `src/engine/turn-frame-builder.ts` (threading) · `src/adapters/llm/openai-agent-brain.ts`
(prompt) · `src/engine/central-engine.ts` (sinais + guardrail deny+feedback + backstop + capPhotoEffects + onSuccess do
determinístico) · **NOVO** `src/engine/photo-selection.ts` · **NOVO** `tests/run-f2-37-opening-and-photo-selection.ts` ·
`package.json` (test:f237 + test:all) · `eval/run-ctwa-ad-smoke.ts` (gate universal ≤5 fotos + cenário `opening-photos`).
Ajuste de teste (não-regressão): `tests/run-f2-34...` [TS-2] rodado em turno 2 (isola technical_fallback; no turno 1 o backstop
de abertura corretamente vira discovery).

## Gates offline (grátis, sem OpenAI)
`tsc` **EXIT 0** · `test:all` **EXIT 0** · **F2.37 24 OK** (PS-1..6 puro; PB-0..5 engine: 12→5, diversidade b1/b12, manda-mais
sem repetir, 3 fotos→3, ordinal certo, negação sem mídia; PA-1..5 abertura: firstContact/specificAd/adGeneric entregues,
deny+feedback vira discovery, nunca entrega "qual seu nome", intenção comercial não força discovery, 2º turno não é abertura).
F2.32 30, F2.34 30 (ajuste TS-2), demais intactos.

## PARTE C — eval real (⚠️ STAGED, NÃO EXECUTADO — sem chave OpenAI local)
NÃO há `OPENAI_API_KEY`/`EVAL_OPENAI_API_KEY`/`.env` no ambiente → **não consegui rodar o eval real** (não vou mascarar).
Deixei o gate PRONTO no smoke sancionado: `eval/run-ctwa-ad-smoke.ts` agora tem (a) gate UNIVERSAL "send_media com >5 fotos =
violação" e (b) cenário `opening-photos` (abertura genérica → discovery sem nome; SUV até 100k busca; fotos do 2º ≤5; manda
mais sem repetir). Coluna `effects` já mostra `[photoCount]` por turno. Rodar quando houver chave:
`PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 CTWA_SMOKE_SCENARIO=opening-photos npm run smoke:ctwa` (+ `compass` para o
anúncio específico). Custo alvo baixo (≤4 cenários, gpt-4.1-mini, efeitos OFF).

## Riscos / follow-ups
- **Dedup de 3+ lotes de "manda mais":** offline provado p/ 2 lotes via `lastPhotoAction` (accepted-safe); 3+ depende do
  `photoLedger` (fase delivered, que a produção tem). Universo do 2º lote depende do estoque REAL ter >5 fotos.
- **Sem metadado de ângulo/categoria:** a diversidade é por espaçamento de índice (o pipeline só tem IDs opacos). Melhoria
  futura = adapter expor ângulo/categoria por foto → `photo-selection.ts` troca a heurística por classificação.
- **PARTE C não executada** (chave). Assim que rodar, anexar o relatório `.md` e o veredito por turno.
- Próximas fases (NÃO nesta missão): CRM/transferência/handoff/agendamento; áudio; imagem do lead; visão do anúncio genérico.

**PARADO para auditoria do Codex — nada commitado.**
