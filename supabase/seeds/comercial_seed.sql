-- ============================================================================
-- SEED de demonstração do módulo Comercial (somente STAGING).
-- Escolhe o master com mais vendedores (ai_team_members), limpa os dados
-- comerciais dele e cria: 1 meta de loja + metas individuais + ~20 vendas
-- variadas no mês atual. Idempotente (limpa antes de semear).
-- ============================================================================
DO $$
DECLARE
  v_user      uuid;
  v_sellers   uuid[];
  v_metas     int[] := ARRAY[14, 10, 8];   -- metas individuais (qtd vendas)
  v_origens   text[] := ARRAY['trafego','portais','porta','particular'];
  v_portais   text[] := ARRAY['Webmotors','OLX','iCarros'];
  v_veiculos  text[] := ARRAY['Jeep Compass 2022','HB20 2021','Onix 2023','Toro 2020','Corolla 2022','Strada 2023'];
  v_mes       date := date_trunc('month', now())::date;
  v_diasmes   int  := EXTRACT(day FROM (date_trunc('month', now()) + interval '1 month - 1 day'))::int;
  i           int;
  v_sid       uuid;
  v_org       text;
  v_dia       int;
BEGIN
  -- Master com mais vendedores ativos
  SELECT user_id INTO v_user
  FROM ai_team_members
  WHERE coalesce(active_in_system, true) = true
  GROUP BY user_id
  ORDER BY count(*) DESC
  LIMIT 1;
  IF v_user IS NULL THEN RAISE NOTICE 'Sem vendedores — nada a semear'; RETURN; END IF;

  -- Até 3 vendedores desse master
  SELECT array_agg(id) INTO v_sellers FROM (
    SELECT id FROM ai_team_members WHERE user_id = v_user AND coalesce(active_in_system, true) = true
    ORDER BY created_at LIMIT 3
  ) t;

  -- Limpa dados comerciais anteriores desse master (demo limpa)
  DELETE FROM comercial_vendas WHERE user_id = v_user;
  DELETE FROM comercial_metas  WHERE user_id = v_user;

  -- Meta da loja (soma das individuais ~ 32)
  INSERT INTO comercial_metas (user_id, seller_id, tipo, mes_referencia, valor_meta)
  VALUES (v_user, NULL, 'loja', v_mes, 32);

  -- Metas individuais
  FOR i IN 1 .. array_length(v_sellers, 1) LOOP
    INSERT INTO comercial_metas (user_id, seller_id, tipo, mes_referencia, valor_meta)
    VALUES (v_user, v_sellers[i], 'individual', v_mes, v_metas[i]);
  END LOOP;

  -- ~20 vendas variadas no mês atual
  FOR i IN 1 .. 20 LOOP
    v_sid := v_sellers[1 + (i % array_length(v_sellers, 1))];
    v_org := v_origens[1 + (i % 4)];
    v_dia := 1 + (i * 7 % GREATEST(v_diasmes - 1, 1));
    INSERT INTO comercial_vendas (user_id, seller_id, data_venda, valor, origem, portal, veiculo, observacao)
    VALUES (
      v_user, v_sid,
      (v_mes + (v_dia - 1))::date,
      round((35000 + (i * 1700) % 90000)::numeric, 2),
      v_org,
      CASE WHEN v_org = 'portais' THEN v_portais[1 + (i % 3)] ELSE NULL END,
      v_veiculos[1 + (i % 6)],
      'Venda de demonstração'
    );
  END LOOP;

  RAISE NOTICE 'Seed comercial OK para user %, % vendedores', v_user, array_length(v_sellers,1);
END $$;
