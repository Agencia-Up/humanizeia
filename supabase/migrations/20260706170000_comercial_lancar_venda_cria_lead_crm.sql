-- ============================================================================
-- comercial_lancar_venda: a venda manual do Painel Geral passa a CRIAR o lead
-- no CRM certo (Pedro se tráfego pago; Marcos senão), atribuído ao vendedor e
-- marcado como fechado -> o gatilho existente gera a comercial_vendas LIGADA.
-- Ordem: cria lead (novo) -> insere a venda ligada com os valores digitados ->
-- marca fechado (o gatilho tenta inserir e cai no ON CONFLICT, sem duplicar).
-- SECURITY DEFINER + checagem de tenant/vendedor (espelha a RLS de comercial_vendas).
-- Aplicada em prod via MCP em 06/07/2026 (arquivo versionado depois).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.comercial_lancar_venda(
  p_seller_id   uuid,
  p_origem      text,
  p_data_venda  date,
  p_valor       numeric DEFAULT 0,
  p_nome        text DEFAULT NULL,
  p_telefone    text DEFAULT NULL,
  p_cidade      text DEFAULT NULL,
  p_veiculo     text DEFAULT NULL,
  p_observacao  text DEFAULT NULL,
  p_portal      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tenant   uuid;
  v_master   boolean;
  v_lead_id  uuid;
  v_venda_id uuid;
  v_crm      text;
  v_agent    uuid;
  v_stage0   uuid;
  v_stageF   uuid;
  v_jid      text;
  v_digits   text;
BEGIN
  IF p_seller_id IS NULL THEN RAISE EXCEPTION 'vendedor obrigatorio'; END IF;
  IF p_origem NOT IN ('trafego','portais','porta','particular') THEN RAISE EXCEPTION 'origem invalida'; END IF;
  IF p_data_venda IS NULL THEN RAISE EXCEPTION 'data obrigatoria'; END IF;

  SELECT user_id INTO v_tenant FROM ai_team_members WHERE id = p_seller_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'vendedor invalido'; END IF;

  -- Autorizacao: master do tenant OU vendedor do proprio tenant lancando pra si.
  v_master := (auth.uid() = v_tenant);
  IF NOT v_master THEN
    IF get_seller_master_user_id() IS DISTINCT FROM v_tenant
       OR (p_seller_id::text <> ALL (get_seller_member_ids_text())) THEN
      RAISE EXCEPTION 'sem permissao para lancar venda para este vendedor';
    END IF;
  END IF;

  IF p_origem = 'trafego' THEN
    -- ===== Tráfego pago -> Agente Pedro (ai_crm_leads) =====
    v_digits := regexp_replace(COALESCE(p_telefone,''), '[^0-9]', '', 'g');
    IF length(v_digits) < 10 THEN RAISE EXCEPTION 'telefone valido e obrigatorio para trafego pago'; END IF;
    IF left(v_digits,2) <> '55' THEN v_digits := '55' || v_digits; END IF;
    v_jid := v_digits || '@s.whatsapp.net';

    SELECT id INTO v_agent FROM wa_ai_agents WHERE user_id = v_tenant ORDER BY created_at LIMIT 1;
    IF v_agent IS NULL THEN RAISE EXCEPTION 'nenhum agente Pedro configurado para criar o lead de trafego'; END IF;

    SELECT id INTO v_lead_id FROM ai_crm_leads
      WHERE user_id = v_tenant AND remote_jid = v_jid ORDER BY created_at DESC LIMIT 1;
    IF v_lead_id IS NULL THEN
      INSERT INTO ai_crm_leads (user_id, agent_id, remote_jid, lead_name, assigned_to_id, status_crm, status, origem, vehicle_interest, client_city, arrived_at)
      VALUES (v_tenant, v_agent, v_jid, NULLIF(btrim(COALESCE(p_nome,'')),''), p_seller_id, 'novo', 'novo', 'trafico_pago',
              NULLIF(btrim(COALESCE(p_veiculo,'')),''), NULLIF(btrim(COALESCE(p_cidade,'')),''), p_data_venda::timestamptz)
      RETURNING id INTO v_lead_id;
    ELSE
      UPDATE ai_crm_leads SET assigned_to_id = COALESCE(assigned_to_id, p_seller_id) WHERE id = v_lead_id;
    END IF;
    v_crm := 'pedro';

    INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, portal, veiculo, observacao, origem_lead_tipo, origem_lead_id, lead_criado_em)
    VALUES (v_tenant, p_seller_id, p_data_venda, COALESCE(p_valor,0), p_origem, NULL,
            NULLIF(btrim(COALESCE(p_veiculo,'')),''), NULLIF(btrim(COALESCE(p_observacao,'')),''), 'pedro', v_lead_id, p_data_venda)
    ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL
      DO UPDATE SET data_venda=EXCLUDED.data_venda, valor=EXCLUDED.valor, origem=EXCLUDED.origem,
                    veiculo=EXCLUDED.veiculo, observacao=EXCLUDED.observacao
    RETURNING id INTO v_venda_id;

    UPDATE ai_crm_leads SET status_crm='fechado', status='fechado'
      WHERE id = v_lead_id AND COALESCE(status_crm,'') <> 'fechado';

  ELSE
    -- ===== Outras origens -> Agente Marcos (crm_leads) =====
    SELECT id INTO v_stageF FROM crm_pipeline_stages
      WHERE user_id = v_tenant AND (lower(name) = 'fechado' OR lower(name) LIKE 'venda conclu%')
      ORDER BY position LIMIT 1;
    IF v_stageF IS NULL THEN RAISE EXCEPTION 'etapa Fechado/Venda concluida nao encontrada no CRM do Marcos'; END IF;
    SELECT id INTO v_stage0 FROM crm_pipeline_stages WHERE user_id = v_tenant ORDER BY position LIMIT 1;

    v_digits := regexp_replace(COALESCE(p_telefone,''), '[^0-9]', '', 'g');

    INSERT INTO crm_leads (user_id, name, phone, assigned_to, stage_id, source, origem, vehicle_interest, client_city, arrived_at)
    VALUES (v_tenant, COALESCE(NULLIF(btrim(COALESCE(p_nome,'')),''), 'Venda avulsa'),
            NULLIF(v_digits,''), p_seller_id::text, v_stage0, 'Venda manual', p_origem,
            NULLIF(btrim(COALESCE(p_veiculo,'')),''), NULLIF(btrim(COALESCE(p_cidade,'')),''), p_data_venda::timestamptz)
    RETURNING id INTO v_lead_id;
    v_crm := 'marcos';

    INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, portal, veiculo, observacao, origem_lead_tipo, origem_lead_id, lead_criado_em)
    VALUES (v_tenant, p_seller_id, p_data_venda, COALESCE(p_valor,0), p_origem, NULLIF(btrim(COALESCE(p_portal,'')),''),
            NULLIF(btrim(COALESCE(p_veiculo,'')),''), NULLIF(btrim(COALESCE(p_observacao,'')),''), 'marcos', v_lead_id, p_data_venda)
    ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL
      DO UPDATE SET data_venda=EXCLUDED.data_venda, valor=EXCLUDED.valor, origem=EXCLUDED.origem,
                    portal=EXCLUDED.portal, veiculo=EXCLUDED.veiculo, observacao=EXCLUDED.observacao
    RETURNING id INTO v_venda_id;

    UPDATE crm_leads SET stage_id = v_stageF WHERE id = v_lead_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'crm', v_crm, 'lead_id', v_lead_id, 'venda_id', v_venda_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.comercial_lancar_venda(uuid,text,date,numeric,text,text,text,text,text,text) TO authenticated;
