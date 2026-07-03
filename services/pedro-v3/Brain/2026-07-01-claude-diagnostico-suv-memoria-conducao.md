# Diagnóstico — "não tenho SUV" logo após listar SUVs + condução fraca (Avant/Icom, piloto v3)

> **Tipo:** Handoff de DIAGNÓSTICO (read-only). Nenhum código alterado ainda.
> **Autor:** Claude (executor, sem Codex no momento) · **Data:** 2026-07-01
> **Para o Codex auditar quando voltar:** confirmar que os fixes propostos (§6) são MECANISMOS GERAIS aterrados (não `if` por frase/modelo) e que não regridem os testes offline.
> **Regra viva:** sem `if` por frase específica; solução aterrada no domínio/dados; provar OFFLINE; contrato de state/tabela = parar e pedir auditoria.

---

## 1. O caso real (piloto tenant `ecb26258`, conversa das 13:24–13:27 UTC / 10:24–10:27 BRT)

Reconstruído read-only de `v3_inbox` / `v3_decisions` / `v3_effect_outbox` / `v3_conversation_state`.

| # | turn_id | Lead disse | reason_code | Agente respondeu |
|---|---|---|---|---|
| 1 | poll-1 | "Bom dia" | `initial_greeting_and_connection` | Saudação + "conhece a loja?" (OK) |
| 2 | poll-2 | "Conheço sim" + "Vocês tem SUV?" (2 msgs, **debounce mesclou OK**) | `explicit_offer` (conf 1.0) | Lista **cheapest-5**: 1.**C3 2015 (hatch!)** 2.CRV 3.2008 4.Tiggo2 5.Renegade + "Qual é seu nome?" |
| 3 | poll-3 | "Douglas" | **`error` — `MODEL_DECISION_INVALID:confidence`** | "Qual modelo ou tipo de carro você procura?" |
| 4 | poll-4 | "Queria um SUV até 70k" | **`explicit_not_found`** (conf 1.0) | "No momento não tenho SUV no nosso estoque. Tem algum carro para dar de troca?" |

**Fatos do `v3_conversation_state` (pós-conversa):**
- `slots` **funcionam**: `nome=Douglas` (known), `tipoVeiculo=suv`, `interesse=suv`, `faixaPreco.max=70000`, `conheceLoja=true`. → **NÃO é amnésia de armazenamento.**
- `lastRenderedOfferContext` = os 5 carros (com marca/modelo/ano, **sem `tipo`**).
- `offers.last=null`, `offers.presentedKeys=[]`, `vehicleContext.focus=null` → **memória de oferta VAZIA** (gated em receipt `delivered` que não chega em prod — "Issue C").
- `stage="greeting"` após 4 turnos (funil não avança).
- `error` (coluna) = 0; nenhum terminal-safe "hard".

> **A hipótese do dono (memória / esperar o bloco de mensagens) não é a causa raiz.** O debounce funcionou (turno 2 mesclou 2 msgs). Os slots guardam tudo. A dor real são 5 defeitos abaixo.

---

## 2. CAUSA-RAIZ #1 (headline) — Tipo de veículo decidido por LISTA ESTÁTICA, não pelos dados; e `unknown` vira mentira confiante

**Fluxo:** `stock_search({tipo})` → `stock-source.ts:49-56` filtra por `classifyVehicleType(...)`.

`classifyVehicleType` (`stock-normalizer.ts:17-51`) resolve o tipo por, nesta ordem:
1. `resolveVehicleTypeFromTaxonomy(brand,model)` — **lista hardcoded** `VEHICLE_TAXONOMY` (planilha `carros_brasil_categorias.xlsx`), 140 entradas.
2. `bodyType` contém "suv/sedan/hatch/pickup".
3. `category` idem.
4. senão → **`unknown` (confidence 0)**.

**Para RevendaMais (feed da Avant):** o decode (`stock-normalizer.ts:193-194`) lê `category` (= genérico `"AUTOMOVEL"`) e `bodyType` (campos `body_type`/`subCategoryName`, **que o feed RevendaMais NÃO envia** → `null`). Logo, **o tipo depende 100% da taxonomia hardcoded**.

**A taxonomia é incompleta.** Conferido contra os carros do print:
| Carro do print | Na taxonomia? | Classifica como |
|---|---|---|
| Citroën **C3** | sim (`:11` hatch) | hatch ✅ (correto) |
| Honda **CRV** | **NÃO** (só HR-V `:107`, WR-V `:108`) | **unknown** ❌ (é SUV) |
| Peugeot **2008** | sim (`:126` suv) | suv ✅ |
| CAOA Chery **Tiggo 2** | **NÃO** (só Tiggo 5x/7/8 `:91-93`) | **unknown** ❌ (é SUV) |
| Jeep **Renegade** | sim (`:116` suv) | suv ✅ |

**O golpe fatal:** `stock-source.ts:53` — `if (classified.value === "unknown") return false;`. Ou seja, **"não sei o tipo" é tratado como "não é SUV"** e o carro é descartado silenciosamente. Somado a `explicit_not_found` (`explicit-search.ts:173-175`), isso vira uma **mentira confiante**: "No momento não tenho SUV" logo após ter listado SUVs.

**Por que é o cheiro do v2 em v3:** um FATO do veículo (o tipo) está sendo decidido por uma **lista de modelos hardcoded** em vez de vir do **dado/fonte**. Toda vez que a loja tiver um modelo fora da planilha (CRV, Tiggo 2, lançamento novo…), o agente fica cego. É o mesmo padrão da regex de marcas que o Codex já mandou tornar dinâmica.

---

## 3. CAUSA-RAIZ #2 — `taxonomyModelInputsForType` é um remendo sobre o mesmo furo

`explicit-search.ts:93-97,114-123`: quando `stock_search({tipo:"suv"})` volta vazio, o handler expande com `taxonomyModelInputsForType("suv")` = buscar por CADA `modelo` de SUV **da mesma taxonomia** (`Renegade`, `2008`, `HR-V`, `Tracker`…). Como herda a mesma lista, **também nunca acha CRV nem Tiggo 2**. É band-aid sobre a causa #1, não solução.

> **Item em aberto (confirmar OFFLINE):** o turno 2 exibiu um **C3 hatch** no topo de uma lista "SUV" (cheapest-5 amplo). Isso é *incompatível* com o Branch C aplicando `{tipo:"suv"}` (que devolveria só SUVs conhecidos). Os `v3_turn_events.decision_final` estão `__redacted`, então **não dá para provar por leitura estática qual busca exata rodou no turno 2**. Reproduzir com o harness offline (frames reais "Vocês tem SUV?" e "Queria um SUV até 70k") antes de afirmar o caminho. NÃO inventar a explicação.

---

## 4. CAUSA-RAIZ #3 — `explicit-search` NÃO persiste o interesse nos slots → condutor reperguntou

Turno 2 ("Vocês tem SUV?") detectou `explicitTypes=["suv"]` e ofertou, **mas `buildExplicitSearchTurnOutput` (`explicit-search.ts:172-183`) não grava `tipoVeiculo`/`interesse`/`faixaPreco` nos slots** (`decisionMutations` vazio). Por isso, no turno 3 o `sdr-conductor` achou `interesse` ainda `unknown` e disparou a pergunta padrão `DEFAULT_QUESTIONS.interesse` = **"Qual modelo ou tipo de carro você procura?"** (`sdr-conductor.ts:30`) — repergunta o que o lead JÁ disse. (Foi essa a origem real da fala do turno 3, **não** o `buildContextualSdrReply`.)

---

## 5. CAUSA-RAIZ #4 — Decisão do LLM inválida (`confidence`) derruba o turno inteiro; fallback ignora contexto

- `prompt-bound-conversation.ts:259-261`: a decisão do LLM exige `confidence` **número finito em [0,1]**; senão lança `MODEL_DECISION_INVALID:confidence`.
- `decision-engine.ts`: o erro do passo `propose` **não é retry-ado** → cai em `emitErrorTerminalSafe` (`finalizer.ts:344-363`, `reasonCode:"error"`, confidence 0.5) e a resposta veio do condutor (pergunta de slot), **cega ao contexto** (ignorou `nome=Douglas`, ignorou que já mostrou lista, ignorou SUV).
- `continuity-fallback.ts:46-55` (`buildContextualSdrReply`) só olha `recentAgentOffered` + `slots.interesse` — **ignora `nome`, `tipoVeiculo`, `faixaPreco`, `currentObjective`, `lastRenderedOfferContext`, `stage`**.

Uma única `confidence` malformada do modelo **descarta o turno inteiro**. Robustez ruim.

---

## 6. CAUSA-RAIZ #5 — Memória de oferta gated em `delivered` (Issue C)

`offers.last` / `offers.presentedKeys` / `vehicleContext.focus` só são populados num receipt `delivered` que **não chega em prod** (provider capability), enquanto `lastRenderedOfferContext` é populado no aceite. Resultado: **split-brain** — o agente "renderizou" 5 carros mas acha que não ofertou nada. Degrada condução (referência a "os que te mostrei", foco, foto por "o primeiro"). Arquivos: `conversation-engine.ts`, `state-reducer.ts`, `effect-outcome-commit.ts`, `provider-delivery-receipt.ts`.

---

## 7. Plano de correção (MECANISMOS GERAIS, não `if`) — ordenado por impacto

> Cada fix: (a) mecanismo geral aterrado, (b) invariante, (c) teste OFFLINE novo, (d) checagem de regressão p/ Codex. Implementar **um por vez**, com `test:all` + `tsc` verdes entre eles.

**FIX A — `unknown` nunca vira "não tenho" (fim da mentira confiante).** [headline]
- Mudança de regra em `stock-source.ts:49-56` + `explicit-search`: um filtro de `tipo` deve separar "é OUTRO tipo conhecido" (exclui) de "tipo desconhecido" (NÃO exclui com confiança). Opção aterrada: no filtro por tipo, retornar os *matches conhecidos*; se resultarem poucos/zero E existirem veículos `unknown`, **não** emitir `explicit_not_found` — ofertar candidatos (amplo) sendo honesto ("deixa eu confirmar o tipo") em vez de negar.
- Invariante: **o agente nunca nega uma categoria de estoque enquanto houver veículos de tipo indeterminado no feed.** Geral (qualquer tipo/qualquer modelo).
- Teste: `run-f2-7-15-type-grounding.ts` — feed com CRV/Tiggo2 `unknown` + Renegade/2008 suv; `stock_search({tipo:"suv"})` não pode devolver 0 e virar `explicit_not_found`.

**FIX B — Tipo aterrado em sinal mais forte que a lista estática.**
- RevendaMais não manda body type ⇒ (1) tornar o match da taxonomia robusto por FAMÍLIA (`CRV`↔`CR-V`, `Tiggo 2`→família Tiggo) e ampliar cobertura; (2) manter taxonomia como FALLBACK, não como gate único; (3) registrar `provenance`/confidence do tipo para o filtro decidir.
- Invariante: classificação por família não pode ter buraco por hífen/variação ortográfica; lista é fallback, não fonte única.
- Teste: casos CRV, CR-V, Tiggo 2, HR-V no `run-f2-7-15`.

**FIX C — `explicit-search` grava o interesse nos slots.**
- `buildExplicitSearchTurnOutput` emite `decisionMutations` para `tipoVeiculo`/`interesse`/`faixaPreco` quando o frame os traz. Assim o condutor não repergunta.
- ⚠️ **toca escrita de slots** — checar com o padrão de mutations existente; se mudar contrato, PARAR e sinalizar.
- Teste: após "Vocês tem SUV?", `slots.tipoVeiculo="suv"` (known); próximo turno não dispara `DEFAULT_QUESTIONS.interesse`.

**FIX D — `confidence` malformada não derruba o turno + fallback com contexto.**
- `prompt-bound-conversation.ts`: se só `confidence` for inválida mas o resto da decisão for válido, **clampar/coagir** (ou 1 retry dirigido) em vez de descartar o turno.
- `continuity-fallback.ts`: usar `nome`, `tipoVeiculo`, `faixaPreco`, `lastRenderedOfferContext`, `currentObjective`.
- Invariante: uma decisão do modelo só é descartada se for irrecuperável; o fallback nunca ignora slots `known`.
- Teste: `run-f2-7-16-propose-resilience.ts` — decisão com `confidence` fora de [0,1] mas ação/plano válidos → turno não vira `error`; fallback cita o nome.

**FIX E — Memória de oferta não gated em `delivered` (Issue C).**
- Popular `offers.last`/`presentedKeys`/`vehicleContext.focus` no **mesmo aceite** que popula `lastRenderedOfferContext`.
- ⚠️ **contrato de state / fluxo de receipt** — PARAR e pedir auditoria do Codex antes de mexer; é o mais arriscado.
- Teste: após oferta aceita (sem `delivered`), `offers.presentedKeys` = as 5 chaves.

**Ordem recomendada:** A → C → B → D → E (A resolve a mentira; C devolve condução; B melhora precisão; D robustez; E por último, é o que mexe em contrato).

---

## 8. O que NÃO será tocado
Pedro v2 / bridge / webhook; CRM/handoff/briefing; nada de segredo; nada de SQL de escrita sem aprovação. Fixes C e E tocam contrato/fluxo → sinalizados para auditoria antes.

---

## 9. Checklist de regressão para o Codex
1. Nenhum fix adiciona `if` por frase/modelo específico (grep por nomes de carro hardcoded no diff).
2. `stock_search({tipo})` nunca produz `explicit_not_found` havendo veículos `unknown` no feed (FIX A).
3. Classificação por família cobre CRV/CR-V/Tiggo 2 e não quebra os tipos já corretos (C3 hatch, 2008 suv) (FIX B).
4. `explicit-search` grava slots sem quebrar o contrato de `decisionMutations` (FIX C).
5. `confidence` inválida não vira `error` quando o resto é válido; fallback cita slots known (FIX D).
6. `offers.presentedKeys` popula sem `delivered` e não duplica com `lastRenderedOfferContext` (FIX E).
7. `test:all` + `tsc --noEmit` verdes; itens em aberto (§3, turno 2) confirmados por replay offline.

---

## 10. Evidência (SQL read-only usado)
`v3_inbox`/`v3_decisions`/`v3_effect_outbox` (turnos), `v3_conversation_state` (slots/offers/lastRenderedOfferContext), `information_schema` (colunas). Código: `explicit-search.ts`, `stock-normalizer.ts`, `stock-source.ts`, `vehicle-taxonomy.ts`, `sdr-conductor.ts`, `continuity-fallback.ts`, `prompt-bound-conversation.ts`, `finalizer.ts` (paths/linhas nas seções acima).

---

## 11. FIX A + C — APLICADOS (2026-07-01) ✅ *(aguarda auditoria do Codex; NÃO deployado)*

Escopo escolhido pelo dono: **A + C agora**, depois B/D. Codex fora → documentado aqui p/ auditoria.

### Arquivos alterados
- `Agent/src/engine/explicit-search.ts` — o mecanismo (Fix A + Fix C).
- `Agent/tests/run-f2-7-16-explicit-honesty.ts` — **NOVO** teste offline ($0), 19 checagens.
- `Agent/package.json` — `test:f2716` + append no `test:all`.

### FIX A — anti-mentira em busca por TIPO (mecanismo GERAL, não `if` por frase)
- `resolveExplicitSearchIntent`: quando a busca por tipo (estrito + fallback de taxonomia) **zera** E o turno é por **tipo**, roda uma **rede de segurança broad na faixa** (`{ broad:true, precoMax? }`) e devolve `offer` com `grounded:false` — em vez de `none`.
- `buildExplicitSearchTurnOutput`: `grounded:false` → mensagem de **candidatos** honesta ("Deixa eu te mostrar as opções que mais encaixam…", reasonCode `explicit_offer_soft`) que **não afirma** que são do tipo pedido **nem mente** "não tenho". `none` de tipo → "não achei opções [até R$ X]" (verdade), **nunca** "não tenho SUV". Marca/modelo mantêm `explicit_not_found` honesto (ausência verificável).
- **Invariante:** nunca negar uma CATEGORIA havendo estoque de tipo indeterminado. Vale p/ qualquer tipo (suv/sedan/hatch/pickup), qualquer catálogo — generaliza a CLASSE.

### FIX C — persistir a intenção do turno nos slots (`intentSlotMutations`)
- O handler emite `set_slot` (mesmo mecanismo do `lead-extraction`, via `ProposedDecision.facts`): **`tipoVeiculo`** e **`faixaPreco`** sempre que presentes; **`interesse`** **apenas em turno de TIPO puro** (sem modelo/marca) — modelo/marca ficam com o `lead-extraction`, que agrega multi-modelo ("onix e argo"). Isso impede o condutor de reperguntar "qual modelo/tipo?" após ofertar.

### Compatibilidade
- `ExplicitSearchResult.frame`/`grounded` são **opcionais**; `buildExplicitSearchTurnOutput` é defensivo (sem `frame` → sem slots + honestidade estilo modelo; `grounded` undefined → oferta normal `explicit_offer`). Preserva callers que montam o result à mão (ex.: `run-f2-7-13` L137/L140).

### Regressão encontrada e resolvida (mesma rodada)
- `run-f2-7-7` L166: multi-modelo "onix ou argo" → Fix C escrevia `interesse="Onix"` (1º modelo), clobrando o "onix, argo" do `lead-extraction`. **Fix:** `interesse` só em turno de tipo puro (acima). Voltou 21/21.

### Gates (todos verdes)
- `test:f2716` = **19/0** · `test:f2713` = **37/0** · `test:f277` = **21/0** · `test:all` **EXIT=0** · `tsc --noEmit` **EXIT=0**.

### Checagem de regressão para o Codex
1. `explicit-search.ts` não tem `if` por frase/modelo hardcoded (a rede de segurança é por `frame.explicitTypes.length>0`, geral).
2. `explicit_offer_soft` nunca afirma o tipo nem diz "não tenho"; `none` de tipo não diz "não tenho {tipo}".
3. Fix C não clobra `interesse` multi-modelo (só escreve em tipo puro); `tipoVeiculo`/`faixaPreco` OK.
4. `frame`/`grounded` opcionais não quebram callers manuais (L137/L140 do f2-7-13).
5. Reexecutar `test:all` + `tsc`. Confirmar que a rede de segurança (broad) respeita `precoMax`.

### O que continua PENDENTE (não tocado)
- **FIX B** (taxonomia: CRV/Tiggo 2 e cia. → `unknown`; a rede A evita a mentira mas o ideal é classificar certo). Coberto em parte por `run-f2-7-15-vehicle-taxonomy.ts` (do dono/Codex).
- **FIX D** (propose `confidence` inválida derruba turno + fallback cego) e **FIX E** (memória de oferta gated em `delivered` — contrato de state, exige auditoria).
- Confirmar por **replay offline** o caminho exato do turno 2 (por que exibiu C3 hatch) — `v3_turn_events` estava `__redacted`.
- **Deploy:** as mudanças são LOCAIS. O agente no WhatsApp segue no código antigo até o deploy (decisão do dono).

---

## 12. FIX B — APLICADOS (2026-07-01) ✅ *(cobertura da taxonomia; aguarda auditoria; NÃO deployado)*

### Arquivos alterados
- `Agent/src/adapters/read/vehicle-taxonomy.ts` — **+3 linhas** na seção SUV: `Honda CR-V`, `CAOA Chery Tiggo 2`, `CAOA Chery Tiggo 3x`.
- `Agent/tests/run-f2-7-15-vehicle-taxonomy.ts` (do dono/Codex) — **estendido de forma ADITIVA**: 2 checagens de classificação (CR-V→suv, Tiggo 2→suv) + 2 veículos no estoque fake (CRV/Tiggo 2) + 1 asserção de filtro ("suv agora acha CRV e Tiggo 2"). Nada removido/alterado das asserções existentes.

### Por que NÃO é `if` por frase
A `VEHICLE_TAXONOMY` é **dado** casado GENERICAMENTE por modelo (`compactTaxonomyText` já normaliza `CRV`↔`CR-V`, hífen/caixa). O feed RevendaMais **não manda carroceria** (comentário do próprio teste `:3`: a API chama SUV/picape de "Outros"/"utilitario"), então um mapa canônico modelo→tipo é a fonte de grounding **endossada pelo design de vocês** — completar a tabela ≠ remendo.

### Composição com o Fix A
Agora o fallback `taxonomyModelInputsForType` acha CR-V/Tiggo 2 por nome → **oferta grounded** (SUV de verdade). A **rede de segurança do Fix A** continua para modelos GENUINAMENTE fora de qualquer taxonomia. Ajustei o `run-f2-7-16` teste 2 para usar modelos **fictícios** (Nimbus Vega / Zenith Lyra, sempre `unknown`), exercitando a rede do Fix A de forma robusta e desacoplada da taxonomia.

### Gates
- `test:f2715` = **25/0** · `test:f2716` = **19/0** · `test:all` **EXIT=0** · `tsc --noEmit` **EXIT=0**.

### Checagem de regressão para o Codex
1. As adições não quebram nenhuma asserção existente do `run-f2-7-15` (Renegade/2008/Onix/HB20/C3 etc. intactos).
2. CR-V (feed "CRV" sem hífen) e Tiggo 2 → `suv`; sem falso-match (ex.: Tiggo 2 não vira 5x/7/8; CR-V não colide com Civic/City).
3. Modelo REALMENTE fora da lista continua `unknown` (invariante do teste `:71`) → a honestidade do Fix A cobre.
4. `test:all` + `tsc` verdes.

### Follow-up recomendado (não feito)
- A taxonomia é lista estática → **sempre vai atrasar** vs o mercado. Sugestão de solução (não remendo): manter a taxonomia a partir de um **dataset versionado** (a planilha de origem) com refresh, e — se a RevendaMais expuser algum campo de carroceria/espécie no feed — **mapear esse campo** no decode (`stock-normalizer`) como sinal primário, deixando a taxonomia como fallback. Auditoria de cobertura (outros usados comuns ausentes) fica como tarefa de dados.
- **Ainda pendentes:** Fix D (propose `confidence` + fallback com contexto) e Fix E (memória de oferta gated em `delivered`).

---

## 13. AUDITORIA P1 (2026-07-01) — reprovou o deploy; 3 findings, corrigidos

O dono/Codex reprovou o deploy e apontou 3 P1. Todos endereçados. **Sem commit/deploy** (ordem do dono).

- **Finding 1 (código, FEITO):** o broad-rescue do Fix A mostrava C3/Gol como "opções que encaixam" p/ quem pediu SUV (carro do tipo ERRADO — repetia a dor do veículo aleatório). **Removido.** Busca por tipo sem match ATERRADO → `none` → pergunta HONESTA e condutiva (ampliar faixa / outro tipo), **sem listar carro errado** e sem mentir "não tenho SUV". `explicit-search.ts`: removidos `grounded`/`explicit_offer_soft`/broad-rescue. F2.7.16 reescrito + e2e novo F2.7.17.
- **Finding 2 (código, FEITO):** o conductor (`applySdrConduction`, `conversation-engine.ts:259`) lia `contextState` SEM os slots do handler (Fix C só entra no commit ~L269) → reperguntava "qual modelo/tipo?" no MESMO turno. **Fix:** projeta os `set_slot` do handler sobre `contextState` (throwaway) antes do conductor. e2e F2.7.17 (nome conhecido → "tem SUV?" → NÃO repergunta "modelo ou tipo").
- **Finding 3 (plano, movido p/ Fase 1):** o conductor pode sobrescrever o compose com pergunta/texto hardcoded. **Movido da Fase 3 para dentro da Fase 1** (ver `10-PLANO-REBALANCEAMENTO-COMPOSICAO-PROMPT.md` §8): a Fase 1 tem que incluir o conductor INFORMAR o próximo slot como *guidance* pro compose, não reescrever depois com `DEFAULT_QUESTIONS`.
- **Finding 2b (2ª auditoria, código, FEITO):** a projeção do Finding 2 usava `applyDecision` cru → bumpava `turnNumber` 0→1 → no 1º contato o conductor OMITIA a apresentação do portal (`ensureInitialIntroduction`: `turnNumber>0` pula a intro). **Fix:** `safeCommitSlots` (preserva `version`/`turnNumber`/`updatedAt`) em vez de `applyDecision` cru. e2e F2.7.17: 1º turno "tem SUV?" → oferta + **apresenta o agente (Aloan)** + não repergunta o tipo.
- **D1** confirmado correto pela auditoria; **B** aceito como melhoria incremental.
- **Gates:** F2.7.16 18/0 · F2.7.17 (e2e) 10/0 · F2.7.13 37/0 · `test:all` EXIT=0 · `tsc` EXIT=0.
- **Checagem p/ Codex:** (1) busca por tipo sem match aterrado NUNCA lista carro do tipo errado (F2.7.17 e2e); (2) conductor enxerga os slots do turno (F2.7.17 e2e); (3) grounding/none de marca/modelo inalterado; (4) `explicit_offer_soft`/`grounded` removidos — nenhum caller depende deles (F2.7.13 e F2.7.16 verdes).
