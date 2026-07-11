# Fase 0 — Diagnóstico read-only: briefing, transferência e follow-up (v2 real → contrato v3)

**Data:** 2026-07-11 · **Autor:** Claude (executor) · **Missão:** `2026-07-11-missao-claude-briefing-transferencia-followup.md`
**Status:** diagnóstico CONCLUÍDO (zero edição de código até aqui; zero SQL de escrita; PII mascarada).

Fontes lidas na íntegra: `_shared/pedro-v2/transferRouter.ts`, `_shared/transfer/messageTemplates.ts`,
`_shared/automation/rules.ts`, `cron-lead-followup/index.ts` (1278 linhas), `transfer-timeout-checker/index.ts`,
`pedro-seller-ack/index.ts`, `_shared/pedro-v2/contactIdentity.ts`, `phone.ts` (isSellerAckText),
`orchestrator_20260525_photo_flow.ts` (bloco de handoff ~3470-3688 + identidade ~1185 + markAgentReplyForLead ~752),
`pedro-webhook-v2/index.ts` (ordem bridge×turno), `pedroV3Bridge.ts`; v3: `domain/decision.ts`,
`effect-materializer.ts`, `whatsapp-dispatcher.ts`, `uazapi-whatsapp-sender.ts`, `crm-write.ts`.
Banco (SELECT read-only, prod): `wa_ai_agents` do piloto, `ai_team_members`, `ai_crm_leads`, constraints
(`pg_constraint`), colunas de `ai_lead_transfers`, `v3_required_receipt_level`, `cron.job`.

---

## 1. Evidência do banco (piloto, mascarado)

| Item | Valor real confirmado |
|---|---|
| `automation_rules` (agente Aloan) | **configurado**: followup `{enabled:true, t1:5, t2:8, t3:12, t3_transfers:true}`; transfer `{enabled:true, seller_response_min:10, window:null}` (janela LEGADA) |
| Templates portal | `briefing_template_vendedor` = NULL, `briefing_template_gerente` = NULL → **fallback inline** é o que o aceite exercita; caminho de template fica provado por teste offline |
| `mensagens_sem_emoji` | false · `gerente_feedback_completo` false · `gerente_phone`/`_2` **NULL** (sem relatório de gerente no piloto; código deve suportar mesmo assim) |
| Vendedores do tenant | 3 rows, **TODOS `agent_id=NULL`** — só **Regia** ativa (fone ***9350, 11 dígitos sem 55); "Gerente" inativo (fone 15 dígitos, malformado); "Victoria" inativa |
| `ai_crm_leads` do tenant | **ZERO linhas** (a linha suja antiga foi limpa) — aceite parte de base limpa |
| `ai_lead_transfers` CHECK | `transfer_status IN ('pending','confirmed','expired')`; colunas: user_id NOT NULL, lead_id NULL-ável, to_member_id NOT NULL, from_member_id, transfer_reason (default 'round_robin'), notes, is_confirmed (default false), confirmed_at, confirmation_timeout_at, created_at, triggered_by_*; **NÃO tem agent_id** |
| `v3_effect_outbox` CHECK | `kind` **JÁ permite** `handoff` e `notify_seller` → **zero SQL novo p/ Fase 3**. `v3_required_receipt_level`: todo kind ≠ send_message exige receipt `delivered` p/ aplicar outcome (mesmo contrato do crm_write) |
| Crons ativos | `cron-lead-followup` **a cada 1min**; `transfer-timeout-checker` a cada 5min — ambos operam sobre `ai_lead_transfers` assim que existir pending |

## 2. Comportamento real do v2 (mapa dos 5 fluxos)

**(a) Decisão de handoff** (orchestrator ~3470): sinais do cérebro (`pronto_para_transferir` / `transferir_silencioso`
/ `needs_handoff` / `force_transfer_now`) + gate de funil (bloqueia se falta pergunta do bloco 4) + bloqueio de
handoff não-anunciado; gated por `automation_rules.transfer.enabled` e `identity.kind !== "seller"`.

**(b) Saga `executePedroV2Handoff`** (transferRouter): (0) estado do lead; (1) lead COM dono ativo → re-notifica o
dono (`returning_lead_renotify`, throttle 45min, insere transfer CONFIRMED como marco); dono inativo → solta
atribuição; (2) pending vigente (timeout não vencido) → `already_pending` (dedup de corrida); (3) escolha:
`preferred_seller_id` (recuperação) > vendedor anterior (transfer confirmado / lead atribuído, tenant-wide por
remote_jid) > round-robin **APENAS agent-scoped** (`uniqueSellersByPhone` + `pickRoundRobinSeller`, nunca-recebeu
primeiro); (4) claim atômico `UPDATE ai_crm_leads SET status='transferido', origem='trafico_pago' WHERE id=? AND
assigned_to_id IS NULL` → 0 rows = `already_handled`; (4b) INSERT pending IMEDIATO (notes="Preparando briefing...",
`confirmation_timeout_at = now + seller_response_min`) fechando a janela de corrida; (5) briefing rico (LLM) →
update notes + lead.summary; `last_lead_received_at`/`total_leads_received` do vendedor.

**(c) Notificação** (orchestrator, após saga ok): `composeSellerMsg(agent, buildEtiquetas(...), fallbackInline)`
→ `maybeStripEmojis` → envia ao vendedor ("Responda Ok..."; variante re-aviso sem Ok); gerentes (até 2; completo =
mesma msg do vendedor + linha do vendedor; NÃO re-avisa gerente em renotify); etiqueta SDR; persistência
`status_crm`/colunas best-effort. Ordem v2 ≈ resposta ao lead → saga → notify vendedor → gerente → CRM.

**(d) Aceite "Ok"**: mensagem do vendedor chega no MESMO webhook → `processPedroV2Turn` → `identifyPedroContact`
(match de telefone tenant-wide em `ai_team_members` ativos) → `kind="seller"` → `isSellerAckText` (TRF-1: só aceite
de verdade; predicado puro em `phone.ts:136`) → `confirmSellerAck`: última pending do vendedor → lead
`assigned_to_id` + `status='em_atendimento'` + `origem='trafico_pago'` → transfer `confirmed` → resolve falhas →
`last_lead_received_at` → **expira pendings IRMÃS do mesmo lead**.

**(e) Timeout/repasse — DOIS motores simultâneos**: SEÇÃO 1 do cron (1min, só janela operacional): pendings com
`elapsed ≥ seller_response_min` (por agente), regras de janela (configurada vs legada; criado fora da janela =
auto-confirma, lead fica com o vendedor), defesas (status precisa ser `qualificado`/`transferido` senão EXPIRA;
assigned/confirmado → expira stale; vendedor recebeu lead mais novo → auto-confirma), claim atômico do expire,
avisa o perdedor, round-robin com **fallback tenant-wide quando o agent-scoped é vazio**, **notifica o PRÓXIMO
ANTES de commitar** (falha → volta pending), reatribui (assigned null + transferido) + nova pending (+15min).
`transfer-timeout-checker` (5min, janela): expira por `confirmation_timeout_at`, mesmas defesas, `pickNextSeller`
(rotação por transfers recentes, SEM fallback tenant-wide), nova pending +15min.

**(f) Follow-up v2** (SEÇÃO 2, 1min, 24h): scan `status IN (novo,interessado) AND assigned_to_id IS NULL AND
last_agent_reply_at IS NOT NULL AND last_user_reply_at IS NOT NULL AND last_agent_reply_at <= now-5min`; skip se
`last_user_reply_at >= last_agent_reply_at` (lead falou por último = cancela); usuários v2-allowlist →
`handleV2Followup`: regras `resolveAutomationRules`; skip `conversa_encerrada`; **âncora = `lead.last_agent_reply_at`**
(resposta nova do agente move a âncora → ciclo/stage resetam); stage em `pedro_conversation_state.state.followup`;
T1 reengage/T2 check_help (texto por mini-LLM com fallback fixo; envio VALIDADO antes de gravar stage), T3:
despedida ao lead PRIMEIRO (envio validado; falhou → ADIA tudo) → se `t3_transfers && transfer.enabled`: claim
`IN (novo,interessado)` → transferido + pending (`timeout = seller_response_min`) + notifica vendedor/gerentes
(mesmos templates) + `status_crm`; senão só despedida e stage 3. `markAgentReplyForLead` (orchestrator:752) é quem
escreve `last_agent_reply_at` — **só o v2 escreve esse campo**.

## 3. Matriz `comportamento real v2 → contrato v3 → lacuna → decisão`

| # | v2 real | Contrato v3 (missão) | Lacuna encontrada | Decisão |
|---|---|---|---|---|
| M1 | "Ok" do vendedor detectado DENTRO de `processPedroV2Turn` (identidade→ack) | Aceite Ok/timeout/repasse continuam do v2 | **P0: o bridge v3 intercepta ANTES do turno v2 e NÃO checa identidade** (`buildPedroV3BridgeTurn` aceita qualquer inbound) → "Ok" do vendedor viraria turno v3: v3 criaria LEAD para o telefone do vendedor, responderia comercialmente e o ack NUNCA confirmaria | **Guard de identidade no webhook ANTES do branch do bridge** (reusa `identifyPedroContact`; `kind="seller"` → segue fluxo v2 normal, não bridgeia). Mudança mínima em 1 arquivo v2 (webhook), gated ao piloto, com teste. Alternativa (v3 tratar ack nativo) rejeitada: duplicaria a máquina de aceite e violaria propriedade única |
| M2 | Follow-up v2 varre `ai_crm_leads` com `last_agent_reply_at NOT NULL` | v3 tem follow-up próprio T1/T2/T3; **zero double-send provado** | Quando o CRM write do v3 ligar, as linhas v3 têm `status='novo'`+`assigned NULL`+`last_user_reply_at` set → entrariam no scan SE tivessem `last_agent_reply_at` | **v3 NUNCA escreve `last_agent_reply_at`** (vira invariante testado da F2.49) → filtro NOT NULL exclui linhas v3 do motor v2 PARA SEMPRE. Reforço: crm_write do v3 mantém `last_user_reply_at`/`last_interaction_at` frescos a cada turno do lead (factual) → mesmo linha ADOTADA de era v2 cai no skip `user >= agent`. Dupla proteção determinística, sem tocar o cron v2 |
| M3 | Saga cria pending + lead `status='transferido'`; rotação EXIGE status `qualificado`/`transferido` (senão EXPIRA sem repasse) | Transferência v3 idempotente compatível com Ok/timeout/repasse do v2 | Se o claim v3 não espelhar `status='transferido'`, a SEÇÃO 1 mata a transfer (defesa 1) | Saga v3 espelha à risca: claim atômico `status='transferido'` com `assigned_to_id IS NULL`, pending com `confirmation_timeout_at = now + seller_response_min` (das `automation_rules` REAIS), notes=briefing. **Divergência deliberada: v3 NÃO grava `origem='trafico_pago'`** (v2 inventa origem; F2.47 fixou origem factual; nada na rotação/ack LÊ origem — seguro) |
| M4 | `chooseSellerForPedroTransfer` é SÓ agent-scoped; crons têm fallback tenant-wide | Vendedor anterior > round-robin justo | **Piloto: todos os vendedores têm `agent_id=NULL`** → a escolha v2 do orchestrator acharia NINGUÉM | Seleção v3 = anterior (tenant-wide por remote_jid) > roster agent-scoped > **fallback tenant-wide (espelha o cron, motor real de hoje)** > `no_active_seller` honesto (efeito falha observável, lead não fica mudo). Dedup por telefone + nunca-recebeu-primeiro reimplementados PUROS no v3 (mesma semântica do fix Icom) |
| M5 | LLM v2 emite sinais; sellerId sai da saga | **LLM NUNCA fornece sellerId**; promessa exige plano executável no MESMO turno | `HandoffPlan` atual do v3 = `{leadId, sellerId}` — exigiria sellerId na DECISÃO | Mudar plano: `handoff` carrega SÓ `leadId` (+reason tipado); o DISPATCHER resolve o vendedor (saga). `notify_seller` (dependsOn handoff) lê a pending criada e compõe/envia; gerente best-effort dentro do notify. `mark_handoff_completed` só com receipt `delivered` (CHECK do banco já exige) |
| M6 | Notificação via `sendPedroText` na instância do agente | v3 notifica vendedor+gerente | `WhatsAppEffectDispatcher` v3 tem `to` FIXO = lead | Novo dispatcher de handoff/notify reusando `UazapiWhatsAppSender.sendText` (aceita destino arbitrário) com credenciais da MESMA instância; normalização 10/11→55 já existe no sender |
| M7 | Templates `composeSellerMsg`/`composeGerenteMsg` + `buildEtiquetas` + `maybeStripEmojis` (linha só-de-etiqueta-vazia SOME) | Briefing factual com templates do portal, sem emoji se configurado | v3 tem `briefing-builder.ts` factual (F2.46) mas NÃO tem renderTemplate/etiquetas | Porta PURA no v3: `renderTemplate` (mesma semântica de remoção de linha), mapa de etiquetas alimentado pelo ESTADO v3 (interesse ≠ anúncio ≠ troca, slots conhecidos apenas), fallback = briefing factual F2.46. Piloto sem template → fallback no aceite; template provado offline |
| M8 | T1/T2 texto por mini-LLM avulso (gpt-4o-mini) fora do cérebro | P0 LLM-first: engine NÃO escreve resposta comercial | Follow-up v3 precisa de autor | Turno SISTÊMICO no PRÓPRIO cérebro central (frame de follow-up com objetivo T1/T2/T3 + validação/deny normais). Fallback determinístico NÃO-comercial só como degradação observável (regra do dono) |
| M9 | Âncora v2 = `last_agent_reply_at` do CRM + stage no state v2; cancel = lead falar | T1/T2/T3 por `automation_rules` com âncora/stage/idempotência; cancel imediato quando lead responde | v3 não tem timer | Timer no serviço v3 (scheduler interno): âncora = última resposta do agente ENTREGUE (receipt) por conversa v3; stage monotônico por âncora persistido no estado v3; ingest de mensagem do lead reseta ciclo; T3 transfere SÓ se `t3_transfers && transfer.enabled` (regras REAIS do banco); janela de repasse continua sendo problema do v2 (rotação) — follow-up roda 24h como no v2 |
| M10 | Pós-Ok, lead vira `em_atendimento` com dono; v2 tem protocolo 30min de silêncio | Decisão `returning_lead_renotify` no contrato | Comportamento v3 pós-transferência precisa ser definido | Saga v3 espelha o passo (1) do v2: lead com dono ativo → renotify com throttle 45min (transfer confirmed como marco). Silêncio pós-transferência do v3 = follow-ups CESSAM ao transferir (dono da automação passa ao humano); conversa v3 continua respondendo lead (sticky), com renotify throttled |
| M11 | 2 motores de rotação rodam JUNTOS (1min e 5min) sobre a MESMA pending | Zero duplicação | v3 não deve criar um TERCEIRO motor | v3 NÃO rotaciona: cria a pending e ENTREGA a rotação/aceite aos motores v2 existentes (compatibilidade por contrato de dados, não por código novo) |

## 4. Regra de propriedade única (FECHADA — pré-condição de implementação)

Dono da automação = quem responde o lead na conversa. Em qualquer instante, exatamente UM:

1. **Conversa v3 (piloto)**: v3 é o ÚNICO dono de follow-up e da DECISÃO de handoff. Garantias mecânicas:
   (a) v3 nunca escreve `last_agent_reply_at` → o scan do follow-up v2 NUNCA enxerga a linha (filtro NOT NULL);
   (b) v3 mantém `last_user_reply_at` fresco a cada turno do lead → mesmo linha adotada cai no skip do v2;
   (c) teste F2.49 fixa (a) e (b) como invariantes.
2. **Mensagem de VENDEDOR** (identidade por telefone em `ai_team_members`): NUNCA entra no v3 — o webhook resolve
   identidade ANTES do bridge e mantém o fluxo v2 (ack/assistente). Fecha M1.
3. **Pós-transferência**: a pending em `ai_lead_transfers` pertence à máquina v2 (Ok/rotação/timeout). O v3 não
   cria segundo motor de rotação (M11) e cessa follow-ups da conversa transferida; renotify throttled se o lead voltar.
4. **Conversas não-v3**: tudo intocado (v2 segue dono integral).

## 5. Riscos operacionais a declarar no aceite

- Com `PEDRO_V3_HANDOFF=on` no piloto, a transferência REAL notifica **Regia (***9350)** — vendedor real. Dono
  precisa avisá-la ou cadastrar vendedor de teste antes da conversa de aceite.
- Sem gerente_phone no piloto, o ramo de gerente só é provado OFFLINE.
- Vendedores do piloto com `agent_id=NULL` exercitam o fallback tenant-wide (M4) já no aceite — bom.

## 6. Próximo passo (dentro desta missão)

Implementação nas fases HF-1/2 (contrato de decisão + briefing/templates), HF-3/5 (saga+notify+compatibilidade Ok),
HF-4/6/7 (follow-up + flags `PEDRO_V3_HANDOFF`/`PEDRO_V3_FOLLOWUP` default OFF + F2.49 25 cenários + 2 smokes).
**PARAR para auditoria Codex antes de commit/push/deploy/SQL/flag.**
