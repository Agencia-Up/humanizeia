-- ============================================================================
-- Marcos CRM: guard raiz para contas sem etapas
-- ----------------------------------------------------------------------------
-- O CRM do Marcos depende de crm_pipeline_stages. Se uma conta master nasce por
-- um fluxo que nao semeia essas etapas, o front ate pode mostrar fallback visual,
-- mas operacoes reais de cadastro/importacao quebram por falta de stage_id.
--
-- Esta migration cria uma funcao unica e idempotente para garantir o pipeline,
-- liga essa funcao ao ciclo de vida de profiles e tambem faz backfill seguro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ensure_marcos_default_pipeline_stages(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user uuid;
  v_seller_master uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  v_auth_user := auth.uid();

  BEGIN
    v_seller_master := public.get_seller_master_user_id();
  EXCEPTION
    WHEN undefined_function THEN
      v_seller_master := NULL;
  END;

  -- Chamadas vindas de trigger/migration rodam sem auth.uid(). Via API, limita a
  -- propria conta master ou ao master efetivo do vendedor logado.
  IF v_auth_user IS NOT NULL
     AND v_auth_user IS DISTINCT FROM p_user_id
     AND v_seller_master IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Nao autorizado a criar etapas do CRM do Marcos para esta conta.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.crm_pipeline_stages
    WHERE user_id = p_user_id
      AND seller_auth_id IS NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.crm_pipeline_stages (
    user_id,
    name,
    color,
    position,
    is_default,
    ativo,
    show_in_live,
    seller_auth_id
  )
  VALUES
    (p_user_id, 'Leads Inativos', '#9ca3af', 0, false, true, true, NULL),
    (p_user_id, 'Marketplace', '#f97316', 1, false, true, true, NULL),
    (p_user_id, 'Porta/loja', '#14b8a6', 2, false, true, true, NULL),
    (p_user_id, 'Não tem no Estoque', '#f43f5e', 3, false, true, true, NULL),
    (p_user_id, 'Agendamento', '#06b6d4', 4, false, true, true, NULL),
    (p_user_id, 'Negociação', '#8b5cf6', 5, false, true, true, NULL),
    (p_user_id, 'Venda concluída', '#10b981', 6, false, true, true, NULL),
    (p_user_id, 'Consignado', '#a78bfa', 7, false, true, true, NULL),
    (p_user_id, 'Indicação', '#fb923c', 8, false, true, true, NULL),
    (p_user_id, 'Redes Sociais', '#ec4899', 9, false, true, true, NULL)
  ON CONFLICT (user_id, name) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_marcos_default_pipeline_stages(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_marcos_default_pipeline_stages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_marcos_default_pipeline_stages(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_marcos_pipeline_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.role, 'owner') = 'owner' THEN
    PERFORM public.ensure_marcos_default_pipeline_stages(NEW.id);
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'ensure_marcos_pipeline_for_profile error (nao critico): %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_ensure_marcos_pipeline ON public.profiles;
CREATE TRIGGER trg_profiles_ensure_marcos_pipeline
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_marcos_pipeline_for_profile();

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT id
    FROM public.profiles
    WHERE COALESCE(role, 'owner') = 'owner'
  LOOP
    PERFORM public.ensure_marcos_default_pipeline_stages(rec.id);
  END LOOP;
END $$;
