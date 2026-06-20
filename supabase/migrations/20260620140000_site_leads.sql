-- ============================================================================
-- Leads do site (formulário "Quero testar agora" da home nova). Visitante anônimo
-- INSERE; só superadmin LÊ. Não expõe dados (sem SELECT pra anon). Idempotente.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.site_leads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text NOT NULL,
  whatsapp    text NOT NULL,
  email       text,
  mensagem    text,
  origem      text,                 -- de qual CTA veio (home_hero, pedro, etc.)
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_leads ENABLE ROW LEVEL SECURITY;

-- Grants (RLS continua valendo por cima): anon pode inserir; authenticated lê via policy.
GRANT INSERT ON public.site_leads TO anon, authenticated;
GRANT SELECT ON public.site_leads TO authenticated;

-- Visitante (anon) ou logado pode CRIAR um lead pelo formulário.
DROP POLICY IF EXISTS "site_leads_insert_anyone" ON public.site_leads;
CREATE POLICY "site_leads_insert_anyone" ON public.site_leads
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Só superadmin LÊ os leads (ninguém anônimo lê).
DROP POLICY IF EXISTS "site_leads_select_superadmin" ON public.site_leads;
CREATE POLICY "site_leads_select_superadmin" ON public.site_leads
  FOR SELECT TO authenticated
  USING (public._is_caller_superadmin());

CREATE INDEX IF NOT EXISTS idx_site_leads_created ON public.site_leads (created_at DESC);
