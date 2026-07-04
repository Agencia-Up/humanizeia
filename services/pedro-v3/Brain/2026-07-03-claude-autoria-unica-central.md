# P0 — Autoria única do agente central (fim da dupla autoria) — Claude executor — 2026-07-03

> Corrige a falha de produção do `central_active`: o AgentBrain decidia "132.623 km" mas o OUTBOX enviava "0 km"
> (poll-11) e no poll-12 enviava um menu genérico. **Sem commit/push/deploy/SQL/OpenAI.** Só testes grátis.
> Pedro v2 / bridge / webhook / CRM / arquivos alheios NÃO tocados. Parar para auditoria Codex.

## Causas eliminadas
1. **`labelToFact`/`buildMemoryGroundingFacts` fabricavam km=0/ano=0/preco=-1/cor,câmbio vazios.** → agora IDENTIDADE
   apenas (marca/modelo/ano); km **undefined**, câmbio/cor **null**, preço sentinela. Nunca fabrica atributo.
   (`central-engine.ts`)
2. **`groundNamedVehicles` tratava o placeholder como fato conhecido e pulava `vehicle_details`.** → no caminho
   single-author o auto-grounding NÃO roda; o cérebro consulta (protocolo) e o render fail-closed FORÇA a consulta.
3. **`OpenAiAgentBrain` devolvia só `guidance` e `DecisionLlm.compose` virava 2º autor.** → o cérebro agora AUTORA um
   `ResponseDraft.parts` estruturado; `central_active` **nunca** chama `compose`. (`openai-agent-brain.ts` +
   `central-engine.ts`)
4. **`renderDeterministicResponse` mascarava falha, mudava o assunto e reportava terminalSafe=false.** → no
   single-author, esgotou o limite = **fallback técnico honesto** (responde à pergunta atual; nunca lista/menu/funil).
5. **Os gates checavam reason/guidance, não o que foi enviado.** → novo gate `run-f2-15` assere em
   **`outbox.payload.text`** e compara cada atributo ao `QueryResult` do MESMO vehicleKey.

## Desenho final (autoria única, atrás de `singleAuthor`, caminho legado INTOCADO)
- UM `AgentBrainPort` recebe prompt integral (SHA no frame) + bloco + transcript + WorkingMemory + observações.
- Loop limitado: `query` (fato tipado volta ao MESMO cérebro) | `final` (ResponseDraft + effects + mutations).
- **`final` renderiza+valida DENTRO do loop** (`authorFromBrainDraft`): `ResponseRenderer` materializa as parts
  (text/vehicle_ref/money_ref/vehicle_offer_list); identidade de memória só NOMEIA; km/cor/câmbio/preço só de fato
  REAL do MESMO vehicleKey (renderer **fail-closed**: `v.km == null`→throw, cor/câmbio ''/null→throw, e novo guard
  `money_ref` preço<=0→throw). Policy valida contra os **fatos REAIS** (identidade não aterra atributo/oferta).
- **Deny/fato ausente → feedback TIPADO volta ao MESMO cérebro** (RESPONSE_REJECTED) dentro do limite → o cérebro
  consulta `vehicle_details` e re-finaliza (`responseSource=brain_retry`).
- **Loop idêntico proibido** (`toolCallSignature`: mesma tool+args → observação "use o fato").
- **Esgotou → `buildTechnicalFallback`** (honesto, uma fala; nunca lista/menu/funil). `responseSource=technical_fallback`.
- **`central_active` liga `singleAuthor:true`** (`pilot-active-root.#processCentralActive`). O 2º compose (`DecisionLlm`)
  fica SÓ no caminho legado (shadow/testes de engine que scriptam guidance sem draft).
- **Observabilidade:** `responseSource` (brain_final|brain_retry|technical_fallback|legacy_compose) + `brainReason`
  (intenção do cérebro ≠ texto enviado) + `toolsExecuted` + `selectedVehicleKey` + `policyFeedback` sanitizado no
  evento `decision_final`; texto enviado no `response_composed`; `responseSource` também no result. Fallback tem
  `reasonCode="technical_fallback"` (distinguível de sucesso normal).

## Regras de memória/fatos (aplicadas)
- Memória (vehicleKey+label) só NOMEIA. km/cor/câmbio/preço/ano exigem fato REAL do MESMO vehicleKey.
- Desconhecido NUNCA vira 0/-1/vazio/cast artificial (`km:undefined`, cor/câmbio `null`, preço sentinela + guard).
- "ele/dele/desse" = selectedVehicle (protocolo do cérebro + POL-GROUND-DETAIL/ATTR-VALUE nos fatos REAIS).
- Campo ausente → defere ("vou confirmar"), nunca zero. "0 km" só se a tool retornar 0 de verdade.
- Atributo NÃO é extraído do transcript textual (o brain expressa via vehicle_ref → ancorado no fato).

## Arquivos alterados (exatos)
- `Agent/src/engine/response-renderer.ts` — guard `money_ref` (preço<=0/não-finito → fail-closed).
- `Agent/src/engine/central-engine.ts` — `labelToFact`/oferta km=undefined; `ResponseSource`; `singleAuthor` no args
  + result; helpers `authorFromBrainDraft`/`sanitizePolicyFeedback`/`buildTechnicalFallback`/`toolCallSignature`;
  loop com render+validate+retry+dup-guard; ramo single-author×legacy; observabilidade em `decision_final`.
- `Agent/src/adapters/llm/openai-agent-brain.ts` — `BRAIN_PROTOCOL` (draft.parts estruturado; atributo só via ref);
  `#decodeDraft`/`#decodeMoneyPart`; `responsePlan.draft` no `#decodeFinal` (guidance mantido p/ compat).
- `Agent/src/engine/pilot-active-root.ts` — `#processCentralActive` passa `singleAuthor:true`.
- `Agent/tests/run-f2-15-central-authorship.ts` — NOVO gate offline (14 itens, sem OpenAI).
- `Agent/package.json` — `test:f215` + no `test:all`.

## Gates (grátis, sem OpenAI)
- `npx tsc --noEmit` **EXIT 0**.
- `npm run test:all` **EXIT 0 / 0 FALHA** — inclui F2.14 (OpenAiAgentBrain 13 OK, decode do draft não quebrou),
  F2.13 (46), R13-D/2 (10), R13-D/5 (7), F2.8 (166, prova "vehicle_ref(km) ausente falha fechado"), e o novo
  **F2.15 AUTORIA ÚNICA 15 OK**.

### Prova de ZERO 2º compose
`run-f2-15` injeta um `ComposeSpyLlm` cujo `compose()` incrementa contador (e marca o texto). Em TODOS os turnos
single-author `composeCalls === 0` (checks [1][2][3][4][5][5b][7][8][12] asseram isso). `proposeNextQueryOrFinal`
explode se chamado (nunca é).

### Transcrição dos novos testes (tool → vehicleKey → fato → outbox final)
- **[1] "ele tem quantos km?"** → query `vehicle_details(revendamais:8022153)` → fato km=132623 →
  outbox: `"Esse Onix tem 132.623 km rodados. Quer agendar uma visita pra ver de perto?"` (compose=0).
- **[2] "E a cor dele?"** → `vehicle_details(revendamais:8022153)` → cor="Branco" → outbox contém **Branco**, não Prata.
- **[3]** câmbio→**Manual**, ano→**2014**, preço→`money_ref`→**R$ 42.990** (cada um do fato do mesmo key).
- **[4] "qual a cor dele?"** (carro cor=null) → 1º draft `vehicle_ref{cor}` → render **falha fechada** → feedback →
  2º final defere → outbox: `"Deixa eu confirmar a cor certinho e já te falo."` (sem cor/0 inventado).
- **[5] km factual 0** → tool retorna km=0 → outbox contém **"0 km"** (legítimo). **[5b]** sem fetch → falha fechada
  → fallback: NÃO contém "0 km" nem "132.623".
- **[7]** 1º final sem fetch (falha) → **query corretiva** `vehicle_details` → 2º final → **132.623 km**;
  `responseSource=brain_retry`.
- **[8]** cérebro nunca consulta (4 finals falham) → esgota → **technical_fallback**, sem menu comercial.
- **[12] "bom dia!"** → 0 tool calls, resposta simples. **[13]** frame do único brain traz o SHA do prompt integral.
  **[14]** draft com 2 "?" → engine trima p/ 1.

## Riscos restantes reais
- **Não testado com OpenAI real** (quota/custo). O gate offline usa `ScriptedAgentBrain`; a QUALIDADE das decisões do
  cérebro REAL (escolher consultar, montar as parts certas) só será validada no WhatsApp pelo dono após deploy
  auditado. O `BRAIN_PROTOCOL` foi reescrito p/ draft.parts — a LLM pode errar o shape; a rede de proteção
  (fail-closed → retry → fallback) impede envio errado, mas turnos podem cair em fallback se a LLM não cooperar.
- **Legacy compose ainda existe** (shadow/testes). Se alguém rodar shadow com o brain real (que agora emite draft mas
  cai no compose por `singleAuthor` ausente), o texto pode divergir do active. Shadow está OFF; follow-up: ligar
  `singleAuthor` no shadow p/ espelhar. NÃO feito aqui (fora do escopo P0).
- **km=0 do FEED** (usados com km não informado no feed) ainda renderiza "0 km" na oferta — é "zero factual da tool"
  pela letra da regra, mas é enganoso. Fora do escopo desta rodada (é qualidade de dado do feed, não fabricação).
- `central_active` **NÃO ativado** (flag `PEDRO_V3_BRAIN_MODE=off`); nada em produção mudou.

**Parado para auditoria Codex. Sem commit/push/deploy/SQL.**

---

## CORREÇÕES DA AUDITORIA CODEX (deploy REJEITADO) — 2026-07-03 (2ª rodada)

O Codex reprovou o deploy da F2.15 com 7 bloqueadores. TODOS corrigidos, só testes grátis (sem OpenAI/SQL/commit).

1. **Fallback = degradação observável.** `technical_fallback` agora dá `terminalSafe=true` + `degraded=true` (no result
   e nos eventos `decision_final`/`response_composed`); o texto NÃO promete retorno ("Me desculpe, não consegui
   confirmar essa informação com segurança agora. Consegue reformular pra eu te ajudar melhor?"). O gate FALHA se um
   cenário-alvo cair em fallback (F2.15 [15] exige degraded=true; [1..3] exigem NÃO-degradado). Novo `ResponseSource`
   `deterministic_recall` (recall de foto é resposta ATERRADA, não degradação).
2. **vehicle_details obrigatório.** `requireVehicleDetailBeforeFinal`: `asks_vehicle_detail` + selecionado ->
   EXIGE `vehicle_details` bem-sucedido do MESMO vehicleKey antes de QUALQUER final (senão força a consulta; esgotou
   -> degradado). Detalhe de OUTRO key não conta. Sem selecionado -> null (o cérebro pede esclarecimento; nunca
   consulta arbitrário). F2.15 [15] (sem fetch -> degradado) + [1][4] (com fetch -> responde).
3. **postQuery deny nunca envia o draft.** `authorFromBrainDraft` checa `hasDeny(postQuery)` ANTES de renderizar ->
   feedback ao MESMO cérebro; esgotou -> fallback degradado; nenhum efeito comercial original sobrevive (só a fala
   honesta). F2.15 [16] (POL-TRACK-001: send_photos em resposta de pagamento -> deny -> re-autora sem send_media).
4. **Decoder integral + money estrito.** `#decodeDraft`: QUALQUER part inválida invalida o DRAFT INTEIRO (nunca
   descarta parcial). `#decodeMoneyPart`: role/source validados SEM `as never` e SEM corrigir a saída do modelo
   (source divergente -> null). F2.14 [9] decode válido, [10] rejeição integral, [11] money estrito, [12]
   query->observação->final. F2.14 agora cobre `responsePlan.draft` de verdade (17 OK).
5. **Sem VehicleFact artificial.** Removidos `labelToFact`/`buildMemoryGroundingFacts` (fabricavam ano=0/preco=-1).
   Novo tipo `RememberedVehicleIdentity` (marca/modelo/ano|null) — só NOMEIA no renderer; km/cor/câmbio/preço só de
   fato REAL do MESMO vehicleKey (renderer `renderVehicleRef` recebe `identities` e falha fechado sem o fato).
   F2.15 [17] (identidade sem ano/preço nunca vira 0/-1).
6. **Shadow roda `singleAuthor=true`** (espelha exatamente o ativo). SHADOW [4] (renderiza o draft, ZERO compose).
7. **Gates:** `npx tsc --noEmit` EXIT 0; `npm run test:all` EXIT 0 (0 RED) — F2.14 17, F2.15 18, SHADOW 11, F2.13 46,
   GATE OFFLINE 7, F2.8 166, e todo o legado (removidos os fake facts SEM regressão: `groundNamedVehicles` passou a
   receber `identities` no `known` p/ preservar "recall sem tool" no legado).

**Arquivos alterados (2ª rodada):** `domain/types.ts` (RememberedVehicleIdentity), `response-renderer.ts` (identities +
km/cor/câmbio só de fato real), `central-engine.ts` (parseLabel/buildRememberedIdentities, requireVehicleDetailBeforeFinal,
postQuery-deny em authorFromBrainDraft, fallback degradado + deterministic_recall, degraded no result/evento,
groundNamedVehicles com identities), `decision-engine.ts` (composeAndVerify aceita identities), `openai-agent-brain.ts`
(#decodeDraft integral + #decodeMoneyPart estrito), `central-shadow-runner.ts` (singleAuthor:true). Testes:
`run-f2-14` (+4), `run-f2-15` (+3 e [7] corrigido p/ B2), `run-central-shadow-isolation` (+1 e draft no finalGreeting).

**Parado para NOVA auditoria Codex. Sem commit/push/deploy/SQL.**

---

## SMOKE CONVERSACIONAL REAL (audit 3ª rodada) — 2026-07-04 — NÃO PASSOU (3 violações; NÃO re-rodado)

Codex aprovou estruturalmente as 7 correções e pediu UM smoke real econômico. Rodado UMA vez (`eval/run-smoke-audit.ts`,
`smoke:audit`): gpt-4.1-mini REAL, prompt/estoque/config REAIS, engine+WM REAIS, EffectGate OFF, singleAuthor=true, sem
judge. **29 chamadas OpenAI (BRAIN 29, 2xx=29; COMPOSE 0), prompt integral SHA=true, efeitos OFF (0 dispatcher),
11/11 turnos. tokens prompt≈128.190 completion≈4.602 (~US$0,06).**

**PASSOU (9/11 turnos):** T1 saudação; T2 sem selecionado → pede qual carro, ZERO vehicle_details arbitrário; T3
stock_search {tipo:suv, cambio:automatic, precoMax:90000}; T4 seleciona o 2º ofertado (Peugeot 2008 2021,
revendamais:7906712); T5 vehicle_details do MESMO key + km/cor REAIS (80.000 km / BRANCO); T6 resolve fotos do
selecionado + send_media SEM despacho; T7 deterministic_recall nomeia "Peugeot 2008 2021" sem tool/mídia; T10
nome=Douglas + possuiTroca=false; T11 reconhece visita+sábado. **compose=0, terminal_safe=0 fora do T8.**

**FALHOU (2 assertivas) — diagnóstico por causa-raiz (NÃO re-rodado, SEM remendo por frase, NÃO aprovado):**
- **T8 (real): degradado.** O harness do smoke usava `RuntimeConfigBusinessInfoSource` (retorna SEMPRE address/hours=null)
  em vez do `PromptTenantBusinessInfoSource` da PRODUÇÃO (pilot-active-root, extrai do prompt). → `tenant_business_info`
  devolveu NOT_CONFIGURED. Aí o cérebro (gpt-4.1-mini) **fixou re-consultando `tenant_business_info{address}` 4×**
  (dup-guarded 2-4) sem nunca consultar `hours` nem finalizar → esgotou brainMaxSteps → **fallback DEGRADADO**. O
  engine agiu CERTO (não inventou endereço; degradação observável); mas: (a) **fidelidade do harness** — fonte de
  business info != produção (CORRIGIDO no smoke p/ PromptTenantBusinessInfoSource; NÃO re-rodado); (b) **aderência do
  cérebro** — em NOT_CONFIGURED o protocolo manda deferir honesto ("vou confirmar"), mas a LLM entrou em loop de
  re-consulta. Item aberto p/ Codex: com a fonte de produção + prompt COM rótulos "Endereço:/Horário:", o tool
  retornaria dado e o cérebro responderia; se o prompt NÃO tiver os rótulos, o loop-em-NOT_CONFIGURED persiste
  (o fallback degradado contém, mas não responde). NÃO é remendo por frase; é comportamento da LLM a decidir.
- **T9 (falso-positivo da assertiva, não do agente):** o agente EXCLUIU os 9 ofertados (`excludeKeys` corretos) e disse
  honestamente "não temos mais além das que já mostrei" — NÃO repetiu lista. Minha assertiva leu `lastRenderedOfferContext`
  OBSOLETO (do T3, não limpo quando 0 novos) e marcou "repetiu". CORRIGIDO (usa `offerFresh`=oferta renderada NESTE
  turno; NÃO re-rodado).

**Correções aplicadas ao smoke (fidelidade + medição), tsc verde, NÃO re-rodado:** `run-smoke-audit.ts`
(PromptTenantBusinessInfoSource; assertiva T9 por offerFresh). **NÃO declarei aprovação.** Observações menores: T5
"80.000 km km" (o cérebro pôs "km" em text ANTES do vehicle_ref{km} → duplicou; cosmético, km correto); T4/T5 pedem
nome 2× (funil repetido leve). **Parado para auditoria Codex decidir o item aberto (aderência LLM em NOT_CONFIGURED)
e autorizar (ou não) um novo smoke.**

---

## SMOKE #2 (institucional generalizado) — 2026-07-04 — NÃO PASSOU (7 violações; NÃO re-rodado)

Codex aprovou estruturalmente + pediu 1 correção institucional + re-rodar o MESMO smoke 1×. FEITO o fix institucional
(detecção geral de tópicos address/hours/unit + resolução TERMINAL por tópico via `resolveInstitutional`, cache 1x/tópico,
NOT_CONFIGURED terminal sem loop/fallback; protocolo do brain reforçado; `institutionalResolved` observável; F2.16 5 OK;
T8 endurecida). test:all+tsc verdes ANTES. Re-rodado 1×: **23 chamadas (BRAIN 23 2xx / COMPOSE 0), prompt integral
SHA=true, efeitos OFF, 11/11 turnos, ~US$0,05.**

⭐**T8 MELHOROU DE VERDADE:** "Sobre o endereço… essa informação não está disponível. Já o horário… das 9h às 19h, de
segunda a sábado." → honesto sobre endereço ausente + deu o horário, `brainCalls=2`, SEM loop/degradado/fallback. O laço
de 4× do smoke #1 morreu.

**7 violações — causa-raiz (categorizado):**
- **2 BUGS DE ENGINE:** (1) `extractTenantBusinessFacts` (hours) casou "horário" numa REGRA DE SAUDAÇÃO do prompt ("Se o
  horário for entre 00h e 11h59 → Bom dia!") e devolveu isso como valor (`tenant_business_info(hours)` ok:true GARBAGE); o
  cérebro ignorou e deu o horário REAL do prompt, mas a FONTE institucional está bugada (regex de hours permissivo demais)
  — afeta produção. (2) **Label do veículo lembrado = CHAVE CRUA quando a oferta não é renderizada**: T3 (LLM) perguntou
  "quer ver a lista?" em vez de listar → sem offer context → `select_vehicle_focus` do cérebro com label=chave →
  `resolveVehicleLabel` caiu em selected.label=chave → `lastPhotoAction.label`="revendamais:8065690" → **T7 recall enviou
  a CHAVE CRUA**. (removi groundNamedVehicles do single-author; sem aterrar o NOME do veículo fotografado, o label vira a
  chave.)
- **3 VARIAÇÃO DA LLM (single-author = a LLM conduz; gpt-4.1-mini decidiu diferente do #1):** T3 não renderizou a lista;
  T9 sem `excludeKeys` (excluiu só no texto); T11 não registrou visita/sábado (sem extração determinística de visita).
- **2 BUGS DA ASSERTIVA (medição):** T8 "endereço sem declaração honesta" (regex `honestAbout` com janela 40 chars, curta)
  e T8 "horário não está na resposta" (usei o `promptFacts.hours` BUGADO; a resposta deu "9h às 19h" certo). Ambos
  FALSO-POSITIVO — o agente acertou o T8.

**ACHADO CENTRAL p/ Codex:** o GROUNDING do single-author é sólido (T5 km/cor reais, T8 honesto, zero fato inventado,
compose=0), mas a CONDUÇÃO (renderizar lista, excludeKeys, reconhecer visita) é **LLM-dependente e variou entre runs**.
Decisão de arquitetura pendente: tornar essas conduções DETERMINÍSTICAS (executores) ou aceitar a variância; + corrigir
os 2 bugs de engine (regex de hours; aterrar nome do veículo fotografado). **NÃO re-rodei o smoke, NÃO apliquei fix
(diagnóstico+parar), NÃO declarei aprovação.** Gates pré-smoke: tsc EXIT 0; test:all EXIT 0 (F2.16 5, F2.15 18, F2.14 17,
SHADOW 11, GATE OFFLINE 7, F2.13 46). **Parado para Codex.**

---

## 5 CAUSAS do smoke #2 corrigidas POR INVARIANTES (audit Codex) — 2026-07-04 — SEM OpenAI

Autoria única preservada (o brain decide/redige; o engine VALIDA/ENRIQUECE, nunca substitui por handler comercial):
- **P0-1** `extractTenantBusinessFacts` (tenant-business-info.ts): `findLabeled` exige rótulo com separador (`:`/`-`) e
  ITERA candidatos; pula linhas de REGRA/saudação ("Se o horário for..."/→); remove markdown. Regra de saudação com
  "horário" nunca vira horário comercial. Fixture (saudação + Bloco 9) provada no replay (endereço+horário exatos).
- **P0-2** (central-engine.ts): `canonicalVehicleLabel` = nome REAL (marca modelo ano) ou **null**, NUNCA a key;
  `canonicalizeSelectMutations` aterra o label de toda `select_vehicle_focus` (jamais label==key);
  `pendingPhotoAction` só persiste com nome humano; **guard** em `authorFromBrainDraft`: `knownVehicleKeys` — se o texto
  contém QUALQUER key conhecida -> deny + feedback. Cascata: busca-sem-lista→detalhe→seleção→foto→recall = "Honda CRV 2010".
- **P0-3** (authorFromBrainDraft): stock_search com itens + draft SEM `vehicle_offer_list` (e sem send_media) -> deny +
  feedback ("mostre a lista, não pergunte"). Sem itens -> resposta livre. A LLM segue autora da intro/CTA.
- **P0-4** (loop kernel): `mentionsMoreOptions` + stock_search -> o engine enriquece `input.excludeKeys` com a união das
  keys da última oferta na chamada EXECUTADA (preserva tipo/câmbio/teto). Não depende da LLM lembrar.
- **P0-5** (lead-extraction.ts): `VISIT_INTENT_RX` (stem "visit"/agend/conhecer presencialmente/ir na loja) +
  `extractDayPeriod`; interesseVisita=true + diaHorario no MESMO turno SEM objetivo pendente; negativos barrados.

**Testes:** `run-f2-17-smoke-replay.ts` (NOVO, offline, singleAuthor, brain scriptado reproduz os erros do smoke #2 e os
invariantes corrigem) 14 OK; `run-f2-16` (institucional) 5 OK. **tsc EXIT 0; test:all EXIT 0** (F2.17 14, F2.16 5, F2.15
18, F2.14 17, SHADOW 11, GATE OFFLINE 7, F2.13 46; legado sem regressão). Observabilidade: `institutionalResolved` +
`policyFeedback` no result/evento. **Arquivos:** `tenant-business-info.ts`, `central-engine.ts`, `lead-extraction.ts`,
`run-f2-17-smoke-replay.ts` (+`package.json`). **NÃO rodei OpenAI. Sem commit/push/deploy/SQL. Parado para auditoria Codex.**

---

## 6a rodada — DOIS HARDENINGS GRATUITOS da auditoria (H1 seleção canônica + H2 visita 3 estados) — 2026-07-04
Codex aprovou as correções principais (5 causas por invariantes) e encomendou apenas dois hardenings, sem OpenAI/commit.

### H1 — Seleção de veículo ESTRITAMENTE canônica
Antes, `canonicalizeSelectMutations` tinha um FALLBACK que aceitava o `label` proposto pela LLM quando não achava nome
grounded (`... ?? (m.vehicle.label && m.vehicle.label !== key ? m.vehicle.label : "")`). Risco: a LLM podia "batizar" a
seleção (ex.: label "Ferrari Roma" num key de outro carro) ou vazar a chave.
- **`central-engine.ts`**: a função agora **DESCARTA** a `select_vehicle_focus` quando não há label canônico —
  `canonicalVehicleLabel` (que só lê VehicleFact / RememberedVehicleIdentity / lastRenderedOfferContext / selected prévio)
  é a ÚNICA fonte. NUNCA usa `m.vehicle.label`. Retorna `{ mutations, droppedKeys }`; os keys descartados vão para
  observabilidade (`droppedSelectKeys` no evento `decision_final` e no result). Exportada p/ teste.
- **`state-reducer.ts`** (defesa 2ª): o caso `select_vehicle_focus` **rejeita** label vazio (`""`/só espaços) OU
  `label === vehicle.key`. Nenhuma seleção não-canônica entra no estado, venha de onde vier.

### H2 — Visita em TRÊS estados (`lead-extraction.ts`)
Antes, `VISIT_NEGATION_RX` juntava recusa real com adiamento ("talvez"/"mais tarde"/"agora não"/"depois eu") e gravava
`interesseVisita=false` para todos — mentira sobre a intenção do lead.
- **Recusa** (`VISIT_REFUSAL_RX`, negação ligada ao ato de visitar: "não quero visitar", "não vou passar na loja",
  "não quero presencial") -> `interesseVisita=false`.
- **Intenção** (VISIT_INTENT_RX presente, não-recusa, não seleção/mídia) -> `interesseVisita=true` (+`diaHorario` se houver
  dia/hora concreto). "quero visitar sábado" -> true + sábado.
- **Adiamento/incerteza** (`VISIT_POSTPONE_RX`: "talvez", "agora não", "mais tarde", "depois", "outro dia", "não sei",
  "quem sabe") — quando NÃO há intenção positiva nem recusa -> **NÃO grava** interesseVisita (nem false nem true).
- **"quero visitar mais tarde"** -> `interesseVisita=true` E **sem** diaHorario: `extractDayPeriod` limpa
  "mais tarde"/"mais cedo" (período vago, não horário concreto) antes de extrair.
- Não quebra "quero fotos" (mídia) nem "quero o terceiro" (seleção ordinal) — ambos seguem sem virar visita.

**Testes:** `run-f2-18-canonical-select-visit.ts` (NOVO, offline, $0) — **20 OK / 0 RED**: H1 adversarial ("Ferrari Roma"
não persiste; key sem fonte canônica descartado; label==key canonicaliza pelo fato; identidade lembrada nomeia; seleção
normal do 2º = "Honda CRV 2010"; reducer rejeita vazio/==key e aceita canônico) + H2 (recusa/intenção/3 adiamentos/"mais
tarde"=true-sem-dia/fotos/terceiro). **test:f217 14 OK; tsc EXIT 0; test:all EXIT 0** (F2.18 20, F2.17 14, F2.16 5, F2.15
18, F2.14 17, SHADOW 11, GATE OFFLINE 7, F2.13 46, F2.8 166; legado sem regressão). **Arquivos:** `central-engine.ts`,
`state-reducer.ts`, `lead-extraction.ts`, `run-f2-18-canonical-select-visit.ts` (+`package.json`). **NÃO rodei OpenAI. Sem
commit/push/deploy/SQL. Parado para auditoria Codex.**
