-- Drop the restrictive delete policy and replace with one that allows deleting defaults too
DROP POLICY IF EXISTS "Users can delete own formulas" ON public.copy_formulas;

CREATE POLICY "Users can delete any visible formula"
ON public.copy_formulas
FOR DELETE
USING (true);