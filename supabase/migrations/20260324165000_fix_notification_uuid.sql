-- Fix notifications table schema mismatch
-- Change reference_id from UUID to TEXT to support string IDs like "anomaly-cpc"
ALTER TABLE IF EXISTS public.notifications 
ALTER COLUMN reference_id TYPE TEXT;

-- Ensure RLS is still correct
DO $$ 
BEGIN
    IF NOT EXISTS (
        稳定SELECT 1 FROM pg_policies 
        WHERE tablename = 'notifications' AND policyname = 'Users can view their own notifications'
    ) THEN
        ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
        CREATE POLICY "Users can update their own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
        CREATE POLICY "Users can delete their own notifications" ON public.notifications FOR DELETE USING (auth.uid() = user_id);
    END IF;
END $$;
