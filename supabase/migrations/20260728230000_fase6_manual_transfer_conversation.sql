-- =============================================================================
-- FASE 6 — Transferência manual de conversa (Conversas IA)
-- RPC atômica e idempotente que ADOTA uma conversa da projeção
-- ai_conversation_index como lead do Pedro (find-or-create de EXATAMENTE um
-- lead por telefone canônico) e a deixa pronta para o fluxo manual existente
-- (edge manual-transfer: briefing + OK do vendedor + auditoria em
-- ai_lead_transfers + fila round-robin). A RPC NÃO envia mensagem nenhuma.
--
-- Invariantes exigidos pelo dono:
--   * atômica: advisory lock da projeção (mesmo lock dos alimentadores) —
--     clique repetido/concorrência serializam e retornam o MESMO lead;
--   * ambiguidade (2+ leads com o telefone) => EXCEPTION explícita, nenhuma
--     escolha silenciosa;
--   * IA permanece pausada: lead nasce (ou vira) ai_paused=true;
--   * nenhum follow-up: lead criado tem last_agent_reply_at/last_user_reply_at
--     NULL e next_followup_at NULL — fora de TODOS os seletores do
--     cron-lead-followup (que ainda exige assigned_to_id IS NULL);
--   * transferência automática/follow-up/José/feedbacks: INTOCADOS.
-- =============================================================================

DROP FUNCTION IF EXISTS public.manual_transfer_conversation(uuid, text);

CREATE OR REPLACE FUNCTION public.manual_transfer_conversation(
  p_conversation_id uuid,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_is_manager boolean := false;
  v_tenant uuid;
  v_conv public.ai_conversation_index%ROWTYPE;
  v_lead_id uuid;
  v_created boolean := false;
  v_agent uuid;
  v_ids uuid[];
  v_surviving uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao autenticado';
  END IF;

  -- Papel: master (dono do tenant) ou gerente-membro. Vendedor comum não
  -- transfere conversa órfã (ele nem as enxerga na lista).
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF coalesce(v_role, '') = 'seller' THEN
    v_tenant := public.get_seller_master_user_id();
    SELECT coalesce(bool_or(coalesce(m.is_manager, false)), false) INTO v_is_manager
    FROM public.ai_team_members m
    WHERE m.auth_user_id = v_uid
      AND coalesce(m.active_in_system, true) <> false
      AND m.removed_at IS NULL;
    IF NOT v_is_manager THEN
      RAISE EXCEPTION 'sem permissao: apenas o dono da conta ou um gerente transferem conversas';
    END IF;
  ELSE
    v_tenant := v_uid;
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant nao resolvido';
  END IF;

  SELECT * INTO v_conv FROM public.ai_conversation_index
  WHERE id = p_conversation_id AND user_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversa nao encontrada neste tenant';
  END IF;

  -- Mesmo lock dos alimentadores da projeção: serializa com webhook/v3/adoção
  -- e com um segundo clique simultâneo no mesmo contato.
  PERFORM public.ai_conv_index_lock(v_tenant, v_conv.phone_canonical);

  -- Reler DEPOIS do lock: outra transação pode ter vinculado ou mesclado
  -- (adoção órfã→instância apaga a linha órfã).
  SELECT * INTO v_conv FROM public.ai_conversation_index WHERE id = p_conversation_id;
  IF NOT FOUND THEN
    SELECT * INTO v_conv FROM public.ai_conversation_index
    WHERE user_id = v_tenant AND phone_canonical = (
      SELECT phone_canonical FROM public.ai_conversation_index WHERE id = p_conversation_id
    );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'conversa mesclada por outra operacao; recarregue a lista e tente de novo';
    END IF;
  END IF;

  -- Conversa já vinculada a lead do Marcos: não é fluxo desta RPC.
  IF v_conv.crm_lead_id IS NOT NULL AND v_conv.crm_source = 'marcos' THEN
    RETURN jsonb_build_object(
      'lead_id', v_conv.crm_lead_id, 'source', 'marcos', 'created', false,
      'conversation_id', v_conv.id);
  END IF;

  -- Idempotência: vínculo existente e válido => mesmo lead.
  IF v_conv.crm_lead_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ai_crm_leads l WHERE l.id = v_conv.crm_lead_id AND l.user_id = v_tenant
  ) THEN
    v_lead_id := v_conv.crm_lead_id;
  ELSE
    -- Candidatos por telefone canônico. Prioridade: MESMA instância.
    IF v_conv.instance_id IS NOT NULL THEN
      SELECT coalesce(array_agg(l.id), '{}') INTO v_ids
      FROM public.ai_crm_leads l
      WHERE l.user_id = v_tenant
        AND l.instance_id = v_conv.instance_id
        AND public.logos_phone_canonical(l.remote_jid) = v_conv.phone_canonical;
      IF array_length(v_ids, 1) = 1 THEN
        v_lead_id := v_ids[1];
      ELSIF array_length(v_ids, 1) > 1 THEN
        RAISE EXCEPTION 'AMBIGUO: % leads com este telefone nesta instancia — resolva a duplicidade no CRM antes de transferir',
          array_length(v_ids, 1);
      END IF;
    END IF;

    IF v_lead_id IS NULL THEN
      SELECT coalesce(array_agg(l.id), '{}') INTO v_ids
      FROM public.ai_crm_leads l
      WHERE l.user_id = v_tenant
        AND public.logos_phone_canonical(l.remote_jid) = v_conv.phone_canonical;
      IF array_length(v_ids, 1) = 1 THEN
        v_lead_id := v_ids[1];
      ELSIF array_length(v_ids, 1) > 1 THEN
        RAISE EXCEPTION 'AMBIGUO: % leads com este telefone no CRM — resolva a duplicidade antes de transferir',
          array_length(v_ids, 1);
      END IF;
    END IF;

    IF v_lead_id IS NULL THEN
      -- Criar o lead: resolver o agente (conversa → instância → agente único).
      IF v_conv.agent_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.wa_ai_agents a WHERE a.id = v_conv.agent_id AND a.user_id = v_tenant
      ) THEN
        v_agent := v_conv.agent_id;
      ELSIF v_conv.instance_id IS NOT NULL THEN
        SELECT a.id INTO v_agent
        FROM public.wa_ai_agents a
        WHERE a.user_id = v_tenant
          AND (a.instance_id = v_conv.instance_id
               OR v_conv.instance_id = ANY(coalesce(a.instance_ids, '{}')))
        ORDER BY a.is_active DESC, a.created_at ASC, a.id ASC
        LIMIT 1;
      END IF;
      IF v_agent IS NULL THEN
        SELECT coalesce(array_agg(a.id), '{}') INTO v_ids
        FROM public.wa_ai_agents a WHERE a.user_id = v_tenant;
        IF array_length(v_ids, 1) = 1 THEN
          v_agent := v_ids[1];
        ELSE
          RAISE EXCEPTION 'nao foi possivel determinar o agente desta conversa — a conta tem % agentes e a conversa nao tem instancia vinculada',
            coalesce(array_length(v_ids, 1), 0);
        END IF;
      END IF;

      -- Lead nasce PAUSADO e fora de qualquer follow-up:
      --  * last_agent_reply_at / last_user_reply_at NULL => nenhum seletor do
      --    cron-lead-followup o encontra;
      --  * next_followup_at NULL, followup_5min_sent false (defaults).
      INSERT INTO public.ai_crm_leads (
        user_id, agent_id, instance_id, remote_jid, lead_name,
        status, status_crm, ai_paused, ai_paused_at, ai_paused_by, pause_reason,
        summary, additional_notes, arrived_at, entry_datetime,
        last_interaction_at, message_count
      ) VALUES (
        v_tenant, v_agent, v_conv.instance_id, v_conv.phone_canonical, v_conv.contact_name,
        'novo', 'novo', true, now(), v_uid, 'transferencia_manual_no_painel',
        v_conv.last_message,
        coalesce(nullif(trim(p_notes), ''), 'Lead criado por transferencia manual de conversa (Conversas IA)'),
        coalesce(v_conv.first_seen_at, now()), coalesce(v_conv.first_seen_at, now()),
        coalesce(v_conv.last_message_at, now()), coalesce(v_conv.message_count, 0)
      ) RETURNING id INTO v_lead_id;
      v_created := true;
    END IF;
  END IF;

  -- IA PERMANECE PAUSADA também quando o lead já existia despausado.
  UPDATE public.ai_crm_leads
  SET ai_paused = true,
      ai_paused_at = coalesce(ai_paused_at, now()),
      ai_paused_by = coalesce(ai_paused_by, v_uid),
      pause_reason = coalesce(pause_reason, 'transferencia_manual_no_painel')
  WHERE id = v_lead_id AND user_id = v_tenant AND ai_paused IS DISTINCT FROM true;

  -- Vincular TODAS as linhas da identidade (órfã NULL e/ou linha da instância;
  -- o trigger de INSERT em ai_crm_leads pode já ter adotado/mesclado — este
  -- UPDATE é idempotente e nunca rouba conversa vinculada a OUTRO lead).
  UPDATE public.ai_conversation_index
  SET crm_lead_id = v_lead_id, crm_source = 'pedro', crm_match_status = 'linked',
      updated_at = now()
  WHERE user_id = v_tenant
    AND phone_canonical = v_conv.phone_canonical
    AND (crm_lead_id IS NULL OR crm_lead_id = v_lead_id);

  SELECT id INTO v_surviving FROM public.ai_conversation_index
  WHERE user_id = v_tenant AND crm_lead_id = v_lead_id
  ORDER BY (instance_id IS NOT NULL) DESC, updated_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'lead_id', v_lead_id,
    'source', 'pedro',
    'created', v_created,
    'conversation_id', coalesce(v_surviving, v_conv.id),
    'agent_id', v_agent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manual_transfer_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_transfer_conversation(uuid, text) TO authenticated, service_role;
