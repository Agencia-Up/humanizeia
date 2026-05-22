-- =============================================================================
-- Fase 6.6 — Trigger que popula dynamic_fields_audit_log automaticamente
-- =============================================================================
-- Insert → 'created'
-- Update de status → 'approved'/'rejected'/'archived' conforme novo valor

CREATE OR REPLACE FUNCTION public.dynamic_fields_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entity_type text;
  v_action      text;
  v_performed   uuid;
BEGIN
  -- Determina entity_type pela tabela
  IF TG_TABLE_NAME = 'cities' THEN
    v_entity_type := 'city';
  ELSIF TG_TABLE_NAME = 'lead_sources' THEN
    v_entity_type := 'lead_source';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_performed := NEW.created_by;
    INSERT INTO public.dynamic_fields_audit_log
      (user_id, entity_type, entity_id, action, performed_by, payload)
    VALUES (
      NEW.user_id,
      v_entity_type,
      NEW.id,
      v_action,
      v_performed,
      jsonb_build_object('name', NEW.name, 'status', NEW.status, 'is_system_default', NEW.is_system_default)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := CASE NEW.status
        WHEN 'active'    THEN 'approved'
        WHEN 'rejected'  THEN 'rejected'
        WHEN 'archived'  THEN 'archived'
        ELSE 'edited'
      END;
      v_performed := COALESCE(NEW.approved_by, NEW.created_by);
      INSERT INTO public.dynamic_fields_audit_log
        (user_id, entity_type, entity_id, action, performed_by, payload)
      VALUES (
        NEW.user_id,
        v_entity_type,
        NEW.id,
        v_action,
        v_performed,
        jsonb_build_object(
          'name', NEW.name,
          'old_status', OLD.status,
          'new_status', NEW.status
        )
      );
    ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
      INSERT INTO public.dynamic_fields_audit_log
        (user_id, entity_type, entity_id, action, performed_by, payload)
      VALUES (
        NEW.user_id,
        v_entity_type,
        NEW.id,
        'edited',
        NEW.created_by,
        jsonb_build_object('old_name', OLD.name, 'new_name', NEW.name)
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Triggers em cities
DROP TRIGGER IF EXISTS cities_audit_trigger ON public.cities;
CREATE TRIGGER cities_audit_trigger
  AFTER INSERT OR UPDATE ON public.cities
  FOR EACH ROW EXECUTE FUNCTION public.dynamic_fields_audit_trigger();

-- Triggers em lead_sources
DROP TRIGGER IF EXISTS lead_sources_audit_trigger ON public.lead_sources;
CREATE TRIGGER lead_sources_audit_trigger
  AFTER INSERT OR UPDATE ON public.lead_sources
  FOR EACH ROW EXECUTE FUNCTION public.dynamic_fields_audit_trigger();

-- Verificação
DO $$
DECLARE
  v_trigger_count int;
BEGIN
  SELECT COUNT(*) INTO v_trigger_count
  FROM pg_trigger
  WHERE tgname IN ('cities_audit_trigger', 'lead_sources_audit_trigger');
  RAISE NOTICE '[Fase 6.6] Triggers criadas: %', v_trigger_count;
END $$;
