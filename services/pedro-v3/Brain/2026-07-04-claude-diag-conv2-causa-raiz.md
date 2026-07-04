# DIAG conv2 — CAUSA-RAIZ EXATA de T4/T10 (technical_fallback) — 2026-07-04

**Run diagnóstico** (`diag:conv2`, observabilidade PURA, NENHUM código corrigido): 30 chamadas gpt-4.1-mini, US$0,075,
efeitos OFF, singleAuthor+llmFirst. Capturou draft bruto + effects + policyFeedback POR TENTATIVA.

## ⭐ ACHADO QUE INVERTE A CONCLUSÃO ANTERIOR
NÃO é não-compliância do modelo. **Os drafts do cérebro são BONS** — quem derruba são MINHAS PRÓPRIAS GUARDAS
(P0-B foto + grounding), que estão bloqueando respostas legítimas.

## T4 "gostei do segundo" (currentTurnIntent=other; selecionou HONDA CR-V 2010 corretamente; chamou vehicle_details)
- **Tentativa 1** draft: *"Ótima escolha! Quer ver as fotos ou já te passo as condições desse Honda CR-V 2010?"*
  → NEGADO por **SELECTION_ATTR_FEEDBACK** (minha guarda de seleção, disparada pelo `validateResponse` deny). CAUSA: o
  grounding trata o **ANO "2010"** — que faz parte do NOME/identidade do carro ("Honda CR-V 2010") — como ATRIBUTO não
  aterrado, mesmo o carro estando aterrado por vehicle_details. Ou seja: citar o NOME COMPLETO do carro selecionado é
  barrado.
- **Tentativa 2/3** draft: *"...Quer que eu te envie as fotos desse Honda CR-V ou prefere as condições?"*
  → NEGADO por **PHOTO_NOT_REQUESTED_FEEDBACK** (P0-B). CAUSA: `textPromisesPhoto` casa "te envie as fotos" — mas isso é
  uma OFERTA/pergunta ("quer que eu te envie...?"), NÃO uma promessa/envio. P0-B bloqueia OFERTA de foto legítima.
- Esgotou (3 finais negados) → technical_fallback. **policyId: minha SELECTION guard (att1) + P0-B PHOTO_NOT_REQUESTED (att2/3).**

## T10 "não quero foto agora" (currentTurnIntent=other; nenhuma tool)
- **Todas as 4 tentativas** draft: *"Sem problema, não envio as fotos agora. Quer que eu te passe as condições ou veja
  outro modelo?"* → NEGADO por **PHOTO_NOT_REQUESTED_FEEDBACK** (P0-B) nas 4. CAUSA: `reasonCodeMentionsPhoto` casa o
  reasonCode **"respect_photo_decline_and_offer_next_step"** porque contém a substring "photo" — mesmo o cérebro estando
  CORRETAMENTE RECUSANDO a foto. O check de reasonCode é largo demais (qualquer "photo"/"foto" no código dispara).
- Esgotou (4 finais negados) → technical_fallback. **policyId: P0-B PHOTO_NOT_REQUESTED (reasonCodeMentionsPhoto).**

## Causas-raiz (2 guardas MINHAS, over-aggressive)
1. **P0-B `reasonCodeMentionsPhoto` largo demais** — casa QUALQUER reasonCode com "photo"/"foto" (inclui
   "respect_photo_decline"). Deveria só bloquear intenção REAL de enviar (send_media effect + reasonCode EXATO
   send_vehicle_photos/send_photos), nunca um código que RECUSA foto.
2. **P0-B `textPromisesPhoto` casa OFERTA** — "quer que eu te envie as fotos?" é pergunta/oferta, não promessa. Só deveria
   casar envio ATIVO ("aqui estão as fotos", "estou enviando"), não uma oferta interrogativa.
3. **Grounding trata o ANO do NOME como atributo** — "Honda CR-V 2010" (marca modelo ANO = identidade do carro
   selecionado+aterrado) é barrado. O ano que compõe o NOME não deveria exigir vehicle_ref quando o carro está nos fatos.

## Consequência
As 2 degradações (T4, T10) são 100% causadas por guardas minhas bloqueando drafts bons. Corrigir = afrouxar P0-B
(reasonCode exato + texto de promessa que exclui oferta interrogativa) + permitir o NOME COMPLETO (com ano) do carro
aterrado no texto. São 3 correções pontuais de GUARDA (não de cérebro). NÃO apliquei (o dono pediu só o diagnóstico).

## Recomendação p/ Codex (correções propostas, NÃO aplicadas)
- P0-B: trocar `reasonCodeMentionsPhoto(code)` por match EXATO (`send_vehicle_photos`/`send_photos`), não substring.
- P0-B: `textPromisesPhoto` — não casar quando a menção de foto está numa OFERTA interrogativa ("quer que eu te envie…?"
  / frase terminada em "?"); manter o bloqueio de envio ativo.
- Grounding: permitir o ANO como parte do NOME do veículo aterrado (identidade), não tratá-lo como atributo (km/cor/etc).
- Depois: re-rodar SÓ a conv 2 e confirmar T4/T10 sem technical_fallback.

**Custo diagnóstico US$0,075. NENHUM código corrigido. Parado para Codex.**

## ⭐ CORREÇÕES APLICADAS (autorizadas pelo dono) + RE-EVAL conv 2 = PASS — 2026-07-04
As 3 guardas over-aggressive corrigidas (só as guardas; sem tocar arquitetura/handler/executor):
1. **P0-B `reasonCodeIsPhotoSend`** (era `reasonCodeMentionsPhoto`): allow/deny por reasonCode EXATO — bloqueia só
   {send_photos, send_vehicle_photos, photo_send, vehicle_photo_send, send_media_photo}. NUNCA bloqueia códigos de
   recusa/continuidade ("respect_photo_decline_and_offer_next_step" etc.). (central-engine.ts)
2. **P0-B `textPromisesPhoto`** (`PHOTO_ACTIVE_SEND_RX`): só ENVIO ATIVO/promessa assertiva ("aqui estão as fotos",
   "vou/estou enviando", "segue", "te enviei"); NÃO bloqueia OFERTA interrogativa ("quer que eu te envie as fotos?",
   "posso te mandar?", "prefere fotos ou condições?"). O subjuntivo "envie" (após "quer que eu te...") não entra.
3. **POL-GROUND-YEAR** (policy-engine.ts validateResponse): o ANO que compõe o NOME de um veículo ATERRADO é IDENTIDADE
   e PASSA ("Honda CR-V 2010" quando o CR-V 2010 está nos fatos). Um "modelo ano" que não bate com NENHUM par (modelo,
   ano) real -> deny (ex.: "Honda CR-V 2020"); idem ano possessivo do selecionado que diverge ("ele é 2020"). Correto
   passa; inventado bloqueia.

Offline: `run-f2-21` **35 OK** (dg1..dg8 = os 8 testes exigidos: recusa/oferta passam; envio ativo continua bloqueado;
ano correto passa; ano errado/solto bloqueia). **test:all + tsc verdes** (F2.8 grounding, F2.17, F2.20 sem regressão).

RE-EVAL conv 2 (EVAL_ONLY=2, 23 chamadas, US$0,058, compose=0, prompt integral): **PASS — 0 degradados** (agora o check
de terminalSafe está ativo, então é PASS real):
- ✅ **T4 "gostei do segundo"** -> "Ótima escolha! Quer que eu te envie as fotos desse Honda CR-V ou as condições?"
  (brain_retry, TS=false — NÃO degrada; a oferta de foto não é mais bloqueada).
- ✅ **T10 "não quero foto agora"** -> "Sem problema, não envio as fotos agora. Quer as condições ou outras opções?"
  (brain_final, steps=0, TS=false — respeita a recusa, sem mídia, sem fallback).
- ✅ T5 foto (send_media), T6 recall, T7 loja, T8 Onix, T9 popular — todos OK.

Critérios de sucesso ATINGIDOS: T4/T10 não degradam; nenhuma foto sem pedido; nenhum atributo/ano inventado passa.
**NÃO commitado. Parado para Codex.**
