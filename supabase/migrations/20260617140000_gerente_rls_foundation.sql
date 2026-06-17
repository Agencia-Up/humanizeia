-- ============================================================================
-- Papel GERENTE — Fundação de acesso (RLS) + coluna de limitações
-- ----------------------------------------------------------------------------
-- O gerente (profiles.role='manager', profiles.manager_id = id do dono) tem
-- acesso AMPLO à conta do dono dele — vê/gerencia tudo da conta — porém SÓ da
-- conta dele (isolamento entre contas mantido). Diferente do vendedor, que só
-- vê os leads atribuídos a ele.
--
-- Mecanismo: policies aditivas keyed em get_user_role()='manager' AND
-- user_id = get_my_manager_id() (ambas SECURITY DEFINER, lêem profiles —
-- sem recursão). Não afeta dono nem vendedor (a policy só casa p/ manager).
-- Edge functions usam service-role (BYPASSRLS) — intactas.
--
-- Esta é a FUNDAÇÃO (acesso). O convite que cria o gerente, o front e a tela
-- de limitações vêm em etapas seguintes. Sem nenhum gerente cadastrado ainda,
-- estas policies ficam dormentes (não mudam nada hoje).
--
-- ROLLBACK: DROP das policies manager_all_* abaixo.
-- ============================================================================

-- Limitações do gerente (jsonb; null = acesso total). Preenchida pela tela de
-- config do dono (etapa futura). Guardada no profiles do proprio gerente.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS manager_features jsonb;

-- Helper: a policy do gerente é sempre "é manager E a linha é da conta do meu
-- master". Aplicado em cada tabela do painel.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_crm_leads',
    'ai_team_members',
    'wa_ai_agents',
    'wa_instances',
    'ai_lead_transfers'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS manager_all_%1$s ON public.%1$s;', t);
    EXECUTE format($f$
      CREATE POLICY manager_all_%1$s ON public.%1$s
        FOR ALL TO authenticated
        USING (public.get_user_role() = 'manager' AND user_id = public.get_my_manager_id())
        WITH CHECK (public.get_user_role() = 'manager' AND user_id = public.get_my_manager_id());
    $f$, t);
  END LOOP;
END $$;
