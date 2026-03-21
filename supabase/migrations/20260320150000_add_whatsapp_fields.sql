-- Adiciona campos necessários para o módulo de Automação de WhatsApp e UTMs
ALTER TABLE public.crm_leads 
ADD COLUMN IF NOT EXISTS follow_up_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS utm_source TEXT,
ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

-- Criação da tabela wa_instances se ela ainda não existir de forma robusta
CREATE TABLE IF NOT EXISTS public.wa_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'disconnected',
    qr_code TEXT,
    phone_number TEXT,
    rotator_active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ativa RLS se a tabela acabou de nascer
ALTER TABLE public.wa_instances ENABLE ROW LEVEL SECURITY;

-- Políticas
DROP POLICY IF EXISTS "Usuários gerenciam suas instâncias" ON public.wa_instances;
CREATE POLICY "Usuários gerenciam suas instâncias"
    ON public.wa_instances FOR ALL
    USING (auth.uid() = user_id);
