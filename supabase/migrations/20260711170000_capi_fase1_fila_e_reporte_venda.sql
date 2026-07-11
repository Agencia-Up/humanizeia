-- FASE 1 do loop CAPI (API oficial de conversões). Aplicada em prod via MCP (11/07).
-- (a) liga o cron da fila (wa-capi-process-queue) a cada 5 min — antes os eventos 'pending'
--     ficavam presos pra sempre (a fila nunca tinha sido agendada).
-- (b) reporta a VENDA de volta pro Facebook: varredor pega vendas novas (7 dias), monta o
--     evento Purchase com telefone (matching), valor, ad_id do anúncio de origem e fbc (do
--     fbclid), e enfileira; a fila envia. SEM gatilho na tabela de vendas (zero risco de
--     travar venda). No-op enquanto o tenant não tiver um Pixel ATIVO conectado (meta_pixels).
-- Pré-requisito pra enviar de verdade: conectar o Pixel + token CAPI do cliente (tela /meta-pixels).

SELECT cron.schedule('wa-capi-process-queue-5min', '*/5 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/wa-capi-process-queue',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='service_role_key')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$cron$);

ALTER TABLE public.comercial_vendas ADD COLUMN IF NOT EXISTS capi_reported_at timestamptz;

CREATE OR REPLACE FUNCTION public.cron_capi_report_sales_runner()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v record; v_pixel uuid; v_phone text; v_ad_id text; v_fbclid text;
  v_userdata jsonb; v_customdata jsonb;
BEGIN
  FOR v IN
    SELECT cv.* FROM public.comercial_vendas cv
    WHERE cv.capi_reported_at IS NULL
      AND cv.created_at >= now() - interval '7 days'
      AND EXISTS (SELECT 1 FROM public.meta_pixels p WHERE p.user_id = cv.user_id AND p.is_active = true)
    LIMIT 200
  LOOP
    BEGIN
      SELECT id INTO v_pixel FROM public.meta_pixels WHERE user_id = v.user_id AND is_active = true ORDER BY created_at LIMIT 1;
      IF v_pixel IS NULL THEN CONTINUE; END IF;

      v_phone := NULL; v_ad_id := NULL;
      IF v.origem_lead_id IS NOT NULL THEN
        SELECT regexp_replace(split_part(l.remote_jid,'@',1),'\D','','g'), l.ad_id
          INTO v_phone, v_ad_id FROM public.ai_crm_leads l WHERE l.id = v.origem_lead_id;
        IF v_phone IS NULL THEN
          SELECT regexp_replace(coalesce(l.phone,''),'\D','','g')
            INTO v_phone FROM public.crm_leads l WHERE l.id = v.origem_lead_id;
        END IF;
      END IF;
      v_phone := nullif(v_phone,'');

      v_fbclid := NULL;
      IF v_phone IS NOT NULL THEN
        SELECT fbclid INTO v_fbclid FROM public.wa_contacts
          WHERE user_id = v.user_id AND regexp_replace(coalesce(phone,''),'\D','','g') = v_phone AND fbclid IS NOT NULL
          LIMIT 1;
      END IF;

      v_userdata := '{}'::jsonb;
      IF v_phone IS NOT NULL THEN v_userdata := jsonb_set(v_userdata, '{ph}', to_jsonb(ARRAY[v_phone])); END IF;
      IF v_fbclid IS NOT NULL THEN
        v_userdata := v_userdata || jsonb_build_object('fbc', 'fb.1.' || (extract(epoch from now())*1000)::bigint || '.' || v_fbclid);
      END IF;

      v_customdata := jsonb_build_object('currency','BRL','value', coalesce(v.valor,0));
      IF v_ad_id IS NOT NULL AND v_ad_id NOT IN ('','0') THEN v_customdata := v_customdata || jsonb_build_object('ad_id', v_ad_id); END IF;
      IF v.veiculo IS NOT NULL THEN v_customdata := v_customdata || jsonb_build_object('content_name', v.veiculo); END IF;

      IF v_phone IS NOT NULL THEN
        INSERT INTO public.meta_capi_events (user_id, pixel_id, event_name, event_time, action_source, user_data, custom_data, status)
        VALUES (v.user_id, v_pixel, 'Purchase', coalesce(v.created_at, now()), 'system_generated', v_userdata, v_customdata, 'pending');
      END IF;

      UPDATE public.comercial_vendas SET capi_reported_at = now() WHERE id = v.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.comercial_vendas SET capi_reported_at = now() WHERE id = v.id;
    END;
  END LOOP;
END; $$;

SELECT cron.schedule('capi-report-sales-10min', '*/10 * * * *', 'SELECT public.cron_capi_report_sales_runner();');
