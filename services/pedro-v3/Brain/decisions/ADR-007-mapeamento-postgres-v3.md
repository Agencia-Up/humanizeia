# ADR-007 - Mapeamento dos ports do Pedro v3 para PostgreSQL/Supabase

- Status: **Aprovado para instalacao pelo dono**.
- Data: 2026-06-27. Autor: Codex.
- Artefato: `Brain/sql/v3_schema.sql`.
- Verificador: `Brain/sql/v3_verify_after_install.sql`.

## Decisoes

1. O Postgres e a fonte duravel inicial. Redis/Valkey continua opcional e nao e necessario para a primeira versao.
2. `tenant_id` mapeia para `auth.users.id`, que e o `user_id` usado pelo Pedro v2 e pelas configuracoes atuais de estoque/agente.
3. IDs externos e de dominio (`conversationId`, `turnId`, `effectId`, `agentId`, `leadId`) permanecem `text`. O Kernel define `Id = string` e providers podem usar IDs nao-UUID.
4. O estado central continua em JSONB, mas possui envelope validado e uma coluna `version` para CAS.
5. O commit do turno e uma unica RPC: CAS do estado + history + decision + events + outbox + inbox done.
6. `outcome_applied_at` e reservado para sucesso entregue e aplicado ao estado. Resolucao operacional sem sucesso usa `terminal_at`.
7. Claims de inbox e outbox exigem lease/token. Isso impede dois workers de consumirem o mesmo trabalho.
8. O grafo do outbox e validado novamente no banco: dependencia inexistente e ciclo falham fechado.
9. RLS e `service_role`:
   - o runtime escreve somente com `service_role`;
   - autenticados podem ler dados nao sensiveis apenas do proprio tenant;
   - `v3_sensitive_vault` nao oferece leitura ao portal.
10. O cofre armazena apenas ciphertext, nonce, algoritmo e versao de chave. Criptografia/descriptografia pertencem ao adapter e nenhum valor cru pode chegar ao SQL.

## Mapeamento port -> tabela/RPC

| Port/operacao | Persistencia |
|---|---|
| `InboxStore.tryInsert` | `v3_ingest_inbox` -> `v3_inbox` (`ON CONFLICT DO NOTHING`) |
| `LeaseStore.acquire/renew/release` | `v3_acquire_lease`, `v3_renew_lease`, `v3_release_lease` -> `v3_leases` |
| `InboxStore.claimBurst` | `v3_claim_inbox_burst` com cutoff, lease e recuperacao de claim stale |
| `InboxStore.releaseClaim` | `v3_release_inbox_claim` |
| `StateStore.load` | `v3_conversation_state` |
| `UnitOfWork.commit` do turno | `v3_commit_turn` |
| `OutboxStore`/dispatcher | `v3_claim_outbox`, `v3_record_outbox_result`, `v3_requeue_outbox`, `v3_skip_outbox` |
| `EffectOutcomeCommit` | `v3_commit_effect_outcome` |
| media parcial | `v3_media_receipts` |
| replay/auditoria | `v3_state_history`, `v3_turn_events`, `v3_query_log`, `v3_decisions`, `v3_messages` |
| shadow | `v3_shadow_comparisons` |
| CPF/segredo | `v3_sensitive_vault` (ciphertext somente) |

## Diferenca intencional em relacao ao fake atual

O adapter in-memory da F2.3 usa `outcomeAppliedAt` para encerrar tambem `failed/skipped`. O schema nao replica essa ambiguidade: `outcome_applied_at` prova aplicacao de `on_success`; `terminal_at` encerra falhas, skips e sucessos sem mutacao. O adapter Postgres da F2.5 deve seguir o contrato do schema. Antes de trocar o fake pelo adapter real, a suite in-memory deve ganhar esse mesmo campo sem alterar o comportamento comercial.

## Validacao

- Schema executado integralmente em PostgreSQL embutido (`PGlite`).
- 25 testes de integracao SQL cobrem DDL, dedupe, redaction, lease, claim, CAS, transacao do turno, outbox, accepted/delivered, outcome idempotente, imutabilidade, rollback e RLS do cofre.
- A instalacao no Supabase permanece responsabilidade do dono.
