-- Replace overly permissive delete policy with authenticated-only
DROP POLICY IF EXISTS "Users can delete any visible formula" ON public.copy_formulas;

CREATE POLICY "Authenticated users can delete formulas"
ON public.copy_formulas
FOR DELETE
USING (auth.uid() IS NOT NULL);