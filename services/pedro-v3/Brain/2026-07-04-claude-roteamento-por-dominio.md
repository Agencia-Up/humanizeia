# P0 ROTEAMENTO POR DOMÍNIO — policies só atuam no domínio certo (institucional não trava) — 2026-07-04

**Autor:** Claude (executor). **Auditor:** Codex. **NÃO commitado** (missão: sem commit/push/deploy sem autorização).

## Bug (teste real do Douglas)
Institucional "aonde fica a loja?" com estado íntegro (recentTurns/selectedVehicle/lastPhotoAction/interesseVisita/
diaHorario ok, tenant_business_info(address)=ok) caía em **technical_fallback** porque a validação era DOMAIN-BLIND:
- poll-13: POL-QUESTION-OBJECTIVE reclamou de reperguntar slot conhecido (interesseVisita/diaHorario).
- poll-12: policy de atributo de veículo reclamou sem vehicle_details.
Uma pergunta institucional simples não pode ser barrada por policy de veículo/funil.

## Arquitetura da correção — ROTEAMENTO POR DOMÍNIO
Novo módulo `src/engine/turn-domain.ts` (baixo nível, sem ciclo): `isInstitutionalTurn(block)` +
`institutionalTopicsRequested(block)` (address/hours/unit) + `mentionsContact` (instagram/site/telefone). Importado por
central-engine E policy-engine.
- **`policy-engine.validateResponse`** computa `institutionalTurn = isInstitutionalTurn(ctx.leadMessage)` e as policies de
  VEÍCULO/FUNIL se ABSTÊM quando institucional: POL-QUESTION-OBJECTIVE (reperguntar slot conhecido), POL-GROUND-DETAIL,
  POL-ATTR-VALUE, POL-GROUND-STOCK (claims de modelo em texto). Guardrails de dano real CONTINUAM (≤1 pergunta, CPF cedo,
  POL-GROUND-PRICE, POL-GROUND-YEAR).
- **`central-engine`**: RESPOSTA INSTITUCIONAL DETERMINÍSTICA (`buildInstitutionalResponse`) — se o lead pediu
  endereço/horário/loja e a tool resolveu, o turno NUNCA vira technical_fallback: responde com os FATOS da tool (2 tópicos
  → ambos; ok+NOT_CONFIGURED → responde ok + honesto do outro). Fallback determinístico MÍNIMO (§4 da missão): usa os
  fatos da tool, não menu, não "não consegui confirmar", não cita carro, não usa vehicle_details, não pergunta funil.
  `responseSource=deterministic_institutional`. Roda no fallback single-author ANTES do technical_fallback.
- Fix de regex: "aonde fica" (variante BR de "onde") agora casa (era `\bonde`, não pegava "aonde").
- NÃO é handler-first: LLM-first intacto; o engine só ROTEIA/VALIDA por domínio.

## Tabela POLICY × DOMÍNIO
| Policy / guard | Aplica em | NÃO aplica em | Falso-positivo que não pode bloquear |
|---|---|---|---|
| POL-GROUND-STOCK (modelo em texto) | vehicle_stock, vehicle_detail | **institutional**, sales_funnel, other | "Sobre o Onix, a loja fica na Av. X" (nomeia carro lembrado no institucional) |
| POL-GROUND-DETAIL (atributo possessivo) | vehicle_detail | **institutional**, other | "aonde fica a loja?" com carro selecionado |
| POL-ATTR-VALUE (valor de atributo) | vehicle_detail (asks_vehicle_detail) | **institutional** | pergunta de loja num turno com selectedVehicle |
| POL-QUESTION-OBJECTIVE (reperguntar slot conhecido) | sales_funnel | **institutional** | CTA leve de visita ("deixo encaminhada?") na resposta de endereço |
| POL-QUESTION-OBJECTIVE (≤1 pergunta / CPF cedo) | TODOS | — | (guardrail de dano real — sempre vale) |
| POL-GROUND-PRICE / POL-GROUND-YEAR | TODOS (dano real) | — | (ano/preço inventado sempre barrado) |
| P0-B PHOTO_NOT_REQUESTED | qualquer turno não-foto | photo | oferta interrogativa "quer que eu te envie as fotos?" (já corrigido antes) |
| requireVehicleDetailBeforeFinal (B2) | vehicle_detail (asks_vehicle_detail + palavra de atributo) | institutional, seleção pura | "aonde fica" / "gostei do segundo" |
| requiredToolBeforeFinal (stock_search) | vehicle_stock (currentTurnIntent=search, llmFirst) | institutional, funil, other | "aonde fica" (institucional, não força busca) |
| buildInstitutionalResponse (determinístico) | **institutional** (tópico resolvido) | resto | — (garante 0 technical_fallback no institucional) |

Critério atendido: nenhuma policy de veículo barra "onde fica/horário/sábado/estacionamento/Instagram/obrigado/segunda à
tarde/quero visitar/sem entrada mas quero financiar/não tenho troca/gostei dele".

## Testes offline — `run-f2-22-domain-policy-routing.ts` = **14 OK / 0 FALHA**
A institucional+veículo selecionado não trava (nomeia carro + toca slot conhecido) · B institucional+agenda (salva
diaHorario, responde endereço, ≤1 pergunta) · C endereço+horário · D endereço ok + horário ausente → determinístico
(endereço + honesto) · E "ele tem quantos km?" AINDA exige vehicle_details · F "tem Onix?" AINDA exige stock_search ·
G foto AINDA exige photo tool · H "obrigado" não bloqueia · I financiamento sem entrada não encerra.
**test:all + tsc verdes** (F2.16 5, F2.8 167, F2.17 14, F2.20 21, F2.21 35 — sem regressão).

## Conversa real (8 turnos, gpt-4.1-mini, efeitos OFF, compose=0, ~US$0,05)
- ✅ **T8 "aonde fica a loja e qual horário?"** (o ALVO): "Nossa loja fica na Avenida Charles Schnneider, 1700, ... no
  estacionamento do Taubaté Shopping. Funcionamos das 9h às 19h, de segunda a sábado." → `src=brain_final`, chamou SÓ
  tenant_business_info (0 vehicle_details/stock_search), **0 technical_fallback, responde endereço + horário**. Policy de
  veículo NÃO aplicada. ✅ T4 foto (send_media), T5 recall ("PEUGEOT 2008 2021", sem reenviar), T2 SUV list. Sem CPF cedo.
- ❌ **T3 "Gostei do segundo" degradou** (technical_fallback) — o cérebro citou atributo do carro e o SELECTION guard
  negou mesmo após vehicle_details. É a NÃO-COMPLIÂNCIA de SELEÇÃO do gpt-4.1-mini (já conhecida, não-determinística: no
  eval anterior a MESMA fala passou). Domínio vehicle_detail, NÃO institucional — fora do escopo desta missão (o dono
  vetou executor determinístico de seleção). Candidato a próxima rodada.
- ⚠️ o check "não respondeu horário" foi FALSO-POSITIVO do meu harness (a resposta respondeu; assertiva corrigida).

## Veredito
**A missão (roteamento por domínio / institucional não travado) PASSOU**: offline 14 OK + real T8 respondido sem policy
de veículo, 0 technical_fallback no institucional. Resta a degradação NÃO-DETERMINÍSTICA de SELEÇÃO (T3) — domínio
diferente, escopo diferente. **NÃO commitei** (aguarda autorização/Codex). Arquivos: `turn-domain.ts` (novo),
`policy-engine.ts`, `central-engine.ts`, `run-f2-22-domain-policy-routing.ts` (novo), `eval/run-eval-institutional.ts`
(novo), `package.json`.

## ⭐ AUDITORIA CODEX — P0 CORRIGIDO: bypass por DOMÍNIO DA AFIRMAÇÃO (não da mensagem) — 2026-07-04
Codex apontou (correto) que `isInstitutionalTurn(ctx.leadMessage)` era bypass GLOBAL por MENSAGEM: numa msg mista
("onde fica a loja e esse Onix é automático?") desligava o grounding de veículo do turno inteiro. Correção:
- **`validateResponse` gateia pelo DOMÍNIO DA RESPOSTA, não da mensagem.** POL-GROUND-DETAIL/ATTR-VALUE/GROUND-STOCK
  ficam SEMPRE LIGADOS (são claim-scoped: só disparam quando a RESPOSTA cita veículo/atributo). Novo helper
  `isInstitutionalOnlyResponse(composed)` = a resposta não tem NENHUM claim de marca/modelo.
- **Funil (reperguntar slot conhecido) abstém-se SÓ quando `instOnlyResponse && isInstitutionalTurn(lead)`** — resposta
  institucional pura numa pergunta institucional. Resposta MISTA (cita veículo) OU turno de funil normal -> trava vale
  (não mascara reask indevido). [caso L prova a regressão fechada].
- **GROUNDING DE MEMÓRIA em POL-GROUND-STOCK**: o NOME de um veículo LEMBRADO (selecionado/ofertado) é aterrado — nomear
  "o Onix" no institucional passa; INVENTAR modelo continua barrado; o ATRIBUTO dele continua exigindo vehicle_details.
- **`buildInstitutionalResponse` nunca retorna null** (audit §F): todos NOT_CONFIGURED -> resposta honesta (não fallback);
  contato (instagram/site) sem topic da tool -> honesto (§G). address ok+hours missing (e vice-versa) -> responde ambos.

### Testes offline — `run-f2-22` = **16 OK / 0 FALHA** (reescrito p/ a auditoria)
A institucional puro passa · A2 institucional NOMEANDO carro lembrado passa (memória) · B institucional+atributo inventado
("automático") BLOQUEADO + institucional respondido · C institucional+km exige vehicle_details+km real · D disponibilidade
não-aterrada BLOQUEADA · E institucional+foto -> send_media · F ambos ausentes -> honesto · G contato -> honesto · H/I
veículo/estoque puros ainda exigem tool · J "obrigado" livre · K financiamento não encerra · **L reperguntar slot conhecido
em turno NÃO-institucional CONTINUA bloqueado (bypass não vazou)**. test:all+tsc verdes.
> NOTA (gap GERAL pré-existente, NÃO do roteamento): modelo FORA do catálogo (ex.: "Corolla") não é capturado pelo
> CatalogClaimExtractor -> não é barrado. D usa um modelo do catálogo não-aterrado (Renegade). Follow-up separado.

### Conversa real 5 turnos (Codex) — 13 chamadas, US$0,033, compose=0, 0 technical_fallback
- ✅ **T4 "aonde fica a loja e quantos km ele tem?"** (MISTO): respondeu endereço via tenant_business_info **E chamou
  vehicle_details** -> "80.000 km" REAL. A policy de veículo NÃO foi desligada pela pergunta institucional (o núcleo do P0).
- ✅ **T5 "qual horário e me manda foto dele?"** (MISTO): chamou vehicle_photos_resolve + **send_media** (foto só com mídia).
- ✅ T3 "gostei do segundo" não degradou. **0 technical_fallback** em todos os 5.
- ⚠️ T5 respondeu o ENDEREÇO em vez do HORÁRIO pedido — é CONTEÚDO do cérebro (respondeu o tópico institucional errado),
  NÃO falha de policy/roteamento. Minor, candidato a ajuste de prompt.

### Veredito
O P0 do Codex (bypass por domínio da AFIRMAÇÃO, não da mensagem) está CORRIGIDO e provado (F2.22 16 OK incl. mistos +
regressão L; real T4 exigiu vehicle_details para o km, T5 exigiu send_media). **NÃO commitado — aguarda a auditoria Codex
passar** (instrução do dono). Arquivos: `policy-engine.ts`, `central-engine.ts`, `turn-domain.ts`, `run-f2-22-*`, `eval/
run-eval-institutional.ts`.

## ⭐ COMPLETUDE DO TURNO (prompt-first) — fecha o gap T5 (respondia endereço no lugar do horário) — 2026-07-04
O gap comportamental notado acima (⚠️ T5 respondeu ENDEREÇO em vez do HORÁRIO) foi corrigido — NÃO com policy pesada nem
handler, e sim **prompt-first + uma validação LEVE de completude** (LLM-first: nudge por retry, o cérebro re-autora; nunca
reescreve resposta comercial).

### 1) Prompt-first (fonte primária = prompt do portal) — `openai-agent-brain.ts` BRAIN_PROTOCOL
- Regra reescrita: **dados da empresa (horário/endereço/site/contato/faixa de preço/diferenciais/regras) estão no PROMPT**
  — fonte PRIMÁRIA; responder DIRETO do prompt. `tenant_business_info` só CONFIRMA/organiza: se vier ok, usa; se vier
  NOT_CONFIGURED MAS o dado estiver no prompt, responde com o do prompt (não diz "não tenho"). Só honesto ("confirmo com
  a equipe") quando não há nem no prompt nem na tool. Não é fonte concorrente.
- Regra nova: **RESPONDA O TÓPICO PEDIDO** — perguntou horário → responde HORÁRIO (não endereço no lugar); pediu VÁRIAS
  coisas no mesmo turno ("qual horário e me manda foto") → atende TODAS (horário no texto E foto via send_media).

### 2) Guarda de completude — `central-engine.ts` `turnCompletenessFeedback` (validação LEVE, não decide a conversa)
Roda no `authorFromBrainDraft` DEPOIS do grounding passar, ANTES do `ok:true`. Se a resposta IGNORA um pedido explícito
→ deny + feedback tipado ao MESMO cérebro (retry). NÃO reescreve, NÃO monta menu, NÃO muda de assunto.
- **Institucional** (address/hours/unit): cada tópico PEDIDO tem que aparecer na resposta — token do VALOR (ex.: "9h")
  OU sinal do tópico (paráfrase/ausência honesta). `respondsInstitutionalTopic`. Cobre exatamente o T5 (pediu horário,
  respondeu só endereço → deny → retry responde horário).
- **Foto**: pediu foto → precisa `send_media` OU ausência honesta ("não localizei as fotos"). Oferta interrogativa
  ("quer que eu te envie?") NÃO satisfaz. **CEDE quando há objetivo PENDENTE** (POL-TRACK-001 etc. têm prioridade — não
  reexige a foto que a policy acabou de barrar; corrige a regressão F2.15 [16]).
- **km/cor/câmbio/preço e estoque**: JÁ cobertos por `requireVehicleDetailBeforeFinal` + POL-ATTR-VALUE +
  `requiredToolBeforeFinal` (não duplicado aqui).
- `brainMaxSteps` 4→**6** no piloto (`pilot-active-root`) + harness de eval: folga p/ o retry num turno misto (foto +
  resolução institucional + 1 retry). Guarda só gasta passo extra quando NEGA (raro); turno típico finaliza em 1-2.

### Testes offline — `run-f2-22` = **21 OK / 0 FALHA** (16 anteriores + 5 de completude)
M horário pedido, resposta só-endereço REJEITADA + retry responde horário (feedback cita o tópico) · N horário respondido
passa sem deny (não over-fire) · O foto sem mídia/ausência-honesta REJEITADA + retry honesto · P foto com send_media passa.
**F2.15 [16] volta a passar** (18 OK — carve-out de objetivo pendente). test:all EXIT 0, tsc EXIT 0 (nenhuma regressão em
kernel/F2.7.x/F2.8-F2.21).

### Conversa real 5 turnos (`eval:institutional`, gpt-4.1-mini, compose=0, US$0,038, 14 chamadas) — **PASS, 0 violações**
- ✅ **T4 "aonde fica a loja e quantos km ele tem?"**: "Nossa loja fica na Avenida Charles Schnneider, 1700... O PEUGEOT
  2008 2021 que você gostou tem **80.000 km** rodados" → tenant_business_info + vehicle_details, endereço + km REAL.
- ✅ **T5 "qual horário e me manda foto dele?"**: "Nossa loja **funciona das 9h às 19h**. Agora vou te enviar as **fotos**
  do PEUGEOT 2008 2021" → **HORÁRIO (não endereço!) + send_media**. GAP FECHADO.
- ✅ 0 technical_fallback, 0 pergunta ignorada, sem menu robótico, prompt respeitado.

### Veredito
Gap comportamental T5 FECHADO por prompt-first + completude leve (sem policy pesada / sem handler / sem executor
comercial). Arquivos adicionais: `openai-agent-brain.ts`, `central-engine.ts` (turnCompletenessFeedback + brainMaxSteps),
`pilot-active-root.ts`, `eval/central-real-harness.ts`, `run-f2-22-*`, `eval/run-eval-institutional.ts`. **NÃO commitado —
segue aguardando a auditoria Codex** (mesma leva do roteamento por domínio, sobre `8c05f251`).
