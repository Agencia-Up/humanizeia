
ALTER TABLE public.wa_campaigns
  ADD COLUMN IF NOT EXISTS listas_alvo uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS regras_delay jsonb DEFAULT '{"min": 35, "max": 89}'::jsonb,
  ADD COLUMN IF NOT EXISTS regras_rodizio jsonb DEFAULT '{"mensagens_por_instancia": 10, "pausa_entre_instancias": 300}'::jsonb,
  ADD COLUMN IF NOT EXISTS regras_aquecimento jsonb DEFAULT '{"enabled": false, "initial_messages": 20}'::jsonb,
  ADD COLUMN IF NOT EXISTS start_time timestamptz,
  ADD COLUMN IF NOT EXISTS end_time timestamptz;

-- Migrate existing data to new columns
UPDATE public.wa_campaigns
SET 
  listas_alvo = list_ids,
  regras_delay = jsonb_build_object('min', min_delay_seconds, 'max', max_delay_seconds),
  regras_rodizio = jsonb_build_object('mensagens_por_instancia', rotation_messages_per_instance, 'pausa_entre_instancias', 300),
  start_time = scheduled_at
WHERE listas_alvo = '{}'::uuid[] OR listas_alvo IS NULL;
