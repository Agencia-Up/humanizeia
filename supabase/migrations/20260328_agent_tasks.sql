-- Create agent_tasks table to track background work
CREATE TABLE IF NOT EXISTS public.agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, -- 'maria', 'paulo', etc
    task_type TEXT NOT NULL, -- 'generate_image', 'generate_copy', etc
    status TEXT NOT NULL DEFAULT 'processing', -- 'processing', 'completed', 'failed'
    payload JSONB NOT NULL DEFAULT '{}'::jsonb, -- Store input parameters
    result JSONB DEFAULT '{}'::jsonb, -- Store output data (URLs, text, etc)
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own tasks" 
ON public.agent_tasks FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tasks" 
ON public.agent_tasks FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can update any task" 
ON public.agent_tasks FOR UPDATE 
USING (true);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.handle_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_task_updated
    BEFORE UPDATE ON public.agent_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_task_updated_at();

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_tasks;
