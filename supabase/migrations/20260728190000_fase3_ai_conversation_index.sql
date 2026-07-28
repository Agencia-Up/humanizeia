-- =============================================================================
-- FASE 3 v2 (RASCUNHO — NÃO APLICAR; sufixo .DRAFT impede apply acidental)
-- Projeção canônica de conversas das instâncias de IA.
-- Revisado conforme os 10 pontos do dono (28/07). Aditiva e idempotente.
-- =============================================================================

-- ── 1. Telefone canônico = ESPELHO EXATO do gateway (normalizeBrazilPhone) ────
-- Regra única: só dígitos; se começa com 55 e tem ≥12 dígitos, mantém; se tem
-- 10/11 dígitos, prefixa 55; QUALQUER outra coisa fica INTOCADA (estrangeiro,
-- curto, lixo). NÃO inventa nem remove 9º dígito (ponto 2 — validado contra
-- dados reais: leads vivem em 13/12 dígitos; espelho conferido caso a caso).
CREATE OR REPLACE FUNCTION public.logos_phone_canonical(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH d AS (SELECT regexp_replace(coalesce(raw,''), '\D', '', 'g') AS x)
  SELECT nullif(CASE
    WHEN x LIKE '55%' AND length(x) >= 12 THEN x
    WHEN length(x) IN (10,11) THEN '55' || x
    ELSE x
  END, '') FROM d;
$$;

-- Guard de sanidade dos ALIMENTADORES (não é normalização): identidade só nasce
-- de um telefone plausível (8..15 dígitos, teto E.164). Barrado o lixo real
-- observado na wa_inbox histórica (ids de grupo/broadcast com 18/23 dígitos).
CREATE OR REPLACE FUNCTION public.logos_phone_plausible(canon text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT canon IS NOT NULL AND length(canon) BETWEEN 8 AND 15;
$$;

-- ── 2. Projeção ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_conversation_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_id uuid NULL,
  agent_id uuid NULL,
  phone_raw text,
  phone_canonical text NOT NULL,
  contact_name text,
  profile_picture_url text,
  last_message text,
  last_message_type text,
  last_message_direction text,
  last_message_at timestamptz,
  message_count integer NOT NULL DEFAULT 0,
  origem text NOT NULL DEFAULT 'webhook' CHECK (origem IN ('webhook','v3','backfill')),
  crm_lead_id uuid NULL,
  crm_source text NULL CHECK (crm_source IS NULL OR crm_source IN ('pedro','marcos')),
  -- ponto 3: 'ambiguous' quando há mais de uma candidata e NENHUMA escolha é feita
  crm_match_status text NOT NULL DEFAULT 'orphan' CHECK (crm_match_status IN ('linked','orphan','ambiguous')),
  ai_line boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),   -- imutável
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_conv_index_identity
  ON public.ai_conversation_index (user_id, instance_id, phone_canonical)
  NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS ai_conv_index_list
  ON public.ai_conversation_index (user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS ai_conv_index_orphans
  ON public.ai_conversation_index (user_id) WHERE crm_lead_id IS NULL;
CREATE INDEX IF NOT EXISTS ai_conv_index_phone
  ON public.ai_conversation_index (user_id, phone_canonical);

ALTER TABLE public.ai_conversation_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversation_index FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_conversation_index FROM anon, authenticated;
GRANT ALL ON public.ai_conversation_index TO service_role;

-- ── 3. Fila de reconciliação (ponto 9: trigger NUNCA derruba a escrita) ──────
CREATE TABLE IF NOT EXISTS public.ai_conv_index_deadletter (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem text NOT NULL,             -- wa_inbox | v3_inbox | v3_outbox | link_pedro | link_marcos
  ref text,                         -- id/event_id/effect_id da linha de origem
  user_id uuid,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  repaired_at timestamptz
);
ALTER TABLE public.ai_conv_index_deadletter ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_conv_index_deadletter FROM anon, authenticated;
GRANT ALL ON public.ai_conv_index_deadletter TO service_role;

-- ── 4. Serialização por identidade (ponto 1: corrida NULL→instância) ─────────
-- Toda operação de identidade (upsert/adoção/vínculo) roda sob advisory lock
-- transacional do par (tenant, telefone) — duas transações concorrentes sobre o
-- MESMO contato serializam; contatos diferentes não se bloqueiam.
CREATE OR REPLACE FUNCTION public.ai_conv_index_lock(p_user uuid, p_canon text)
RETURNS void LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_canon, 42));
$$;

-- ── 5. ADOÇÃO/MERGE atômico da órfã (ponto 1) ────────────────────────────────
-- Chamada sempre que um alimentador CONHECE a instância. Vencedora determinística
-- = a linha COM instance_id. Preserva: menor first_seen/created, maior last_*
-- (empate: mantém o da vencedora), soma message_count, coalesce de CRM/nome/foto.
CREATE OR REPLACE FUNCTION public.ai_conv_index_adopt_instance(
  p_user uuid, p_canon text, p_instance uuid, p_agent uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_orphan public.ai_conversation_index%rowtype;
        v_winner public.ai_conversation_index%rowtype;
BEGIN
  IF p_instance IS NULL OR NOT public.logos_phone_plausible(p_canon) THEN RETURN; END IF;
  PERFORM public.ai_conv_index_lock(p_user, p_canon);

  SELECT * INTO v_orphan FROM public.ai_conversation_index
   WHERE user_id = p_user AND phone_canonical = p_canon AND instance_id IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_winner FROM public.ai_conversation_index
   WHERE user_id = p_user AND phone_canonical = p_canon AND instance_id = p_instance
   FOR UPDATE;

  IF FOUND THEN
    -- MERGE: órfã entra na vencedora; nunca ficam duas.
    UPDATE public.ai_conversation_index w SET
      agent_id      = coalesce(w.agent_id, v_orphan.agent_id, p_agent),
      phone_raw     = coalesce(w.phone_raw, v_orphan.phone_raw),
      contact_name  = coalesce(w.contact_name, v_orphan.contact_name),
      profile_picture_url = coalesce(w.profile_picture_url, v_orphan.profile_picture_url),
      last_message           = CASE WHEN v_orphan.last_message_at > coalesce(w.last_message_at,'-infinity') THEN v_orphan.last_message ELSE w.last_message END,
      last_message_type      = CASE WHEN v_orphan.last_message_at > coalesce(w.last_message_at,'-infinity') THEN v_orphan.last_message_type ELSE w.last_message_type END,
      last_message_direction = CASE WHEN v_orphan.last_message_at > coalesce(w.last_message_at,'-infinity') THEN v_orphan.last_message_direction ELSE w.last_message_direction END,
      last_message_at = greatest(coalesce(w.last_message_at,'-infinity'), coalesce(v_orphan.last_message_at,'-infinity')),
      message_count   = w.message_count + v_orphan.message_count,
      first_seen_at   = least(w.first_seen_at, v_orphan.first_seen_at),
      crm_lead_id     = coalesce(w.crm_lead_id, v_orphan.crm_lead_id),
      crm_source      = coalesce(w.crm_source, v_orphan.crm_source),
      crm_match_status = CASE WHEN coalesce(w.crm_lead_id, v_orphan.crm_lead_id) IS NOT NULL THEN 'linked' ELSE greatest(w.crm_match_status, v_orphan.crm_match_status) END,
      updated_at = now()
    WHERE w.id = v_winner.id;
    DELETE FROM public.ai_conversation_index WHERE id = v_orphan.id;
  ELSE
    -- Só a órfã existe: ela VIRA a linha da instância (mesma linha, sem cópia).
    UPDATE public.ai_conversation_index
       SET instance_id = p_instance, agent_id = coalesce(agent_id, p_agent), updated_at = now()
     WHERE id = v_orphan.id;
  END IF;
END $$;

-- ── 6. Upsert canônico ───────────────────────────────────────────────────────
-- ponto 5 (fora de ordem): preview/direção/última só avançam com event_at
-- ESTRITAMENTE maior; empate mantém o existente (determinístico: 1º a gravar
-- naquele instante vence). created_at nunca muda; first_seen_at = menor.
-- ponto 6 (dupla contagem): p_count_delta>0 SÓ no alimentador wa_inbox — pós-F2
-- a wa_inbox captura TODO o privado da linha de IA (1 linha real = 1 insert,
-- já deduplicada pelo índice único = 1 disparo de trigger = 1 incremento).
-- V3 nunca conta (delta 0): só garante existência/preview. Histórico pré-F2 é
-- recalculado pelo backfill (F7) com união dedupada.
-- p_create=false (ponto 7): outbox NUNCA cria conversa — só atualiza existente.
CREATE OR REPLACE FUNCTION public.ai_conv_index_upsert(
  p_user uuid, p_instance uuid, p_phone_raw text,
  p_agent uuid, p_name text,
  p_msg text, p_msg_type text, p_dir text, p_at timestamptz,
  p_count_delta int, p_origem text, p_create boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_canon text := public.logos_phone_canonical(p_phone_raw);
BEGIN
  IF p_user IS NULL OR NOT public.logos_phone_plausible(v_canon) THEN RETURN; END IF;
  PERFORM public.ai_conv_index_lock(p_user, v_canon);
  IF p_instance IS NOT NULL THEN
    PERFORM public.ai_conv_index_adopt_instance(p_user, v_canon, p_instance, p_agent);
  END IF;
  IF NOT p_create THEN
    UPDATE public.ai_conversation_index i SET
      last_message           = CASE WHEN p_at > coalesce(i.last_message_at,'-infinity') THEN p_msg ELSE i.last_message END,
      last_message_type      = CASE WHEN p_at > coalesce(i.last_message_at,'-infinity') THEN p_msg_type ELSE i.last_message_type END,
      last_message_direction = CASE WHEN p_at > coalesce(i.last_message_at,'-infinity') THEN p_dir ELSE i.last_message_direction END,
      last_message_at        = greatest(coalesce(i.last_message_at,'-infinity'), p_at),
      updated_at = now()
    WHERE i.user_id = p_user AND i.phone_canonical = v_canon
      AND (i.instance_id = p_instance OR (i.instance_id IS NULL AND p_instance IS NULL) OR p_instance IS NULL);
    RETURN;
  END IF;
  INSERT INTO public.ai_conversation_index AS i (
    user_id, instance_id, agent_id, phone_raw, phone_canonical, contact_name,
    last_message, last_message_type, last_message_direction, last_message_at,
    message_count, origem
  ) VALUES (
    p_user, p_instance, p_agent, p_phone_raw, v_canon, nullif(p_name,''),
    p_msg, p_msg_type, p_dir, p_at, greatest(p_count_delta,0), p_origem
  )
  ON CONFLICT (user_id, instance_id, phone_canonical) DO UPDATE SET
    agent_id     = coalesce(i.agent_id, excluded.agent_id),
    phone_raw    = coalesce(excluded.phone_raw, i.phone_raw),
    contact_name = coalesce(excluded.contact_name, i.contact_name),
    last_message           = CASE WHEN excluded.last_message_at > coalesce(i.last_message_at,'-infinity') THEN excluded.last_message ELSE i.last_message END,
    last_message_type      = CASE WHEN excluded.last_message_at > coalesce(i.last_message_at,'-infinity') THEN excluded.last_message_type ELSE i.last_message_type END,
    last_message_direction = CASE WHEN excluded.last_message_at > coalesce(i.last_message_at,'-infinity') THEN excluded.last_message_direction ELSE i.last_message_direction END,
    last_message_at        = greatest(coalesce(i.last_message_at,'-infinity'), excluded.last_message_at),
    message_count = i.message_count + greatest(p_count_delta,0),
    updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public.ai_conv_index_upsert(uuid,uuid,text,uuid,text,text,text,text,timestamptz,int,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_conv_index_adopt_instance(uuid,text,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ── 7. Alimentador wa_inbox (ÚNICA fonte contadora) ──────────────────────────
CREATE OR REPLACE FUNCTION public.ai_conv_index_from_wa_inbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_seller uuid;
BEGIN
  BEGIN
    IF coalesce(NEW.is_archived,false) THEN RETURN NULL; END IF;      -- estacionadas fora
    SELECT seller_member_id INTO v_seller FROM public.wa_instances WHERE id = NEW.instance_id;
    IF v_seller IS NOT NULL THEN RETURN NULL; END IF;                 -- linha de vendedor fora
    PERFORM public.ai_conv_index_upsert(
      NEW.user_id, NEW.instance_id, NEW.phone, NULL, NEW.contact_name,
      NEW.content, NEW.message_type, NEW.direction, NEW.created_at, 1, 'webhook', true);
  EXCEPTION WHEN OTHERS THEN
    -- ponto 9: a escrita operacional NUNCA cai por causa da projeção.
    BEGIN
      INSERT INTO public.ai_conv_index_deadletter (origem, ref, user_id, erro)
      VALUES ('wa_inbox', NEW.id::text, NEW.user_id, left(SQLERRM, 300));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'ai_conv_index deadletter falhou: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ai_conv_index_from_wa_inbox_trg ON public.wa_inbox;
CREATE TRIGGER ai_conv_index_from_wa_inbox_trg
  AFTER INSERT ON public.wa_inbox
  FOR EACH ROW EXECUTE FUNCTION public.ai_conv_index_from_wa_inbox();

-- ── 8. Alimentador v3_inbox (existência/preview; NUNCA conta) ────────────────
-- to_addr VALIDADO com dados reais (213/213 = telefone do LEAD; 0 = instância).
CREATE OR REPLACE FUNCTION public.ai_conv_index_from_v3_inbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_phone text; v_instance uuid; v_agent uuid; v_txt text;
BEGIN
  BEGIN
    SELECT r.to_addr INTO v_phone FROM public.v3_conversation_routing r
     WHERE r.tenant_id = NEW.tenant_id AND r.conversation_id = NEW.conversation_id LIMIT 1;
    IF v_phone IS NULL THEN RETURN NULL; END IF;
    SELECT l.instance_id, l.agent_id INTO v_instance, v_agent
      FROM public.v3_conversation_state cs
      JOIN public.ai_crm_leads l ON l.id::text = cs.lead_id
     WHERE cs.tenant_id = NEW.tenant_id AND cs.conversation_id = NEW.conversation_id LIMIT 1;
    v_txt := coalesce(nullif(NEW.raw->>'text',''), nullif(NEW.raw #>> '{mediaContext,text}',''), '[mídia recebida]');
    PERFORM public.ai_conv_index_upsert(
      NEW.tenant_id, v_instance, v_phone, v_agent, NEW.raw->>'leadNameHint',
      v_txt, CASE WHEN NEW.raw ? 'mediaContext' THEN coalesce(nullif(NEW.raw #>> '{mediaContext,kind}',''),'text') ELSE 'text' END,
      'incoming', coalesce(NEW.received_at, NEW.created_at), 0, 'v3', true);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.ai_conv_index_deadletter (origem, ref, user_id, erro)
      VALUES ('v3_inbox', NEW.event_id, NEW.tenant_id, left(SQLERRM, 300));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'ai_conv_index deadletter falhou: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ai_conv_index_from_v3_inbox_trg ON public.v3_inbox;
CREATE TRIGGER ai_conv_index_from_v3_inbox_trg
  AFTER INSERT ON public.v3_inbox
  FOR EACH ROW EXECUTE FUNCTION public.ai_conv_index_from_v3_inbox();

-- ── 9. Alimentador outbox (ponto 7): SÓ sucesso real, SÓ update, NUNCA conta ──
CREATE OR REPLACE FUNCTION public.ai_conv_index_from_v3_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_phone text; v_instance uuid; v_agent uuid; v_txt text;
BEGIN
  BEGIN
    IF NEW.kind NOT IN ('send_message','send_media') THEN RETURN NULL; END IF;
    -- transição para 'succeeded' com receipt: prova de envio. Falha/pendência/
    -- retry não move preview nem cria conversa.
    IF NEW.status <> 'succeeded' OR OLD.status = 'succeeded' THEN RETURN NULL; END IF;
    SELECT r.to_addr INTO v_phone FROM public.v3_conversation_routing r
     WHERE r.tenant_id = NEW.tenant_id AND r.conversation_id = NEW.conversation_id LIMIT 1;
    IF v_phone IS NULL THEN RETURN NULL; END IF;   -- sem contato inequívoco -> nada
    SELECT l.instance_id, l.agent_id INTO v_instance, v_agent
      FROM public.v3_conversation_state cs
      JOIN public.ai_crm_leads l ON l.id::text = cs.lead_id
     WHERE cs.tenant_id = NEW.tenant_id AND cs.conversation_id = NEW.conversation_id LIMIT 1;
    v_txt := CASE WHEN NEW.kind='send_media'
                  THEN coalesce(nullif(NEW.payload->>'text',''),'📷 Fotos do veículo enviadas')
                  ELSE NEW.payload->>'text' END;
    PERFORM public.ai_conv_index_upsert(
      NEW.tenant_id, v_instance, v_phone, v_agent, NULL,
      v_txt, CASE WHEN NEW.kind='send_media' THEN 'image' ELSE 'text' END,
      'outgoing', coalesce(NEW.dispatched_at, now()), 0, 'v3', false);  -- p_create=false
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.ai_conv_index_deadletter (origem, ref, user_id, erro)
      VALUES ('v3_outbox', NEW.effect_id, NEW.tenant_id, left(SQLERRM, 300));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'ai_conv_index deadletter falhou: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ai_conv_index_from_v3_outbox_trg ON public.v3_effect_outbox;
CREATE TRIGGER ai_conv_index_from_v3_outbox_trg
  AFTER UPDATE OF status ON public.v3_effect_outbox
  FOR EACH ROW EXECUTE FUNCTION public.ai_conv_index_from_v3_outbox();

-- ── 10. Vínculo CRM (pontos 3 e 10): prioridade + ambiguidade explícita ──────
-- Pedro (ai_crm_leads): prioridade tenant → INSTÂNCIA → telefone (+agente).
-- Sem instância confiável: vincula SÓ com candidata única; 2+ → 'ambiguous'.
CREATE OR REPLACE FUNCTION public.ai_conv_index_link_pedro_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_canon text := public.logos_phone_canonical(split_part(NEW.remote_jid,'@',1));
        v_n int;
BEGIN
  BEGIN
    IF NOT public.logos_phone_plausible(v_canon) THEN RETURN NULL; END IF;
    PERFORM public.ai_conv_index_lock(NEW.user_id, v_canon);
    IF NEW.instance_id IS NOT NULL THEN
      -- identidade completa: adota órfã e vincula a linha da instância
      PERFORM public.ai_conv_index_adopt_instance(NEW.user_id, v_canon, NEW.instance_id, NEW.agent_id);
      UPDATE public.ai_conversation_index
         SET crm_lead_id = NEW.id, crm_source = 'pedro', crm_match_status = 'linked',
             agent_id = coalesce(agent_id, NEW.agent_id), updated_at = now()
       WHERE user_id = NEW.user_id AND phone_canonical = v_canon
         AND instance_id = NEW.instance_id AND crm_lead_id IS NULL;
    ELSE
      SELECT count(*) INTO v_n FROM public.ai_conversation_index
       WHERE user_id = NEW.user_id AND phone_canonical = v_canon AND crm_lead_id IS NULL;
      IF v_n = 1 THEN
        UPDATE public.ai_conversation_index
           SET crm_lead_id = NEW.id, crm_source = 'pedro', crm_match_status = 'linked',
               agent_id = coalesce(agent_id, NEW.agent_id), updated_at = now()
         WHERE user_id = NEW.user_id AND phone_canonical = v_canon AND crm_lead_id IS NULL;
      ELSIF v_n > 1 THEN
        UPDATE public.ai_conversation_index
           SET crm_match_status = 'ambiguous', updated_at = now()
         WHERE user_id = NEW.user_id AND phone_canonical = v_canon AND crm_lead_id IS NULL;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.ai_conv_index_deadletter (origem, ref, user_id, erro)
      VALUES ('link_pedro', NEW.id::text, NEW.user_id, left(SQLERRM, 300));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'ai_conv_index deadletter falhou: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ai_conv_index_link_pedro_trg ON public.ai_crm_leads;
CREATE TRIGGER ai_conv_index_link_pedro_trg
  AFTER INSERT ON public.ai_crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.ai_conv_index_link_pedro_lead();

-- Marcos (crm_leads, ponto 10): sem conceito de instância — candidata única só.
CREATE OR REPLACE FUNCTION public.ai_conv_index_link_marcos_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_canon text := public.logos_phone_canonical(NEW.phone); v_n int;
BEGIN
  BEGIN
    IF NOT public.logos_phone_plausible(v_canon) THEN RETURN NULL; END IF;
    PERFORM public.ai_conv_index_lock(NEW.user_id, v_canon);
    SELECT count(*) INTO v_n FROM public.ai_conversation_index
     WHERE user_id = NEW.user_id AND phone_canonical = v_canon AND crm_lead_id IS NULL;
    IF v_n = 1 THEN
      UPDATE public.ai_conversation_index
         SET crm_lead_id = NEW.id, crm_source = 'marcos', crm_match_status = 'linked', updated_at = now()
       WHERE user_id = NEW.user_id AND phone_canonical = v_canon AND crm_lead_id IS NULL;
    ELSIF v_n > 1 THEN
      UPDATE public.ai_conversation_index
         SET crm_match_status = 'ambiguous', updated_at = now()
       WHERE user_id = NEW.user_id AND phone_canonical = v_canon AND crm_lead_id IS NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.ai_conv_index_deadletter (origem, ref, user_id, erro)
      VALUES ('link_marcos', NEW.id::text, NEW.user_id, left(SQLERRM, 300));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'ai_conv_index deadletter falhou: %', SQLERRM;
    END;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ai_conv_index_link_marcos_trg ON public.crm_leads;
CREATE TRIGGER ai_conv_index_link_marcos_trg
  AFTER INSERT ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.ai_conv_index_link_marcos_lead();

-- ── 11. Reparação idempotente (ponto 9) ──────────────────────────────────────
-- Reprocessa deadletters re-disparando o upsert a partir da linha de origem
-- (quando ainda existir) e marca repaired_at. Segura pra rodar N vezes.
CREATE OR REPLACE FUNCTION public.ai_conv_index_repair(p_limit int DEFAULT 200)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d record; v_fixed int := 0;
BEGIN
  FOR d IN SELECT * FROM public.ai_conv_index_deadletter
            WHERE repaired_at IS NULL ORDER BY created_at LIMIT p_limit
  LOOP
    BEGIN
      IF d.origem = 'wa_inbox' THEN
        PERFORM public.ai_conv_index_upsert(w.user_id, w.instance_id, w.phone, NULL, w.contact_name,
                 w.content, w.message_type, w.direction, w.created_at, 1, 'webhook', true)
          FROM public.wa_inbox w WHERE w.id = d.ref::uuid AND coalesce(w.is_archived,false)=false;
      END IF;
      -- v3_inbox/v3_outbox/link_*: reprocesso análogo pode ser adicionado sob demanda;
      -- o registro fica durável e visível até lá.
      UPDATE public.ai_conv_index_deadletter SET repaired_at = now() WHERE id = d.id;
      v_fixed := v_fixed + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- permanece na fila
    END;
  END LOOP;
  RETURN v_fixed;
END $$;
REVOKE ALL ON FUNCTION public.ai_conv_index_repair(int) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
