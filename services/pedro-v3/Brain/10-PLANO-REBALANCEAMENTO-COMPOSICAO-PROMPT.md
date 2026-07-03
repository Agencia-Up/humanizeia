# 10 — Rebalanceamento: handlers entregam FATOS, o LLM compõe seguindo o prompt do portal

> **Status:** PLANO (nada implementado). Aguarda decisão do dono sobre escopo + auditoria do Codex.
> **Autor:** Claude (executor, Codex fora) · **Data:** 2026-07-01
> **Origem:** o dono viu a conversa robótica e perguntou "não era pra seguir sempre o prompt do portal?". Resposta: sim — e hoje os handlers determinísticos **passam por cima** do prompt.

---

## 1. O problema, com evidência

O agente-piloto (Aloan, `d4fd5c38`, tenant `ecb26258`) tem um **`system_prompt` de 6513 chars** — um playbook de SDR completo, adaptativo, em 9 blocos (identidade, regras fixas: *uma pergunta por mensagem*, *qualificar antes de preço*, *variar tom*, *nunca inventar*, *sempre consultar estoque*; abordagem; qualificação; ramificações; critérios; **transferência + briefing**; regras de negócio; empresa). `use_funnel_config=false` → a fonte é esse `system_prompt`.

**Os handlers determinísticos ignoram — e às vezes CONTRADIZEM — esse prompt.** Ex. real (print do dono): o prompt manda *"nunca fale preço antes de qualificar"* e *"uma pergunta por mensagem"*; o handler de SUV **despejou 5 carros com preço** de cara, sem nome. Não é só "sem alma" — é violar a regra do cliente.

### O que os mapas de código provaram
- **A capacidade de compor seguindo o prompt JÁ EXISTE.** Caminho do LLM (`decision-engine.ts`): `propose` (LLM decide) → `compose` (LLM gera `ResponseDraft` com **partes estruturadas**) → `ResponseRenderer.render` → **`PolicyEngine.validateResponse`** (grounding). O `system_prompt` do portal entra na `system message` de TODA chamada (`openai-chat-model.ts:160-273`).
- **Grounding é por PARTES + policy** (`policy-engine.ts:252-339`, `domain/decision.ts:203-209`): `ResponsePart` = `text | vehicle_ref | money_ref | vehicle_offer_list`. Texto livre NÃO pode citar marca/modelo/preço; `vehicle_ref`/`vehicle_offer_list` têm que estar no catálogo + nos fatos; o texto renderizado é rechecado; preço tem que casar com fato (tol. 2%). Deny → retry com guidance → terminal-safe.
- **Os handlers pulam tudo isso.** `explicit-search.ts` / `photo-intent.ts` / `popularity-intent.ts` / `continuity-fallback.ts` / `sdr-conductor.ts` setam `composed.text` = **string fixa**, `terminalSafe=false`, sem `compose`, sem prompt, sem policy.
- **Config do portal que chega:** `system_prompt` (✅ vai pro LLM), `qualification_questions` (✅ conductor), `agentName`/`companyName` (saudação), `model`/`temperature`. **Ignorados (carregados e não usados):** `sdr_goal`, `blockedCategories`, `sellsMotorcycles`, `ragRestricted`.

---

## 2. O desenho (separação de responsabilidades)

| Camada | Responsável | O quê |
|---|---|---|
| **DETERMINÍSTICO** (handlers) | fatos + decisão | roda o `stock_search` certo, resolve o veículo certo, decide *ofertar / não-tenho / foto*; monta as **partes aterradas** (`vehicle_offer_list` com as chaves reais) + uma **guidance curta** do intent |
| **LLM + PROMPT** (`compose`) | wording | escreve a fala seguindo a persona/funil do prompt (uma pergunta por vez, qualificar antes de preço, variar tom), usando SÓ os fatos/partes |
| **POLICY** (inalterada) | verificação | nega qualquer marca/modelo/preço fora dos fatos → mantém a verdade |

**Regra de ouro:** o determinístico decide **O QUE é verdade e o que fazer**; o LLM decide **COMO falar**; a policy garante que o COMO não quebrou o QUÊ. É **menos** código de handler (eles param de redigir), não mais → o oposto de remendo.

**Fluxo do turno (depois):** handler junta fatos + seta `decision` + `responsePlan.guidance` + partes aterradas → **`llm.compose(decision, facts, ctx)`** (o que já existe) → `render` → `policy` → envia. O prompt do portal passa a reger TODO turno comercial.

---

## 3. Pré-requisito e riscos (honesto)

- **Pré-requisito = Fix D (robustez do LLM).** Rebalancear joga MAIS peso no caminho do LLM. Hoje uma `confidence` inválida derruba o turno inteiro (`MODEL_DECISION_INVALID:confidence`) → fallback cego. Isso PRECISA ser resolvido ANTES (clampar/1 retry dirigido em vez de descartar; fallback que usa slots). Senão o rebalanceamento fica frágil.
- **Custo/latência:** cada turno comercial passa a fazer +1 chamada de `compose` (hoje handler é instantâneo/$0). É o preço de seguir o prompt. Decisão do dono.
- **Variância:** o wording passa a variar (o que o prompt PEDE — "varie o tom"). O grounding mantém verídico.
- **Teste offline:** o `FakeLlm` prova o **encanamento + grounding** ($0, determinístico). O comportamento do LLM real se valida no piloto/replay (não dá pra provar wording offline).

---

## 4. Plano faseado (incremental, cada fase com prova + doc + checklist Codex)

- **Fase 0 — Fix D (robustez do compose/propose). ✅ FEITO 2026-07-01 (D1).** `confidence` malformada não derruba mais o turno → normaliza (finito→clamp[0,1]; ausente/NaN→0.7) em `prompt-bound-conversation.ts:decodeProposal` (mesmo princípio já usado p/ reasonCode/reasonSummary logo acima; os campos de contrato — action/facts/effects/guidance — seguem estritos). Teste em `run-model-adapter.ts` (confidence>1→clampa; ausente→0.7). Gates: model 30/0, test:all EXIT=0, tsc EXIT=0. ⏳D2 (fallback `buildContextualSdrReply` mais rico com `lastRenderedOfferContext`/slots) fica como polimento — o turno-3 já não é derrubado. *Destravou.*
- **Fase 1 — PROVA: rotear as OFERTAS pelo compose.** Só o `explicit-search` (offer/soft): em vez de texto fixo, emite `vehicle_offer_list` aterrado + guidance ("ofereça seguindo o funil; se ainda não qualificou, priorize a próxima pergunta do funil antes de preço") → `compose` redige seguindo o prompt → policy valida. Teste offline com `FakeLlm` (encanamento + grounding). Deploy → validar no piloto.
  - **⚠️ RAIO DE IMPACTO (descoberto 2026-07-01 ao ler `decision-engine.ts:196-248`):** o laço `compose→render→policy` vive DENTRO de `runTurn`; os handlers rodam FORA e entregam `TurnOutput` pronto. Rotear a oferta pelo compose = **converter o caminho de oferta de determinístico para LLM**. Toca: (a) engine (extrair `composeAndVerify` reusável), (b) `FakeLlm.compose` (devolver draft `vehicle_offer_list` aterrado), (c) **vários testes e2e de oferta** (ex.: run-f2-7-13 "jeep→Renegade" passa a depender do compose), (d) runtime (+1 LLM/variância por oferta — qualidade só valida com LLM real no piloto). NÃO é "enxuto". Fazer como passo dedicado, incremental: 1º extrair `composeAndVerify` (refactor puro, testes verdes) → 2º rotear a oferta com fallback determinístico se o compose falhar → 3º atualizar FakeLlm+testes → 4º deploy+validar piloto.
  - **Pacote seguro já pronto p/ deploy (independente da Fase 1):** A (anti-mentira) + B (taxonomia) + C (slots) + D1 (confidence robusto). Todos com test:all EXIT=0 + tsc EXIT=0.
- **Fase 2 — Expandir** aos demais handlers (photo, popularity, continuity) com o mesmo padrão, um a um.
- **Fase 3 — Fidelidade do funil:** injetar `sdr_goal` (hoje ignorado) e **alinhar os core-slots do conductor ao funil do prompt** (parar de injetar o slot "interesse" com pergunta-padrão que NÃO está no Bloco 4 do cliente — foi a origem do "Qual modelo ou tipo?" do turno 3).

**Relação com o CRM (prioridade do dono):** transferência, briefing pro vendedor e ramificações (financiamento/troca) **já estão no prompt** (blocos 5-7, incl. "Resumo interno para o vendedor"). Quando o agente conduzir seguindo o prompt, CRM/transferência/briefing viram **consequência do funil**, não builds do zero. Por isso este rebalanceamento é **fundação do CRM**, não desvio.

---

## 5. Arquivos (referência) e o que muda

| Arquivo | Papel hoje | Mudança |
|---|---|---|
| `engine/decision-engine.ts` | orquestra propose/compose/render/policy | Fase 0: robustez; expõe rota "handler→compose" |
| `adapters/llm/prompt-bound-conversation.ts` | valida decisão do LLM (confidence) | Fase 0: clamp/retry em vez de derrubar |
| `engine/explicit-search.ts` | texto fixo | Fase 1: emite partes + guidance, sem texto fixo |
| `engine/photo-intent.ts` / `popularity-intent.ts` / `continuity-fallback.ts` | texto fixo | Fase 2: idem |
| `engine/sdr-conductor.ts` | core-slots + defaults hardcoded | Fase 3: alinhar ao funil do prompt; usar `sdr_goal` |
| `engine/policy-engine.ts` / `response-renderer.ts` | grounding + render | **inalterados** (a separação já existe) |

---

## 6. O que NÃO será tocado / travas
Pedro v2/bridge/webhook; a policy de grounding (mantém a verdade); nada de segredo; contrato de state = parar e auditar. Fase 0/1 são as menos arriscadas; Fase 3 mexe no conductor (mais delicado).

## 7. Checklist de regressão para o Codex (por fase)
1. Nenhum handler volta a emitir marca/modelo/preço em **texto livre** (tudo por parte estruturada) — a policy tem que continuar pegando.
2. Grounding inalterado: `vehicle_offer_list`/`vehicle_ref` só com chaves em catálogo+fatos; preço casa fato (2%).
3. Fase 0: `confidence` inválida não vira `error`/turno-derrubado; fallback cita slots.
4. `test:all` + `tsc` verdes a cada fase; comportamento do LLM validado por replay no piloto.
5. Sem `if` por frase; o determinístico só decide/aterra, não redige.

---

*Decisão pendente do dono: profundidade agora (rebalanceamento completo Fases 0-3, ou fatia de alto impacto Fase 0+1) — trade-off custo/latência por turno vs qualidade de conversa.*

---

## 8. AUDITORIA P1 (2026-07-01) — Finding 3 movido para a Fase 1

O dono/Codex reprovou o deploy. **Finding 3:** mesmo após o `compose`, o `sdr-conductor` (`applySdrConduction`) pode substituir a pergunta por `DEFAULT_QUESTIONS`/texto hardcoded (`stripTrailingQuestion` + append). O plano adiava isso p/ a Fase 3 — **corrigido: passa a ser parte OBRIGATÓRIA da Fase 1.**

- **Requisito da Fase 1 (reforçado na 2ª auditoria):** NÃO basta o LLM só REDIGIR uma pergunta que o conductor ESCOLHEU da sua lista hardcoded (`orderedSlots`/`DEFAULT_QUESTIONS`) — isso ainda ignora o funil do cliente. A **seleção E a ORDEM dos slots** têm que vir do PROMPT (Bloco 4: nome → troca → entrada → loja), não do conductor. Fase 1: o compose recebe o ESTADO do funil (o que já se sabe / o que falta) + o prompt, e o LLM decide **qual** a próxima pergunta seguindo o Bloco 4. O conductor deixa de escolher/ordenar/redigir; vira só o **rastreador** de slots conhecidos/faltantes (memória do funil), não o autor da fala.
- A **Fase 3** mantém só: injetar `sdr_goal` (hoje ignorado) + alinhar a cobertura de core-slots ao funil do prompt (ex.: não forçar "interesse" fora do Bloco 4).
- **Findings 1 e 2** da auditoria já corrigidos no CÓDIGO (não eram Fase 1) — ver `2026-07-01-claude-diagnostico-suv-memoria-conducao.md` §13. Gates verdes (test:all EXIT=0, tsc EXIT=0, e2e F2.7.17 6/0). **Sem commit/deploy.**
