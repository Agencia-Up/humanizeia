-- ============================================================================
-- 20260527230000_followup_ia_config.sql
-- ----------------------------------------------------------------------------
-- Fase 1 do plano "Follow-up IA" (reativação automática de leads inativos
-- pelo agente Pedro via WhatsApp). Esta migration cria a tabela de
-- configurações que vai ser usada pela edge function pedro-trigger-followup
-- (nas fases 2+) pra respeitar horário/dias/limites/intervalos definidos
-- pelo master no novo modal "Follow-up IA".
--
-- Spec do usuário (27/05/2026):
-- - Modal 3 abas: Horário (08-19h seg-sex) / Mensagens (com toggle IA) /
--   Disparo em massa (10-30/dia, intervalo 10-45min, simular humano).
-- - 1 config por master (user_id é UNIQUE).
-- - Defaults conservadores pra evitar bloqueio em WhatsApp não-oficial.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.followup_ia_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- ── Estado geral ────────────────────────────────────────────────────────
  -- is_active=false significa "config existe mas follow-up IA NÃO dispara".
  -- Fases 2+ vão checar essa flag antes de processar a fila.
  is_active boolean NOT NULL DEFAULT false,

  -- ── Aba 1: Horário de Disparo ─────────────────────────────────────────
  horario_inicio time NOT NULL DEFAULT '08:00',
  horario_fim    time NOT NULL DEFAULT '19:00',
  -- Dias da semana: 0=domingo, 1=segunda, ..., 6=sábado.
  -- Default [1,2,3,4,5] = seg-sex.
  dias_semana int[] NOT NULL DEFAULT '{1,2,3,4,5}',

  -- ── Aba 2: Configuração de Mensagens ──────────────────────────────────
  -- Mensagem-base que serve de referência pro gerador IA (Fase 3) ou de
  -- template literal (Fase 2 antes da IA estar pronta).
  mensagem_base text NOT NULL DEFAULT 'Oi {nome}, tudo bem? Vi que vc esteve aqui há uns dias atrás procurando um carro e queria saber se ainda está interessado. Posso te ajudar?',
  -- Toggle "Gerar variações automáticas por lead". Quando true, Fase 3 vai
  -- chamar Claude pra gerar mensagem única por lead baseada no contexto.
  gerar_variacoes_ia boolean NOT NULL DEFAULT true,

  -- ── Aba 3: Disparo em Massa ───────────────────────────────────────────
  -- Quantidade máxima de disparos por dia (1-30). Default 10 (conservador).
  max_disparos_dia int NOT NULL DEFAULT 10
    CHECK (max_disparos_dia BETWEEN 1 AND 30),
  -- Intervalo MÍNIMO entre disparos em minutos (>=10 pra evitar bloqueio).
  intervalo_min_minutes int NOT NULL DEFAULT 15
    CHECK (intervalo_min_minutes >= 10),
  -- Intervalo MÁXIMO entre disparos em minutos (deve ser >= min).
  intervalo_max_minutes int NOT NULL DEFAULT 45
    CHECK (intervalo_max_minutes >= intervalo_min_minutes),
  -- Toggle "Simular comportamento humano" — adiciona jitter aleatório.
  simular_humano boolean NOT NULL DEFAULT true,

  -- ── Audit ─────────────────────────────────────────────────────────────
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- 1 config por master.
  CONSTRAINT followup_ia_config_user_id_unique UNIQUE (user_id)
);

-- Index pra lookup rápido na fase 2 (cron lê por user_id).
CREATE INDEX IF NOT EXISTS idx_followup_ia_config_user_id_active
  ON public.followup_ia_config(user_id) WHERE is_active = true;

-- ─── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.followup_ia_config ENABLE ROW LEVEL SECURITY;

-- Master vê/edita só a config dele.
DROP POLICY IF EXISTS followup_ia_config_owner ON public.followup_ia_config;
CREATE POLICY followup_ia_config_owner
  ON public.followup_ia_config
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── Trigger updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_followup_ia_config_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_followup_ia_config_updated_at ON public.followup_ia_config;
CREATE TRIGGER set_followup_ia_config_updated_at
  BEFORE UPDATE ON public.followup_ia_config
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_followup_ia_config_updated_at();

-- ─── Verificação ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'followup_ia_config'
    AND column_name IN (
      'id','user_id','is_active','horario_inicio','horario_fim','dias_semana',
      'mensagem_base','gerar_variacoes_ia','max_disparos_dia',
      'intervalo_min_minutes','intervalo_max_minutes','simular_humano',
      'created_at','updated_at'
    );
  RAISE NOTICE '[followup_ia_config] colunas criadas: % de 14', v_count;
  IF v_count <> 14 THEN
    RAISE EXCEPTION 'Esperava 14 colunas, encontrei %', v_count;
  END IF;
END $$;
