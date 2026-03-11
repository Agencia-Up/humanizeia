
-- Create table for custom copy formulas
CREATE TABLE public.copy_formulas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  description TEXT NOT NULL,
  example TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.copy_formulas ENABLE ROW LEVEL SECURITY;

-- Users can view their own formulas + defaults
CREATE POLICY "Users can view own and default formulas"
ON public.copy_formulas
FOR SELECT
USING (user_id = auth.uid() OR is_default = true);

-- Users can create their own formulas
CREATE POLICY "Users can create formulas"
ON public.copy_formulas
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own formulas
CREATE POLICY "Users can update own formulas"
ON public.copy_formulas
FOR UPDATE
USING (auth.uid() = user_id AND is_default = false);

-- Users can delete their own formulas
CREATE POLICY "Users can delete own formulas"
ON public.copy_formulas
FOR DELETE
USING (auth.uid() = user_id AND is_default = false);

-- Trigger for updated_at
CREATE TRIGGER update_copy_formulas_updated_at
BEFORE UPDATE ON public.copy_formulas
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
