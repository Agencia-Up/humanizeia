-- Fix copy_formulas delete policy: restrict to own formulas only
DROP POLICY IF EXISTS "Authenticated users can delete formulas" ON public.copy_formulas;
CREATE POLICY "Users can delete own formulas"
  ON public.copy_formulas
  FOR DELETE
  USING (auth.uid() = user_id AND is_default = false);

-- Add missing trigger for auto-creating profiles on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
