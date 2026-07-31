-- =============================================================================
-- Primeiro contato factual do vendedor apos confirmar (OK) uma transferencia.
--
-- Problema corrigido:
--   * o mesmo vendedor possui uma linha ai_team_members por agente;
--   * o lead pode estar atribuido a uma dessas linhas e a instancia WhatsApp a
--     outra linha irma;
--   * calcular a metrica no navegador, sobre a timeline carregada, produzia
--     falsos "Aguardando 1o contato" mesmo com mensagem do vendedor no banco.
--
-- Autoridade unica:
--   transferencia confirmada -> identidade canonica do vendedor -> todas as
--   instancias irmas -> primeira mensagem outgoing para o telefone do lead.
-- A funcao mede mensagem registrada no WhatsApp conectado. Nao afirma ligacao,
-- leitura pelo lead nem contato feito fora da Logos.
-- =============================================================================

drop function if exists public.get_lead_seller_contact_status(uuid);

create function public.get_lead_seller_contact_status(p_lead_id uuid)
returns table(
  transfer_id uuid,
  transfer_status text,
  transfer_created_at timestamptz,
  confirmed_at timestamptz,
  to_member_id uuid,
  seller_name text,
  seller_whatsapp_number text,
  equivalent_member_ids uuid[],
  seller_has_instance boolean,
  seller_connected boolean,
  connected_instance_id uuid,
  first_contact_at timestamptz,
  first_contact_message_id uuid,
  first_contact_instance_id uuid,
  first_contact_source text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_tenant uuid;
  v_is_seller boolean := false;
  v_is_manager boolean := false;
  v_member_ids uuid[] := '{}';
  v_lead record;
  v_transfer record;
  v_target record;
  v_target_phone_key text;
  v_seller_ids uuid[] := '{}';
  v_instance_ids uuid[] := '{}';
  v_first record;
  v_confirmed_at timestamptz;
begin
  if v_uid is null then return; end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;

  if coalesce(public.is_current_user_superadmin(), false) then
    select l.* into v_lead
    from public.ai_crm_leads l
    where l.id = p_lead_id;
    if not found then return; end if;
    v_tenant := v_lead.user_id;
  elsif coalesce(v_role, '') = 'seller' then
    v_is_seller := true;
    v_tenant := public.get_seller_master_user_id();
    select coalesce(array_agg(m.id), '{}'::uuid[]),
           coalesce(bool_or(coalesce(m.is_manager, false)), false)
      into v_member_ids, v_is_manager
    from public.ai_team_members m
    where m.auth_user_id = v_uid
      and m.user_id = v_tenant
      and coalesce(m.active_in_system, true) <> false
      and m.removed_at is null;

    select l.* into v_lead
    from public.ai_crm_leads l
    where l.id = p_lead_id and l.user_id = v_tenant;
    if not found then return; end if;

    if not v_is_manager
       and not (v_lead.assigned_to_id = any(v_member_ids)) then
      return;
    end if;
  else
    v_tenant := v_uid;
    select l.* into v_lead
    from public.ai_crm_leads l
    where l.id = p_lead_id and l.user_id = v_tenant;
    if not found then return; end if;
  end if;

  if v_lead.id is null or v_tenant is null then return; end if;

  select t.* into v_transfer
  from public.ai_lead_transfers t
  where t.user_id = v_tenant
    and t.lead_id = p_lead_id
    and t.transfer_status in ('pending', 'confirmed')
  order by t.created_at desc
  limit 1;

  if not found then return; end if;

  select m.* into v_target
  from public.ai_team_members m
  where m.id = v_transfer.to_member_id and m.user_id = v_tenant;

  if not found then return; end if;

  v_target_phone_key := public.logos_phone_key(v_target.whatsapp_number);

  -- Identidade da pessoa, nao da linha por agente. auth_user_id cobre troca de
  -- formatacao/numero; o telefone canonico cobre linhas antigas ainda sem login.
  select coalesce(array_agg(distinct m.id), array[v_transfer.to_member_id]::uuid[])
    into v_seller_ids
  from public.ai_team_members m
  where m.user_id = v_tenant
    and (
      m.id = v_transfer.to_member_id
      or (v_target.auth_user_id is not null and m.auth_user_id = v_target.auth_user_id)
      or (v_target_phone_key is not null
          and public.logos_phone_key(m.whatsapp_number) = v_target_phone_key)
    );

  select coalesce(array_agg(i.id), '{}'::uuid[])
    into v_instance_ids
  from public.wa_instances i
  where i.user_id = v_tenant
    and i.seller_member_id = any(v_seller_ids);

  select i.id into connected_instance_id
  from public.wa_instances i
  where i.id = any(v_instance_ids)
    and i.status = 'connected'
    and coalesce(i.is_active, true) <> false
  order by i.updated_at desc nulls last, i.created_at desc nulls last
  limit 1;

  transfer_id := v_transfer.id;
  transfer_status := case
    when v_transfer.is_confirmed = true or v_transfer.transfer_status = 'confirmed' then 'confirmed'
    else 'pending'
  end;
  transfer_created_at := v_transfer.created_at;
  v_confirmed_at := case
    when transfer_status = 'confirmed' then coalesce(v_transfer.confirmed_at, v_transfer.created_at)
    else null
  end;
  confirmed_at := v_confirmed_at;
  to_member_id := v_transfer.to_member_id;
  seller_name := v_target.name;
  seller_whatsapp_number := v_target.whatsapp_number;
  equivalent_member_ids := v_seller_ids;
  seller_has_instance := cardinality(v_instance_ids) > 0;
  seller_connected := connected_instance_id is not null;

  if v_confirmed_at is not null and cardinality(v_instance_ids) > 0 then
    select c.contacted_at, c.message_id, c.instance_id, c.source
      into v_first
    from (
      -- Fonte primaria e em tempo real.
      select i.created_at as contacted_at, i.id as message_id,
             i.instance_id, 'wa_inbox'::text as source, 1 as source_order
      from public.wa_inbox i
      where i.user_id = v_tenant
        and i.instance_id = any(v_instance_ids)
        and i.direction = 'outgoing'
        and public.logos_phone_key(i.phone) =
            public.logos_phone_key(split_part(v_lead.remote_jid, '@', 1))
        and i.created_at >= v_confirmed_at

      union all

      -- Rede historica: cobre mensagem importada quando o webhook nao preservou
      -- a linha em wa_inbox. Instancia de vendedor + outgoing e evidencia humana.
      select s.wa_timestamp, s.id, s.instance_id,
             'wa_synced_messages'::text, 2
      from public.wa_synced_messages s
      where s.tenant_id = v_tenant
        and s.instance_id = any(v_instance_ids)
        and s.direction = 'outgoing'
        and s.actor_source in ('humano_manual', 'desconhecido')
        and public.logos_phone_key(s.phone_canonical) =
            public.logos_phone_key(split_part(v_lead.remote_jid, '@', 1))
        and s.wa_timestamp >= v_confirmed_at
    ) c
    where c.contacted_at is not null
    order by c.contacted_at, c.source_order
    limit 1;

    first_contact_at := v_first.contacted_at;
    first_contact_message_id := v_first.message_id;
    first_contact_instance_id := v_first.instance_id;
    first_contact_source := v_first.source;
  end if;

  return next;
end
$function$;

comment on function public.get_lead_seller_contact_status(uuid) is
  'Retorna a transferencia ativa e a primeira mensagem registrada do vendedor apos o OK, resolvendo linhas irmas de ai_team_members por auth/WhatsApp canonico.';

revoke all on function public.get_lead_seller_contact_status(uuid) from public, anon;
grant execute on function public.get_lead_seller_contact_status(uuid) to authenticated, service_role;
