
CREATE POLICY "Users can update own test variants"
  ON public.ab_test_variants FOR UPDATE
  USING (EXISTS (SELECT 1 FROM ab_tests t WHERE t.id = ab_test_variants.test_id AND t.user_id = auth.uid()));

CREATE POLICY "Users can delete own test variants"
  ON public.ab_test_variants FOR DELETE
  USING (EXISTS (SELECT 1 FROM ab_tests t WHERE t.id = ab_test_variants.test_id AND t.user_id = auth.uid()));
