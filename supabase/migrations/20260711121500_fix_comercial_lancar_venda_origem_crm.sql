-- ============================================================================
-- Painel Geral -> CRM: corrige origem invalida ao lancar venda manual.
-- ----------------------------------------------------------------------------
-- Causa do erro:
--   comercial_lancar_venda recebia origens comerciais ('portais', 'particular')
--   e gravava o mesmo valor em crm_leads.origem. O CHECK de crm_leads aceita
--   apenas as origens do Marcos, por exemplo 'marketplace', 'olx', 'porta',
--   'outros'. Resultado: vendas de Portais/Webmotors falhavam com
--   crm_leads_origem_check.
--
-- Regra preservada:
--   trafego  -> cria/fecha lead no Pedro (ai_crm_leads)
--   demais   -> cria/fecha lead no Marcos (crm_leads)
--
-- Blindagem extra:
--   o gatilho comercial_sync_venda_marcos agora reconhece tambem etapas
--   "Venda concluida", nao apenas "Fechado".
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
  v_tenant        uuid;
  v_master        boolean;
  v_lead_id       uuid;
  v_venda_id      uuid;
  v_crm           text;
  v_agent         uuid;
  v_stage0        uuid;
  v_stageF        uuid;
  v_jid           text;
  v_digits        text;
  v_marcos_origem text;
  v_marcos_source text;
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
    -- ===== Trafego pago -> Agente Pedro (ai_crm_leads) =====
    v_digits := regexp_replace(COALESCE(p_telefone,''), '[^0-9]', '', 'g');
    IF length(v_digits) < 10 THEN RAISE EXCEPTION 'telefone valido e obrigatorio para trafego pago'; END IF;
    IF left(v_digits,2) <> '55' THEN v_digits := '55' || v_digits; END IF;
    v_jid := v_digits || '@s.whatsapp.net';

    SELECT id INTO v_agent FROM wa_ai_agents WHERE user_id = v_tenant ORDER BY created_at LIMIT 1;
    IF v_agent IS NULL THEN RAISE EXCEPTION 'nenhum agente Pedro configurado para criar o lead de trafego'; END IF;

    SELECT id INTO v_lead_id
    FROM ai_crm_leads
    WHERE user_id = v_tenant AND remote_jid = v_jid
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_lead_id IS NULL THEN
      INSERT INTO ai_crm_leads (
        user_id, agent_id, remote_jid, lead_name, assigned_to_id,
        status_crm, status, origem, vehicle_interest, client_city, arrived_at
      )
      VALUES (
        v_tenant, v_agent, v_jid, NULLIF(btrim(COALESCE(p_nome,'')),''),
        p_seller_id, 'novo', 'novo', 'trafico_pago',
        NULLIF(btrim(COALESCE(p_veiculo,'')),''),
        NULLIF(btrim(COALESCE(p_cidade,'')),''),
        p_data_venda::timestamptz
      )
      RETURNING id INTO v_lead_id;
    ELSE
      UPDATE ai_crm_leads
      SET assigned_to_id = COALESCE(assigned_to_id, p_seller_id)
      WHERE id = v_lead_id;
    END IF;
    v_crm := 'pedro';

    INSERT INTO comercial_vendas (
      user_id, seller_id, data_venda, valor, origem, portal, veiculo, observacao,
      origem_lead_tipo, origem_lead_id, lead_criado_em
    )
    VALUES (
      v_tenant, p_seller_id, p_data_venda, COALESCE(p_valor,0), p_origem, NULL,
      NULLIF(btrim(COALESCE(p_veiculo,'')),''),
      NULLIF(btrim(COALESCE(p_observacao,'')),''),
      'pedro', v_lead_id, p_data_venda
    )
    ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL
      DO UPDATE SET data_venda=EXCLUDED.data_venda, valor=EXCLUDED.valor, origem=EXCLUDED.origem,
                    veiculo=EXCLUDED.veiculo, observacao=EXCLUDED.observacao
    RETURNING id INTO v_venda_id;

    UPDATE ai_crm_leads
    SET status_crm='fechado', status='fechado'
    WHERE id = v_lead_id AND COALESCE(status_crm,'') <> 'fechado';

  ELSE
    -- ===== Outras origens -> Agente Marcos (crm_leads) =====
    -- Traduz origem comercial para valores aceitos pelo CHECK de crm_leads.
    v_marcos_origem := CASE
      WHEN p_origem = 'porta' THEN 'porta'
      WHEN p_origem = 'portais' AND COALESCE(p_portal,'') ILIKE '%olx%' THEN 'olx'
      WHEN p_origem = 'portais' THEN 'marketplace'
      ELSE 'outros'
    END;

    v_marcos_source := CASE
      WHEN p_origem = 'portais' THEN COALESCE(NULLIF(btrim(COALESCE(p_portal,'')),''), 'Portais')
      WHEN p_origem = 'porta' THEN 'Porta'
      ELSE 'Particular'
    END;

    SELECT id INTO v_stageF
    FROM crm_pipeline_stages
    WHERE user_id = v_tenant
      AND (
        lower(name) = 'fechado'
        OR lower(name) LIKE 'venda conclu%'
        OR lower(name) LIKE 'vendas conclu%'
      )
    ORDER BY
      CASE
        WHEN lower(name) LIKE 'venda conclu%' OR lower(name) LIKE 'vendas conclu%' THEN 0
        WHEN lower(name) = 'fechado' THEN 1
        ELSE 2
      END,
      position
    LIMIT 1;
    IF v_stageF IS NULL THEN RAISE EXCEPTION 'etapa Fechado/Venda concluida nao encontrada no CRM do Marcos'; END IF;

    SELECT id INTO v_stage0
    FROM crm_pipeline_stages
    WHERE user_id = v_tenant
    ORDER BY position
    LIMIT 1;

    v_digits := regexp_replace(COALESCE(p_telefone,''), '[^0-9]', '', 'g');

    INSERT INTO crm_leads (
      user_id, name, phone, assigned_to, stage_id, source, origem,
      vehicle_interest, client_city, arrived_at, value, won_at, notes, custom_fields
    )
    VALUES (
      v_tenant,
      COALESCE(NULLIF(btrim(COALESCE(p_nome,'')),''), 'Venda avulsa'),
      NULLIF(v_digits,''),
      p_seller_id::text,
      v_stage0,
      v_marcos_source,
      v_marcos_origem,
      NULLIF(btrim(COALESCE(p_veiculo,'')),''),
      NULLIF(btrim(COALESCE(p_cidade,'')),''),
      p_data_venda::timestamptz,
      COALESCE(p_valor,0),
      p_data_venda::timestamptz,
      NULLIF(btrim(COALESCE(p_observacao,'')),''),
      jsonb_build_object(
        'venda_manual_painel_geral', true,
        'origem_comercial', p_origem,
        'portal', NULLIF(btrim(COALESCE(p_portal,'')),''),
        'data_venda', p_data_venda,
        'valor_venda', COALESCE(p_valor,0)
      )
    )
    RETURNING id INTO v_lead_id;
    v_crm := 'marcos';

    INSERT INTO comercial_vendas (
      user_id, seller_id, data_venda, valor, origem, portal, veiculo, observacao,
      origem_lead_tipo, origem_lead_id, lead_criado_em
    )
    VALUES (
      v_tenant, p_seller_id, p_data_venda, COALESCE(p_valor,0), p_origem,
      NULLIF(btrim(COALESCE(p_portal,'')),''),
      NULLIF(btrim(COALESCE(p_veiculo,'')),''),
      NULLIF(btrim(COALESCE(p_observacao,'')),''),
      'marcos', v_lead_id, p_data_venda
    )
    ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL
      DO UPDATE SET data_venda=EXCLUDED.data_venda, valor=EXCLUDED.valor, origem=EXCLUDED.origem,
                    portal=EXCLUDED.portal, veiculo=EXCLUDED.veiculo, observacao=EXCLUDED.observacao
    RETURNING id INTO v_venda_id;

    UPDATE crm_leads
    SET stage_id = v_stageF,
        value = COALESCE(p_valor,0),
        won_at = p_data_venda::timestamptz,
        updated_at = now()
    WHERE id = v_lead_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'crm', v_crm, 'lead_id', v_lead_id, 'venda_id', v_venda_id);
END $function$;

GRANT EXECUTE ON FUNCTION public.comercial_lancar_venda(uuid,text,date,numeric,text,text,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.comercial_sync_venda_marcos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new text;
  v_old text;
  v_seller uuid;
  v_is_new_won boolean;
  v_was_old_won boolean;
BEGIN
  SET LOCAL row_security = off;

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT lower(name) INTO v_new FROM crm_pipeline_stages WHERE id = NEW.stage_id;
    SELECT lower(name) INTO v_old FROM crm_pipeline_stages WHERE id = OLD.stage_id;

    v_is_new_won := (
      v_new = 'fechado'
      OR v_new LIKE 'venda conclu%'
      OR v_new LIKE 'vendas conclu%'
    );
    v_was_old_won := (
      v_old = 'fechado'
      OR v_old LIKE 'venda conclu%'
      OR v_old LIKE 'vendas conclu%'
    );

    IF v_is_new_won
       AND NOT COALESCE(v_was_old_won, false)
       AND NEW.assigned_to IS NOT NULL
       AND NEW.assigned_to ~ '^[0-9a-fA-F-]{36}$' THEN
      v_seller := NEW.assigned_to::uuid;
      IF EXISTS (SELECT 1 FROM ai_team_members WHERE id = v_seller) THEN
        INSERT INTO comercial_vendas (
          user_id, seller_id, data_venda, valor, origem, veiculo,
          origem_lead_tipo, origem_lead_id, lead_criado_em
        )
        VALUES (
          NEW.user_id,
          v_seller,
          COALESCE(NEW.won_at::date, current_date),
          COALESCE(NEW.value, 0),
          map_origem_comercial(NEW.origem),
          NULL,
          'marcos',
          NEW.id,
          COALESCE(NEW.created_at::date, current_date)
        )
        ON CONFLICT (origem_lead_tipo, origem_lead_id) WHERE origem_lead_id IS NOT NULL DO NOTHING;
      END IF;
    ELSIF COALESCE(v_was_old_won, false) AND NOT COALESCE(v_is_new_won, false) THEN
      DELETE FROM comercial_vendas WHERE origem_lead_tipo = 'marcos' AND origem_lead_id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_comercial_venda_marcos ON public.crm_leads;
CREATE TRIGGER trg_comercial_venda_marcos
  AFTER UPDATE OF stage_id ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.comercial_sync_venda_marcos();
