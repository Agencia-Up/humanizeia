-- Migration para inserir o Agente Pedro (SDR) caso não exista
-- Isso garante que o Douglas veja o agente na lista assim que rodar o comando db push

DO $$ 
DECLARE 
    v_user_id uuid;
BEGIN
    -- Busca o ID do Douglas
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'douglasaloan@gmail.com' LIMIT 1;

    IF v_user_id IS NOT NULL THEN
        INSERT INTO public.wa_ai_agents 
        (
            user_id,
            name, 
            agent_type, 
            system_prompt, 
            is_active, 
            model, 
            temperature,
            max_tokens,
            reply_delay_ms,
            sdr_goal, 
            qualification_questions
        )
        VALUES (
            v_user_id,
            'Pedro - SDR Lead Qualify', 
            'sdr', 
            'Você é o Pedro, um SDR (Representante de Desenvolvimento de Vendas) da HumanizeIA. Seu tom é amigável, prestativo e focado em qualificação. Você deve conversar de forma natural, sem parecer um robô. Regras: 1. Use frases curtas. 2. Nunca use markdown (**bold**). 3. Seja empático.', 
            true, 
            'google/gemini-2.5-flash',
            0.7,
            500,
            3000,
            'Qualificar o lead e agendar uma chamada de demonstração.',
            '["Qual o faturamento mensal hoje?", "Quantos funcionários tem na empresa?", "Qual a sua maior dificuldade com WhatsApp hoje?"]'::jsonb
        )
        ON CONFLICT (name, user_id) DO NOTHING;
    END IF;
END $$;
