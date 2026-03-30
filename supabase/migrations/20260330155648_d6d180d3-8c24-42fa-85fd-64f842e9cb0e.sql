-- Create a table for user quiz responses
CREATE TABLE IF NOT EXISTS public.user_quiz_responses (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nicho_identificado TEXT NOT NULL,
    respostas_completas JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_quiz_responses ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own quiz responses" 
ON public.user_quiz_responses 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own quiz responses" 
ON public.user_quiz_responses 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own quiz responses" 
ON public.user_quiz_responses 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_quiz_responses_updated_at
BEFORE UPDATE ON public.user_quiz_responses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add a column to profiles to track if quiz is completed (optional but helpful)
ALTER TABLE IF EXISTS public.profiles ADD COLUMN IF NOT EXISTS quiz_completed BOOLEAN DEFAULT false;
