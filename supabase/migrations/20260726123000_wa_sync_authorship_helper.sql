-- ============================================================================
-- F2 (apoio) — autoria ia_v3 POR EVIDENCIA, nunca pela instancia.
-- Retorna as "assinaturas" (telefone canonico + bucket de minuto + texto) do que o
-- Pedro V3 EFETIVAMENTE enviou (v3_effect_outbox) para o tenant, dentro da janela.
-- O syncer casa cada mensagem outgoing sincronizada com essas assinaturas: casou ->
-- ia_v3; nao casou -> humano_manual. Sem CRM/conversa V3 = nao ha assinatura = manual.
-- Read-only. SECURITY DEFINER (o syncer roda como service_role, mas mantemos o gate).
-- ============================================================================
create or replace function public.get_v3_sent_signatures_bulk(
  p_tenant uuid,
  p_since  timestamptz
) returns table(phone_key text, minute_bucket bigint, sig text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    public.logos_phone_key(split_part(l.remote_jid, '@', 1))                as phone_key,
    (extract(epoch from eo.created_at)::bigint / 60)                        as minute_bucket,
    lower(btrim(coalesce(eo.payload->>'text', '')))                         as sig
  from public.v3_effect_outbox eo
  join public.v3_conversation_state cs on cs.conversation_id = eo.conversation_id
  join public.ai_crm_leads l           on l.id::text = cs.lead_id
  where eo.tenant_id = p_tenant
    and eo.kind in ('send_message', 'send_media')
    and eo.created_at >= p_since
    and coalesce(eo.payload->>'text', '') <> '';
$$;

grant execute on function public.get_v3_sent_signatures_bulk(uuid, timestamptz) to service_role;
