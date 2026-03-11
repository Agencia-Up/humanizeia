
-- 1. report_templates
CREATE TABLE public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  descricao text,
  ativo boolean NOT NULL DEFAULT true,
  canais text[] NOT NULL DEFAULT '{whatsapp}',
  header_template text NOT NULL DEFAULT '📊 *Report Meta Ads — {{data}}*',
  metricas jsonb NOT NULL DEFAULT '[{"tipo":"spend","label":"Gasto Total","emoji":"💰","formato":"currency"},{"tipo":"purchases","label":"Compras","emoji":"🛒","formato":"number"},{"tipo":"cpa","label":"CPA","emoji":"💵","formato":"currency"},{"tipo":"roas","label":"ROAS","emoji":"📈","formato":"multiplier"},{"tipo":"revenue","label":"Receita","emoji":"💰","formato":"currency"}]'::jsonb,
  footer_template text NOT NULL DEFAULT '✅ Report gerado por MIDAS AI',
  ordem integer NOT NULL DEFAULT 0,
  agendamento_ativo boolean NOT NULL DEFAULT false,
  horario_envio time NOT NULL DEFAULT '08:00',
  dias_envio integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  discord_webhook_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own report templates"
  ON public.report_templates FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_report_templates_updated_at
  BEFORE UPDATE ON public.report_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. whatsapp_destinatarios
CREATE TABLE public.whatsapp_destinatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  nome text NOT NULL,
  numero text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_destinatarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own destinatarios"
  ON public.whatsapp_destinatarios FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. report_template_destinatarios (N:N)
CREATE TABLE public.report_template_destinatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.report_templates(id) ON DELETE CASCADE,
  destinatario_id uuid NOT NULL REFERENCES public.whatsapp_destinatarios(id) ON DELETE CASCADE,
  UNIQUE(template_id, destinatario_id)
);

ALTER TABLE public.report_template_destinatarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own template destinatarios"
  ON public.report_template_destinatarios FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.report_templates rt
    WHERE rt.id = report_template_destinatarios.template_id AND rt.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.report_templates rt
    WHERE rt.id = report_template_destinatarios.template_id AND rt.user_id = auth.uid()
  ));

-- 4. historico_reports
CREATE TABLE public.historico_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  template_id uuid REFERENCES public.report_templates(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  canal text NOT NULL DEFAULT 'whatsapp',
  mensagem text,
  detalhes jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.historico_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own historico"
  ON public.historico_reports FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
