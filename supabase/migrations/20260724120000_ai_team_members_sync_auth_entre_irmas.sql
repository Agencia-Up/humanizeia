-- =============================================================================
-- FIX DEFINITIVO: lead confirmado no WhatsApp "sumia" do CRM do vendedor (24/07)
--
-- CAUSA: a equipe é MATRIZ — o mesmo vendedor tem 1 linha em ai_team_members
-- POR AGENTE, mas só UMA linha carrega o login (auth_user_id). Os motores de
-- transferência/confirmação atribuem o lead à linha DO AGENTE (sem login), e
-- todo o lado de leitura (painel do vendedor, RLS, RPCs get_allowed_lead_*)
-- enxerga apenas leads atribuídos às linhas COM auth_user_id = login. Resultado
-- medido: 8 leads "fantasma" em 3 contas (4 só em 24/07) — atribuídos, status
-- em_atendimento, e invisíveis pro vendedor que confirmou.
--
-- CORREÇÃO (engine-agnóstica — 12 edges escrevem assigned_to_id; remendar cada
-- uma seria gambiarra): TODAS as linhas da mesma pessoa (mesmo tenant + mesmo
-- whatsapp_number) passam a compartilhar o auth_user_id.
--   1. Backfill das linhas órfãs (7 hoje) — cura os 8 leads na hora.
--   2. Trigger BEFORE: linha nova/atualizada SEM login ADOTA o da irmã.
--   3. Trigger AFTER: linha que GANHA login (ex.: convite aceito) ESPALHA pras
--      irmãs sem login. Guard de profundidade evita cascata.
-- Linhas removidas (removed_at) ficam de fora nas duas direções.
-- =============================================================================

-- ── 1. Backfill ──────────────────────────────────────────────────────────────
UPDATE public.ai_team_members t
SET auth_user_id = s.auth_user_id
FROM public.ai_team_members s
WHERE t.auth_user_id IS NULL
  AND t.removed_at IS NULL
  AND coalesce(t.whatsapp_number,'') <> ''
  AND s.user_id = t.user_id
  AND s.whatsapp_number = t.whatsapp_number
  AND s.auth_user_id IS NOT NULL
  AND s.removed_at IS NULL;

-- ── 2. Linha sem login ADOTA o da irmã (BEFORE INSERT/UPDATE) ────────────────
CREATE OR REPLACE FUNCTION public.atm_adopt_sibling_auth()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.auth_user_id IS NULL
     AND NEW.removed_at IS NULL
     AND coalesce(NEW.whatsapp_number,'') <> '' THEN
    SELECT s.auth_user_id INTO NEW.auth_user_id
    FROM public.ai_team_members s
    WHERE s.user_id = NEW.user_id
      AND s.whatsapp_number = NEW.whatsapp_number
      AND s.auth_user_id IS NOT NULL
      AND s.removed_at IS NULL
      AND s.id IS DISTINCT FROM NEW.id
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS atm_adopt_sibling_auth_trg ON public.ai_team_members;
CREATE TRIGGER atm_adopt_sibling_auth_trg
  BEFORE INSERT OR UPDATE ON public.ai_team_members
  FOR EACH ROW EXECUTE FUNCTION public.atm_adopt_sibling_auth();

-- ── 3. Linha que GANHA login ESPALHA pras irmãs (AFTER) ──────────────────────
CREATE OR REPLACE FUNCTION public.atm_spread_auth_to_siblings()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- o UPDATE abaixo dispara este mesmo trigger nas irmãs: corta a cascata
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF NEW.auth_user_id IS NOT NULL
     AND NEW.removed_at IS NULL
     AND coalesce(NEW.whatsapp_number,'') <> '' THEN
    UPDATE public.ai_team_members
    SET auth_user_id = NEW.auth_user_id
    WHERE user_id = NEW.user_id
      AND whatsapp_number = NEW.whatsapp_number
      AND auth_user_id IS NULL
      AND removed_at IS NULL
      AND id <> NEW.id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS atm_spread_auth_to_siblings_trg ON public.ai_team_members;
CREATE TRIGGER atm_spread_auth_to_siblings_trg
  AFTER INSERT OR UPDATE OF auth_user_id ON public.ai_team_members
  FOR EACH ROW EXECUTE FUNCTION public.atm_spread_auth_to_siblings();
