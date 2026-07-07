# CTWA P0 #2 — Invariante de foto DETERMINÍSTICO (o cérebro não pode "não localizei" quando o carro TEM foto)

**Data:** 2026-07-07 · **Autor:** Claude (executor) · **Achado por:** auditoria Codex (re-rodada do smoke real `smoke:ctwa` compass) · **Modo:** central_active
**Gates:** `tsc` EXIT 0 · `test:all` EXIT 0 (F2.33 **21 OK**, zero regressão real) · **smoke real compass/ranger PASS** (ver rodapé)

## Sintoma (Codex)
Re-rodando `smoke:ctwa CTWA_SMOKE_SCENARIO=compass`, o T3 "me manda fotos dele" às vezes respondia
**"Não localizei as fotos do JEEP Compass 2019 agora..."** — MESMO com `stock_search modelo=compass` retornando o
Compass 2019 `revendamais:7894915` com 10 photoIds e `vehicle_photos_resolve(revendamais:7894915)` OK com 10 photoIds.

## Causa-raiz: NÃO-DETERMINISMO (o invariante dependia do humor do LLM)
O meu F2.33 anterior (P0-A) resolvia a REFERÊNCIA do anúncio e, quando o cérebro NÃO autorava, o Path B determinístico
enviava a foto. Mas quando o gpt-4.1-mini **AUTORAVA** um texto de ausência honesta ("não localizei as fotos..."), a
**guarda de completude do turno ACEITAVA** esse texto (casa `PHOTO_HONEST_ABSENCE_RX`) sem NUNCA ter consultado as fotos
do alvo. Ou seja: a "ausência honesta" podia ser **FALSA** (o carro tem foto) e passava. Rodando o smoke 2×: uma vez
`deterministic_photo` (PASS, o cérebro não autorou → Path B enviou), outra vez o cérebro autorou a ausência falsa (o que
o Codex pegou). **O envio da foto dependia de qual amostragem o LLM escolhia.**

## Fix por invariante (engine PROTEGE, independente do cérebro) — 3 arquivos, só `services/pedro-v3/`
Princípio (Codex): *"Se o lead pediu foto e o alvo foi resolvido por ad_reference/ordinal/seleção/modelo e
`vehicle_photos_resolve` do alvo retorna photoIds>0, a resposta final DEVE conter send_media desse vehicleKey. Ausência
honesta só vale após consultar o alvo certo e vir VAZIO/erro."*

1. **`turn-understanding.ts` `authorizesPhotoByResolvedTarget(target, block)`** — generaliza os autorizadores narrow
   (`authorizesPhotoByResolvedOrdinal`/`ByAdReference`): alvo RESOLVIDO por QUALQUER fonte aterrada (anúncio/ordinal/
   seleção/modelo) + pedido EXPLÍCITO de foto do LEAD (verbo de envio/ver + "foto"; negação barra). **Dirigido pelo
   pedido do lead, não pela cooperação do cérebro.** Superset dos dois antigos (que saíram do central-engine).

2. **`central-engine.ts` — OVERRIDE pós-loop (o coração do fix).** Logo no início do bloco `singleAuthor`, ANTES de
   decidir a resposta final: se `llmFirst && alvo resolvido && authorizesPhotoByResolvedTarget`, o engine **FORÇA**
   `vehicle_photos_resolve` do alvo certo (bypassa o gate de autorização do cérebro) e:
   - `photoIds>0` **e** a autoria não tem send_media → **DESCARTA a autoria** (`authoredComposed/Decision/ProposedEffects
     = null`) → cai no executor determinístico (`buildDeterministicPhotoResponse`) que materializa o `send_media` do alvo.
   - alvo sem fotos / erro → **NÃO** descarta → a ausência honesta do cérebro sobrevive (agora VERDADEIRA, pós-consulta).
   - `buildDeterministicPhotoResponse` e o `wantsPhotoNow`/`photoRequested` da completude passaram a usar
     `authorizesPhotoByResolvedTarget` (envia para seleção/modelo também, não só ordinal/anúncio).

3. A mídia enviada é **a do engine** (grounded em `vehicle_photos_resolve` + `targetAcceptsKey`), nunca a proposta crua
   do cérebro — a trava P0-2 (não confiar no palpite cru) continua; o engine só ATERRA de forma independente e envia.

## Testes offline — `tests/run-f2-33-ctwa-ad-refinements.ts` (21 OK, +5)
Reproduzem o bug do Codex de forma DETERMINÍSTICA (fake brain que autora ausência honesta):
- **A-4** cérebro autora "Não localizei as fotos do Jeep Compass 2019" mas o 2019 TEM fotos → engine OVERRIDE e ENVIA.
- **A-5** a foto do override é o `rm:cmp19` exato. **A-6** a resposta final descarta o "não localizei".
- **A-7** alvo REALMENTE sem fotos (ordinal 1 = 2017, fake sem foto) → ausência honesta SOBREVIVE (sem media).
- **A-8** o engine CONSULTOU as fotos do alvo antes de honrar a ausência.

## Testes ajustados (expectativa ANTIGA contradizia a invariante literal do Codex — NÃO é regressão)
- **F2.22 [O]**: Onix SELECIONADO + "me manda foto do Onix", cérebro autora ausência honesta. O Onix TEM fotos →
  antes esperava "honra a ausência (sem media)"; agora o engine OVERRIDE e ENVIA (a ausência era FALSA). A ausência
  LEGÍTIMA (alvo sem foto) segue coberta por F2.33 A-7.
- **F2.23 [I]**: Onix SELECIONADO, cérebro propõe mídia SEM understanding (malformado). Antes: P0-2 rejeita → ZERO media.
  Agora: a proposta CRUA do cérebro segue rejeitada (`fromBrain=false`), MAS o engine ATERRA e envia a foto do alvo
  resolvido (`src=deterministic_photo`). Recuperação robusta. P0-2 p/ alvo AMBÍGUO/ERRADO segue em [J]/[L].

## Arquivos (deploy Easypanel; SEM mudança no bridge/edge — não redeploya Supabase)
`Agent/src/engine/turn-understanding.ts`, `Agent/src/engine/central-engine.ts`, `Agent/tests/run-f2-33-*`,
`Agent/tests/run-f2-22-*`, `Agent/tests/run-f2-23-*`.

## Riscos / limites
- O override só dispara com alvo ÚNICO resolvido + pedido EXPLÍCITO de foto (PHOTO_REQUEST_STEM, negação barra) —
  "gostei das fotos" (menção) NÃO dispara (F2.23 [O] intacto). Alvo ambíguo → pergunta qual (F2.23 [L]).
- Depende de o alvo RESOLVER: no fluxo CTWA, a referência do anúncio (`resolveAdReferenceKey`) exige a última oferta
  renderizada ter o modelo+ano (o engine grava `lastRenderedOfferContext` de forma determinística quando lista).

## Smoke real (gate barato, LLM real gpt-4.1-mini, efeitos OFF)
`PEDRO_V3_REAL_EVAL=1 CTWA_SMOKE_SCENARIO=<compass|ranger> npm run smoke:ctwa` — **3 runs, todos PASS (0 violações)**:
- **compass RUN 1** PASS (BRAIN=24, ~US$0,074) · **compass RUN 2** PASS (BRAIN=25, ~US$0,078) · **ranger** PASS (BRAIN=5, ~US$0,015). Total ~US$0,17.
- Prova da estabilidade (antes era não-determinístico): compass rodado **2×**, o T3 "me manda fotos dele" enviou
  `send_media(revendamais:7894915)[10]` — o Compass **2019** exato — nas DUAS vezes (source=`deterministic_photo`,
  texto "Aqui estão as fotos do JEEP Compass 2019..."). T4 correção→Onix OK, T5 loja OK. ranger T2 "algo parecido"
  abre p/ picapes sem prender no Ranger.

## Status
Fix por invariante COMPLETO e PROVADO (offline determinístico + smoke real estável 2×). **NÃO commitado** — aguarda ok do
dono. HEAD atual = `ff1b84ea` (F2.33 P0-A/P0-B). Escopo do commit: `central-engine.ts`, `turn-understanding.ts`,
`run-f2-33`, `run-f2-22`, `run-f2-23`, este handoff. Sem edge/Supabase (Easypanel builda no push).
