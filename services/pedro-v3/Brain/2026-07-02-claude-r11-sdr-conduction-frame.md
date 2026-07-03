# R11 — SDR Conduction Frame (Claude executor) — 2026-07-02

> Handoff para auditoria Codex. NÃO commitado, NÃO deployado. Gates offline verdes.
> Regra da rodada (dono): "Não faça if por frase. Toda correção deve ser por invariante geral."

## Objetivo
Governar o PRÓXIMO passo de condução SDR por **invariantes gerais** (não por frase),
sem quebrar nenhuma proteção de segurança já existente (grounding, terminal-safe, uma-pergunta,
supersede, anti-fixação). O sistema NÃO pode: reperguntar slot known; gravar `currentObjective`
diferente da pergunta enviada; trocar objetivo sem supersede; empilhar 2+ perguntas; pedir CPF
antes da fase; fazer handoff antes do funil mínimo; ignorar pergunta comercial clara; insistir em
funil quando o lead demonstra intenção de compra.

## O que foi construído
1. **`src/engine/sdr-conduction-frame.ts` (NOVO)** — módulo PURO. Traduz estado do funil +
   sinais comerciais em guidance estruturada: `{ stage, leadIntent, answeredObjective,
   nextAllowedQuestion, forbiddenQuestions, mustAnswerLeadQuestionFirst, shouldAskOneQuestionOnly,
   buySignalLevel, handoffEligibility, composeGuidance }`.
   - Sinais por **LEXICON** (STRONG_BUY / SOFT_BUY / PRICE_QUESTION / DETAIL_QUESTION /
     DIRECTION_CHANGE / MORE_OPTIONS / PHOTO_REQUEST / GREETING) — mesmo padrão de `parseType`/
     `parseBudget`. **Sem lista hardcoded de frase, sem if-por-frase.**
   - `forbiddenSlots(state)` = todos os slots known/declined (exceto cpf) → invariante geral que
     impede reperguntar o que já sabemos.
   - `answeredObjective` = objetivo pendente cujo slot já entrou em forbidden (foi respondido).
   - `stageOf` + `handoffEligibility` = handoff só quando funil mínimo completo.
2. **`src/engine/sdr-conductor.ts`** — `conductDecision` agora chama `buildSdrConductionFrame` e
   injeta `frame.composeGuidance` via `withConductionGuidance`. `reconcileObjectiveWithQuestion`
   (R10-1) intacto: objetivo persiste = pergunta realmente enviada.
3. **`src/engine/conversation-engine.ts`** — os 2 call-sites de `conductDecision` passam
   `leadMessage` + `interpretation` (frame precisa da fala do lead p/ classificar sinal).
4. **D1 — `src/engine/policy-engine.ts`** — `parseMoneyMentions(...).filter(m => m.value > 0 && !isLeadValue(m.value))`: "entrada zero" nunca é preço de veículo (matava turno em terminal-safe).
5. **A1 — `src/engine/lead-extraction.ts`** — pedido de compra ("quero SUV até 70 mil") não é
   mais lido como "resposta de troca=true"; só posse real ("tenho um gol") seta `possuiTroca`.

## Testes
- **`tests/run-f2-9-conduction-frame.ts` (NOVO)** — 34 testes ESTRUTURAIS puros do frame
  (stage/buySignal/forbidden/nextAllowed/mustAnswerFirst/answeredObjective). FakeLlm só estrutura.
- `tests/run-f2-7-14-sdr-conductor.ts` — asserção ajustada (oferta sem nome → objetivo=nome reconciliado).
- `tests/run-f2-8-rebalance-cases.ts` — bloco R11-A1 (3 checks do guard de troca).
- `package.json` — test:all encadeia `run-f2-9-conduction-frame.ts`.

## Gates offline (VERDES)
- `tsc --noEmit` → **EXIT 0**.
- `npm run test:all` → **EXIT 0**, 0 FALHA. F2.9=34 OK, F2.8=166 OK, F2.7.14=49 OK.

## Eval real (gpt-4.1-mini, temp 0.7, efeitos OFF, prompt integral SHA 009edd16; 2 runs/cenário)
| cenário | judge (run1/run2) | críticas | terminal-safe (causa) |
|---|---|---|---|
| s1 descoberta/estoque/fotos | 72/68 | 2/1 | T9 cor (grounding), T13 2-perguntas (CONDUÇÃO) |
| s2 direção/referências | 70/70 | 3/1 | T3 ONIX×2 (grounding) |
| s3 anti-handoff-precoce | 81/89 | 3/0 | — |
| r3 incidente-v2 sintético | 48/57 | 0/0 | — |

Deterministicos: **OBJECTIVE_REPLACED 28→17 (−39%)**; terminal-safe 5/68 (4 grounding + **1 condução**);
SLOT_FIXATION 5; PRONOUN 4; **EARLY_HANDOFF 0**; **REASK_KNOWN_SLOT 0**. 178 chamadas 2xx, efeitos OFF.

## Diagnóstico honesto (o que o eval revelou)
1. **Ganho real e estável:** OBJECTIVE_REPLACED −39%. `answeredObjective` + reconcile reduziram a
   troca de objetivo por turno. Guards A1/D1 entraram; "entrada zero" não gerou terminal-safe.
2. **LIMITE ESTRUTURAL (o achado da rodada):** o frame só alcança turnos que passam por `compose`
   (`needsCompose`). Os handlers DETERMINÍSTICOS (`continuity_conduct`, `more_options`, foto) dão
   **curto-circuito ANTES do `conductDecision`** e nunca enxergam o frame. É exatamente por isso
   que s1 T6 ("Gostei do segundo") e T8 ("Bonito ele") respondem com menu robótico ignorando a
   seleção do lead — `reason=continuity_conduct`, llm=1, sem compose. **O frame está certo; ele
   simplesmente não é consultado nesses caminhos.** Corrigir = decisão ARQUITETURAL do Codex
   (rotear continuity/soft-buy pelo frame vs. manter determinístico). NÃO fiz agora: seria um
   segundo movimento estrutural, fora do escopo "construir o frame".
3. **1 terminal-safe de condução** (s1 T13: lead "consigo visitar sábado", LLM empilhou 2 perguntas
   apesar do `shouldAskOneQuestionOnly`). Guidance é ADVISORY; a proteção determinística
   `POL-QUESTION-OBJECTIVE` pegou e caiu em fallback — **a rede de segurança funcionou, nenhuma
   mensagem ruim foi enviada** — mas degradou o turno.
4. **r3 nota baixa (48/57) = ALUCINAÇÃO DO JUIZ.** O juiz reclama "repergunta o nome já dado no T1".
   A transcrição prova que o agente **NUNCA reperguntou o nome**: T1 captura nome=Douglas e pergunta
   loja; T2/T3 seguem loja/interesse. O fixture `synthetic_v2_incident` faz o LEAD repetir "Douglas"
   no T2 e o juiz atribuiu isso ao agente. Estruturalmente r3 está CORRETO (0 crítica, nome não
   reperguntado, buy-now conduzido). **Não "consertar" fantasma; sinaliza que o judge LLM é ruidoso.**
5. **Fora do escopo R11 (área Codex, reportado):** grounding terminal-safe ONIX×2 e cor×2;
   `cambio=automatic` vazando na busca de picape (s1 T10, 24 buscas). Não toquei (regra: não remendar
   a parte de busca/grounding do Codex sem prova de regressão — e não há).

## Recomendação
**PODE IR PARA AUDITORIA CODEX — com ressalvas. NÃO DEPLOYAR ainda.**
- O frame é ganho estrutural real, testado (34 estruturais) e com gates verdes.
- Mas o eval expôs um limite que o frame sozinho não resolve (achado #2): os handlers determinísticos
  não consultam o frame. Isso precisa da decisão arquitetural do Codex antes de produção.
- Não bati 2 barras do alvo (0 terminal-safe de condução; 0 crítica de atributo), mas ambas foram
  contidas pela rede determinística (nenhuma mensagem ruim ao lead) e os resíduos são majoritariamente
  grounding (área Codex) + 1 miss de guidance advisory.

## Próxima rodada sugerida (para o Codex decidir)
- R12-A: rotear `continuity_conduct`/`more_options`/soft-buy pelo frame (ou fazer o handler consultar
  `buildSdrConductionFrame`) — fecha o achado #2.
- R12-B: reforçar `shouldAskOneQuestionOnly` no compose de turnos buy-strong (achado #3).
- R12-C (Codex): grounding ONIX/cor + vazamento de `cambio` na busca de picape.
- Judge: considerar rótulo determinístico de "reask" no relatório para não depender do juiz ruidoso (#4).
