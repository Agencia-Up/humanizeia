# R13-D — Agente central no piloto Douglas (baixo custo) — Claude executor — 2026-07-03

> Continuação do R13 Inc2 (engine central + replay P0 PASS). Esta rodada LIGA o cérebro central ao runtime do
> piloto com custo baixo: persistência real no Postgres, shadow verdadeiro, fatos do prompt, modo no composition
> root, e UM smoke real. **Sem commit/push/deploy/SQL executado. Pedro v2 intocado. Flag default OFF.** Parar p/ Codex.

## Estilo N8N alcançado
LLM central conduz o turno; o prompt do portal define personalidade/funil; tools só retornam FATO ou executam ação
quando o cérebro pede; policies só bloqueiam dano real. Nenhum handler comercial redige resposta no caminho central.

## 1. Persistência real (Postgres) — promoção accepted-safe da WorkingMemory
- **Achado:** o UnitOfWork do Postgres é EXCLUSIVO do commit de turno (exige cas+inbox+decisão+lease). A promoção
  accepted-safe da WM (escrita de estado AVULSA no receipt) NÃO cabe ali.
- **Solução:** RPC dedicada `v3_commit_working_memory_outcome` (CAS de versão, tenant-scoped, ligada a um `send_media`
  REAL; conflito de versão → `applied=false` p/ o app recarregar; sincroniza o envelope do estado; nunca toca o
  photoLedger). Método de porta `WorkingMemoryOutcomeStore.commitWorkingMemoryOutcome` (InMemory + Postgres).
  `applyAcceptedPhotoActionOutcome` usa a RPC quando disponível (fallback `casState` avulso). Ligado ao FLUXO REAL:
  `OutboxDispatcher` chama a promoção accepted-safe após o `commitEffectOutcome` de todo `send_media` (no-op no
  handler-first, que não tem `pendingPhotoActions`).
- **SQL manual:** `Brain/sql/v3_r13d_wm_outcome_patch.sql` (aditivo, `create or replace`, revoke public/grant
  service_role). **NÃO executado** — o dono roda no SQL Editor ANTES de `central_active`.
- **Provado offline:** PGlite (`test:sql`): accepted (applied+version bump), **round-trip da WorkingMemory no state
  JSONB**, conflito de versão→applied=false, kind-guard (não-send_media rejeitado), cross-tenant→efeito não encontrado.
  Adapter (`test:postgres`): RPC tenant-scoped + decode de `applied` + round-trip de `workingMemory`/
  `appliedAcceptedEffectIds`. InMemory (`test:f213` [13]/[14]/[15]/[16]): accepted/delivered/restart/cross-tenant.

## 2. Shadow VERDADEIRO (`central-shadow-runner.ts`)
`runCentralShadowTurn` roda o engine central num `InMemoryPersistence` TOTALMENTE ISOLADO, semeado com uma CÓPIA
read-only do estado canônico + o bloco do lead. Garantias provadas (`test:shadow`): NÃO claima/conclui inbox canônico;
NÃO altera o ConversationState canônico (versão inalterada; `canonicalUntouched=true`); NÃO cria outbox acionável no
canônico; **zero dispatch com OutboxDispatcher REAL + gate shadow** (records viram `skipped`, `dispatch()` nunca é
chamado). Devolve uma COMPARAÇÃO SANITIZADA (sem PII/segredo). ⚠️ Custo: uma passada extra do cérebro por turno —
ligar `central_shadow` só p/ comparação CONTROLADA.

## 3. Fatos do prompt (`TenantBusinessFacts`, provenance tipada)
`extractTenantBusinessFacts(config)` extrai company/unit (do config) + address/hours (do prompt, SÓ rótulos de ALTA
confiança + valor com cara de endereço/horário), com `provenance: portal_prompt | config | absent`. NUNCA parseia
texto livre ambíguo; campo ausente → `null` (o cérebro ainda tem o prompt integral no system e responde de lá).
`PromptTenantBusinessInfoSource` alimenta a tool `tenant_business_info`. Provado em `test:shadow` [3].

## 4. Runtime central (composition root) — `PEDRO_V3_BRAIN_MODE`
`pilot-active-root.ts`: `PilotBrainMode = off | central_shadow | central_active`; getter `mode` degrada p/ `off` sem
AgentBrain (fail-safe). `processConversation` ramifica: **off** = handler-first (v3 atual); **central_active** =
`runCentralConversationTurn` no canônico + dispatch (NENHUM handler antes do cérebro); **central_shadow** =
handler-first responde ao lead + shadow isolado p/ comparação. `server.ts`: `resolveBrainMode()` lê `PEDRO_V3_BRAIN_MODE`
(default off) e monta o `agentBrainFactory` (OpenAiAgentBrain real, planner temp 0.2, prompt integral no system,
segredo por tenant, allowlist sem crm_read). `central_active` é tenant-scoped a Douglas por construção
(`PEDRO_V3_PILOT_TENANT_ID`). Rollback imediato = `PEDRO_V3_BRAIN_MODE=off` (volta 100% ao handler-first).

## 5. Ferramentas
`stock_search`/`vehicle_details`/`vehicle_photos_resolve`/`tenant_business_info` devolvem observação ao cérebro; nunca
falam com o lead; o cérebro decide se precisa; effects só após a decisão final validada (Finalizer/policies).

## 6. Testes de baixo custo + UM smoke real
- Custo zero: `test:all` EXIT 0 (KERNEL 68 + todas + PGlite + shadow 10 + f213 37 + f214 13 + postgres 26) · `tsc` EXIT 0.
- **UM smoke real** (`smoke:central`, `EVAL_MAX_LLM_CALLS` teto, probe de quota antes, SEM judge):
  **c1 15 turnos, 1 execução → SMOKE PASS: 0 críticas, 0 terminal_safe, BRAIN 18 (2xx=18) + COMPOSE 17 (2xx=17) =
  35 chamadas REAIS (100% 2xx), prompt integral, efeitos OFF (delivered=0).** Relatório em
  `eval/reports/central-smoke-*.md`. (Sem quota, o probe declara BLOQUEIO EXTERNO e não executa — exit 3.)

## Gates
`npm run test:all` EXIT 0 · `npx tsc --noEmit` EXIT 0 · `npm run test:sql` (PGlite WM RPC) OK · `npm run test:shadow`
10 OK · `PEDRO_V3_REAL_EVAL=1 npm run smoke:central` **PASS**.

## Arquivos
NOVOS: `src/engine/central-shadow-runner.ts`, `Brain/sql/v3_r13d_wm_outcome_patch.sql`, `tests/run-central-shadow-isolation.ts`,
`eval/run-central-smoke.ts`. ADITIVOS: `src/domain/ports.ts` (WorkingMemoryOutcomeStore), `adapters/persistence/in-memory-store.ts`
+ `postgres-store.ts` (commitWorkingMemoryOutcome), `src/engine/central-engine.ts` (usa a RPC), `src/engine/outbox-dispatcher.ts`
(promoção accepted-safe no dispatch), `src/engine/tenant-business-info.ts` (TenantBusinessFacts), `src/engine/pilot-active-root.ts`
(modo+branch+shadow), `src/runtime/server.ts` (PEDRO_V3_BRAIN_MODE+agentBrainFactory), `tests/run-sql-schema.ts` +
`run-postgres-adapter.ts` (provas), `package.json` (scripts).

## CHECKLIST DE ATIVAÇÃO (off → central_shadow → central_active) — SÓ APÓS AUDITORIA CODEX
Pré-requisitos (já feitos p/ o piloto no R13 Inc2/F): instance_id do Aloan, secret OpenAI no Vault, `PEDRO_V3_SERVICE_URL`/
`PEDRO_V3_BRIDGE_SECRET`, `PEDRO_V3_ALLOWED_UAZAPI_HOSTS`, `PEDRO_V3_PILOT_MODE=active` (bridge).
1. **SQL:** rodar `Brain/sql/v3_r13d_wm_outcome_patch.sql` no SQL Editor (Supabase). Verificar `grant … to service_role`.
2. **Shadow (opcional, comparação):** `PEDRO_V3_BRAIN_MODE=central_shadow` + redeploy do serviço v3. O lead segue
   recebendo a resposta do handler-first; o log `pedro_v3_central_shadow_comparison` mostra o que o cérebro central
   FARIA (0 escrita canônica, 0 dispatch). ⚠️ dobra o custo do cérebro — deixar ligado só algumas conversas.
3. **Active:** `PEDRO_V3_BRAIN_MODE=central_active` + redeploy. O cérebro central conduz e despacha SÓ p/ Douglas.
   O dono testa direto no WhatsApp (recall de foto, pergunta de loja sem virar troca, sem reenvio, ≤1 pergunta).
4. **Observação:** logs `pedro_v3_service_started {brainMode}`, `decision_final {brainMode:central_shadow, brainSteps}`.

## ROLLBACK (imediato)
`PEDRO_V3_BRAIN_MODE=off` + redeploy → 100% handler-first (v3 atual). Ou `PEDRO_V3_PILOT_MODE=off` (bridge) → 100% Pedro v2.
Nenhuma migração destrutiva; a RPC de WM é aditiva e inócua com a flag OFF.

## Honestidade / limites
- `central_shadow` no runtime dobra o custo do cérebro por turno (comparação); por isso o gate de qualidade é o UM
  smoke (não shadowar todo o tráfego). O shadow RUNNER + o gate `test:shadow` provam a isolação; o smoke prova a
  qualidade conversacional real.
- A extração de fatos do prompt é conservadora por design; se o prompt não usar rótulos claros, `tenant_business_info`
  devolve honesto e o cérebro responde do prompt (que tem tudo no system) — provado no replay P0 do R13 Inc2.
- Retry/backoff 429 do brain em produção usa o timeout do adapter + fallback seguro (o compose já é robusto). Um
  RetryingModelHttpTransport de runtime é follow-up de baixo risco.
- Sem commit/push/deploy/SQL executado. Parar para auditoria do Codex antes de ativar qualquer modo.
