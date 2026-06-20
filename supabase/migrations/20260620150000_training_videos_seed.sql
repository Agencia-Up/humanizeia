-- ============================================================================
-- Seed das 3 primeiras aulas da biblioteca global de Treinamento.
-- Pega a id da seção pelo título (idempotente — não insere de novo se já existir
-- a mesma URL na seção). Capa = NULL pra usar a capa padrão branded (gradient
-- roxo + LOGOS|IA dourado + título), mantendo a padronização visual.
-- ============================================================================
DO $$
DECLARE
  v_owner uuid;
  v_sec_intro uuid;
  v_sec_marcos uuid;
  v_pos int;
BEGIN
  -- owner do seed = superadmin (Wander).
  SELECT id INTO v_owner FROM auth.users WHERE lower(email) = 'wandercarvalho31@gmail.com' LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE NOTICE '[training-seed] superadmin não encontrado — seed abortado';
    RETURN;
  END IF;

  SELECT id INTO v_sec_intro FROM public.training_sections
    WHERE is_global = true AND sort_order = 0 LIMIT 1;
  SELECT id INTO v_sec_marcos FROM public.training_sections
    WHERE is_global = true AND sort_order = 2 LIMIT 1;

  -- Introdução Parte 01 — Primeiros Passos
  IF v_sec_intro IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.training_videos
     WHERE section_id = v_sec_intro AND video_url = 'https://www.youtube.com/watch?v=jpZgmyb-uCE'
  ) THEN
    SELECT coalesce(max(sort_order), -1) + 1 INTO v_pos FROM public.training_videos WHERE section_id = v_sec_intro;
    INSERT INTO public.training_videos
      (section_id, user_id, is_global, title, description, video_url, platform, thumbnail_url, sort_order, audience)
    VALUES
      (v_sec_intro, v_owner, true, 'Introdução — Parte 01', 'Boas-vindas à Logos IA. Visão geral da plataforma.',
       'https://www.youtube.com/watch?v=jpZgmyb-uCE', 'youtube', NULL, v_pos, 'all');
  END IF;

  -- Introdução Parte 02 — Primeiros Passos
  IF v_sec_intro IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.training_videos
     WHERE section_id = v_sec_intro AND video_url = 'https://www.youtube.com/watch?v=DsaOjx1MOxs'
  ) THEN
    SELECT coalesce(max(sort_order), -1) + 1 INTO v_pos FROM public.training_videos WHERE section_id = v_sec_intro;
    INSERT INTO public.training_videos
      (section_id, user_id, is_global, title, description, video_url, platform, thumbnail_url, sort_order, audience)
    VALUES
      (v_sec_intro, v_owner, true, 'Introdução — Parte 02', 'Continuação da apresentação geral da plataforma.',
       'https://www.youtube.com/watch?v=DsaOjx1MOxs', 'youtube', NULL, v_pos, 'all');
  END IF;

  -- Disparo em Massa — Marcos
  IF v_sec_marcos IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.training_videos
     WHERE section_id = v_sec_marcos AND video_url = 'https://www.youtube.com/watch?v=2dsR3Q2zg70'
  ) THEN
    SELECT coalesce(max(sort_order), -1) + 1 INTO v_pos FROM public.training_videos WHERE section_id = v_sec_marcos;
    INSERT INTO public.training_videos
      (section_id, user_id, is_global, title, description, video_url, platform, thumbnail_url, sort_order, audience)
    VALUES
      (v_sec_marcos, v_owner, true, 'Disparo em Massa', 'Como disparar campanha em massa no WhatsApp com o Marcos.',
       'https://www.youtube.com/watch?v=2dsR3Q2zg70', 'youtube', NULL, v_pos, 'all');
  END IF;
END $$;
