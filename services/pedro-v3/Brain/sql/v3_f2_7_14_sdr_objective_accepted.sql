-- Pedro v3 - F2.7.14 - objetivo de qualificacao accepted-safe
-- Aplicar manualmente no SQL Editor antes do deploy do codigo F2.7.14.
--
-- A ativacao registra qual pergunta o agente enviou. Nao afirma leitura pelo lead.
-- Oferta, foco, fotos, CRM, handoff, agenda, stage e mark_message_delivered
-- continuam exigindo receipt delivered.

begin;

create or replace function public.v3_required_receipt_level(p_kind text, p_on_success jsonb)
returns text
language sql
immutable
as $$
  select case
    when p_kind = 'send_message'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_on_success, '[]'::jsonb)) as e
        where coalesce(e->>'op', '') not in ('append_assistant_turn', 'activate_objective')
      )
    then 'accepted'
    else 'delivered'
  end
$$;

commit;

-- Verificador read-only esperado: all_ok = true.
with checks as (
  select jsonb_build_object(
    'assistant_only_accepted',
      public.v3_required_receipt_level('send_message', '[{"op":"append_assistant_turn"}]'::jsonb) = 'accepted',
    'objective_and_assistant_accepted',
      public.v3_required_receipt_level('send_message', '[{"op":"activate_objective"},{"op":"append_assistant_turn"}]'::jsonb) = 'accepted',
    'offer_still_delivered',
      public.v3_required_receipt_level('send_message', '[{"op":"record_offer"}]'::jsonb) = 'delivered',
    'media_still_delivered',
      public.v3_required_receipt_level('send_media', '[{"op":"mark_photos_sent"}]'::jsonb) = 'delivered',
    'handoff_still_delivered',
      public.v3_required_receipt_level('handoff', '[{"op":"mark_handoff_completed"}]'::jsonb) = 'delivered'
  ) as c
)
select c as checks, (not (c::text ~ ': ?false')) as all_ok from checks;