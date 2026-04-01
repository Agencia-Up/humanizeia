
-- =====================================================================
-- MIGRATION: SuperAdmin e Multitenancy (Logos IA)
-- Data: 31/03/2026
-- =====================================================================

-- 1. ADICIONAR CAMPO DE SUPERADMIN NO PERFIL
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN DEFAULT FALSE;

-- 2. MARCAR DOUGLAS E WANDER COMO SUPERADMINS
UPDATE public.profiles 
SET is_superadmin = TRUE 
WHERE id IN (
  'ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0', -- Douglas
  '249610ea-94c7-41e5-9c19-d9d0841a65e6'  -- Wander
);

-- 3. ADICIONAR ORGANIZATION_ID EM TABELAS DE DADOS (Se não existir)
-- Isso permite o isolamento correto por empresa (Multi-tenancy)

DO $$ 
BEGIN 
  -- Tabela: Campaigns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'campaigns' AND column_name = 'organization_id') THEN
    ALTER TABLE public.campaigns ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
  END IF;

  -- Tabela: Creatives
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creatives' AND column_name = 'organization_id') THEN
    ALTER TABLE public.creatives ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
  END IF;

  -- Tabela: Copies
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'copies' AND column_name = 'organization_id') THEN
    ALTER TABLE public.copies ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
  END IF;

  -- Tabela: Ad Accounts
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ad_accounts' AND column_name = 'organization_id') THEN
    ALTER TABLE public.ad_accounts ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
  END IF;

  -- Tabela: Notifications (Update 400 fix compatibility)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'organization_id') THEN
    ALTER TABLE public.notifications ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
  END IF;
END $$;

-- 4. MIGRAÇÃO DE DADOS EXISTENTES (Opcional, mas seguro)
-- Atribui a organização atual do usuário aos dados que ele já criou
UPDATE public.campaigns c SET organization_id = p.organization_id FROM public.profiles p WHERE c.user_id = p.id AND c.organization_id IS NULL;
UPDATE public.creatives cr SET organization_id = p.organization_id FROM public.profiles p WHERE cr.user_id = p.id AND cr.organization_id IS NULL;
UPDATE public.copies cp SET organization_id = p.organization_id FROM public.profiles p WHERE cp.user_id = p.id AND cp.organization_id IS NULL;
UPDATE public.ad_accounts ad SET organization_id = p.organization_id FROM public.profiles p WHERE ad.user_id = p.id AND ad.organization_id IS NULL;

-- 5. ATUALIZAR POLÍTICAS RLS PARA SUPORTAR MULTITENANCY + SUPERADMIN
-- Uma política central que permite: 
-- a) SuperAdmins verem TUDO
-- b) Usuários comuns verem apenas os dados da própria Organização

-- Exemplo para Campaigns
DROP POLICY IF EXISTS "Users can manage own campaigns" ON public.campaigns;
CREATE POLICY "Users can manage organization campaigns" 
ON public.campaigns FOR ALL 
USING (
  (SELECT is_superadmin FROM public.profiles WHERE id = auth.uid()) = TRUE
  OR 
  organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);

-- Exemplo para Creatives
DROP POLICY IF EXISTS "Users can manage own creatives" ON public.creatives;
CREATE POLICY "Users can manage organization creatives" 
ON public.creatives FOR ALL 
USING (
  (SELECT is_superadmin FROM public.profiles WHERE id = auth.uid()) = TRUE
  OR 
  organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid())
);

-- Exemplo para Profiles (Permitir SuperAdmin ver todos os perfis)
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "SuperAdmins or owner can view profiles" 
ON public.profiles FOR SELECT 
USING (
  (SELECT is_superadmin FROM public.profiles WHERE id = auth.uid()) = TRUE
  OR 
  auth.uid() = id
);
