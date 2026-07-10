# Estágio A (ativação CRM no piloto) — BLOQUEIO ESTRUTURAL: leadId nunca chega ao v3 e ninguém cria o lead

**Data:** 2026-07-10 · **Autor:** Claude (executor) · **Missão:** dono ("VALIDAR CRM REAL NO PILOTO E IMPLEMENTAR FASE 3")
**Status:** ⛔ **PARADO no Estágio A, item 2 (ativação), SEM ativar nada** — a missão manda parar e expor contradição
estrutural antes de mascará-la. **Estágio B NÃO iniciado** (gate: "somente se o Estágio A passar integralmente").
Nenhum código alterado, nenhuma env alterada, nenhum SQL executado, nenhum deploy.

## O que foi verificado (item 1 da missão — tudo read-only)

| Verificação | Resultado |
|---|---|
| Banco | `seyljsqmhlopkcauhlor.supabase.co` (produção da plataforma — o MESMO que webhook/bridge/v3 usam; o sticky-routing do webhook consulta `v3_conversation_routing` neste banco) |
| Agente piloto | **Aloan** — `wa_ai_agents.id = d4fd5c38-dd37-4da5-a971-5a7b7dfb9185`, `user_id = ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0` (Douglas), `is_active = true` |
| Tabelas v3 | **TODAS com 0 linhas (global)** — o reset `v3_reset_pilot_conversation('ecb26258…')` foi executado após o último teste (a função apaga TODO o estado v3 do tenant; o piloto é o único tenant v3). Próximo contato = conversa nova `wa:<sha256(tenant|agent|phone)>` |
| conversation/leadId do piloto | **não existem hoje** (pós-reset). E o leadId NUNCA existirá pelo fluxo atual — ver contradição abaixo |
| `ai_crm_leads` do agente piloto | **0 linhas** — não há lead para o `crm_write` atualizar; snapshot ANTES = vazio |
| `v3_effect_outbox` | 0 registros; **0 `crm_write`** (flag OFF confirmada comportamentalmente). O CHECK do schema JÁ permite `crm_write`/`handoff`/`notify_seller` — nenhum SQL novo é necessário |
| `PEDRO_V3_BRAIN_MODE` / commit `f53509b1` no runtime | **não verificável daqui** — envs do Easypanel; não há credencial de Easypanel no repo/.env (e não vou fingir que ativei). `GET /health` do serviço (sem auth) responde `{ok, service:"pedro-v3", configuredBrainMode}` — verificação que o Douglas faz na URL do serviço |
| Identidade do lead no v2 | chave = `(agent_id, remote_jid)`, `remote_jid = "<55DDDNÚMERO>@s.whatsapp.net"`; criador = `ensurePedroV2Lead` (`leadMemory.ts:22`), upsert `onConflict (agent_id, remote_jid) ignoreDuplicates` |

## ⛔ A contradição estrutural (2 pernas — com a fiação atual, o aceite produziria ZERO crm_write)

**Perna 1 — o leadId nunca chega ao v3.** O bridge fixa `leadId: null` no TIPO e no código
(`supabase/functions/_shared/pedro-v2/pedroV3Bridge.ts:32` e `:229`). Cadeia completa:
`buildPedroV3BridgeTurn → payload.leadId=null → server.run → ingestPilotMessage → upsertRouting(lead_id=null)
→ findSettledConversations → settled.leadId=null → #createRoot(ref.leadId=null) → engine → buildCrmWritePlan
exige leadId (fail-closed) → plan = null`. Com `PEDRO_V3_CRM_WRITE=active`, o comportamento seria idêntico ao OFF.

**Perna 2 — ninguém cria a linha do lead quando o v3 atende.** `ensurePedroV2Lead` roda DENTRO do
`processPedroV2Turn` — que não executa quando o bridge assume (o webhook retorna após o bridge; v2 só roda em
fallback pre-ingest). O store da Fase 1 é **update-only por design**. Logo, para qualquer conversa nova do piloto:
não existe linha em `ai_crm_leads` (confirmado: 0 no banco), e mesmo que o leadId chegasse, não haveria o que
preencher. A Fase 3 (handoff/atribuição/status) depende da mesma linha.

Por que só apareceu agora: a F2.46 foi projetada e testada com `leadId` injetado pelo harness (contrato correto no
engine); a fiação de PRODUÇÃO do leadId era um pressuposto herdado do bridge que nunca foi exercitado — o gate
fail-closed fez o que devia (nenhum efeito inválido), e a verificação pré-ativação pegou o buraco ANTES de gastar
uma conversa real.

## ✅ IMPLEMENTADO (autorização condicional do dono, 2026-07-10) — F2.47, aguarda auditoria Codex

A Opção A foi implementada COM o hardening exigido pela auditoria (12 itens). Desenho final:

**Módulos novos**
- `src/domain/whatsapp-jid.ts` (PURO): `canonicalWhatsappRemoteJid` — ÚNICA fonte da forma canônica
  `<telefone>@s.whatsapp.net` (compat exata com o normalizePhone do bridge: 10/11→prefixo 55; 12/13 preservado);
  rejeita vazio/grupo/@lid/@broadcast/sufixo estranho/malformado → **null = fail-closed, nunca vira consulta**.
- `src/adapters/effects/crm-lead-identity-store.ts`: porta **CrmLeadIdentityStore SEPARADA** do CrmLeadStore
  (update fill-only intacto): `resolveOwnedLead` / `ensureOwnedLead` / `resolveOrEnsureOwnedLead`.
- `src/engine/crm-lead-binding.ts`: `resolveConversationLeadBinding` — decisão do vínculo POR TURNO
  (crm_off | bound_existing | bound_new | resolved_existing_lead | routing_state_mismatch |
  resolved_conflicts_routing | invalid_jid | foreign_tenant_conflict | transient_resolution_failure).

**Contratos-chave**
- **Fonte DURÁVEL do vínculo = `ConversationState.leadId`** (o `v3_commit_turn` espelha na coluna `lead_id`).
  A routing NÃO é durável: o RPC do ingest sobrescreve `lead_id` com o null do bridge a CADA mensagem
  (comportamento reproduzido no teste [C8]); ela é re-hidratada best-effort após o resolve e serve de sinal
  de conferência (mismatch → fail-closed). Patch SQL futuro (coalesce no upsert) fica a critério do Codex.
- **Identidade/ownership**: unique real `(agent_id, remote_jid)` ancora o `on_conflict` ignore-duplicates; o
  UUID **sempre** sai de um SELECT FINAL owned (user_id+agent_id+remote_jid) — nunca do retorno do INSERT
  (corrida). Mesmo (agent, jid) com user_id diferente → HEAD count sem ler dados → `foreign_tenant_conflict`
  fail-closed.
- **INSERT mínimo sem inventar**: user_id/agent_id/remote_jid + lead_name "Lead" (placeholder promovível) +
  status/status_crm "novo" + message_count/followup/timestamps. **`origem` fica NULL** (nullable no schema,
  conferido) — só o crm_write fill-only a preenche com `trafico_pago` quando o adContext factual do turno/state
  existir; origem humana preservada.
- **lead_name × client_name (auditoria de uso real)**: `lead_name` é o nome CANÔNICO de exibição
  (GlobalLeadsCrm/AgentInboxTab/FollowupDashboard/briefing do transferRouter); `client_name` é o nome da
  qualificação (orchestrator v2 idem). O v3 grava OS DOIS quando o slot nome é NOME REAL (`isRealLeadName`,
  mesma semântica do v2); no dispatcher, `lead_name` tem merge próprio: **promove placeholder→real, NUNCA
  regride nome real, lixo/emoji nunca entra** (testes H).
- **Wiring** (`server.ts#processSettled`, flag ON apenas): lê o binding durável (`persistence.load`), decide via
  `resolveConversationLeadBinding`, re-hidrata a routing, cria o root do MESMO turno com o leadId confirmado e
  passa `crmWrite {enabled, bootstrapSync}` por turno. Flag OFF → **zero SELECT/INSERT, byte-idêntico**.
- **Falha não silencia o lead**: resolução transiente → turno segue com leadId null e CRM off (log sanitizado
  `pedro_v3_crm_lead_binding`, sem telefone). **Bootstrap sync**: no turno do 1º vínculo, o crm_write manda o
  SNAPSHOT acumulado (stateBefore=null), não o delta — coleta de turnos sem vínculo não se perde (teste I).
- **Defesa em profundidade no engine**: bind `state.leadId==null → adota leadId do root` (nunca sobrescreve);
  chokepoint só emite crm_write quando `state.leadId === leadId` (mismatch → zero effect, conversa intacta);
  observabilidade `crmWrite {enabled, leadBound, bootstrapSync, planned}` no decision_final.

**F2.47 (`test:f247`) — 49 OK / 0 FALHA**: JID (10 casos) · A flag OFF zero IO · B lead existente (ownership,
zero insert, campos humanos intactos) · C fiação de PRODUÇÃO completa (ingest bridge-like leadId=null →
settled → ensure → routing+state com UUID → crm_write **succeeded+delivered+outcomeAppliedAt** no MESMO turno
→ regressão real da routing no turno 2 → bound_existing pelo state com ZERO consulta nova) · D concorrência
(2 ensures → 1 linha, mesmo UUID) · E cross-tenant fail-closed · G origem (anúncio factual/sem anúncio/humana)
· H nomes (promoção/preservação/lixo/retry) · I transitória + bootstrap acumulado · J idempotência/restart ·
K mismatch (binding e engine) · CONTROLE: fiação ANTIGA com flag ativa → **zero crm_write** (o caso C passa
SOMENTE com a nova fiação). Gates: `tsc` EXIT 0 · `test:f246` 31 OK · `test:all` EXIT 0 (**2162 OK**) ·
`git diff --check` limpo. Sem OpenAI (missão de infraestrutura).

**Riscos/limites conhecidos (honestos)**: (1) o `SupabaseCrmLeadStore` real (PostgREST) é coberto por contrato
via FakeCrmDb de semântica idêntica — o HTTP real será exercitado na conversa de aceite supervisionada (mesmo
padrão aceito na F2.46); (2) turno com flag OFF depois de um vínculo regride `lead_id` da LINHA para null
(o RPC de commit sobrescreve) — o jsonb do state anterior preserva o histórico e o próximo turno com flag ON
re-resolve o MESMO UUID por jid (convergente); (3) a routing continua regredindo a cada ingest até um patch
SQL futuro (opcional).

## Proposta original (mantida p/ contexto histórico — JÁ implementada acima)

**Opção A (recomendada) — resolver/garantir o lead DENTRO do pedro-v3** (não toca bridge/webhook/v2; autoridade =
banco com ownership do próprio root, nunca payload):
1. Novo módulo adapter `resolveOrEnsurePilotLead(ref, toAddr)`: lookup `ai_crm_leads` por
   `agent_id = ref.agentId AND remote_jid = "<toAddr>@s.whatsapp.net"`;
2. Se não existir, INSERT mínimo espelhando o contrato do v2 (`user_id, agent_id, remote_jid, lead_name='Lead',
   origem` = `trafico_pago` se a conversa nasceu de anúncio senão `outros`, `status='novo', status_crm='novo',
   assigned_to_id=null`), `onConflict (agent_id, remote_jid) ignoreDuplicates` → idempotente e convergente com o v2
   (se o v2 criar primeiro, o v3 só resolve; se o v3 criar primeiro, o v2 upsert ignora);
3. Chamada no `processSettled`/`#createRoot`: SÓ quando `PEDRO_V3_CRM_WRITE=active` e `settled.leadId == null` →
   ref nasce com leadId real; flag OFF → zero lookup/insert (byte-idêntico ao atual);
4. Testes F2.47: resolve por jid · ensure cria mínima e é idempotente · cross-tenant fail-closed · flag OFF não
   toca banco · lead existente com dados humanos → intocado (fill-only-if-empty já cobre) · origem por anúncio.

Trade-off honesto: o passo 2 é um **INSERT** — a Fase 1 foi auditada como *update-only*. Ampliar o contrato do
store exige a bênção do dono/Codex (por isso este STOP). A alternativa "só resolver, nunca criar" não escala:
todo lead NOVO do piloto ficaria permanentemente fora do CRM — exatamente o que o CRM veio resolver.

**Opção B (não recomendada)** — bridge/webhook passa a consultar/criar o lead e enviar `leadId`: mexe em edge
function (proibido nesta missão), adiciona latência e ponto de falha no caminho crítico do webhook, e confia a
identidade a um payload externo em vez do ownership do root.

## Checklist de ativação (para DEPOIS da correção aprovada+commitada — nada disso foi feito)
1. Douglas (Easypanel, serviço `agent-pedrov3`): redeploy da `main` (traz `f53509b1` + a correção) + env
   `PEDRO_V3_CRM_WRITE=active` (manter `PEDRO_V3_BRAIN_MODE=central_active`). Sem segredo no Git.
2. Verificar `GET <PEDRO_V3_SERVICE_URL>/health` → `configuredBrainMode: "central_active"`.
3. Conversa de aceite (roteiro semântico da missão: nome → SUV automático → "gostei do segundo" → condições →
   troca Hilux 2020 85 mil km em mensagens separadas → 8k entrada → 2.1k parcela → vendedor), do número de teste.
4. Eu verifico no banco: outbox (`crm_write succeeded/delivered/outcomeAppliedAt`, effectId `turnId:crm`, order 90),
   linha do CRM antes/depois, idempotência, campos humanos intactos, cross-tenant, zero technical_fallback/compose,
   e entrego a tabela por turno + leitura humana + PASS/FAIL.
5. Rollback: remover a env (default OFF).

**PARADO — aguardando decisão do dono (Opção A?) e auditoria do Codex. Estágio B não iniciado.**
