-- Backfill defensivo do historico de feedback.
--
-- A funcao feedback_relatorio_diario_dados foi corrigida para contar os leads
-- reais do CRM. Este backfill atualiza relatorios ja gravados que ainda podem
-- ter "leads_analisados" antigo sendo lido como total de leads recebidos.
DO $$
BEGIN
  IF to_regclass('public.feedback_relatorios') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'feedback_relatorios'
      AND column_name = 'resumo'
  ) THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'feedback_relatorios'
      AND column_name = 'tenant_id'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'feedback_relatorios'
      AND column_name = 'data_ref'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.feedback_relatorios fr
  SET resumo =
    COALESCE(fr.resumo, '{}'::jsonb)
    || jsonb_build_object(
      'periodo_dias', 7,
      'ref_date', (dados.payload->>'ref_date'),
      'leads_recebidos', COALESCE((dados.payload->'funil'->>'chegaram')::int, 0),
      'leads_analisados', COALESCE((dados.payload->'funil'->>'analisados')::int, 0),
      'pendentes_analise', COALESCE((dados.payload->'funil'->>'pendentes_analise')::int, 0),
      'leads_qualificados', COALESCE((dados.payload->'funil'->>'qualificados')::int, 0),
      'leads_bem_atendidos', COALESCE((dados.payload->'funil'->>'bem_atendidos')::int, 0),
      'vendas', COALESCE((dados.payload->'funil'->>'vendas')::int, 0)
    )
  FROM LATERAL (
    SELECT public.feedback_relatorio_diario_dados(
      fr.tenant_id,
      CASE
        WHEN COALESCE(fr.resumo->>'periodo_dias', '') ~ '^[0-9]+$'
          THEN GREATEST((fr.resumo->>'periodo_dias')::int, 1)
        ELSE 7
      END,
      CASE
        WHEN COALESCE(fr.resumo->>'ref_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          THEN (fr.resumo->>'ref_date')::date
        ELSE fr.data_ref - 1
      END
    ) AS payload
  ) dados
  WHERE fr.tenant_id IS NOT NULL
    AND fr.data_ref IS NOT NULL
    AND (
      fr.resumo IS NULL
      OR NOT (fr.resumo ? 'leads_recebidos')
      OR COALESCE(
        CASE WHEN COALESCE(fr.resumo->>'leads_recebidos', '') ~ '^-?[0-9]+$'
          THEN (fr.resumo->>'leads_recebidos')::int
        END,
        -1
      )
        <> COALESCE((dados.payload->'funil'->>'chegaram')::int, 0)
      OR COALESCE(
        CASE WHEN COALESCE(fr.resumo->>'leads_analisados', '') ~ '^-?[0-9]+$'
          THEN (fr.resumo->>'leads_analisados')::int
        END,
        -1
      )
        <> COALESCE((dados.payload->'funil'->>'analisados')::int, 0)
    );
END $$;
