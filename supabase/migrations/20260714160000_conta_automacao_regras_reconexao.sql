-- ============================================================================
-- REGRAS & AUTOMAÇÕES (config por conta) — Fase 1: lembrete de RECONEXÃO.
-- Hoje o wa-instance-health-check lembra o vendedor desconectado a cada ~55min
-- (07-21h), sem on/off — hardcoded (o "loop" que o gestor quer controlar).
-- Esta tabela guarda a regra por tenant; a edge passa a LER dela (defaults =
-- comportamento atual, entao retrocompatível: sem linha => 60min/07-21h/ligado).
-- Cresce nas proximas fases (follow-up/transfer/relatorios).
-- Aplicada em prod (seyljsqmhlopkcauhlor) via MCP em 14/07; registro local.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.conta_automacao_regras (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Reconexão do vendedor desconectado
  reconexao_enabled       boolean NOT NULL DEFAULT true,
  reconexao_intervalo_min integer NOT NULL DEFAULT 60,   -- minutos entre lembretes
  reconexao_hora_ini      integer NOT NULL DEFAULT 7,    -- hora BRT inicio da janela
  reconexao_hora_fim      integer NOT NULL DEFAULT 21,   -- hora BRT fim da janela
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconexao_intervalo_chk CHECK (reconexao_intervalo_min BETWEEN 5 AND 1440),
  CONSTRAINT reconexao_janela_chk CHECK (reconexao_hora_ini BETWEEN 0 AND 23 AND reconexao_hora_fim BETWEEN 1 AND 24 AND reconexao_hora_fim > reconexao_hora_ini)
);

ALTER TABLE public.conta_automacao_regras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS car_owner_select ON public.conta_automacao_regras;
CREATE POLICY car_owner_select ON public.conta_automacao_regras
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS car_owner_insert ON public.conta_automacao_regras;
CREATE POLICY car_owner_insert ON public.conta_automacao_regras
  FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS car_owner_update ON public.conta_automacao_regras;
CREATE POLICY car_owner_update ON public.conta_automacao_regras
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
