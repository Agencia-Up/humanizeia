# 2026-07-06 — P0 "bloco-do-lead" + RESOLUÇÃO ÚNICA de veículo + ANTI-REPETIÇÃO

**Autor:** Claude (executor). **Estado:** implementado + gates verdes (`tsc` EXIT 0, `test:all` EXIT 0, **F2.24 44 OK**). **NÃO commitado, NÃO deployado.** Aguarda (nova) auditoria Codex → depois o dono testa no WhatsApp. `PEDRO_V3_BRAIN_MODE=central_active` mantido. **Nenhum SQL executado. Nenhum toque em CRM/handoff.**

## ⭐ CORREÇÃO — Auditoria Codex F2.24 (1 P0 na trava anti-parcial) — FEITA
**Bug:** o supersede media o "starved" com `Date.parse(clock.now())` — que roda DEPOIS do cérebro. Um cérebro lento (> maxWait) fazia o bloco parecer starved retroativamente → `shouldSupersedeStaleBlock` retornava false → **despachava resposta PARCIAL** ignorando a mensagem nova.
**Fix:** medir a idade do bloco no **CUTOFF (momento do claim)**, não pós-processamento: `const blockAgeAtClaimMs = Date.parse(cutoff) - blockOldestMs;`. Invariante garantida: (1) não-starved no cutoff + msg nova durante o processamento ⇒ SEMPRE supersede, por mais lento que o cérebro tenha sido; (2) já-starved no cutoff ⇒ processa mesmo com pending (anti forever-lock).
**Testes novos (F2.24):** `[I-partial-slow-a/b]` cérebro avança clock 25s > maxWait durante o brain, bloco jovem no cutoff → **superseded, sem outbox** (com o cálculo antigo, commitava parcial); `[I-partial-starved-a/b]` bloco starved no cutoff (blockAwaitMaxMs=500 < idade ~1s) + pending nova → **committed**.
**P1 anti-repetição (Codex):** carve-out `isOfferedListChoice` em `question-repetition.ts` — a guarda bloqueia repergunta de SLOT, NUNCA a escolha de um item ofertado ("qual DESSES modelos você prefere?", "qual dos que te mostrei?"). Testes `[P-rep-g/h/i]` (escolha não bloqueia mesmo com tipo/interesse known) + `[P-rep-j]` (repergunta de nome REAL ainda bloqueia — carve-out não afrouxa o slot).
**Gates:** `tsc` EXIT 0, `test:all` EXIT 0, **F2.24 44 OK** (era 38), zero regressão. `test:f224` verde. Sem SQL/OpenAI/deploy.

Dois P0 do dono, na ordem pedida (Bloco 1 antes do Bloco 2).

---

## BLOCO 1 — Esperar o "bloco real" do lead (como o Pedro v2)

### Auditoria do v2 (como ele espera o bloco)
`supabase/functions/_shared/pedro-v2/orchestrator_20260525_photo_flow.ts` (676–1023) + `pedro-webhook-v2/index.ts` (226–240):
- Webhook recebe evento `presence` do uazapi → `wa_lead_presence(instance_name, remote_jid, state, updated_at)`. `state` ∈ `composing|recording|paused|available`.
- Presença **ativa** = `state ∈ {composing,recording}` E `now-updated_at < 15s` (linha 1002-1003).
- Loop de debounce (polling 3s, teto 45s): (a) chegou msg mais nova → cancela (`debounced_superseded`, guarda `myUserMsgId`); (b) digitando/gravando → reseta silêncio; (c) quieto ≥ janela (10s normal / 18s fragmento) → responde.

### O que o v3 já tinha e o que faltava
v3 é assíncrono (ingest → poller → `runCentralConversationTurn`). Debounce por **tempo** já existia (`debounce-policy.ts`: quiet 10s / maxWait 20s). Faltava: (1) trava anti-parcial; (2) consciência de digitando/gravando.

### FEITO agora (deployável, offline, SEM SQL)
**Trava anti-parcial** — `central-engine.ts`, ANTES do `uow.commit()`:
- Reconfere `persistence.pendingCount(conversationId)`. Se chegou msg NOVA (pending) durante o processamento do cérebro → **NÃO commita** (logo nada é despachado): `releaseClaim` + retorna `status:"superseded"`. O poller reagrupa o bloco completo no próximo tick.
- **Anti forever-lock:** se o bloco já passou do teto (`blockAgeMs >= blockAwaitMaxMs`, = maxWait do debounce), processa mesmo assim (a msg nova vira o próximo turno). Política pura `shouldSupersedeStaleBlock` em `debounce-policy.ts`.
- Threading: `blockAwaitMaxMs` novo em `CentralTurnArgs` + `PilotActiveProcessInput`; `server.ts` passa `this.#debounce.maxWaitMs`; `pilot-active-root.ts` repassa. `dispatchIfCommitted` já era gated em `status==="committed"` → `superseded` nunca despacha (nenhuma mudança de dispatch necessária). Novos status: `CentralTurnResult` e `PilotActiveProcessResult` ganham `"superseded"`.

**Presença (digitando/gravando) — LÓGICA PRONTA + TESTADA, ainda NÃO ligada em produção:**
- `isConversationSettled` ganhou param opcional `leadPresenceActive` (retrocompat: ausente = comportamento anterior). Regra: **starved vence tudo** (teto); senão, presença ativa → NÃO assenta (espera); senão, quiet.
- `isLeadPresenceActive({state,updatedAtMs})` puro (janela `LEAD_PRESENCE_ACTIVE_MS=15s`, paridade v2).
- **PENDENTE p/ ligar em produção (precisa de SQL + deploy de bridge — NÃO executei):** ver §"Presença: plano de wiring" abaixo. Sem isso, o Bloco 1 em produção conta com o debounce por tempo + a trava anti-parcial (o item de segurança crítico já está deployável).

---

## BLOCO 2 — Resolução ÚNICA de veículo + anti-repetição

### Bug do Compass (evidência real)
Turno "Me mande fotos do segundo", `lastRenderedOfferContext = [1. Compass 2017, 2. Compass 2019]`; `decisionMutations` selecionou `revendamais:7894915` (Compass 2019) **mas** `decision_final`: `resolvedVehicleKey=null, toolsExecuted=[], responseSource=deterministic_recovery, reasonCode=recovery_photo_which` ("de qual carro?").

**Causa-raiz:** dois caminhos de resolução DIVERGIAM. `resolveTurnTarget` (executor de foto) resolve o ordinal 2 corretamente, mas o cérebro rotulou "fotos do segundo" só como SELEÇÃO (sem capability `send_photos`), então `authorizesPhotoSend` (exige evidência de foto DO CÉREBRO — P0-2) retornou **false** → `buildDeterministicPhotoResponse` devolveu null → caiu em `buildContextualRecovery` → "de qual carro?". E `vehicle_photos_resolve` nunca rodou (`toolsExecuted=[]`).

### FEITO (resolução única, grounded)
1. **`authorizesPhotoByResolvedOrdinal(target, block)`** (`turn-understanding.ts`, PURO): autoriza foto quando o alvo veio de **`turn_ordinal`** (índice EXATO da última lista) **E** o texto tem pedido explícito de foto (`PHOTO_REQUEST_STEM`), sem negação. Isto **não é** o "foto solta" que o P0-2 barra — o alvo é o item N que a loja ACABOU de renderizar (grounding máximo). Só `turn_ordinal` (nunca modelo inferido/pronome/selecionado antigo).
2. **`central-engine.ts` (`singleAuthor`, antes do executor):** quando o cérebro não autorou e há pedido de foto + ordinal resolvido, o ENGINE roda `vehicle_photos_resolve(vehicleKey exato)` 1x (a MESMA `resolveTarget` alimenta seleção/foto). Assim o executor determinístico tem `photoIds` reais → `send_media`. `buildDeterministicPhotoResponse` autoriza via `authorizesPhotoSend OU authorizesPhotoByResolvedOrdinal`. Guarda de completude (`turnCompletenessFeedback`) também passa a considerar o ordinal (`photoRequested = photoAuthorized || authorizesPhotoByResolvedOrdinal`).
3. **Dedup de `select_vehicle_focus`** (`canonicalizeSelectMutations`): para o MESMO `vehicleKey`, só a última seleção do turno vale (cérebro + ordinal podiam emitir duas iguais).

**Ask "de qual carro?" só quando:** sem lista, ordinal fora de faixa, ou conflito de modelo — comportamento preservado (testes I-nolist / I-range).

### Anti-repetição de pergunta
Achado: turnos do agente **já** entram em `recentTurns` via outcome accepted-safe (`state-reducer.ts:394`, `effect-materializer.ts:42`) — não precisei de `append_agent_turn`.
- Novo módulo PURO `question-repetition.ts`: `detectQuestionRepetition({finalText, slotsKnown, recentTurns})`. Não é if-por-frase: **normaliza a pergunta + classifica o SLOT esperado** (nome/interesse/tipo/preço) + compara com o histórico. (1) slot JÁ conhecido no estado → não repergunta (robusto, independe de timing — "nome conhecido nunca repergunta"); (2) mesma pergunta recente do agente → repetição.
- Ligado em `authorFromBrainDraft` (só `requireBrain`/llmFirst): repetição → `{ok:false, feedback}` → retry do MESMO cérebro. Nunca reescreve o texto aqui. "Já disse, é Douglas" é tratado por `extractLeadSlots` (nome vira known) + o guard (nome known → não repergunta).

---

## ⚠️ NOTA AO CODEX — reconciliação com o P0-2 (invariante que você aprovou)
O P0-2 diz "fallback regex NUNCA autoriza mídia/foco/tool". `authorizesPhotoByResolvedOrdinal` é uma exceção **NARROW e grounded**, pedida explicitamente pelo dono neste P0:
- Dispara **só** com `target.source==="turn_ordinal"` (índice EXATO da lista que a loja renderizou — não é palpite de modelo) **E** verbo de foto explícito no texto.
- O risco que o P0-2 guarda (enviar foto do carro ERRADO por menção vaga) não existe aqui: o alvo é determinístico e aterrado na oferta. `targetAcceptsKey` continua valendo.
- A autorização geral por fallback (`authorizesPhotoSend` com `requireBrain`) permanece intacta. Isto é um caminho SEPARADO só para o ordinal.
- Se preferir manter o P0-2 100% sem exceção, a alternativa é **só** o retry por feedback (guarda de completude já nudge o cérebro a emitir `send_photos`). Deixei os dois: retry (primário) + backstop determinístico por ordinal. Sua chamada.

---

## Presença: plano de wiring (PENDENTE — precisa de SQL + deploy de bridge; NÃO executei)
Para o v3 segurar a resposta enquanto o lead digita/grava (paridade total com v2):
1. **SQL (aplicar quando aprovado):** tabela `v3_lead_presence(conversation_id text pk, state text, updated_at timestamptz)` OU coluna em `v3_conversation_routing`. GRANT só `service_role`.
2. **Bridge/webhook:** encaminhar o evento `presence` do uazapi para o v3 (novo endpoint tipo `/v1/pilot/presence` OU no ingest atual) que faz upsert do estado por `conversation_id` (hash do telefone, mesma derivação do inbox).
3. **Finder:** `findSettledConversations` (RPC Postgres + `postgres-store.ts`) passa a LER a presença e a repassar `leadPresenceActive` para `isConversationSettled` (a lógica pura já está pronta e testada — F2.24 P-settled-b/c).
4. `in-memory-store.ts` (finder de teste) idem, para cobertura offline do caminho ligado.

Enquanto isso NÃO está ligado: em produção o Bloco 1 = debounce por tempo (10s/20s) + trava anti-parcial. A trava anti-parcial é o item de segurança principal e **já está deployável**.

---

## Arquivos tocados
- `Agent/src/engine/debounce-policy.ts` — `shouldSupersedeStaleBlock`, `isLeadPresenceActive`, `isConversationSettled(leadPresenceActive?)`, `LEAD_PRESENCE_ACTIVE_MS`.
- `Agent/src/engine/turn-understanding.ts` — `authorizesPhotoByResolvedOrdinal`.
- `Agent/src/engine/question-repetition.ts` — **novo** módulo puro.
- `Agent/src/engine/central-engine.ts` — trava anti-parcial (pre-commit) + `blockAwaitMaxMs` + status `superseded`; resolução determinística de foto por ordinal (pre-executor) + autorização no executor + na completude; dedup de select; guard anti-repetição.
- `Agent/src/engine/pilot-active-root.ts` — `blockAwaitMaxMs` no input + status `superseded`; repasse ao turno.
- `Agent/src/runtime/server.ts` — passa `blockAwaitMaxMs: this.#debounce.maxWaitMs`.
- `Agent/tests/run-f2-24-block-await-single-resolution.ts` — **novo** (38 casos). `package.json` — `test:f224` + no `test:all`.

## Gates
- `npx tsc --noEmit` → EXIT 0.
- `npm run test:all` → EXIT 0 (F2.24 **38 OK**; F2.23 34; F2.21 35; F2.22 21; scan anti-fallback 5; sem regressão).
- `npm run test:f224` → 38 OK (10 puros debounce/presença; 5 ordinal; 6 anti-repetição; 2 dedup; 5 Compass integração; 5 anti-parcial integração; 2 anti-repetição integração; 3 resolução).

## Próximos passos
1. **Codex audita** (com atenção à NOTA sobre o P0-2 e à trava anti-parcial vs starved).
2. Commit só do pedro-v3 + push `main` (deploy Easypanel) — quando aprovado.
3. Dono testa no WhatsApp: rajada 1 turno; "fotos do segundo"; não reperguntar nome.
4. **Follow-up separado:** wiring de presença (SQL + bridge) do §"Presença: plano de wiring".
5. NÃO avançar para CRM/handoff.
