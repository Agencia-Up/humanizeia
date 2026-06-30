-- Formulário do Pedro: liga um formulário de captura a um agente Pedro (IA).
-- Quando capture_forms.agent_id está preenchido, o form-submit cria um lead no
-- motor do Pedro (ai_crm_leads) e dispara a mensagem de abertura pela instância,
-- em vez do fluxo do Marcos (crm_leads + follow-up estático).
-- Aditivo e idempotente — não altera o comportamento dos formulários existentes
-- (agent_id null = continua exatamente como antes, atendendo no Marcos).

ALTER TABLE public.capture_forms
  ADD COLUMN IF NOT EXISTS agent_id uuid
    REFERENCES public.wa_ai_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pedro_opener_template text;

COMMENT ON COLUMN public.capture_forms.agent_id IS
  'Agente Pedro que atende este formulário. Null = atende no Marcos (CRM + follow-up).';
COMMENT ON COLUMN public.capture_forms.pedro_opener_template IS
  'Mensagem de abertura enviada pela instância do Pedro ao receber o cadastro. {nome} é substituído.';
