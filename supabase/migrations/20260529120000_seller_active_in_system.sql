-- ════════════════════════════════════════════════════════════════════════
-- Separação de dois conceitos independentes de "vendedor ativo"
-- ════════════════════════════════════════════════════════════════════════
-- Antes desta migration, a coluna `is_active` de ai_team_members fazia DOIS
-- papéis ao mesmo tempo:
--   (1) distribuição automática de leads do agente (round-robin no uazapi-webhook)
--   (2) visibilidade do vendedor no CRM ao vivo e nos módulos manuais
--
-- Isso causava o bug: ao marcar um vendedor como "Ausente"/"Pausado" no agente
-- de IA (parar de receber leads de tráfego pago), ele DESAPARECIA do CRM ao vivo
-- e dos demais módulos — mesmo continuando ativo no sistema.
--
-- A partir daqui os conceitos ficam separados:
--   • is_active          → "Ativo no Agente de IA": APENAS distribuição automática
--                          de leads via WhatsApp (tráfego pago / round-robin).
--                          Continua sendo a fonte de verdade do backend
--                          (uazapi-webhook) — NÃO MUDA de semântica.
--   • active_in_system   → "Ativo no Sistema": fonte de verdade do painel
--                          "Vendedores". Controla a visibilidade do vendedor no
--                          CRM ao vivo e em TODOS os módulos manuais (Consignado,
--                          Marketplace, Indicação, Porta a porta, ranking, etc).
--
-- Regras de negócio (espelhadas na UI):
--   • ativo no sistema  + ativo no agente  → aparece em tudo + recebe lead auto
--   • ativo no sistema  + inativo no agente → aparece em tudo, MAS não recebe lead auto
--   • inativo no sistema                    → não aparece em nada
--
-- DEFAULT true + backfill implícito: todos os vendedores existentes continuam
-- visíveis (inclusive os que estavam só "pausados no agente"), corrigindo o bug
-- de desaparecimento sem afetar a distribuição.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.ai_team_members
  ADD COLUMN IF NOT EXISTS active_in_system BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.ai_team_members.active_in_system IS
  'Ativo no sistema (fonte de verdade do painel Vendedores): controla a visibilidade do vendedor no CRM ao vivo e nos módulos manuais. Independente de is_active, que controla APENAS a distribuição automática de leads do agente de IA (round-robin / tráfego pago).';

CREATE INDEX IF NOT EXISTS idx_ai_team_members_active_in_system
  ON public.ai_team_members(user_id, active_in_system);
