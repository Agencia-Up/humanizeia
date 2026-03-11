
-- Allow anon users to see default formulas
CREATE POLICY "Anyone can view default formulas"
ON public.copy_formulas
FOR SELECT
USING (is_default = true);
