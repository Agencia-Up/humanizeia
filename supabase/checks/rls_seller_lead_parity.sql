-- ============================================================================
-- Conferência de paridade de RLS de vendedor nas tabelas de LEAD.
-- ----------------------------------------------------------------------------
-- Detecta o tipo de bug que quebrou o "adicionar lead" do vendedor no Pedro:
-- uma tabela de lead ficar sem política de vendedor para algum comando
-- (SELECT / INSERT / UPDATE / DELETE), enquanto a irmã tem.
--
-- Rode no SQL Editor de produção (ou em CI) sempre que mexer em RLS de lead.
--   RESULTADO VAZIO = tudo certo (paridade completa).
--   Cada linha = uma (tabela, comando) SEM política de vendedor -> corrigir.
--
-- Para cobrir uma tabela nova de lead, é só adicioná-la na lista `tabelas`.
-- ============================================================================
WITH tabelas(t) AS (
  VALUES ('ai_crm_leads'), ('crm_leads')
),
cmds(c) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
SELECT tabelas.t AS tabela,
       cmds.c    AS comando_sem_politica_de_vendedor
FROM tabelas
CROSS JOIN cmds
WHERE NOT EXISTS (
  SELECT 1 FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename  = tabelas.t
    AND p.cmd        = cmds.c
    AND p.policyname LIKE 'seller_%'
)
ORDER BY 1, 2;
