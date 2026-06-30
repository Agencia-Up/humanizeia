-- ============================================================================
-- Pedro v3 — Reset de conversa do piloto (ferramenta de TESTE).
-- Apaga TODO o estado v3 de um tenant (inbox, estado, decisoes, outbox, roteamento,
-- historico, etc.) p/ recomecar um teste "do zero", como conversa nova.
--
-- O MCP do Supabase e READ-ONLY -> o Claude NAO consegue executar isto; voce roda
-- no SQL editor. Idempotente, security definer, service-role only. NAO toca o v2.
--
-- INSTALAR (uma vez): rode este arquivo inteiro.
-- RESETAR (sempre que precisar de teste novo): rode SO esta linha ->
--   select public.v3_reset_pilot_conversation('ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0'::uuid);
-- Retorna um JSON com quantas linhas apagou por tabela.
--
-- Ordem das deletes respeita as 2 FKs reais entre tabelas v3:
--   v3_media_receipts -> v3_effect_outbox ; v3_state_history -> v3_conversation_state.
-- ============================================================================

create or replace function public.v3_reset_pilot_conversation(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb := '{}'::jsonb;
  n integer;
begin
  delete from public.v3_media_receipts     where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('media_receipts', n);
  delete from public.v3_state_history       where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('state_history', n);
  delete from public.v3_turn_events         where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('turn_events', n);
  delete from public.v3_query_log           where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('query_log', n);
  delete from public.v3_decisions           where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('decisions', n);
  delete from public.v3_shadow_comparisons  where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('shadow_comparisons', n);
  delete from public.v3_sensitive_vault     where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('sensitive_vault', n);
  delete from public.v3_messages            where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('messages', n);
  delete from public.v3_effect_outbox       where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('effect_outbox', n);
  delete from public.v3_inbox               where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('inbox', n);
  delete from public.v3_leases              where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('leases', n);
  delete from public.v3_conversation_routing where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('conversation_routing', n);
  delete from public.v3_conversation_state  where tenant_id = p_tenant_id; get diagnostics n = row_count; result := result || jsonb_build_object('conversation_state', n);
  return result;
end;
$$;

revoke all on function public.v3_reset_pilot_conversation(uuid) from public;
revoke all on function public.v3_reset_pilot_conversation(uuid) from anon;
revoke all on function public.v3_reset_pilot_conversation(uuid) from authenticated;
grant execute on function public.v3_reset_pilot_conversation(uuid) to service_role;

-- RESET AGORA (descomente / rode separado no editor):
-- select public.v3_reset_pilot_conversation('ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0'::uuid);
