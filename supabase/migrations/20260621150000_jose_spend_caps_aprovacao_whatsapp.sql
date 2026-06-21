-- José v3.1 / Fase 0: número do responsável que recebe o gate SIM/NÃO no WhatsApp.
-- O responsável cadastra o número na aba Limites do painel; o José manda o
-- "Responda SIM/NÃO" pra ele pela MESMA instância do Pedro. Linha user-level
-- (ad_account_id NULL) é a que vale.
ALTER TABLE public.jose_spend_caps
  ADD COLUMN IF NOT EXISTS aprovacao_whatsapp text;
COMMENT ON COLUMN public.jose_spend_caps.aprovacao_whatsapp IS
  'WhatsApp do responsavel que recebe o gate SIM/NAO do Jose (linha user-level, ad_account_id NULL).';
