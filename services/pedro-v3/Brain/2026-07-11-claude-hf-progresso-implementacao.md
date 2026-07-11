# Missão HF (briefing/transferência/follow-up) — progresso de implementação (parcial)

**Data:** 2026-07-11 · **Autor inicial:** Claude · **Conclusão/auditoria:** Codex · **Status:** IMPLEMENTAÇÃO
CONCLUÍDA NO WORKING TREE. Nada commitado/deployado; flags inalteradas. Gates finais e checklist operacional em
`2026-07-11-codex-fase3-handoff-followup-concluida.md`.

## O que JÁ está no working tree (compila)

**Contrato (HF-1):** `domain/decision.ts` — `HandoffPlan{leadId,reason,briefing}` e
`NotifySellerPlan{leadId,reason,etiquetas}` (SEM sellerId — LLM nunca fornece; saga resolve);
`mark_handoff_completed.sellerId` opcional. Ripples: `effect-materializer` (payloads novos),
`finalizer` (deny de sellerId afirmado no plano), `prompt-bound-conversation` (validadores),
`tests/run-active-root.ts` (contrato atualizado).

**Puro (HF-2):** `engine/transfer-templates.ts` — `renderTemplate` (linha só-de-etiqueta-vazia some, porta exata
do v2), `stripEmojis`/`maybeStripEmojis` (acentos intactos), `buildTransferEtiquetas` (SÓ fatos do state; interesse
≠ troca; cpf excluído por tipo), `composeSellerMessage` (template OU fallback v2 c/ "Responda Ok"; variante
renotify sem Ok; linha *Motivo*), `composeManagerMessage` (completo/resumido/template),
`HANDOFF_REASON_KINDS`+tags `v3:<kind>` em transfer_reason, `sellerPhoneKey`/`uniqueSellersByPhone`/
`pickFairRoundRobin` (nunca-recebeu primeiro). `engine/automation-rules.ts` — porta exata do
`resolveAutomationRules` v2 (defaults 5/8/12, t3_transfers, seller_response_min 10; janela é dos motores v2).

**Saga (HF-3):** `adapters/effects/transfer-store.ts` (portas) + `supabase-transfer-store.ts` (PostgREST,
ownership everywhere; claim atômico `status='transferido'` SEM origem; revert CAS; contador CAS otimista;
summary só vazio/[Pedro v3]) + `transfer-dispatchers.ts`:
- `HandoffEffectDispatcher`: config fresca do portal (transfer.enabled/seller_response_min) → lead owned →
  renotify c/ throttle 45min (dono ativo) → pendente vigente = FAILED `transfer_already_pending` (notify vira
  SKIPPED → nunca duplica aviso) → escolha anterior>roster agente>roster tenant (M4) sem-telefone-fora →
  claim → INSERT pending (`confirmation_timeout_at=now+seller_response_min`) → falha = revert+uncertain →
  receipt DELIVERED `transfer:<id>:seller:<id>:<reason>`.
- `NotifySellerEffectDispatcher`: vendedor lido de `ai_lead_transfers` (nunca do modelo), compose template/
  fallback c/ briefing=notes, envia via `UazapiWhatsAppSender` (destino arbitrário ok), gerentes best-effort
  (nunca em renotify), receipt DELIVERED.

**Engine:** `engine/handoff-plan.ts` (chokepoint puro `buildHandoffChain`: remove handoff/notify propostos;
quando plannable monta reply(delivered-gate via `mark_message_delivered`)→crm→handoff→notify c/ dependsOn
por planId + briefing `buildSellerBriefing`+linha de motivo + etiquetas) e `central-engine.ts`:
`args.handoff{enabled,available,agentName,leadPhone,leadDisplayName,nowLocal}`, `handoffPlannable`
(flag+available+crmWrite+leadId), deny de promessa REFINADO (promessa exige effect proposto **E** plannable;
feedback distinto pede o effect quando plannable), chokepoint integra a cadeia pós-crmPlan, observabilidade
`handoff:{plannable,planned,reason,stripped}` no decision_final. Adapter `openai-agent-brain#decodeEffects`
aceita `{kind:"handoff",reason}` (engine é a autoridade).

## FALTA (ordem de execução na retomada)

1. **`npm run test:all` + ajustes de contrato** (deny de promessa mudou de texto; comportamento igual p/ testes
   existentes pois `handoffPlannable` ausente = deny como antes).
2. **Protocolo do cérebro** (openai-agent-brain, FLAG-GATED `handoffEnabled` na opção do adapter): ensinar
   QUANDO propor handoff (pedido explícito de humano c/ evidência no bloco; funil do prompt completo) e que
   promessa exige o effect; NUNCA por "gostei"/foto/garantia. OFF = protocolo atual byte-idêntico.
3. **Wiring root/server**: `PilotActiveDeps.transferStore`+`handoffFlags`; rotas `handoff`/`notify_seller` no
   CompositeEffectDispatcher (notify usa o MESMO runtime uazapi da conversa mas `sendText` direto ao vendedor —
   criar o sender fora do WhatsAppEffectDispatcher, via `createPilotWhatsAppDispatcher` deps ou direto
   UazapiWhatsAppSender c/ instance creds); server: env `PEDRO_V3_HANDOFF`/`PEDRO_V3_FOLLOWUP` (default off),
   pré-check `available` (listActiveSellers>0, 1 GET/turno só com flag on), `nowLocal` via
   `toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})`, /health expõe as 3 flags (PilotHttpApp health
   provider callback em server.ts:328), **flush pós-receipt** (applyReceipt → se transitou delivered, rodar
   OutboxDispatcher da conversa p/ liberar a cadeia delivered-gated — sem isso handoff fica pending até a
   próxima mensagem).
4. **Guard de vendedor no webhook (M1 P0)**: pedro-webhook-v2 ANTES do branch do bridge chama
   `identifyPedroContact`; `kind==="seller"` → NÃO bridgeia (segue v2 = ack/assistente). Pilot-gated, 1 arquivo.
5. **Follow-up (HF-4)**: `engine/followup-policy.ts` (puro: due por anchor/stage/rules) + campo
   `followupCycle` no ConversationState (aditivo) + runner no server (tick ~60s, pilot+flag) que roda TURNO
   SISTÊMICO pelo cérebro (LLM autora T1/T2/T3; engine valida; T3+t3_transfers → mesma cadeia handoff com
   reason followup_timeout_handoff); cancel = lead falou depois do anchor; zero double-send (M2: v3 nunca
   escreve last_agent_reply_at + crm_write mantém last_user_reply_at fresco — IMPLEMENTAR o freshness no
   CrmWriteEffectDispatcher/store + teste).
6. **F2.49** (25 cenários da missão, FakeTransferStore/FakeSender) + gates + **2 smokes** (A transferência
   explícita; B follow-up com relógio virtual) + entrega/checklist/riscos (Regia ***9350 recebe WhatsApp real
   no aceite!) + STOP Codex.

## Notas de desenho já decididas (não rediscutir)
Dedup do notify em retry uncertain = risco residual DECLARADO (mesmo do v2; track_id enviado); pendente
vigente/claim perdido = FAILED não-retryable p/ o dependente ser SKIPPED; `mark_message_delivered` no reply
torna a cadeia delivered-gated (CHECK do banco já exige delivered p/ outcome de handoff/notify).
