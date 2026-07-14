-- ============================================================================
-- PRIVACIDADE Conversas — PASSO 5: remover o SELECT amplo do vendedor.
--
-- Remove as policies que davam ao VENDEDOR leitura do inbox/chat INTEIRO do master:
--   - wa_inbox.seller_view_master_inbox         (SELECT user_id = get_seller_master_user_id())
--   - wa_chat_history.seller_view_master_chat_history (SELECT user_id = get_seller_master_user_id())
--
-- Depois disto, a leitura de conversa acontece SOMENTE via RPCs SECURITY DEFINER
-- (get_allowed_lead_conversations / get_allowed_lead_messages / get_allowed_lead_inbox),
-- que aplicam o escopo lead-only e excluem conversa interna.
--
-- ⚠️ ORDEM OBRIGATÓRIA: só aplicar em PROD DEPOIS que o front novo (commit e5162251,
-- que consome as RPCs) estiver LIVE no EasyPanel e validado. Se aplicar antes, o front
-- ANTIGO (que lê wa_inbox/wa_chat_history direto) para de mostrar conversas p/ o vendedor.
--
-- O QUE CONTINUA PERMITIDO (não tocar):
--   - wa_inbox "Users can manage own inbox" (ALL, auth.uid()=user_id) -> MASTER, dados próprios.
--   - wa_inbox seller_insert_master_inbox (INSERT) -> vendedor ENVIA mensagem.
--   - wa_inbox seller_update_master_inbox (UPDATE) -> vendedor marca como lida.
--   - wa_chat_history "insert/update/delete their own" (auth.uid()=user_id).
--   => Envio, marcar-como-lido, etiquetas, mídia, transferência e pausa/reativação IA
--      seguem funcionando (nenhum depende de SELECT amplo do vendedor).
-- ============================================================================

DROP POLICY IF EXISTS "seller_view_master_inbox" ON public.wa_inbox;
DROP POLICY IF EXISTS "seller_view_master_chat_history" ON public.wa_chat_history;
