-- =============================================================================
-- Marcos CRM: reorganizar stages padrão
-- =============================================================================
-- Remove "Qualificado", adiciona "Marketing Place", "Agendamento", "Lead Inativo", "Perdido".
-- Ordem final: Novo Lead → Marketing Place → Agendamento → Proposta → Negociação
--               → Fechado → Perdido → Lead Inativo → Carro não disponível → Porta
--
-- ESCOPO SEGURO: aplica APENAS a users que ainda têm o set default exato (7 stages
-- com nomes padrão). Users com customização (renomes, reordens, stages extras)
-- ficam totalmente intocados — evita destruir trabalho manual deles.
--
-- LEADS em "Qualificado" são migrados pra "Negociação" antes da DELETE.
-- Idempotente: re-rodar não muda nada (NOT EXISTS guards + filtro de detecção).

DO $$
DECLARE
  rec        RECORD;
  v_qualif_id uuid;
  v_negoc_id  uuid;
  v_processados int := 0;
BEGIN
  -- Itera só sobre users com EXATAMENTE 7 stages com nomes padrão.
  -- unaccent normaliza acentos pra comparação confiável.
  FOR rec IN
    SELECT user_id
    FROM crm_pipeline_stages
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) = 7
       AND ARRAY_AGG(unaccent(LOWER(TRIM(name))) ORDER BY position) = ARRAY[
         'novo lead', 'qualificado', 'proposta', 'negociacao',
         'fechado', 'carro nao disponivel', 'porta'
       ]
  LOOP
    -- 1. Pega IDs das stages relevantes deste user
    SELECT id INTO v_qualif_id FROM crm_pipeline_stages
      WHERE user_id = rec.user_id
        AND unaccent(LOWER(TRIM(name))) = 'qualificado';

    SELECT id INTO v_negoc_id FROM crm_pipeline_stages
      WHERE user_id = rec.user_id
        AND unaccent(LOWER(TRIM(name))) = 'negociacao';

    -- 2. Migra leads de Qualificado → Negociação (antes de deletar a stage)
    IF v_qualif_id IS NOT NULL AND v_negoc_id IS NOT NULL THEN
      UPDATE crm_leads SET stage_id = v_negoc_id WHERE stage_id = v_qualif_id;
    END IF;

    -- 3. Remove stage Qualificado
    IF v_qualif_id IS NOT NULL THEN
      DELETE FROM crm_pipeline_stages WHERE id = v_qualif_id;
    END IF;

    -- 4. Insere novas stages (NOT EXISTS evita duplicação se rodarmos 2x)
    INSERT INTO crm_pipeline_stages (user_id, name, color, position, is_default)
    SELECT rec.user_id, v.name, v.color, 999, false
    FROM (VALUES
      ('Marketing Place'::text, '#f97316'::text),  -- orange-500
      ('Agendamento'::text,     '#06b6d4'::text),  -- cyan-500
      ('Lead Inativo'::text,    '#9ca3af'::text),  -- gray-400
      ('Perdido'::text,         '#ef4444'::text)   -- red-500
    ) AS v(name, color)
    WHERE NOT EXISTS (
      SELECT 1 FROM crm_pipeline_stages existing
      WHERE existing.user_id = rec.user_id
        AND unaccent(LOWER(TRIM(existing.name))) = unaccent(LOWER(TRIM(v.name)))
    );

    -- 5. Reordena todas as 10 stages do user pra ordem desejada
    UPDATE crm_pipeline_stages SET position = CASE unaccent(LOWER(TRIM(name)))
      WHEN 'novo lead'             THEN 0
      WHEN 'marketing place'       THEN 1
      WHEN 'agendamento'           THEN 2
      WHEN 'proposta'              THEN 3
      WHEN 'negociacao'            THEN 4
      WHEN 'fechado'               THEN 5
      WHEN 'perdido'               THEN 6
      WHEN 'lead inativo'          THEN 7
      WHEN 'carro nao disponivel'  THEN 8
      WHEN 'porta'                 THEN 9
      ELSE position
    END
    WHERE user_id = rec.user_id;

    v_processados := v_processados + 1;
  END LOOP;

  RAISE NOTICE '[Marcos Stages] users processados: %', v_processados;
END $$;
