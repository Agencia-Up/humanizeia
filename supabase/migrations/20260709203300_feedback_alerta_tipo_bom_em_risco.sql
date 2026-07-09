-- Alerta em tempo real "bom cliente em risco": novo valor do enum (ADITIVO —
-- enums so estendidos, nunca reduzidos). O gatilho "marcou como ruim" ficou
-- cego na pratica (vendedores quase nao usam 'Perdido' no CRM; o cerebro nao
-- flagra descarte), entao o alerta passou a disparar em "cliente que o cerebro
-- considera BOM mas foi mal atendido e esta escapando". Aplicado em prod via MCP.
ALTER TYPE public.feedback_tipo_alerta ADD VALUE IF NOT EXISTS 'bom_em_risco';
