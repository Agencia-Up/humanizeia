-- 1. Modificar a tabela 'wa_ai_agents' para adicionar os campos do SDR

ALTER TABLE public.wa_ai_agents
ADD COLUMN IF NOT EXISTS sdr_goal text,
ADD COLUMN IF NOT EXISTS qualification_questions jsonb DEFAULT '[]'::jsonb;

-- 2. Criar a tabela 'wa_chat_history' para manter a memória do chat (Thread) do Agente via Uazapi
-- Necessário para o Agente se lembrar do que o Lead falou nas mensagens anteriores.

CREATE TABLE IF NOT EXISTS public.wa_chat_history (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES public.wa_ai_agents(id) ON DELETE CASCADE,
    instance_id text NOT NULL,        -- O ID ou Name da instância Uazapi que enviou/recebeu a mensagem
    remote_jid text NOT NULL,         -- O número do cliente no WhatsApp "5511999999999@s.whatsapp.net"
    role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content text NOT NULL,
    metadata jsonb,                   -- Campos extras (Message ID da Uazapi da msg enviada)
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS Enable
ALTER TABLE public.wa_chat_history ENABLE ROW LEVEL SECURITY;

-- Índice para buscar o histórico de um contato específico rapidamente
CREATE INDEX IF NOT EXISTS idx_wa_chat_history_remote_jid ON public.wa_chat_history(instance_id, remote_jid);

-- Policies
CREATE POLICY "Users can view their own wa_chat_history"
    ON public.wa_chat_history FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own wa_chat_history"
    ON public.wa_chat_history FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own wa_chat_history"
    ON public.wa_chat_history FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own wa_chat_history"
    ON public.wa_chat_history FOR DELETE
    USING (auth.uid() = user_id);

-- E-mail e Auth do Lead extraído pelo webhook serão salvos aqui
ALTER TABLE public.wa_chat_history
ADD COLUMN IF NOT EXISTS lead_email text,
ADD COLUMN IF NOT EXISTS lead_name text;
