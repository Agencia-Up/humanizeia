-- Pedro v3 F2.56: receipts operacionais que o provider realmente garante.
-- Idempotente. Midia, CRM, handoff e agendamento continuam delivered-only.
begin;

create or replace function public.v3_required_receipt_level(p_kind text, p_on_success jsonb)
returns text
language sql
immutable
as $$
  select case
    when p_kind = 'notify_seller'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_on_success, '[]'::jsonb)) as e
        where e->>'op' is distinct from 'mark_handoff_completed'
      )
    then 'accepted'
    when p_kind = 'send_message'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_on_success, '[]'::jsonb)) as e
        where e->>'op' not in ('append_assistant_turn', 'activate_objective', 'mark_followup_sent')
      )
    then 'accepted'
    else 'delivered'
  end
$$;

commit;
