-- ============================================================================
-- ETAPA 1 — Processo EXPLICITO de classificacao de instancias (NAO APLICADA).
--
-- Este arquivo NAO classifica ninguem. Ele cria o mecanismo para que a
-- classificacao seja um ato humano, deliberado e auditado — nunca inferido por
-- nome de instancia, nunca por backfill automatico.
--
-- Valores aceitos pelo CHECK atual de wa_instances.purpose (conferido em prod
-- 30/07/2026): NULL | 'agent' | 'bulk_sender' | 'manual' | 'test'.
-- 'sync_only' NAO existe e NAO e introduzido aqui.
--
-- ADITIVO e reversivel: cria 1 tabela de auditoria + 1 RPC + 1 correcao
-- defensiva em wa_campaigns.instance_id (0 linhas afetadas hoje).
-- ============================================================================

-- ── 1. Auditoria: quem classificou o que, quando e por que ──────────────────
create table if not exists public.wa_instance_purpose_audit (
  id           uuid primary key default gen_random_uuid(),
  instance_id  uuid not null,
  user_id      uuid not null,
  purpose_de   text,
  purpose_para text,
  motivo       text,
  alterado_por uuid,
  created_at   timestamptz not null default now()
);
alter table public.wa_instance_purpose_audit enable row level security;

drop policy if exists wa_instance_purpose_audit_sel on public.wa_instance_purpose_audit;
create policy wa_instance_purpose_audit_sel on public.wa_instance_purpose_audit
  for select to authenticated using (
    user_id = auth.uid() or coalesce(public.is_current_user_superadmin(), false)
  );

-- ── 2. RPC de classificacao (unico caminho autorizado) ──────────────────────
-- Regras que a propria funcao impoe:
--   * so o dono da conta ou superadmin classifica;
--   * instancia de VENDEDOR nunca pode virar 'bulk_sender';
--   * valor precisa existir no CHECK;
--   * toda mudanca vira linha de auditoria.
create or replace function public.set_wa_instance_purpose(
  p_instance_id uuid,
  p_purpose text,
  p_motivo text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_inst public.wa_instances%rowtype;
  v_antes text;
begin
  if v_uid is null then raise exception 'nao autenticado'; end if;

  select * into v_inst from public.wa_instances where id = p_instance_id;
  if not found then raise exception 'instancia nao encontrada'; end if;

  if v_inst.user_id <> v_uid and not coalesce(public.is_current_user_superadmin(), false) then
    raise exception 'sem permissao: apenas o dono da conta ou um superadmin classificam instancias';
  end if;

  if p_purpose is not null and p_purpose not in ('agent','bulk_sender','manual','test') then
    raise exception 'purpose invalido: use agent, bulk_sender, manual, test ou NULL';
  end if;

  -- INVARIANTES DE SEGURANCA (nao dependem da tela)
  -- 1) numero de vendedor nunca vira linha de campanha nem linha de IA.
  if v_inst.seller_member_id is not null and p_purpose in ('bulk_sender','agent') then
    raise exception 'BLOQUEADO: o WhatsApp pessoal de um vendedor nunca pode ser linha de campanha nem linha de IA';
  end if;

  -- 2) instancia vinculada a AGENTE ATIVO nunca vira linha de campanha.
  if p_purpose = 'bulk_sender' and exists (
       select 1 from public.wa_ai_agents a
       where a.user_id = v_inst.user_id and coalesce(a.is_active,false)
         and (a.instance_id = v_inst.id or v_inst.id = any(coalesce(a.instance_ids,'{}')))
     ) then
    raise exception 'BLOQUEADO: este numero esta vinculado a um agente de IA ativo e nao pode virar linha de campanha';
  end if;

  v_antes := v_inst.purpose;
  update public.wa_instances set purpose = p_purpose where id = p_instance_id;

  insert into public.wa_instance_purpose_audit (instance_id, user_id, purpose_de, purpose_para, motivo, alterado_por)
  values (p_instance_id, v_inst.user_id, v_antes, p_purpose, nullif(btrim(coalesce(p_motivo,'')),''), v_uid);

  return jsonb_build_object('instance_id', p_instance_id, 'de', v_antes, 'para', p_purpose);
end;
$$;

revoke all on function public.set_wa_instance_purpose(uuid, text, text) from public, anon;
grant execute on function public.set_wa_instance_purpose(uuid, text, text) to authenticated, service_role;

-- ── 3. Defensivo: campanha nunca fica fixada em numero de vendedor ──────────
-- Hoje afeta 0 linhas (nenhuma campanha tem instance_id preenchido). Existe para
-- que uma campanha herdada/criada assim nao trave a fila no futuro. O codigo do
-- processador ja ignora o pin inelegivel; isto limpa o dado.
update public.wa_campaigns c
set instance_id = null
from public.wa_instances i
where i.id = c.instance_id and i.seller_member_id is not null;

comment on function public.set_wa_instance_purpose(uuid, text, text) is
  'Unico caminho autorizado para classificar a finalidade de uma instancia. Nunca classifique por nome nem por backfill: numero de vendedor jamais vira bulk_sender, e toda mudanca fica em wa_instance_purpose_audit.';
