
-- Create swipe_files table for storing reference copies
CREATE TABLE public.swipe_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'geral',
  platform TEXT DEFAULT 'meta',
  tags TEXT[] DEFAULT '{}',
  is_favorite BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.swipe_files ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own swipe files"
ON public.swipe_files FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create own swipe files"
ON public.swipe_files FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own swipe files"
ON public.swipe_files FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own swipe files"
ON public.swipe_files FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_swipe_files_updated_at
BEFORE UPDATE ON public.swipe_files
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
