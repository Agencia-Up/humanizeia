
CREATE TABLE public.apollo_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nova conversa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.apollo_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.apollo_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.apollo_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apollo_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own conversations"
  ON public.apollo_conversations FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own messages"
  ON public.apollo_messages FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_apollo_messages_conversation ON public.apollo_messages(conversation_id, created_at);
CREATE INDEX idx_apollo_conversations_user ON public.apollo_conversations(user_id, updated_at DESC);

CREATE TRIGGER update_apollo_conversations_updated_at
  BEFORE UPDATE ON public.apollo_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
