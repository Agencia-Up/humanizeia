-- Permite leitura pública de formulários ativos (necessário para FormPublico.tsx funcionar sem login)
-- Sem esta policy, visitantes não autenticados (celular, link direto) recebem "Formulário não encontrado"
CREATE POLICY IF NOT EXISTS "Public read active forms" ON public.capture_forms
  FOR SELECT USING (is_active = true);
