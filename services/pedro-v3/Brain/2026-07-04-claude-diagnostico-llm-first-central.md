# DIAGNÓSTICO — central_active LLM-first (o que ainda sequestra a conversa) — 2026-07-04

**Autor:** Claude (executor). **Auditor:** Codex. **Entregue ANTES de qualquer alteração** (exigência da missão).
Escopo: caminho `central_active` (`singleAuthor=true`), rodado por `PilotActiveConversationRoot.#processCentralActive`.

## Ponto de partida — o que JÁ é LLM-first
- **Nenhum handler comercial roda antes do cérebro.** `pilot-active-root.ts:280-283`: em `central_active`, `processConversation`
  chama SÓ `#processCentralActive` → `runCentralConversationTurn(singleAuthor=true)`. O handler-first (`runConversationTurn`,
  com photo/ranking/economy/continuity/ordinal) só roda em `off`/`central_shadow`.
- **Autoria já é do cérebro** (trabalho P0/autoria única): o cérebro autora um `ResponseDraft`; o engine RENDERIZA aterrado
  SEM 2º compose (`authorFromBrainDraft`), policies só validam. `DecisionLlm.compose` NÃO roda em central_active.
- **Já FORA do central_active** (confirmado por grep em `central-engine.ts`): `conductDecision`, `applySdrConduction`,
  `adjustDraftSafeguards`, `enforceNoSlotFixation` NÃO são chamados aqui (só no legacy `composeAndVerify`/handler-first).
  `renderDeterministicResponse` só no ramo LEGACY (`central-engine.ts:819`), nunca no single-author.

## Pergunta 1 — o que AINDA decide a conversa antes/depois da LLM no central_active
1. **`reconcileObjectiveWithQuestion` (`central-engine.ts:788` → `sdr-conductor.ts:380-416`)** — pós-compose. É a **FONTE
   ÚNICA** de objetivo de funil no central_active (`finalize`/`attachQualificationObjective` só MATERIALIZAM um objetivo já
   proposto — `finalizer.ts:197` retorna null se já existe; o cérebro não emite objetivo de funil). O que ela faz:
   - Se o texto do cérebro fez uma pergunta de slot (`slotQuestions`), CRIA/persiste `currentObjective` daquele slot.
   - Se não fez pergunta, e o funil queria o slot pendente que o lead ignorou, DEFERE/SUPERSEDE via `decideFunnelNext`.
   - Não reescreve o texto, MAS o `currentObjective` que ela mantém vira `funnel.suggestedObjective` no frame do PRÓXIMO
     turno (`working-memory.ts:149,154`) → **empurra o cérebro a reperguntar o slot pendente**. É o "robô de funil".
2. **`extractLeadSlots`/`safeCommitSlots` (`central-engine.ts:~594`)** — captura determinística de slots ANTES do cérebro.
   É MEMÓRIA (bom como contexto), MAS: (a) NÃO captura negação a valor ("não" / "tenho não" / "não tenho dinheiro pra
   entrada" respondendo a pergunta de entrada) → o slot `entrada` fica `unknown` → funil/cérebro repergunta; (b) alimenta
   o objetivo pendente que dirige o reask.
3. **Frame expõe `funnel.suggestedObjective`** (`working-memory.ts:149-154`) = slot do `currentObjective` pendente → sinal
   forte de "pergunte ISTO agora", em vez de contexto neutro.
4. **`BRAIN_PROTOCOL` (`openai-agent-brain.ts`)** — tem boas regras ("responda a dúvida antes de qualificar", grounding,
   foto), mas NÃO instrui explicitamente: interpretar negações/objeções em contexto; NÃO reperguntar slot já respondido/
   declinado; continuar vendendo em "sem entrada" (financiamento); acompanhar mudança de assunto; tratar o funil como
   CONTEXTO e não formulário. Sem isso o modelo tende a repetir a pergunta pendente que o frame sinaliza.

## Pergunta 2 — o que CONTINUA como guardrail/ferramenta (NÃO remover)
Tudo em `authorFromBrainDraft` + commit do single-author:
- **Grounding**: `ResponseRenderer.render` fail-closed (km/cor/câmbio/preço só de fato REAL do MESMO vehicleKey),
  `PolicyEngine.validateResponse`, guard P0-2 (nunca vehicleKey no texto), `money_ref` preço<=0 barrado.
- **Foto**: P0-B (turno não-foto não promete/envia foto), P0-C (`buildDeterministicPhotoResponse` factual), recall
  determinístico (nomeia veículo lembrado), anti-mídia-sem-pedido (`isPhotoRequestBlock` gate do send_media).
- **Tool-authorization**: `PolicyEngine.authorizeQuery` (allow/deny), tool nunca fala com o lead, resultado vira FATO.
- **Reducer/memória**: `applyDecision` (autoridade do estado) + WorkingMemory accepted-safe; canonicalização de seleção (H1).
- **Materialização de efeitos**: `materializeEffectPlans` + EffectGate.
- **CPF cedo / erro técnico**: policy de CPF + `buildTechnicalFallback` (honesto, curto, sem vazar erro).
- **≤1 pergunta**: `trimToOneQuestion`.

## Pergunta 3 — o que REMOVER/BYPASSAR no central_active
Critério da missão: se decide "qual pergunta fazer / qual CTA / encerrar / oferecer lista / pedir nome-troca-entrada" por
fora da LLM, NÃO governa central_active — vira no máximo hint.
1. **`reconcileObjectiveWithQuestion` → BYPASS** em modo llm_first: não criar/gerenciar objetivo de funil. Substituir por
   `stripAllObjectiveMutations` (garante que nenhum objetivo de funil seja persistido; funil vira contexto read-only).
2. **`funnel.suggestedObjective`** → em llm_first fica `null` (sem objetivo criado). Mantém `known`/`declined` como contexto.
3. **`BRAIN_PROTOCOL`** → adicionar bloco LLM-first: conduza como SDR humano; funil = contexto; interprete negações/objeções;
   NÃO repergunte slot respondido/declinado; "sem entrada" continua no financiamento (nunca encerra); acompanhe mudança
   de assunto; 1 pergunta útil.
4. **`extractLeadSlots`** → capturar negação de entrada/pagamento como MEMÓRIA (contexto correto), não para forçar reask.

## Arquitetura alvo (mínimos arquivos)
Flag explícita **`llmFirst`** em `CentralTurnArgs` (a missão sugeriu `mode:"llm_first"`). `#processCentralActive` passa
`llmFirst:true`. Em llmFirst: skip do gerenciamento de objetivo de funil (strip em vez de reconcile); demais guardrails
intactos. O caminho `singleAuthor` legado (F2.13/15/17/20) mantém `llmFirst=false` → comportamento atual preservado
(compatibilidade). Prompt reforçado LLM-first. `extractLeadSlots` capta negação de entrada.

**Fluxo llm_first:** msg → frame (prompt integral + transcript + WorkingMemory + funil COMO CONTEXTO + veículo em foco +
fatos institucionais + sinais leves) → cérebro decide (responder | tool estoque/detalhe/foto/institucional | registrar
memória | propor efeito) → tool devolve FATO → cérebro decide de novo até final → engine VALIDA (grounding, foto certa,
sem inventar, sem CPF cedo, sem erro técnico) → envia. O engine NÃO escolhe pergunta de funil, não encerra, não vira menu.

**Não declarar pronto se** o engine ainda escrever pergunta de funil por fora da LLM, encerrar por falta de entrada,
repetir pergunta respondida, prender em foto na mudança de assunto, ou mandar lista/foto sem decisão da LLM.
