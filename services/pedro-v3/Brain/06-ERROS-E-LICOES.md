# 06 - Erros e Lições (do v2 → prevenção estrutural no v3)

> Status: Fase 0 — semeado com incidentes-raiz REAIS do Pedro v2 (origem: changelog/commits/comentários do código + memória do executor).
> Autor: Claude. Data: 2026-06-26.
> Objetivo: cada incidente vira **prevenção estrutural** (política/contrato), não outro remendo. Coluna "v3 previne por" aponta o mecanismo que torna o erro impossível ou detectável.

## A. Classe "perdeu o trilho" (a dor central)

| Incidente real (v2) | Causa raiz | Remendo no v2 | v3 previne por |
|---|---|---|---|
| Lead respondeu "não tenho/vou pela parcela" a pergunta de entrada e o agente DESPEJOU lista (98123-8305) | a pergunta de entrada não virava `pending_question`; sem guard, "valor" virava busca | classificador + `leadRespondsNoDownPaymentOrInstallmentConcern` + guard no `normalizePlan` (v212) | `PendingObjective` estruturado + POL-TRACK-001 no `PolicyEngine` (deny de search) — não depende de regex de frase |
| Objeção de valor de troca virou foto/estoque (Francisco/Hilux) | guard só cobria oferta, não objeção dentro de `perguntou_troca` | `leadRespondsTradeValueObjection` (v213) | POL-TRACK-002 sobre o objetivo pendente de troca |
| Coleta da troca (km/fotos) perdida — turno não rodou após transferir (99628-7178) | enforcement de transferência rodava no meio da coleta | gates `leadProvidingTradeDetails` (v176) | POL-TRACK-003 + handoff só após slots mínimos (POL-HANDOFF-001) |

**Lição estrutural:** o trilho não é uma string `pending_question` — é um `PendingObjective` tipado com `expectedAnswerKinds`. A resposta do lead é interpretada PRIMEIRO contra ele (POL-TRACK-010).

## B. Classe estoque/oferta

| Incidente | Causa raiz | Remendo v2 | v3 previne por |
|---|---|---|---|
| "mais opções" repetia a mesma lista / misturava categoria | dedup preso a "mais opções"; override buscava sem categoria | `buildLastStockOffer`/`opcoes_listadas_keys` (v202/v217) | `OfferMemory` no estado + POL-STOCK-002 (preserva filtros, não repete) |
| Preço deflacionado pro orçamento do lead (Civic 73.990→50.000) | LLM reescrevia preço sob pressão de orçamento; validador não pegava preço | `validateGrounding` R6 (v161) | POL-GROUND-PRICE: composer aterrado em `QueryResult`; property "preço ∈ fatos" |
| "não temos sedans" tendo sedans / moto sumindo | palavra de TIPO virava token de modelo exigindo score>0 | WEAK_WORDS/v203/v215 | tool `stock_search` com contrato (tipo = filtro, não token) + POL-STOCK-003/005 |
| "vou buscar X e some" | LLM deferia num turno que já podia responder | `replyDefersSearch` (v171) | POL-PROMISE + decisão única que já incorpora o `QueryResult` antes de compor |

## C. Classe foto

| Incidente | Causa raiz | Remendo v2 | v3 previne por |
|---|---|---|---|
| Mandou foto e perguntou "quer foto?" de novo (dor nº1) | nenhuma camada cruzava "já enviei" com "re-ofertei" | `PhotoLedger`+`photoCtaDecision`+`stripPhotoReoffer` (v211) | `PhotoLedger` no estado + POL-PHOTO-002 |
| "de qual?" 4× sem nunca mandar (98287-4078) | `pickReferencedVehicle` ordem errada; sem caso "todos" | rework v163-v165 | tool `vehicle_photos_resolve`: ambíguo→clarify, alvo→envia (POL-PHOTO-001) |

## D. Classe handoff/transferência

| Incidente | Causa raiz | Remendo v2 | v3 previne por |
|---|---|---|---|
| Handoff por trás DEPOIS do envio; lead ficou sem resposta (99793-2207) | enforcement tardio mutava `reply.text` após o bloco de envio | `shouldBlockUnannouncedHandoff` (v214) | **arquitetura**: efeito só via outbox APÓS decisão final; nada de mutação tardia (POL-STATE-003, POL-HANDOFF-002) |
| Lead quente encerrado em silêncio ("Grata!") | LLM lia agradecimento como fim | `leadExplicitlyDeclined` (v169/v170) | POL-CLOSE-001 |
| Reação 👍 transferiu (99146-6876) | reação tratada como "sim" | `isReactionMessage`+lone-emoji guard (v186) | POL-PERSONA-002 no adapter de ingestão |

## E. Classe infra/atomicidade

| Incidente | Causa raiz | Remendo v2 | v3 previne por |
|---|---|---|---|
| ~20% de leads sem resposta (drop sistêmico — Gilda 99175-5700) | turno em `waitUntil` morria no recycle/deploy | `pedro-recover-dropped` cron (v190) | **design**: inbox durável + lease + at-least-once → o recuperador é propriedade, não remendo (POL-STATE-004) |
| Cada deploy matava tarefas em background | mesma raiz | evitar deploy em pico | idem — processamento desacoplado do isolate do webhook |
| Humanize destruía formatação de lista | envio refluía o texto em 3 msgs | `preserveFormatting` | POL-STOCK-006 + composer separado do sender |

## F. Classe alucinação/persona

| Incidente | Causa raiz | Remendo v2 | v3 previne por |
|---|---|---|---|
| Inventou "garantia de fábrica"/"laudo" (98861-9201) | LLM afirmava o que não está no prompt/estoque | `detectUngroundedClaims` prompt-aware (v166) | POL-GROUND-CLAIM (invariante duro no PolicyEngine) |
| Áudio "Hilux"→"Array Lux" → agente preso no carro errado | Whisper sem prompt de domínio | prompt de domínio em `transcribeAudioMedia` (v187) | tool `media_understanding` com contrato + "quando não entender, pergunta" |
| Vazou "sou uma IA" sob ataque | injeção de quebra de persona | `detectAiIdentityLeak` (v167) | POL-PERSONA-001 |

## Meta-lição (vale para TODO o v3)

O v2 acumulou ~100 builds porque cada print virava um backstop determinístico no pipeline. Funcionou, mas é **autoridade dispersa**. O v3 troca isso por: **estado tipado** (o erro não tem onde se esconder) + **uma decisão validada por políticas com ID** (o invariante é explícito e testado) + **efeito só via outbox após a decisão** (sem mutação tardia). Cada incidente acima deixa de ser "um if a mais" e vira "uma política com teste". Se, ao migrar, alguém propuser um `if` por frase, **é regressão de arquitetura** — pare (contexto-mestre §22).
