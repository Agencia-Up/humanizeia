-- Galeria de veículos do José dentro da área de Feedbacks, com gasto por carro CORRETO
-- (batendo com o total da conta) e imagem guardada no nosso bucket (sempre abre).
-- Aplicada em prod via MCP (11/07); este arquivo é a versão fiel em Git.
-- Robô: edge feedback-jose-sync (pré-calcula 7/30/60 + baixa imagens). Painel: RPC abaixo.

-- Gasto por criativo/carro já calculado, por período fixo (7/30/60 dias).
CREATE TABLE IF NOT EXISTS public.feedback_jose_trafego (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  periodo_dias int NOT NULL,
  nome text NOT NULL,
  carro_key text,
  gasto numeric NOT NULL DEFAULT 0,
  conversas int NOT NULL DEFAULT 0,
  status text,
  image_url text,
  asset_key text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  gasto_total_periodo numeric,
  UNIQUE (tenant_id, periodo_dias, nome)
);
CREATE INDEX IF NOT EXISTS idx_fjt_tenant_periodo ON public.feedback_jose_trafego (tenant_id, periodo_dias);
ALTER TABLE public.feedback_jose_trafego ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fjt_sel ON public.feedback_jose_trafego;
CREATE POLICY fjt_sel ON public.feedback_jose_trafego
  FOR SELECT USING (tenant_id = public.resolve_billing_owner_user_id(auth.uid()));

INSERT INTO storage.buckets (id, name, public)
VALUES ('jose-criativos', 'jose-criativos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- O painel lê o período já calculado (instantâneo, sem Meta). Inclui o cache de carros lidos por imagem.
CREATE OR REPLACE FUNCTION public.feedback_jose_trafego_periodo(p_dias int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; v_res jsonb; v_when timestamptz; v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'criativos', '[]'::jsonb); END IF;
  v_tenant := public.resolve_billing_owner_user_id(auth.uid());
  IF v_tenant IS NULL THEN RETURN jsonb_build_object('ok', false, 'criativos', '[]'::jsonb); END IF;

  SELECT max(computed_at), max(gasto_total_periodo) INTO v_when, v_total
  FROM public.feedback_jose_trafego WHERE tenant_id = v_tenant AND periodo_dias = p_dias;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'nome', nome, 'carro_key', carro_key, 'gasto', gasto, 'conversas', conversas,
           'status', status, 'thumbnail_url', image_url, 'asset_key', asset_key
         ) ORDER BY gasto DESC), '[]'::jsonb) INTO v_res
  FROM public.feedback_jose_trafego WHERE tenant_id = v_tenant AND periodo_dias = p_dias;

  RETURN jsonb_build_object(
    'ok', true, 'tem_dados', v_when IS NOT NULL,
    'computed_at', v_when, 'gasto_total', v_total, 'criativos', v_res,
    'carros_ia', (SELECT coalesce(jsonb_agg(jsonb_build_object('asset_key', asset_key, 'carro', carro)), '[]'::jsonb)
                  FROM public.jose_criativo_carro WHERE tenant_id = v_tenant AND carro IS NOT NULL AND carro <> 'indefinido')
  );
END; $$;
REVOKE ALL ON FUNCTION public.feedback_jose_trafego_periodo(int) FROM public;
GRANT EXECUTE ON FUNCTION public.feedback_jose_trafego_periodo(int) TO authenticated;

-- Robô agendado: pra cada tenant com Meta ativa E cérebro de feedback em uso, dispara o sync.
CREATE OR REPLACE FUNCTION public.cron_feedback_jose_sync_runner()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_key IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT DISTINCT a.user_id FROM public.ad_accounts a
    WHERE a.platform = 'meta' AND a.is_active = true AND coalesce(a.access_token_encrypted,'') <> ''
      AND EXISTS (SELECT 1 FROM public.feedback_conversas fc WHERE fc.tenant_id = a.user_id)
  LOOP
    PERFORM net.http_post(
      url := 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/feedback-jose-sync',
      body := '{}'::jsonb, params := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key, 'x-user-id', r.user_id::text),
      timeout_milliseconds := 240000);
  END LOOP;
END; $$;

-- cron: SELECT cron.schedule('feedback-jose-sync-hourly', '25 * * * *', 'SELECT public.cron_feedback_jose_sync_runner();');
