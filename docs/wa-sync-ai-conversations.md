# Sincronização da caixa UAZAPI → "Conversas IA" (pacote consolidado)

Branch isolado `feat/wa-sync-ai-conversations` (base `origin/main`). **Nada aplicado/deployado/pushado na main.** Aguarda uma única autorização.

## 1. Commits e arquivos por fase
| Fase | Commit | Arquivos |
|---|---|---|
| F1 schema+auditoria | `cd7eebb5` | `migrations/20260726120000_wa_sync_ai_conversations.sql` |
| F2 syncer | `12037eff` | `functions/wa-sync-ai-conversations/index.ts`, `migrations/20260726123000_wa_sync_authorship_helper.sql` |
| F3 reconciliação | `53c5e424` | `functions/wa-sync-reconcile/index.ts`, `migrations/20260726124000_wa_sync_reconcile_cron.sql` |
| F4 RPC/timeline | `7a48415b` | `migrations/20260726125000_conversas_ia_synced_source.sql` |
| F5 frontend | `e1d26edb` | `functions/_shared/wa-sync/classify.ts`, `components/pedro/AgentInboxTab.tsx`, syncer refatorado |
| F6 testes+docs | (este) | `functions/_shared/wa-sync/classify.offline-test.ts`, `docs/wa-sync-ai-conversations.md` |

## 2. Migrations (todas aditivas/idempotentes; nenhuma altera migration antiga)
- `20260726120000` — `wa_sync_checkpoint`, `wa_sync_run`, `wa_synced_messages` (única `(tenant,instance,provider_message_id)`), RLS por tenant.
- `20260726123000` — `get_v3_sent_signatures_bulk` (autoria ia_v3).
- `20260726124000` — cron `wa-sync-reconcile-10min`.
- `20260726125000` — índice funcional + `get_ai_conversation_messages_v2` (DROP+CREATE, +`actor_source`/`ingestion_source`, fonte `synced`).

## 3. Contrato UAZAPI validado (read-only, instância piloto `wa-pre`)
- Base `https://logosiabrasilcom.uazapi.com`, header `token`.
- `POST /chat/find {limit,offset,sort:'-wa_lastMsgTimestamp'}` → chats (paginação limit+offset).
- `POST /message/find {where:{chatid},limit,sort:'-messageTimestamp'}` → mensagens.
- Chat: `wa_chatid`(JID), `wa_isGroup`, `phone`, `wa_name`. Msg: `messageid`(ID provedor), `fromMe`, `messageTimestamp`(ms), `messageType`, `text`, `fileURL`.
- **Gap provado:** UAZAPI `wa-pre` = **1184 conversas privadas** vs `wa_inbox` = **152** telefones.

## 4. Fluxo da sincronização
`cron 10min → wa-sync-reconcile` (só tenants da allowlist `WA_SYNC_TENANT_IDS`) → para cada instância de IA (não-vendedor, vinculada a agente): `wa-sync-ai-conversations` → lock por (tenant,instância) → `/chat/find` paginado → exclui grupo/status/broadcast/newsletter/interno → `/message/find` paginado (janela 30d) → classifica autoria por evidência → **upsert idempotente** em `wa_synced_messages` (por `messageid`) → atualiza `ai_conversation_index` (sem CRM) → checkpoint por chat. A timeline (`get_ai_conversation_messages_v2`) faz UNION da fonte `synced` com dedup pelo ID do provedor.

## 5. Testes e resultados
- **Automatizado** `classify.offline-test.ts` (Deno): **20/20 OK** — canonical (com/sem 55, sem last-8 puro), exclusão de grupo/status/broadcast, tipos de mídia, timestamp s/ms, e **autoria por evidência** (cliente/ia_v3/humano_manual; nunca por instância).
- Type-check Deno: **zero erros** em syncer, dispatcher e classify.
- **Preparados para o piloto (WhatsApp real, itens 1-15):** ver §10.

## 6. Prova: sincronização NÃO aciona o V3
`grep` no syncer+dispatcher por `PEDRO_V3|callPedroV3|v3_effect_outbox(escrita)|ai_crm_leads|crm_leads|send/text|/message/send|follow-up|transfer|openai|anthropic` → **vazio**. O syncer **escreve só** em `wa_synced_messages`, `ai_conversation_index`, `wa_sync_checkpoint`, `wa_sync_run`. `wa_synced_messages` é **tabela dedicada**: nenhum webhook/trigger/worker a lê → mensagem importada nunca vira mensagem nova nem entra na fila do V3.

## 7. Prova de idempotência
Única `(tenant_id, instance_id, provider_message_id)` + `upsert(..., ignoreDuplicates:true)`. Reexecução conta `duplicates` e importa `0` novas. Validar no piloto: rodar 2×, 2ª rodada `messages_imported=0`, `duplicates=N`.

## 8. Prova de isolamento entre tenants
Toda query filtra `tenant_id`/`user_id`. O syncer valida `instance.user_id === tenant_id` (senão `tenant_instance_mismatch`). RLS de leitura por tenant (master/superadmin/membro). `logos_internal_keys` exclui números internos. Duas contas com mesmo telefone: linhas separadas por `tenant_id` na única.

## 9. EXPLAIN ANALYZE
Baseline dos branches atuais (índice usado, `cost 0.42..10.06`). **O EXPLAIN ANALYZE completo (com o branch `synced` + índice funcional `wa_synced_messages_phonekey_idx`) só é possível após aplicar F1+F4** (a tabela/função não existem antes) — será executado como **1º passo pós-migration, pré-piloto**, e anexado.

## 10. Plano do piloto (conta WA) — 15 testes
Setar `WA_SYNC_TENANT_IDS=9420eb5d-...` (allowlist). Depois validar: (1) agente ativo+cliente; (2) agente inativo+cliente; (3) conversa pausada; (4) IA global off; (5) resposta V3→IA; (6) resposta manual WhatsApp→atendente; (7) resposta manual painel→atendente; (8) conversa sem CRM aparece; (9) conversa antiga só na UAZAPI é importada; (10) mensagem repetida webhook+sync não duplica; (11) 2 contas mesmo telefone isoladas; (12) áudio/imagem/documento; (13) instância de vendedor NÃO sincroniza; (14) sync não dispara IA/follow-up/transfer; (15) reexecução importa 0 duplicatas.
**Antes/depois:** total chats UAZAPI, total `ai_conversation_index`, total RPC, importadas, duplicadas, falhas, sem-CRM, classificação IA/manual/cliente, +3 conversas conferidas manualmente.

## 11. Riscos e rollback
- Risco: dedup por assinatura (fallback) pode ocultar mensagem legítima idêntica em <180s — mitigado (fallback só quando não há ID do provedor). Risco: variação do 9º dígito pode duplicar conversa no índice (comportamento já existente do índice).
- **Rollback (sem perda):** desligar cron (`cron.unschedule('wa-sync-reconcile-10min')`); limpar `WA_SYNC_TENANT_IDS` (dispatcher vira no-op); as tabelas são aditivas e podem ser dropadas; a RPC volta à versão anterior (guardada). Nada destrói dados existentes.

## 12. Ordem exata de deploy (pós-autorização)
1. **Migrations** F1→F2helper→F4 (schema+RPC+índice). *(cron F3 por último)*
2. **EXPLAIN ANALYZE** completo da RPC (pré-piloto).
3. **Edge Functions** `wa-sync-ai-conversations` e `wa-sync-reconcile`.
4. **Piloto**: setar `WA_SYNC_TENANT_IDS=WA`, invocar o syncer 1× manual (dry-run depois real), rodar os 15 testes.
5. **Cron** F3 (`20260726124000`) — liga a reconciliação 10min.
6. **RPC** já no passo 1; **Frontend** (Rebuild) por último.
7. Monitorar `wa_sync_run`; expandir allowlist gradualmente.

## 13. Frontend — itens finalizados vs pendentes (Rebuild)
Feito: empty-state honesto (não exige agente ativo/CRM); autoria por `actor_source` (ia_v3→IA, humano_manual→atendente, desconhecido→"Enviado"). Pendente (finalizar no Rebuild, sem risco de dados): botão "Sincronizar conversas" (master/gerente), "Limpar filtros", filtros ativos visíveis, cartão de estado da última sincronização (`wa_sync_run`).
