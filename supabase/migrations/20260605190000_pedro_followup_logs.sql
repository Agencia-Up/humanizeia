-- ============================================================================
-- 20260605190000_pedro_followup_logs.sql
-- ----------------------------------------------------------------------------
-- Cria a tabela de logs detalhados para disparos de reativação automática
-- (Follow-up IA) e reativações manuais.
-- Configura índices de busca e o trigger automático de resposta em wa_inbox.
-- ============================================================================

-- 1. Cria a tabela de logs
CREATE TABLE IF NOT EXISTS public.pedro_followup_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.ai_crm_leads(id) ON DELETE SET NULL,
  remote_jid text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'sent', -- 'sent', 'failed', 'delivered', 'responded'
  error_message text,
  type text NOT NULL DEFAULT 'ia', -- 'ia' ou 'manual'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Índices de performance para busca rápida pelo dashboard
CREATE INDEX IF NOT EXISTS idx_pedro_fu_logs_user_date 
  ON public.pedro_followup_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pedro_fu_logs_lead_status
  ON public.pedro_followup_logs(lead_id, status);

-- 3. Habilita RLS para proteção multi-tenant
ALTER TABLE public.pedro_followup_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pedro_fu_logs_owner ON public.pedro_followup_logs;
CREATE POLICY pedro_fu_logs_owner
  ON public.pedro_followup_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- 4. Função e trigger para marcar log como 'responded' quando o lead responde
CREATE OR REPLACE FUNCTION public.mark_pedro_followup_log_on_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  -- direction = 'incoming' significa mensagem enviada pelo cliente
  IF NEW.direction = 'incoming' AND NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
    -- Localiza o lead pelo telefone/jid e user_id
    SELECT id INTO v_lead_id 
    FROM public.ai_crm_leads 
    WHERE user_id = NEW.user_id 
      AND (remote_jid = NEW.phone || '@s.whatsapp.net' OR remote_jid = NEW.phone)
    LIMIT 1;
    
    IF v_lead_id IS NOT NULL THEN
      -- Atualiza o último envio desse lead que estava como enviado ('sent') para respondido
      UPDATE public.pedro_followup_logs
         SET status = 'responded', updated_at = now()
       WHERE lead_id = v_lead_id
         AND status = 'sent';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedro_followup_log_on_reply ON public.wa_inbox;
CREATE TRIGGER trg_pedro_followup_log_on_reply
AFTER INSERT ON public.wa_inbox
FOR EACH ROW EXECUTE FUNCTION public.mark_pedro_followup_log_on_reply();

-- 5. Verificação
DO $$
DECLARE
  v_table_exists int;
  v_trigger_exists int;
BEGIN
  SELECT count(*) INTO v_table_exists
  FROM information_schema.tables
  WHERE table_schema='public' AND table_name='pedro_followup_logs';

  SELECT count(*) INTO v_trigger_exists
  FROM pg_trigger
  WHERE tgname = 'trg_pedro_followup_log_on_reply';

  IF v_table_exists <> 1 THEN
    RAISE EXCEPTION '[pedro_followup_logs] tabela nao criada!';
  END IF;
  IF v_trigger_exists < 1 THEN
    RAISE EXCEPTION '[pedro_followup_logs] trigger nao criado!';
  END IF;

  RAISE NOTICE '[pedro_followup_logs] OK -> Tabela e trigger criados.';
END $$;
