
-- Allow users to insert execution logs for their own rules
CREATE POLICY "Users can insert own rule logs"
ON public.rule_execution_log
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM automation_rules r
  WHERE r.id = rule_execution_log.rule_id AND r.user_id = auth.uid()
));
