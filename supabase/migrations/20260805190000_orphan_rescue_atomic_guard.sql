-- =============================================================================
-- Resgate de orfaos: claim atomico e conservador.
--
-- Incidente real (Monaco, 05/08/2026): um lead ja confirmado e atendido por
-- Ronye apareceu momentaneamente como transferido/sem dono e foi reatribuido
-- pelo rescue-orphan-transfers ao Diego. O vendedor original continuou falando
-- por sua linha pessoal, enquanto o CRM mostrava a segunda atribuicao.
--
-- A funcao abaixo e a unica escrita do resgate. Ela trava o lead e recusa:
--   * estado diferente de transferido + sem dono;
--   * qualquer transferencia pendente;
--   * qualquer transferencia confirmada anterior;
--   * contato humano ja registrado por uma instancia de vendedor neste ciclo.
-- Assim, lista carregada antes de um "Ok" nunca consegue sobrescrever o dono.
-- =============================================================================

create or replace function public.claim_orphan_rescue(
  p_user_id uuid,
  p_lead_id uuid,
  p_to_member_id uuid,
  p_from_member_id uuid default null
)
returns table(claimed boolean, reason text, transfer_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_lead public.ai_crm_leads%rowtype;
  v_transfer_id uuid;
  v_status_crm text;
begin
  select l.*
    into v_lead
  from public.ai_crm_leads l
  where l.id = p_lead_id
    and l.user_id = p_user_id
  for update;

  if not found then
    return query select false, 'lead_missing'::text, null::uuid;
    return;
  end if;

  if v_lead.status is distinct from 'transferido' then
    return query select false, 'lead_not_transferido'::text, null::uuid;
    return;
  end if;

  if v_lead.assigned_to_id is not null then
    return query select false, 'lead_already_assigned'::text, null::uuid;
    return;
  end if;

  if not exists (
    select 1
    from public.ai_team_members m
    where m.id = p_to_member_id
      and m.user_id = p_user_id
      and coalesce(m.is_active, false) = true
  ) then
    return query select false, 'seller_not_active'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1
    from public.ai_lead_transfers t
    where t.user_id = p_user_id
      and t.lead_id = p_lead_id
      and (coalesce(t.is_confirmed, false) = true or t.transfer_status = 'confirmed')
  ) then
    return query select false, 'confirmed_transfer'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1
    from public.ai_lead_transfers t
    where t.user_id = p_user_id
      and t.lead_id = p_lead_id
      and coalesce(t.is_confirmed, false) = false
      and t.transfer_status = 'pending'
  ) then
    return query select false, 'pending_transfer'::text, null::uuid;
    return;
  end if;

  -- Se um WhatsApp pessoal de vendedor ja falou com o lead depois da criacao
  -- deste ciclo no CRM, existe atendimento humano real mesmo que a projecao do
  -- responsavel esteja inconsistente. O resgate automatico falha fechado.
  if exists (
    select 1
    from public.wa_inbox w
    join public.wa_instances i
      on i.id = w.instance_id
     and i.user_id = p_user_id
     and i.seller_member_id is not null
    where w.user_id = p_user_id
      and w.direction = 'outgoing'
      and w.created_at >= v_lead.created_at
      and public.logos_phone_key(w.phone) =
          public.logos_phone_key(split_part(v_lead.remote_jid, '@', 1))
  ) then
    return query select false, 'seller_already_contacted'::text, null::uuid;
    return;
  end if;

  v_status_crm := case
    when lower(coalesce(v_lead.status_crm, '')) in ('', 'inativo', 'perdido', 'transferido') then 'novo'
    else v_lead.status_crm
  end;

  insert into public.ai_lead_transfers (
    user_id,
    lead_id,
    from_member_id,
    to_member_id,
    transfer_reason,
    notes,
    transfer_status,
    is_confirmed
  ) values (
    p_user_id,
    p_lead_id,
    p_from_member_id,
    p_to_member_id,
    'orphan_rescue',
    'Reencaminhado pelo resgate de leads orfaos (atribuido direto ao vendedor).',
    'confirmed',
    true
  )
  returning id into v_transfer_id;

  update public.ai_crm_leads
  set assigned_to_id = p_to_member_id,
      status = 'em_atendimento',
      status_crm = v_status_crm,
      last_interaction_at = now()
  where id = p_lead_id
    and user_id = p_user_id
    and status = 'transferido'
    and assigned_to_id is null;

  if not found then
    raise exception 'orphan_rescue_claim_lost';
  end if;

  update public.ai_team_members
  set last_lead_received_at = now()
  where id = p_to_member_id
    and user_id = p_user_id;

  return query select true, 'claimed'::text, v_transfer_id;
end
$function$;

comment on function public.claim_orphan_rescue(uuid, uuid, uuid, uuid) is
  'Claim atomico do resgate de orfaos. Nunca reatribui lead com dono, handoff pendente/confirmado ou contato humano registrado.';

revoke all on function public.claim_orphan_rescue(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_orphan_rescue(uuid, uuid, uuid, uuid) to service_role;
