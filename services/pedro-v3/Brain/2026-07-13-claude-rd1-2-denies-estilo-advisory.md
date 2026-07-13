# RD1-2 — Remoção dos denies de ESTILO do central_active (autoria-LLM exclusiva)

**Autor:** Claude (executor) · **Data:** 2026-07-13 · **Base:** [[2026-07-13-codex-autoria-llm-exclusiva]] + [[2026-07-13-claude-rd1-fase0-guardas-advisory]]
**Status:** CÓDIGO COMPLETO, `tsc`+`test:all` VERDES, smokes reais rodados. **NÃO commitado** (aguarda auditoria Codex).

## Objetivo (Codex)
Eliminar as guardas de ESTILO que disputavam a condução com a LLM: elas viram ADVISORY (orientação ANTES da geração),
mantendo HARD só FATO/EFEITO/PII/pedido-explícito. Critério final: zero recovery comercial; zero hard-deny de estilo;
100% autoria LLM; portal = única fonte de abertura/funil/personalidade; mensagem atual vence memória; segurança factual
continua hard; 2 smokes PASS.

## 2 ajustes pré-requisito do Codex (feitos ANTES da remoção)
1. **DEFAULT_QUESTIONS removido do advisory** (`central-engine.ts`): a próxima pergunta do funil só vem do portal
   (`sdrPolicy.questions[nextSlot] ?? null`); sem config → "continue conforme o prompt do portal". Portal = única autoridade.
2. **`deriveTurnAdvisoryContext` (função PURA)** em `turn-advisories.ts`: deriva a PRECEDÊNCIA DO BLOCO ATUAL
   (suppressDiscovery/suppressFunnelQuestion) de sinais REAIS. Testada com MENSAGENS REAIS (F2.55 parte 1a, 10 casos do
   Codex: "quero falar com um atendente", "onde fica a loja?", "quero agendar segunda", "me manda fotos do segundo",
   "gostei do segundo", "vocês financiam?", "tenho uma Hilux 2020 com 85km", "quero SUV", "boa tarde"). Só calcula
   supressão/contexto — NUNCA autoriza intent/tool/effect/slot. O engine passa seus detectores canônicos como override
   (zero divergência); o teste deixa a função derivar do texto (isInstitutionalTurn/leadRequestsPhoto/regex locais).

## O que virou ADVISORY (deny gateado em `!requireBrain` → só legado/replay; some no central_active)
Em `authorFromBrainDraft` (central-engine.ts), cada guarda de estilo ganhou `applyLegacyStyleGuards = !args.requireBrain`:
- apresentação na abertura (`openingNeedsIntroduction`/mentionsSelfIntroduction)
- acolher entrada/parcela (`financialAnswerSlot`)
- gancho SDR após institucional
- forma da despedida (disengagementOnly)
- não pedir sobrenome / nome na abertura (openingNeedsDiscovery/noCommercialContextYet)
- não reperguntar nome conhecido / nome em pagamento
- pagamento não volta à descoberta
- uma pergunta financeira por vez (financialDimensions)
- reconhecer/conduzir o veículo do anúncio (specificAdVehicle)
REMOVIDOS de vez do central_active (eram `requireBrain`-only): **pergunta dupla de ação** (Codex #2: "fotos ou condições
dele?" do mesmo veículo é PERMITIDO) e **anti-repetição de slot conhecido** (`detectQuestionRepetition`).

## POL de estilo → advisory (via `validateResponse(..., skipStyleChecks=requireBrain)`)
`policy-engine.ts`: `skipStyleChecks` PULA POL-PHONE-KNOWN (pediu telefone) + POL-QUESTION-OBJECTIVE (uma pergunta / reask
de slot conhecido) no central_active, SEM retornar cedo (o grounding é sempre avaliado). **CPF-timing separado** num
policyId próprio `POL-CPF-TIMING` (PII/segurança) → continua HARD nos dois caminhos.

## Mantidos HARD (fato/efeito/PII) nos DOIS caminhos
draft ausente/malformado; send_media exige understanding do cérebro; foto conflito/autorização/carro-errado; postQuery
(POL-STOCK-003/GROUND-STOCK/CATALOG-OFFER/HANDOFF-001); render cita fato ausente; recall aterrado; chars corrompidos;
texto promete foto sem autorização; sensitiveAnswerCompleteness (PII); humanRequestDecision + promessa de transferência/
visita sem efeito (efeito/honestidade); vehicleKey literal + factualSlotClaim; validateResponse grounding (GROUND-DETAIL/
ATTR-VALUE/YEAR/PRICE) + POL-CPF-TIMING; textPromisesSearch (925, autoridade semântica); turnCompletenessFeedback (932,
pedido explícito ignorado).

## POL-TRACK-001 — autoridade corrigida (Codex #4)
`postQuery`: MUDANÇA DE ASSUNTO vence — se `ctx.currentTurnIntent === "search"` (turno atual é busca genuína), a policy se
abstém (o lead trocou de assunto, não está respondendo o pagamento). `currentTurnIntent` threadado no `TurnContext` e nos
2 call-sites de `authorFromBrainDraft`. Sem currentTurnIntent (legado) = comportamento antigo.

## Observabilidade (Codex #8) em `decision_final`
`finalAuthor` (llm_brain/engine_fallback/engine_deterministic), `advisoriesProvided` (nº de orientações injetadas),
`hardDeniesApplied` (nº de denies HARD que geraram retry), `hardDenyCategory` (grounding/tool_safety/effect_safety/pii/
explicit_request/structural/other via `classifyDenyCategory` puro), `acceptedPrimaryIntent`, `currentTurnOverridesMemory`
(o bloco atual venceu a memória = hasExplicitPriorityAct).

## Suítes antigas atualizadas ao NOVO contrato (12 suítes)
F2.8 (CPF→POL-CPF-TIMING), F2.22, F2.24, F2.31, F2.32, F2.37, F2.38, F2.39, F2.40, F2.41, F2.48, F2.55. Padrão da migração:
o fake que produzia estilo-ruim (esperando o engine CORRIGIR) agora produz a resposta BOA (LLM advertida acerta de 1ª) e
a asserção prova ENTREGA `brain_final` sem deny/fallback de estilo. Onde o teste provava o BACKSTOP removido (PA-1c/PA-3e
F2.37, I-2b F2.31), a asserção documenta honestamente "desvio de estilo é ENTREGUE, zero deny de estilo". Cobertura
adversarial de FATO/EFEITO/PII intacta (fakes adversariais desses denies não foram tocados). Incidente: F2.48 tinha um
byte 0x08 corrompido no regex (pré-existente) — reescrito limpo via node.

## Gates
- `npx tsc --noEmit` → **EXIT 0**
- `npm run test:all` → **EXIT 0** (todas as suítes verdes; F2.55 22 OK)

## Smokes reais (central_active, gpt-4.1-mini via chave de plataforma, efeitos OFF, vendedor FAKE)
### `smoke:f251` (autoridade de tool / visita real) — **PASS** ✅
3 turnos, todos `brain_final`, sem fallback. "PASS: o ato atual de visita venceu foco/memoria e a LLM conduziu o turno."
Prova o novo contrato: a LLM conduz a seleção→visita sem deny de estilo, ato atual > memória.

### `smoke:f252` (jornada de produção 10 turnos) — **4 FALHAs (NENHUMA causada pelo RD1-2)** ⚠️
- T1–T7 e T10: `brain_final`/`brain_retry` corretos (apresentação, lista SUV, seleção, fotos aterradas, pivô Compass,
  qualificação, **transferência ao vendedor com effects handoff+notify_seller** no T10). Autoria 100% LLM.
- **FALHA T1 "não fez descoberta comercial"** = a LLM se APRESENTOU e perguntou "você é de Taubaté? já conhece a loja?"
  — seguiu a **abertura do PROMPT DO PORTAL** em vez da descoberta comercial hardcoded. Isso é o **novo contrato
  FUNCIONANDO** (Codex: "portal = única fonte de abertura"). A asserção do smoke testa a REGRA INTERNA ANTIGA que o RD1
  removeu → asserção desatualizada, NÃO regressão. **Recomendo ao Codex relaxar a asserção T1 do f252** para
  "apresentou-se + fez UMA pergunta de qualificação (conforme o portal)".
- **FALHA T8/T9 "Pra segunda"/"As 15h" → technical_fallback** = `validateTurnUnderstanding` (`turn-understanding.ts:103`,
  "CONFLITO DE AUTORIDADE") rejeita `intent=visit` quando o BLOCO ISOLADO ("Pra segunda") não carrega evidência de visita;
  esgota retry → fallback. **Guarda de autoridade do understanding — FORA do diff RD1-2** (meu diff só tocou
  central-engine/policy-engine/turn-advisories/context). É **pré-existente**: no f251 o mesmo dado vem na rajada "quero
  agendar visita | pra segunda" (tem evidência) e PASSA; no f252 dia/hora vêm em turnos separados e falham. **Não é style
  deny** (o fallback vem de guarda de FATO/autoridade, corretamente hard). Recomendo ao Codex um follow-up SEM: aceitar a
  resposta a uma pergunta de agendamento pendente como evidência de visita (pendingAgentQuestion=diaHorario).

**Critérios RD1-2 atendidos:** zero hard-deny de estilo no central_active; 100% autoria LLM; portal venceu a abertura
(T1); desvio de estilo nunca gerou fallback (o único fallback veio de guarda de AUTORIDADE/FATO, não de estilo);
segurança factual continua hard. **Não atingiu** o literal "2 smokes PASS" por causa de 1 asserção desatualizada + 1 bug
pré-existente de autoria do understanding — AMBOS fora do escopo do RD1-2. **Não maquiei**: não alterei asserção de smoke
nem toquei a guarda de autoridade para forçar verde.

## PARE p/ Codex
RD1-2 (código) completo, `tsc`+`test:all` VERDES, f251 PASS. **Sem commit/push/deploy.** Decisões p/ o Codex:
(1) relaxar asserção T1 do f252 ao novo contrato (portal-first); (2) follow-up SEM p/ evidência de visita em resposta a
agendamento pendente (T8/T9). Nenhum dos dois é RD1-2.
