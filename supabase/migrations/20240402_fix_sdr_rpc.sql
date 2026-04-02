-- Função para incrementar o contador de respostas do agente
CREATE OR REPLACE FUNCTION public.increment_agent_replies(agent_id uuid)
RETURNS void AS $$
BEGIN
    UPDATE public.wa_ai_agents
    SET total_replies = COALESCE(total_replies, 0) + 1,
        updated_at = NOW()
    WHERE id = agent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
