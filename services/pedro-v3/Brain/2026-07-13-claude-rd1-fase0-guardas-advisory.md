# RODADA 1 (Claude) — Fase 0: auditoria e classificação das guardas do central_active

**Data:** 2026-07-13 · **Autor:** Claude (executor) · **Base:** `2026-07-13-codex-autoria-llm-exclusiva.md` (bd2d53bb) ·
**Status:** ⛔ **Fase 0 (diagnóstico read-only) CONCLUÍDA. Nada editado ainda.** Missão exige esta tabela antes de editar.

## Estado atual (o que bd2d53bb já resolveu)

No `central_active` (`singleAuthor:true, llmFirst:true`) o engine **já NÃO autora texto comercial**. Fluxo em
`central-engine.ts:2519+`: brain propõe → tools/fatos resolvidos deterministicamente (SEM texto) → **passe final de
autoria da mesma LLM** (2626-2690, cap 2 tentativas via `FINAL_AUTHORSHIP_REQUIRED`) → se converge = `brain_final`/
`brain_retry`; se NÃO converge = **`buildBrainUnavailableResponse` = `technical_fallback` operacional degradado**
(2699-2714). Todos os `deterministic_*` (photo/institutional/disengagement/more-options/empty-conduct/relaxed/recovery/
recall) estão no ramo `else` (2715+) que só roda `singleAuthor && !llmFirst` = **inalcançável no piloto**. `DEGRADED_SOURCES`
= só `technical_fallback` (152). Confirmado: no piloto, resposta comercial = brain_* ou fallback operacional. ✅

**O que sobra (alvo desta rodada):** os denies de QUALIDADE ainda vivos dentro de `authorFromBrainDraft` e alguns
`POL-*`. Eles ainda **negam um draft comercial válido** por STYLE → forçam retry → se a LLM não satisfaz no cap →
degrada para `technical_fallback` (a linha robótica que o dono viu no "Boa noite"). A missão manda: STYLE vira
**advisory ANTES da geração**; só dano factual/segurança/efeito continua hard deny.

## Tabela — `authorFromBrainDraft` (central-engine.ts)

| linha | gatilho (verbatim curto) | dano evitado | classe | decisão |
|---|---|---|---|---|
| 645 | `!draft \|\| draft.parts.length===0` | não dá p/ enviar vazio | ESTRUTURAL | **KEEP** (mínimo: exigir 1 part text; afrouxar contrato p/ raramente falhar) |
| 643 | despedida + draft vazio/malformado | idem, especializado | ESTRUTURAL+estilo | KEEP núcleo; prescrição→advisory |
| 652 | `firstContact... !apresentou` | — (estilo) | QUALIDADE (apresentação) | **ADVISORY** ⭐bug "Boa noite" |
| 663 | send_media sem understanding/evidence | foto proativa/sem pedido | SEGURANÇA | **KEEP** |
| 685 | subjectValue ≠ modelo escrito | foto do carro errado | SEGURANÇA | **KEEP** |
| 688/780 | `textPromisesPhoto` sem autorização | foto proativa | SEGURANÇA | **KEEP** |
| 694 | foto resolvida ≠ alvo | foto do carro errado | SEGURANÇA | **KEEP** |
| 742 | buscou, há itens, "MOSTRE a lista" | esconder estoque real | QUALIDADE (condução) | **ADVISORY** ⚠️debatível (flag Codex) |
| 747 | `hasDeny(post)` (PolicyEngine) | grounding (ver POL-*) | SEGURANÇA | KEEP (denies factuais) |
| 754/755 | cita fato ausente (km/cor/preço) | atributo inventado | SEGURANÇA (grounding) | **KEEP** |
| 764 | recall: nomeie o veículo lembrado | — (condução de memória) | QUALIDADE | **ADVISORY** (label vira contexto) |
| 769 | texto corrompido (mojibake/ctrl) | mensagem ilegível ao lead | SEGURANÇA (output) | **KEEP** |
| 772 | acolha ENTRADA explicitamente | — (estilo) | QUALIDADE (acolhimento) | **ADVISORY** |
| 775 | acolha PARCELA explicitamente | — (estilo) | QUALIDADE (acolhimento) | **ADVISORY** ⭐(elo do loop parcela) |
| 783 | `sensitiveFeedback` (CPF/PII) | PII exposta | SEGURANÇA | **KEEP** |
| 790 | `humanRequestDecisionFeedback` | promessa humana sem efeito | SEGURANÇA (efeito) | **KEEP** |
| 801/805/809 | promessa handoff sem effect executável | promessa falsa | SEGURANÇA | **KEEP** (não tocar handoff) |
| 815 | promessa de visita sem schedule effect | promessa falsa | SEGURANÇA | **KEEP** |
| 820 | `hasDoubleActionQuestion` | — (estilo) | QUALIDADE (pergunta dupla) | **ADVISORY** |
| 824 | `factualSlotClaimFeedback` | valor de slot inventado | SEGURANÇA | **KEEP** |
| 826 | vehicleKey interna no texto | chave interna vaza | SEGURANÇA | **KEEP** |
| 833 | `PolicyEngine.validateResponse` deny | grounding (ver POL-*) | SEGURANÇA | KEEP factuais / downgrade POL-quality |
| 842 | institucional sem gancho ("não pare seco") | — (estilo) | QUALIDADE | **ADVISORY** |
| 847 | despedida reabre funil | — (estilo) | QUALIDADE (despedida) | **ADVISORY** |
| 852 | pediu sobrenome | — (estilo) | QUALIDADE | **ADVISORY** |
| 863 | pediu nome antes da descoberta | — (estilo) | QUALIDADE | **ADVISORY** |
| 869 | abertura sem alvo comercial (discovery) | — (estilo) | QUALIDADE | **ADVISORY** |
| 877 | reperguntou nome já conhecido | — (estilo) | QUALIDADE (anti-repetição) | **ADVISORY** |
| 886 | pagamento: não peça nome, ordem troca>entrada>parcela | — (estilo) | QUALIDADE (ordem funil) | **ADVISORY** |
| 898 | pagamento c/ carro escolhido volta à descoberta | — (estilo) | QUALIDADE | **ADVISORY** |
| 904 | 2 perguntas financeiras empilhadas | — (estilo) | QUALIDADE (nº perguntas) | **ADVISORY** |
| 915 | anúncio específico: reconheça o veículo | — (estilo) | QUALIDADE (abertura anúncio) | **ADVISORY** |
| 925 | prometeu buscar sem stock_search | busca falsa | QUALIDADE⚠️ | **ADVISORY** (flag; engine já pré-roda a busca em 2569) |
| 932 | `turnCompletenessFeedback` (ignorou pedido) | — (institucional)/foto | QUALIDADE+seg | **ADVISORY** parte institucional; foto já coberta por 663/688/694 |
| 949 | anti-repetição (`question-repetition`) | — (estilo) | QUALIDADE | **ADVISORY** |

## Tabela — PolicyEngine (`policy-engine.ts`, alcançado por 747/833)

| policyId | dano | classe | decisão |
|---|---|---|---|
| POL-STATE-011 (crm_read sem leadId) | tool sem contexto | SEGURANÇA | KEEP |
| POL-STOCK-003 (acima do teto) | ofertar acima do teto | SEGURANÇA | KEEP |
| POL-GROUND-STOCK / -DETAIL / -ATTR-VALUE / -YEAR / -PRICE | atributo/preço/ano inventado | SEGURANÇA | **KEEP** (todos) |
| POL-TRACK-001 (financiamento virou busca) | mis-roteamento | QUALIDADE/roteamento | ⚠️**revisar** (flag; lean advisory) |
| POL-PHONE-KNOWN (pediu telefone conhecido) | — (repetição) | QUALIDADE | **ADVISORY** |
| POL-QUESTION-OBJECTIVE (repergunta slot conhecido) | — (repetição) | QUALIDADE | **ADVISORY** |
| POL-HANDOFF-001 (handoff sem nome) | — (exige nome p/ transferir) | QUALIDADE **CONFLITA com request_human** | ⛔**NÃO tocar (é handoff)** — flag: conflita com "pedido de humano não exige nome"; corrigir na rodada de handoff |

## Achado importante (conflito de guardas)

**POL-HANDOFF-001 (nome obrigatório p/ handoff) × request_human (PII: pedido de humano NÃO exige nome).** Um lead
que pede "quero um atendente" sem ter dado o nome pode ser BLOQUEADO por POL-HANDOFF-001. A missão proíbe tocar
handoff nesta rodada, então **fica registrado para a rodada de handoff** (gate: POL-HANDOFF-001 não se aplica quando
`reason=explicit_human_request`). Não altero agora.

## Desenho da implementação (rodadas RD1-1/2)

**Dois tipos de guarda de qualidade:**
1. **Situacional (conhecido ANTES da geração, do frame/estado):** apresentação no 1º contato, descoberta-antes-de-nome,
   nome-já-conhecido, anúncio-específico, turno-de-pagamento-com-carro (conduzir financiamento não descoberta), ordem
   financeira troca>entrada>parcela, acolher-dado-recém-informado (entrada/parcela). → viram **advisory injetado no
   prompt** por um módulo PURO `buildTurnAdvisories(frame/estado)`; novo campo `advisories?: readonly string[]` no
   `TurnFrame`; o adapter (`openai-agent-brain`) renderiza um bloco "ORIENTAÇÕES DESTE TURNO (não são ordens rígidas)".
2. **Pós-texto (só sabíveis depois: pergunta dupla, reperguntou nome, prometeu visita, despedida reabriu, gancho):**
   deixam de existir como deny. A orientação equivalente já vai no advisory situacional + regra no prompt ("no máximo
   UMA pergunta acionável; não repergunte o que já sabe"). Se a LLM escorregar no ESTILO, **envia mesmo assim**
   (`brain_final`) — desvio de estilo nunca causa retry/fallback (critério da missão).

**Hard deny permanece SÓ para:** 645(estrutural mínimo), 663/685/688/694/780(foto), 754/755/824/826/833+POL-GROUND-*(grounding),
769(texto corrompido), 783(PII), 790/801/805/809/815(promessa sem efeito), POL-STATE-011, POL-STOCK-003.

**Observabilidade nova no decision_final (sem PII):** `hardDeniesApplied[]` (quais denies de segurança dispararam),
`advisoriesProvided[]` (advisories injetados), `finalAuthor` (`brain`|`technical_fallback`), `retryReason`, tool/effect
executado. `responseSource` já existe.

**Fallback:** inalterado — só `technical_fallback` operacional degradado (provider não convergiu); honesto, curto,
sem interpretar/listar/conduzir. Não há outro.

## Provas planejadas (RD1-3)
Suíte nova F2.55 (13 cenários da missão + jornada Hilux 2009/78km→sem entrada→parcela 1500→transferência→obrigado).
Assertivas: 100% comercial=brain_final/retry; 0 recovery comercial; 0 technical_fallback com provider ok; desvio de
estilo NÃO causa retry/fallback; violação factual continua bloqueada; tools só por ato confiável da LLM; nenhum estado
antigo vence o bloco; compose=0. Gates: tsc, test:all, F2.49/F2.50 + suítes de autoria; **2 smokes reais consecutivos**.

## Apêndice — inventário exaustivo (subagente, cruzado e confirmado)

Uma varredura independente confirmou: em `central_active` o conjunto FECHADO de `responseSource` é `brain_final`/
`brain_retry`/`technical_fallback`; o ÚNICO não-brain ativo é `buildBrainUnavailableResponse` (2702, texto fixo honesto,
`degraded=true`). Todos os `deterministic_*` estão no ramo `else`=`!llmFirst` = **LEGADO inalcançável**. ✅

**Camada nova que eu não tinha catalogado — guardas de TOOL no loop do cérebro (categoria b/e):**

| linha | gatilho | classe | decisão |
|---|---|---|---|
| 2344 FORBIDDEN tool fora do allowlist | tool inválida | SEGURANÇA | KEEP |
| 2358 `sensitiveAnswerTurn` → sem tool comercial | pós-CPF/data | SEGURANÇA (PII) | KEEP |
| 2411-2437 `REQUIRED_TURN_UNDERSTANDING` (tool exige capability+evidence) | tool sem base | SEGURANÇA | KEEP |
| 2447-2506 `DUP_*` (tool repetida) + authorizeQuery | idempotência | SEGURANÇA | KEEP |
| 2098 `UNDERSTANDING_STALE` / 2041 conflito / 2048 descarte | evidence fora do bloco | SEGURANÇA | KEEP |
| **2351** `commercialToolAllowedForHumanRequest` (pediu humano→sem tool comercial) | prioridade do ato humano | QUALIDADE⚠️ | **KEEP** (alinha com request_human; não degrada) |
| **2371** `stock_search` em resposta de TROCA | não re-buscar em resposta de funil | QUALIDADE⚠️ tool-gate | **revisar** (advisory?) |
| **2383** tool comercial em resposta FINANCEIRA | idem | QUALIDADE⚠️ tool-gate | **revisar** (advisory?) |
| **2394** `stock_search` c/ intent repair/financing/trade/smalltalk | não re-buscar fora de busca | QUALIDADE⚠️ tool-gate | **revisar** (advisory?) |
| **2125** `SEARCH_ACT_EXPECTED` (bloco pede estoque, filtro suficiente, sem search) | exige o ato de busca | QUALIDADE⚠️ | **revisar** |
| **2161** `REQUIRED_TOOL_MISSING` (já buscou → liste, não re-busque) | conduzir a lista | QUALIDADE⚠️ | **revisar** |

**⚠️ Recalibração importante:** os tool-gates (2371/2383/2394) usam flags do ENGINE (`tradeInAnswerTurn`/
`financialAnswerTurn`) para **sobrescrever a escolha de tool da LLM** — é exatamente "estado/regex decidindo o ato por
cima da LLM" que a missão quer remover. MAS eles evitam um bug real de condução (re-listar carros quando o lead
respondeu "não tenho entrada"). Convertê-los para advisory é mais delicado que os denies de TEXTO: muda comportamento
de TOOL no núcleo que o Codex acabou de refatorar. **Recomendo tratá-los como sub-rodada separada** (advisory que diz
"o cliente está respondendo sua pergunta de troca/financeira — não inicie nova busca"; se a LLM ignorar = escorregão de
condução, não dano). Nesta rodada foco nos denies de TEXTO (o que causa a degradação robótica).

## Ripple de testes (declarado)
Converter os denies de qualidade em advisory vai **quebrar as asserções de contrato** de várias suítes que HOJE exigem
que esses denies DISPAREM (F2.21/F2.22/F2.43/F2.48: pergunta dupla, reperguntar-nome, promessa-de-consultor,
ordem-financeira, despedida). Elas precisarão ser reescritas para o novo contrato (o invariante protegido muda de
"nega o texto" para "orienta antes; texto de estilo passa"). É um trabalho grande e deliberado, não uma regressão.

## Itens que dependem do Codex antes do edit no núcleo
1. POL-HANDOFF-001 × request_human (deferir p/ rodada de handoff — não toco agora).
2. Debatíveis TEXTO: 742 (mostre a lista), 925 (prometeu buscar), POL-TRACK-001 (financeiro→busca).
3. **NOVO — tool-gates 2371/2383/2394/2125/2161:** manter nesta rodada (só TEXTO) ou já converter para advisory?
   Minha recomendação: manter e tratar em sub-rodada, para não colidir com o refactor de autoria recém-feito.

## PROGRESSO — RD1-1 (infra de advisory) LANDED + VERIFICADO (2026-07-13)

Implementado e **compilando + test:all EXIT 0** (aditivo, zero deny removido ainda — comportamento inalterado):
- `TurnFrame.advisories?: readonly string[]` (`domain/agent-brain.ts`) + `buildTurnFrame` aceita/anexa (`turn-frame-builder.ts`).
- **`src/engine/turn-advisories.ts` (NOVO, puro):** `buildTurnAdvisories(input)` → orientações situacionais do turno
  (apresentação 1º contato; anúncio específico; discovery-antes-de-nome; nome/telefone/slot já conhecido; pagamento com
  carro escolhido → conduzir financiamento; acolher entrada/parcela recém-informada; despedida; gancho institucional;
  UMA pergunta / anti-repetição). Advisory ORIENTA — nunca decide ato/tool/slot/veículo.
- **`central-engine.ts`:** computa `turnAdvisories` do estado/frame SÓ em llmFirst e anexa ao frame ANTES do loop do cérebro.
- **`openai-agent-brain.ts`:** renderiza `frame.advisories` no user JSON como `orientacoesDoTurno` (não-rígidas; pedido
  explícito do cliente vence).

## FALTA (RD1-2/RD1-3, próximo chunk — grande, com ripple de testes)
1. **Remover os ~15 denies de ESTILO** do `authorFromBrainDraft` (652/772/775/820/842/847/852/863/877/886/898/904/915/949)
   — o advisory já os cobre antes da geração; desvio de estilo passa a enviar brain_final (não retry/fallback).
2. **Filtrar POL-* de qualidade em llmFirst** (POL-PHONE-KNOWN; POL-QUESTION-OBJECTIVE known-slot/>1-pergunta — MANTER a
   perna CPF-timing) via filtro dos vereditos em 747/833.
3. **Refinar por autoridade semântica (KEEP hard, Codex):** 742 (mostre a lista) e 925 (prometeu buscar) gateados no ato
   aceito=search_stock OU retomada validada; POL-TRACK-001 respeitando mudança explícita de assunto do bloco atual
   ("na verdade quero um Onix" → busca passa; "até 1500" respondendo parcela → bloqueia). 932 (completude) FICA hard.
4. **Observabilidade:** `finalAuthor`/`advisoriesProvided`/`hardDeniesApplied`/`hardDenyCategory`/`acceptedPrimaryIntent`/
   `currentTurnOverridesMemory` no decision_final.
5. **Tool-gates 2371/2383/2394:** ganham escape "mudança explícita de assunto → tool passa" (necessário p/ o teste E).
6. **Ripple:** reescrever as asserções de contrato de ~10 suítes (F2.21/22/43/48…) que HOJE exigem esses denies dispararem.
7. **F2.55** (cenários A-G do Codex + jornada Hilux 2009/78km→sem entrada→parcela 1500→transferência→obrigado) + gates
   + **2 smokes reais**. Regressão nova exigida: lead sem nome "quero atendente" → handoff explicit_human_request sem coleta.

**Estado:** RD1-1 verde e verificado; parei aqui para não deixar o tree quebrado no meio do ripple de testes do RD1-2/3.
Correções da auditoria Codex (item 1-5) incorporadas ao plano acima.

## AUDITORIA CODEX do RD1-1 — 3 ajustes obrigatórios FEITOS + VERIFICADOS (2026-07-13)

O Codex vetou o commit do RD1-1 e pediu 3 correções ANTES de remover denies. Todas implementadas (tsc + test:all EXIT 0):
1. **Precedência do bloco atual:** advisory de apresentação/anúncio/descoberta é SUPRIMIDO quando o bloco atual tem ato
   explícito prioritário (`suppressDiscovery`) — humano/visita/institucional/foto/detalhe/seleção/financiamento/troca/
   sensível/despedida/alvo-comercial-dito. Detectores lexicais no engine SÓ suprimem (nunca autorizam tool/effect/slot/
   intent). Invariante `pedido explícito atual > funil > memória`.
2. **Portal é a autoridade do funil:** removida a ordem hardcoded troca→entrada→parcela. A próxima pergunta vem de
   `deriveSdrQualification(state, sdrPolicy)` + `policy.questions`/`DEFAULT_QUESTIONS` (config do tenant). Sem próxima
   pergunta configurada → "continue a qualificação conforme o prompt do portal". `suppressFunnelQuestion` em turnos
   institucional/humano/visita/despedida. A regra geral NÃO proíbe "fotos ou condições dele?" (alternativa curta do
   mesmo veículo permitida); só proíbe empilhar perguntas INDEPENDENTES.
3. **Testes puros de `buildTurnAdvisories` (F2.55 parte 1) ANTES de remover denies:** A-L **12 OK** (A saudação→apresentação;
   B request_human→zero discovery; C institucional→zero discovery/funil; D visita pós-financiamento→zero funil antigo;
   E despedida→só encerramento; F SUV→não repergunta tipo; G nome conhecido; H/I ordem do portal respeitada/sem hardcode;
   J advisory é só string, zero tool/effect/mutação; K fallback do portal; L alternativa curta permitida).

**Arquivos:** `turn-advisories.ts` (reescrito), `central-engine.ts` (suppress/portalNextQuestion + import), `package.json`
(test:f255 + test:all). Gates: tsc EXIT 0, test:all EXIT 0 (F2.55 12 OK, zero regressão). **Nada commitado.**

**Próximo (RD1-2, o chunk que vira o comportamento):** remover os ~15 denies de estilo do authorFromBrainDraft (advisory
já cobre); filtrar POL-PHONE-KNOWN/POL-QUESTION-OBJECTIVE-estilo em llmFirst (manter CPF-timing); refinar 742/925/POL-TRACK
por autoridade semântica + escape de mudança-de-assunto nos tool-gates 2371/2383/2394; observabilidade
(finalAuthor/advisoriesProvided/hardDeniesApplied/hardDenyCategory/acceptedPrimaryIntent/currentTurnOverridesMemory);
F2.55 parte 2 (cenários A-G + jornada Hilux 2009/78km→sem entrada→parcela 1500→transferência→obrigado); reescrever as
asserções de contrato de ~10 suítes antigas; test:all; 2 smokes reais consecutivos. É o ripple grande — feito na
próxima janela com orçamento cheio, sem deixar o tree quebrado no meio.

## Limites respeitados
Não toco CRM/handoff/follow-up (POL-HANDOFF-001 fica — já corrigida por `handoffReason!=="explicit_human_request"`,
confirmado pelo Codex). Não mexo em flags. Sem commit/push/deploy — PARA p/ Codex.
