# CRM/Handoff do Pedro v3 — FASE 1 (CRM write seguro) + FASE 2 (briefing) — F2.46

**Data:** 2026-07-09 · **Autor:** Claude (executor) · **Missão:** dono ("integração CRM/Handoff em fases, sem quebrar o
agente LLM-first") · **Escopo executado:** Fases 1+2 APENAS. **NÃO commitado, NÃO deployado, handoff real NÃO ativado,
nenhuma mensagem a vendedor, v2 intocado. Ativação futura: SÓ conta do Douglas (piloto), gated por env.**

## Diagnóstico (leituras obrigatórias feitas)
- **v2 (referência de regras)**: `03-INVENTARIO-PEDRO-V2.md` (itens #8/#52 CRM, #9 handoff, #50 silêncio, #51 notify);
  `transferRouter.ts` (chooseSeller/ack/briefing best-effort; `confirmSellerAck` grava `assigned_to_id`+status);
  `buildBriefing.ts` (formato consistente: emoji+nome+dados+próxima ação+wa.me; interesse ≠ troca; ausente omitido);
  `leadSdrCategory.ts` (3 categorias do dono; `PROTECTED_STATUSES` — "o vendedor é quem move"; 
  `mapQualificacaoToLeadColumns` — só campos com valor, nunca apaga); `pedro-seller-ack` + `transfer-timeout-checker`
  (confirmação/expiração — **Fase 3, não implementados**).
- **v3 (pipeline)**: `crm_write` JÁ era um `EffectKind` tipado (CrmWritePlan {leadId, fields}) com materializer pronto —
  faltavam o PRODUTOR (engine) e o DESPACHANTE (adapter). `OutboxDispatcher` ordena por `order` e pula dependentes de
  falha → a garantia "falha de CRM não silencia o lead" nasce da ORDEM (crm depois do reply). `ai_crm_leads` (schema
  real conferido no banco): client_name, vehicle_interest, payment_method, down_payment, **desired_installment**,
  trade_in_vehicle, client_city, visit_scheduled, budget, origem, summary.

## Arquitetura (LLM-first preservado)
- **A LLM não participa do CRM write**: o engine grava o que JÁ COLETOU (slots do estado pós-turno; fonte = extração
  determinística + reducer). Nenhum handler fala com o lead; nenhuma policy decide conversa.
- **Produtor** `src/engine/crm-write.ts` (PURO): `buildCrmWritePlan(stateAfter, stateBefore, ad, adVehicleLabel,
  leadId, turnId)` → CrmWritePlan ou null. Só campos com valor; **delta por turno** (stateBefore = state ORIGINAL do
  snapshot — turno sem coleta nova não emite); `effectId = turnId:crm` (idempotência por turno); `order=90` (sempre
  depois de send_message/send_media). Interesse = selecionado CANÔNICO > slot interesse > veículo do ANÚNCIO aterrado
  (inventário: lead de anúncio não digita o modelo). Troca = `tradeVehicleText(slots.veiculoTroca/possuiTroca)` —
  **colunas separadas por construção** (troca ↛ interesse ↛ troca). `origem="trafico_pago"` quando há adContext
  (mesma semântica do v2). `summary` determinístico prefixado `[Pedro v3]` (sem LLM na Fase 1).
- **Chokepoint** (`central-engine.ts`): injeção do plan pós-reducer, gated por `crmWriteEnabled === true` (novo arg,
  default OFF) + `leadId` presente (fail-closed) + `llmFirst`.
- **Despachante** `src/adapters/effects/crm-write-dispatcher.ts`: `CrmWriteEffectDispatcher` com:
  - **merge NÃO-destrutivo (fill-only-if-empty)**: campo preenchido no CRM NUNCA é sobrescrito (não importa a autoria);
    exceção única: `summary` que COMEÇA com `[Pedro v3]` (autoria nossa por construção) pode atualizar; summary alheio
    intocado. NUNCA apaga (null/vazio nem entram no update). *Limitação assumida da Fase 1: valor corrigido pelo lead
    (entrada 8k→10k) não atualiza a coluna já escrita — o valor novo vai no summary/briefing; autoria por campo é
    evolução da Fase 3.*
  - **cross-tenant fail-closed**: SELECT e UPDATE filtram por user_id+agent_id do **ref do dispatcher** (autoridade da
    composição, nunca do payload). Lead alheio/faltante → FORBIDDEN não-retryable, zero linhas.
  - **idempotência de retry**: re-dispatch do mesmo effect → 2ª passada é no-op (fill-if-empty).
  - allowlist DURA de colunas (2×: dispatcher e store).
  - `CompositeEffectDispatcher`: roteia por kind (send_* → WhatsApp; crm_write → CRM); kind sem rota falha fechado.
- **Store real** `src/adapters/effects/supabase-crm-lead-store.ts`: PATCH PostgREST em `ai_crm_leads` com HTTPS+host
  allowlist+UUID guard; update-only (nunca insere/deleta).
- **Wiring gated** (`pilot-active-root.ts` + `runtime/server.ts`): `PEDRO_V3_CRM_WRITE=active` (default OFF) monta o
  store — e o root já é pilot-scoped (SÓ tenant do Douglas). Sem env → comportamento byte-idêntico ao atual.
- **Briefing (Fase 2)** `src/engine/briefing-builder.ts` (PURO): `buildSellerBriefing(state, adContext,
  adVehicleLabel, lastPhotoAction, agentName, leadPhone)` — categoria SDR (espelho puro das 3 categorias do dono),
  interesse/anúncio/troca (seções SEPARADAS), pagamento (forma/entrada/parcela/faixa), fotos ENVIADAS (WM
  accepted-safe), visita, pendência (slot do currentObjective), **próximo passo derivado do funil** (troca→entrada→
  parcela→visita — nunca inventado), últimas mensagens truncadas, wa.me. Ausente = omitido/"não informado". SEM LLM
  (fase futura pode REESCREVER este briefing como fato — nunca criar). Consumidor: handoff/notify_seller da Fase 3.

## Arquivos
NOVOS: `src/engine/crm-write.ts` · `src/engine/briefing-builder.ts` · `src/adapters/effects/crm-write-dispatcher.ts` ·
`src/adapters/effects/supabase-crm-lead-store.ts` · `tests/run-f2-46-crm-briefing.ts` · este handoff.
ALTERADOS: `src/engine/central-engine.ts` (arg `crmWriteEnabled` + chokepoint) · `src/engine/pilot-active-root.ts`
(dep `crmLeadStore` + composite no dispatch) · `src/runtime/server.ts` (env gate) · `package.json` (test:f246).
Colisão de numeração resolvida: o Codex entregou F2.44 (semantic-slot-boundaries) e F2.45 (sdr-style) em paralelo
(commit `589f681f`) — esta suíte virou **F2.46** e o test:all encadeia as três.

## Testes (os 10 da missão) — `test:f246`: **27 OK / 0 FALHA**
1. ✅ jornada nome+carro+troca+entrada+parcela grava CRM (client_name/vehicle_interest/trade_in/down_payment/
   desired_installment/summary) e gera briefing completo (categoria=qualificado).
2. ✅ lead de anúncio: `origem=trafico_pago` + vehicle_interest = veículo do ANÚNCIO; briefing cita o anúncio.
3. ✅ troca ↛ interesse (Hilux na troca, Onix no interesse; linhas separadas no briefing).
4. ✅ interesse ↛ troca.
5. ✅ campo humano preenchido INTOCADO (client_name/client_city/summary alheio).
6. ✅ retry do mesmo effect = no-op (0 updates extras).
7. ✅ falha no CRM: send_message SUCCEEDED, crm uncertain/failed isolado, lead respondido.
8. ✅ cross-tenant: FORBIDDEN, zero escrita.
9. ✅ briefing vazio não inventa ("não informado", sem R$/carro/troca/visita) + plan fail-closed (sem leadId/sem
   campos/flag OFF → nenhum crm_write) + delta (turno sem coleta não emite).
10. ✅ `npx tsc --noEmit` EXIT 0 · `npm run test:all` EXIT 0 (**2109 OK** — inclui as F2.44/45 novas do Codex).

## Próximos passos (Fase 3+, NÃO iniciados)
Handoff real: escolha de vendedor (rodízio justo do v2), `notify_seller` com o briefing desta fase, `ai_lead_transfers`
pending→ack (pedro-seller-ack), timeout/escalação (transfer-timeout-checker), silêncio pós-handoff (POL-HANDOFF-005),
`status_crm` com PROTECTED_STATUSES, `ai_paused`/ownership (POL-OWN-002). Pré-requisito de qualidade: os P0 de extração
do audit (pergunta-vira-slot etc.) foram atacados em paralelo pelo Codex (F2.44/45) — validar juntos antes de ligar
`PEDRO_V3_CRM_WRITE=active` no piloto.

## Ativação (quando o dono autorizar; NADA disso foi feito)
1. Deploy do serviço v3 com `PEDRO_V3_CRM_WRITE=active` (só piloto Douglas — root já é pilot-scoped).
2. Verificar 1 conversa real: `v3_effect_outbox` com `crm_write succeeded` + lead no CRM com os campos e `summary
   [Pedro v3]`, sem sobrescrever nada preenchido.
3. Rollback: remover a env (default OFF) — zero efeito residual.

## ⭐Auditoria do Codex (rodada 1) + fix (2026-07-09, noite)
**Finding [P1] procedente:** o `crm_write` devolvia receipt `accepted`, mas `effect-policy.ts` o classifica como
efeito CRÍTICO (exige `delivered` + `outcomeAppliedAt` para `isEffectSatisfiedForDependency`). Hoje não quebrava
(sem dependentes); na Fase 3, um `handoff`/`notify_seller` com `dependsOn: ["crm"]` ficaria PRESO para sempre.
**Fix:** o PATCH no CRM é SÍNCRONO e confirmado pelo banco — o sucesso É a entrega → receipt agora é `delivered`
(comentário no dispatcher explica o porquê). **Testes novos (F2.46 → 31 OK):** [R-1] crm_write succeeded +
receiptLevel=delivered + outcomeAppliedAt preenchido; [R-2] efeito DEPENDENTE do crm_write (send_message
`dependsOn:["crm"]` — o notify_seller da Fase 3 simulado) é LIBERADO e despacha após o sucesso; [R-3] escrita real
no store. Gates re-rodados: tsc EXIT 0 · test:f246 31 OK · test:all EXIT 0 (**2113 OK**).

**PARADO — nada commitado/deployado. Aguarda re-auditoria do Codex/decisão do dono.**
