-- ============================================================================
-- Pedro v3 — R13-D/1 — Promoção accepted-safe da WorkingMemory (patch ADITIVO). REVISADO pós-auditoria Codex.
--
-- Escrita AVULSA da WorkingMemory (fora do commit de turno) quando um send_media recebe receipt ACCEPTED no
-- dispatch. Correções da auditoria:
--   - recebe SOMENTE `p_next_working_memory jsonb` (a WorkingMemory), NUNCA o ConversationState completo;
--   - carrega o estado ATUAL no banco e atualiza SÓ 4 chaves: workingMemory, appliedAcceptedEffectIds, version,
--     updatedAt — PRESERVANDO byte-a-byte todos os demais campos do estado (jsonb_set pontual);
--   - valida efeito: existe, é send_media desta conversa/tenant, status=succeeded, receipt_level in (accepted,delivered);
--   - IDEMPOTENTE server-side: se o effect_id já está em appliedAcceptedEffectIds -> NO-OP (applied=false);
--   - conflito de versão -> applied=false (o app recarrega e reprocessa); NÃO toca o photoLedger (isso é do delivered).
--
-- Execute no SQL Editor SOMENTE depois de v3_schema.sql + patches anteriores. Idempotente. Segurança: security
-- definer, tenant-scoped, revoke public / grant service_role. Mesma assinatura de TIPOS (uuid,text,text,bigint,jsonb,
-- timestamptz) do rascunho anterior; o DROP garante troca limpa do nome do parâmetro (p_next_state -> p_next_working_memory).
-- ============================================================================

begin;

drop function if exists public.v3_commit_working_memory_outcome(uuid, text, text, bigint, jsonb, timestamptz);

create function public.v3_commit_working_memory_outcome(
  p_tenant_id uuid,
  p_conversation_id text,
  p_effect_id text,
  p_expected_version bigint,
  p_next_working_memory jsonb,
  p_now timestamptz default now()
)
returns table(state_version bigint, applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect public.v3_effect_outbox%rowtype;
  v_state_record public.v3_conversation_state%rowtype;
  v_applied_ids jsonb;
  v_state jsonb;
  v_new_version bigint;
begin
  -- SEGURANÇA: o efeito precisa ser um send_media REAL desta conversa/tenant, JÁ com receipt (succeeded + accepted|delivered).
  select * into v_effect
  from public.v3_effect_outbox
  where tenant_id = p_tenant_id and conversation_id = p_conversation_id and effect_id = p_effect_id
  for update;

  if not found then
    raise exception 'v3_wm_effect_not_found:%', p_effect_id using errcode = 'P0002';
  end if;
  if v_effect.kind <> 'send_media' then
    raise exception 'v3_wm_effect_kind_invalid:%', p_effect_id using errcode = '22023';
  end if;
  if v_effect.status <> 'succeeded'
     or v_effect.receipt_level is null
     or v_effect.receipt_level not in ('accepted', 'delivered')
  then
    raise exception 'v3_wm_effect_not_accepted:%', p_effect_id using errcode = '22023';
  end if;
  if p_next_working_memory is null or jsonb_typeof(p_next_working_memory) <> 'object' then
    raise exception 'v3_wm_working_memory_required:%', p_effect_id using errcode = '22023';
  end if;

  select * into v_state_record
  from public.v3_conversation_state
  where tenant_id = p_tenant_id and conversation_id = p_conversation_id
  for update;

  if not found then
    raise exception 'v3_wm_state_not_found:%', p_conversation_id using errcode = 'P0002';
  end if;

  v_applied_ids := coalesce(v_state_record.state -> 'appliedAcceptedEffectIds', '[]'::jsonb);

  -- DUPLICADO -> NO-OP idempotente (o efeito já foi promovido; nunca reaplica nem incrementa versão).
  if v_applied_ids @> to_jsonb(array[p_effect_id]) then
    state_version := v_state_record.version;
    applied := false;
    return next;
    return;
  end if;

  -- Conflito de versão -> applied=false (sem escrita; o app recarrega e reprocessa dentro do limite).
  if v_state_record.version <> p_expected_version then
    state_version := v_state_record.version;
    applied := false;
    return next;
    return;
  end if;

  v_new_version := p_expected_version + 1;
  -- Atualiza SOMENTE workingMemory + appliedAcceptedEffectIds + version + updatedAt. PRESERVA byte-a-byte o resto
  -- (slots, vehicleContext, photoLedger, recentTurns, offers, currentObjective, plannedObjectives, etc.).
  v_state := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(v_state_record.state, '{workingMemory}', p_next_working_memory, true),
        '{appliedAcceptedEffectIds}', v_applied_ids || to_jsonb(array[p_effect_id]), true
      ),
      '{version}', to_jsonb(v_new_version), true
    ),
    '{updatedAt}', to_jsonb(p_now::text), true
  );

  update public.v3_conversation_state
     set state = v_state, version = v_new_version, updated_at = p_now
   where tenant_id = p_tenant_id and conversation_id = p_conversation_id;

  state_version := v_new_version;
  applied := true;
  return next;
  return;
end;
$$;

-- Produção: função de escrita só do backend (service_role). Fecha explicitamente public/anon/authenticated.
revoke all on function public.v3_commit_working_memory_outcome(uuid, text, text, bigint, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.v3_commit_working_memory_outcome(uuid, text, text, bigint, jsonb, timestamptz) to service_role;

comment on function public.v3_commit_working_memory_outcome(uuid, text, text, bigint, jsonb, timestamptz) is
  'R13-D (audit Codex): promoção accepted-safe da WorkingMemory. Recebe SÓ a WorkingMemory; atualiza só workingMemory/appliedAcceptedEffectIds/version/updatedAt (preserva o resto); idempotente por appliedAcceptedEffectIds; não toca photoLedger.';

commit;
