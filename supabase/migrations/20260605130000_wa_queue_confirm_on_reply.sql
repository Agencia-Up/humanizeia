-- ============================================================================
-- 05/06/2026 — Disparo em massa: contar RESPOSTA do cliente como confirmacao
-- ----------------------------------------------------------------------------
-- Problema: a "taxa de confirmacao" do disparo ficava sempre 0% porque nada
-- preenchia delivered_at/read_at/delivery_confirmed_at em wa_queue.
-- Decisao do Wander (05/06): contar a RESPOSTA do contato como confirmacao
-- (sinal mais confiavel). As respostas ja caem em wa_inbox (direction=incoming).
--
-- Solucao webhook-independente: um trigger em wa_inbox marca a linha
-- correspondente em wa_queue (mesmo user, telefone e instancia, enviada nos
-- ultimos 45 dias) com delivery_confirmed_at = now(). O relatorio/dashboard ja
-- le esse campo (categorize -> "entregue"), entao a taxa passa a funcionar.
-- NAO toca webhook nem o cerebro do Pedro.
-- ============================================================================

create or replace function mark_wa_queue_confirmed_on_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.direction = 'incoming' and NEW.phone is not null and NEW.phone <> '' then
    update wa_queue q
       set delivery_confirmed_at = now()
     where q.delivery_confirmed_at is null
       and q.user_id = NEW.user_id
       and q.phone = NEW.phone
       and (NEW.instance_id is null or q.instance_id = NEW.instance_id)
       and q.status <> 'failed'
       and q.sent_at is not null
       and q.sent_at > now() - interval '45 days';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_wa_queue_confirm_on_reply on wa_inbox;
create trigger trg_wa_queue_confirm_on_reply
after insert on wa_inbox
for each row execute function mark_wa_queue_confirmed_on_reply();

-- index pra o trigger casar rapido (prod-ready)
create index if not exists idx_wa_queue_user_phone_inst on wa_queue(user_id, phone, instance_id);

-- backfill: marca as respostas que ja chegaram (ultimos 45 dias)
update wa_queue q
   set delivery_confirmed_at = now()
 where q.delivery_confirmed_at is null
   and q.status <> 'failed'
   and q.sent_at is not null
   and q.sent_at > now() - interval '45 days'
   and exists (
     select 1 from wa_inbox wi
      where wi.direction = 'incoming'
        and wi.user_id = q.user_id
        and wi.phone = q.phone
        and (wi.instance_id is null or wi.instance_id = q.instance_id)
   );
