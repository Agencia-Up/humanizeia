-- =============================================================================
-- Fase 6.5b — dynamic_field_settings (toggle auto_approve por user)
-- Fase 6.5e — Trigger: inserir notification quando status='pending_review'
-- =============================================================================

-- ─── Tabela de configuração por user (master) ───
CREATE TABLE IF NOT EXISTS public.dynamic_field_settings (
  user_id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cities_auto_approve           boolean NOT NULL DEFAULT true,
  lead_sources_auto_approve     boolean NOT NULL DEFAULT true,
  notify_on_pending             boolean NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dynamic_field_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dfs_select_own ON public.dynamic_field_settings;
CREATE POLICY dfs_select_own ON public.dynamic_field_settings
  FOR SELECT
  USING (user_id = auth.uid()
    OR user_id IN (SELECT p.manager_id FROM public.profiles p WHERE p.id = auth.uid() AND p.manager_id IS NOT NULL));

DROP POLICY IF EXISTS dfs_upsert_own ON public.dynamic_field_settings;
CREATE POLICY dfs_upsert_own ON public.dynamic_field_settings
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── Função helper: seed row de settings + retorna ───
CREATE OR REPLACE FUNCTION public.ensure_dynamic_field_settings(p_user_id uuid)
RETURNS public.dynamic_field_settings
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row public.dynamic_field_settings;
BEGIN
  SELECT * INTO v_row FROM public.dynamic_field_settings WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.dynamic_field_settings (user_id) VALUES (p_user_id) RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;

-- ─── Trigger: notification quando entra pending_review ───
CREATE OR REPLACE FUNCTION public.notify_dynamic_field_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entity_label text;
  v_settings public.dynamic_field_settings;
BEGIN
  -- Só dispara quando o NEW.status entra como 'pending_review'
  IF NEW.status <> 'pending_review' THEN
    RETURN NEW;
  END IF;
  -- Se UPDATE, só dispara se mudou DE outro status PRA pending
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending_review' THEN
    RETURN NEW;
  END IF;

  v_entity_label := CASE TG_TABLE_NAME
    WHEN 'cities' THEN 'cidade'
    WHEN 'lead_sources' THEN 'origem de lead'
    ELSE 'campo'
  END;

  -- Master + qualquer membro com role 'manager' do mesmo master
  INSERT INTO public.notifications (user_id, type, title, message, reference_type, reference_id, action_url)
  SELECT
    target.id,
    'pending_review',
    'Nova ' || v_entity_label || ' aguardando aprovação',
    '"' || NEW.name || '" foi sugerido por um vendedor e precisa de revisão.',
    'dynamic_field',
    NEW.id::text,
    '/configuracoes/campos-dinamicos'
  FROM (
    -- Master é sempre notificado
    SELECT NEW.user_id AS id
    UNION
    -- Demais managers da mesma conta (manager_id = master)
    SELECT p.id FROM public.profiles p WHERE p.manager_id = NEW.user_id AND p.role IN ('manager', 'owner')
  ) target;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Notification é nice-to-have. Não bloqueia o insert principal
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cities_notify_pending ON public.cities;
CREATE TRIGGER cities_notify_pending
  AFTER INSERT OR UPDATE OF status ON public.cities
  FOR EACH ROW EXECUTE FUNCTION public.notify_dynamic_field_pending();

DROP TRIGGER IF EXISTS lead_sources_notify_pending ON public.lead_sources;
CREATE TRIGGER lead_sources_notify_pending
  AFTER INSERT OR UPDATE OF status ON public.lead_sources
  FOR EACH ROW EXECUTE FUNCTION public.notify_dynamic_field_pending();

-- ─── Função RPC pra contar pendentes (badge no sidebar) ───
CREATE OR REPLACE FUNCTION public.count_pending_dynamic_fields(p_user_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    (SELECT COUNT(*) FROM public.cities WHERE user_id = p_user_id AND status = 'pending_review')::int
  + (SELECT COUNT(*) FROM public.lead_sources WHERE user_id = p_user_id AND status = 'pending_review')::int;
$$;

-- ─── Validação ───
DO $$
BEGIN
  RAISE NOTICE '[6.5b] dynamic_field_settings criada';
  RAISE NOTICE '[6.5e] triggers cities_notify_pending + lead_sources_notify_pending criadas';
  RAISE NOTICE '[6.5f] função count_pending_dynamic_fields criada';
END $$;
