-- ══════════════════════════════════════════════════════════════════════════
-- Chat de Suporte com IA — Fase 1 (schema)
--
-- Assistente que responde dúvidas de USO da plataforma Logos. Conteúdo é
-- GLOBAL (é a documentação da Logos, não dado de cliente); a conversa é
-- privada de cada usuário.
--
-- DECISÕES tomadas a partir da análise do que já existe (16-17/07/2026):
--
-- 1. VÍDEOS: NÃO criamos catálogo novo. O dono já mantém `/treinamento`
--    (training_sections/training_videos, is_global, superadmin edita, 7 vídeos
--    hoje). Tabela nova obrigaria a cadastrar cada vídeo DUAS vezes e as duas
--    listas divergiriam. Aqui só ENRIQUECEMOS training_videos com keywords +
--    categoria pra IA achar. Cadastro segue em UM lugar só.
--
-- 2. CUSTO: o suporte NÃO passa pelo aiGateway do José. Aquele gateway grava em
--    jose_usage_ledger, que alimenta o TETO MENSAL e o KILL-SWITCH do José —
--    cliente perguntando "como conecto o WhatsApp?" queimaria o orçamento do
--    gestor de tráfego dele e podia derrubar o José. O suporte loga em
--    ai_call_log com disparo_tipo='chat_suporte' (valor novo, adicionado no fim
--    deste arquivo), que é auditoria forense e não controla nada.
--
-- 3. BUSCA EM PORTUGUÊS SEM ACENTO: medido em prod — a config `portuguese`
--    pura NÃO acha "configuração" quando o usuário digita "configuracao"
--    (@@ devolveu false). Gente digitando rápido não põe acento, e o suporte
--    responderia "não encontrei" por causa de um til. Por isso a config
--    `pt_unaccent` abaixo. Testado: sem acento, com acento e multi-palavra.
-- ══════════════════════════════════════════════════════════════════════════

-- ─── 1. Config de busca: português + sem acento ───────────────────────────
-- unaccent já está instalado (pg_extension). Config explícita = IMMUTABLE,
-- então pode ser usada em coluna gerada (to_tsvector(regconfig, text)).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_unaccent') THEN
    EXECUTE 'CREATE TEXT SEARCH CONFIGURATION public.pt_unaccent (COPY = portuguese)';
    EXECUTE 'ALTER TEXT SEARCH CONFIGURATION public.pt_unaccent
               ALTER MAPPING FOR hword, hword_part, word
               WITH unaccent, portuguese_stem';
  END IF;
END $$;

-- ─── 1b. Wrapper IMMUTABLE pra juntar text[] ──────────────────────────────
-- POR QUE ISTO EXISTE: `array_to_string(anyarray, text)` do Postgres é STABLE,
-- não IMMUTABLE — porque `anyarray` genérico pode conter tipos cuja saída em
-- texto muda com o ambiente (timestamptz depende de TimeZone, por exemplo).
-- Coluna GERADA e índice de expressão exigem IMMUTABLE, então usar
-- array_to_string direto falha com "generation expression is not immutable"
-- (medido — foi exatamente o erro que este arquivo tomou antes da correção).
-- Para `text[]` a operação é imutável de fato (o elemento JÁ é texto; não há
-- função de saída dependente de ambiente), então marcar IMMUTABLE aqui é uma
-- promessa verdadeira, não uma mentira pro planner. É o contorno padrão.
CREATE OR REPLACE FUNCTION public.support_arr_txt(arr text[])
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT coalesce(array_to_string(arr, ' '), '') $$;

-- ─── 2. Categorias da base de conhecimento ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_knowledge_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  description text,
  icon        text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── 3. Artigos ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_knowledge_articles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id       uuid REFERENCES public.support_knowledge_categories(id) ON DELETE SET NULL,
  title             text NOT NULL,
  slug              text NOT NULL UNIQUE,
  summary           text,
  content           text NOT NULL,
  keywords          text[] NOT NULL DEFAULT '{}',
  related_questions text[] NOT NULL DEFAULT '{}',
  -- DIVERGE do spec (que pedia default 'published') DE PROPÓSITO: o próprio
  -- spec manda "se não houver conteúdo real, marcar como draft para não
  -- responder com coisa inventada". Default draft = falha fechado: ninguém
  -- publica por descuido, e a IA só enxerga o que foi publicado a dedo.
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published','archived')),
  priority          integer NOT NULL DEFAULT 0,
  audience          text NOT NULL DEFAULT 'all'
                      CHECK (audience IN ('all','master','seller','admin')),
  agent_scope       text NOT NULL DEFAULT 'all'
                      CHECK (agent_scope IN ('all','pedro','marcos','jose','settings','billing','integrations')),
  created_by        uuid,
  updated_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Peso A = como a pessoa pergunta (título/keywords); B = resumo/perguntas
  -- relacionadas; C = corpo. Assim "como conecto o whatsapp" casa com o TÍTULO
  -- do artigo certo em vez de com o corpo de um artigo qualquer que cita whatsapp.
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('public.pt_unaccent', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('public.pt_unaccent', public.support_arr_txt(keywords)), 'A') ||
    setweight(to_tsvector('public.pt_unaccent', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('public.pt_unaccent', public.support_arr_txt(related_questions)), 'B') ||
    setweight(to_tsvector('public.pt_unaccent', coalesce(content, '')), 'C')
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_support_articles_search ON public.support_knowledge_articles USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_support_articles_status ON public.support_knowledge_articles (status) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_support_articles_category ON public.support_knowledge_articles (category_id);

-- ─── 4. Vídeos: ENRIQUECER o /treinamento (não duplicar) ──────────────────
-- Aditivo e inerte: nada em /treinamento lê estas colunas, então a tela do
-- dono continua exatamente como está. Só a busca do suporte usa.
ALTER TABLE public.training_videos
  ADD COLUMN IF NOT EXISTS keywords              text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS support_category_slug text;

-- Sem FK pra support_knowledge_categories DE PROPÓSITO: /treinamento não pode
-- quebrar nem ficar preso ao ciclo de vida da base de suporte. Acoplamento solto.
COMMENT ON COLUMN public.training_videos.support_category_slug IS
  'Slug (solto, sem FK) de support_knowledge_categories — usado só pela busca do Chat de Suporte.';
COMMENT ON COLUMN public.training_videos.keywords IS
  'Palavras que a pessoa usaria pra pedir este vídeo. Alimenta a busca do Chat de Suporte.';

CREATE INDEX IF NOT EXISTS idx_training_videos_support_search
  ON public.training_videos
  USING GIN ((
    setweight(to_tsvector('public.pt_unaccent', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('public.pt_unaccent', public.support_arr_txt(keywords)), 'A') ||
    setweight(to_tsvector('public.pt_unaccent', coalesce(description, '')), 'C')
  ));

-- ─── 5. Sessões de conversa ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_chat_sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  tenant_id  uuid NOT NULL,          -- conta master dona (vendedor -> id do master)
  title      text,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_sessions_user ON public.support_chat_sessions (user_id, updated_at DESC);

-- ─── 6. Mensagens ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.support_chat_sessions(id) ON DELETE CASCADE,
  user_id     uuid,
  tenant_id   uuid NOT NULL,
  role        text NOT NULL CHECK (role IN ('user','assistant','system')),
  content     text NOT NULL,
  sources     jsonb NOT NULL DEFAULT '[]',   -- artigos/vídeos que embasaram a resposta
  tokens_used integer NOT NULL DEFAULT 0,
  cost_usd    numeric NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_session ON public.support_chat_messages (session_id, created_at);
-- Rate limit da edge conta "quantas perguntas este usuário fez no último minuto".
-- Sem este índice a checagem vira scan da tabela inteira a cada mensagem — o
-- anti-abuso viraria o gargalo.
CREATE INDEX IF NOT EXISTS idx_support_messages_user_time ON public.support_chat_messages (user_id, created_at DESC);

-- ─── 7. "Isso ajudou?" ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_ai_feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.support_chat_messages(id) ON DELETE CASCADE,
  user_id    uuid,
  tenant_id  uuid,
  rating     text NOT NULL CHECK (rating IN ('helpful','not_helpful')),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)   -- 1 voto por pessoa por resposta (reavaliar = UPDATE)
);

-- ══════════════════════════════════════════════════════════════════════════
-- RLS
--
-- Padrão copiado do que já funciona: conteúdo global = training_* (leitura
-- geral + escrita só superadmin); dado privado = predicado DIRETO
-- (user_id = auth.uid()), NUNCA EXISTS solto — foi exatamente um EXISTS que
-- não amarrava auth.uid() que causou o vazamento cross-tenant de
-- pedro_manager_feedback (ver 20260716230000).
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.support_knowledge_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_knowledge_articles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_chat_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_chat_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ai_feedback          ENABLE ROW LEVEL SECURITY;

-- Base de conhecimento: todo autenticado LÊ o publicado; só superadmin escreve.
DROP POLICY IF EXISTS support_categories_read ON public.support_knowledge_categories;
CREATE POLICY support_categories_read ON public.support_knowledge_categories
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS support_categories_admin ON public.support_knowledge_categories;
CREATE POLICY support_categories_admin ON public.support_knowledge_categories
  FOR ALL TO authenticated
  USING (public._is_caller_superadmin())
  WITH CHECK (public._is_caller_superadmin());

-- Artigo em draft NÃO vaza: só o superadmin enxerga (as 2 policies de SELECT
-- somam com OR, então o superadmin vê draft + publicado).
DROP POLICY IF EXISTS support_articles_read ON public.support_knowledge_articles;
CREATE POLICY support_articles_read ON public.support_knowledge_articles
  FOR SELECT TO authenticated USING (status = 'published');

DROP POLICY IF EXISTS support_articles_admin ON public.support_knowledge_articles;
CREATE POLICY support_articles_admin ON public.support_knowledge_articles
  FOR ALL TO authenticated
  USING (public._is_caller_superadmin())
  WITH CHECK (public._is_caller_superadmin());

-- Conversa: cada um só a sua. Vendedor e master seguem a MESMA regra — o
-- master NÃO lê a conversa de suporte do vendedor (é dúvida pessoal de uso da
-- ferramenta, não dado operacional da conta). Métrica pro dono sai agregada,
-- via RPC, sem expor o texto.
DROP POLICY IF EXISTS support_sessions_own ON public.support_chat_sessions;
CREATE POLICY support_sessions_own ON public.support_chat_sessions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Mensagem é SÓ LEITURA pro front: quem grava é a edge (service role). Assim
-- ninguém forja resposta do assistente pelo console do navegador.
DROP POLICY IF EXISTS support_messages_read_own ON public.support_chat_messages;
CREATE POLICY support_messages_read_own ON public.support_chat_messages
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS support_feedback_own ON public.support_ai_feedback;
CREATE POLICY support_feedback_own ON public.support_ai_feedback
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- Busca (RPCs canônicas — edge e front usam AS MESMAS, pra não divergirem)
-- ══════════════════════════════════════════════════════════════════════════

-- ESTRATÉGIA DE BUSCA EM DOIS NÍVEIS (medida, não chutada)
--
-- `websearch_to_tsquery` liga as palavras com E. Numa pergunta natural isso
-- mata a busca: "configuracao do pedro" vira 'configurac' & 'pedro', mas o
-- artigo diz "configurAR" (stem `configur`) — stems diferentes, o E zera tudo.
-- Medido: com só o E, 2 de 3 perguntas naturais devolviam NADA.
--
-- Então: tenta E primeiro (preciso); se der zero, refaz como OU (abrangente),
-- trocando ' & ' por ' | ' na tsquery. O OU sozinho traria lixo — por isso o
-- PISO DE RANK. Medido com os 4 casos: as 3 perguntas naturais acharam o artigo
-- certo, e "integracao com tiktok ads" (sem artigo na base) devolveu ZERO mesmo
-- no OU. É esse zero que faz a IA admitir que não sabe em vez de inventar.
CREATE OR REPLACE FUNCTION public.search_support_articles(p_query text, p_limit integer DEFAULT 4)
RETURNS TABLE (
  id uuid, slug text, title text, summary text, content text,
  category_slug text, agent_scope text, audience text, rank real, match_mode text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('public.pt_unaccent', coalesce(p_query, '')) AS q_and
  ),
  q2 AS (
    SELECT q_and,
           nullif(replace(q_and::text, ' & ', ' | '), '')::tsquery AS q_or
    FROM q
  ),
  base AS (
    SELECT a.id, a.slug, a.title, a.summary, a.content, c.slug AS category_slug,
           a.agent_scope, a.audience, a.priority, a.search_vector
    FROM public.support_knowledge_articles a
    LEFT JOIN public.support_knowledge_categories c ON c.id = a.category_id
    WHERE a.status = 'published'
      AND p_query IS NOT NULL AND btrim(p_query) <> ''
  ),
  hit_and AS (
    SELECT b.*, ts_rank(b.search_vector, (SELECT q_and FROM q2)) AS rank
    FROM base b
    WHERE b.search_vector @@ (SELECT q_and FROM q2)
  ),
  hit_or AS (
    SELECT b.*, ts_rank(b.search_vector, (SELECT q_or FROM q2)) AS rank
    FROM base b
    WHERE (SELECT q_or FROM q2) IS NOT NULL
      AND b.search_vector @@ (SELECT q_or FROM q2)
      -- Piso: sem ele o OU casaria qualquer artigo que tenha UMA palavra banal
      -- em comum ("como", "do") e a IA responderia com o artigo errado.
      AND ts_rank(b.search_vector, (SELECT q_or FROM q2)) >= 0.05
  )
  -- Subquery porque, depois de UNION ALL, o ORDER BY só enxerga coluna de
  -- SAÍDA — e `priority` é critério de desempate, não sai no retorno.
  SELECT t.id, t.slug, t.title, t.summary, t.content, t.category_slug,
         t.agent_scope, t.audience, t.rank, t.match_mode
  FROM (
    SELECT id, slug, title, summary, content, category_slug, agent_scope,
           audience, priority, rank, 'and'::text AS match_mode
    FROM hit_and
    UNION ALL
    SELECT id, slug, title, summary, content, category_slug, agent_scope,
           audience, priority, rank, 'or'::text AS match_mode
    FROM hit_or
    WHERE NOT EXISTS (SELECT 1 FROM hit_and)
  ) t
  ORDER BY t.rank DESC, t.priority DESC
  LIMIT greatest(1, least(coalesce(p_limit, 4), 10));
$$;

-- Vídeos vêm do /treinamento (is_global). A IA só pode mandar link que EXISTE
-- aqui — é esta função que torna "não inventar link" uma garantia estrutural,
-- não uma promessa no prompt.
CREATE OR REPLACE FUNCTION public.search_support_videos(p_query text, p_limit integer DEFAULT 3)
RETURNS TABLE (
  id uuid, title text, description text, video_url text,
  platform text, thumbnail_url text, rank real, match_mode text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH q2 AS (
    SELECT websearch_to_tsquery('public.pt_unaccent', coalesce(p_query, '')) AS q_and,
           nullif(replace(websearch_to_tsquery('public.pt_unaccent', coalesce(p_query, ''))::text,
                          ' & ', ' | '), '')::tsquery AS q_or
  ),
  base AS (
    SELECT v.id, v.title, v.description, v.video_url, v.platform, v.thumbnail_url,
           v.sort_order,
           setweight(to_tsvector('public.pt_unaccent', coalesce(v.title, '')), 'A') ||
           setweight(to_tsvector('public.pt_unaccent', public.support_arr_txt(v.keywords)), 'A') ||
           setweight(to_tsvector('public.pt_unaccent', coalesce(v.description, '')), 'C') AS sv
    FROM public.training_videos v
    WHERE v.is_global = true
      AND p_query IS NOT NULL AND btrim(p_query) <> ''
  ),
  hit_and AS (
    SELECT b.*, ts_rank(b.sv, (SELECT q_and FROM q2)) AS rank
    FROM base b WHERE b.sv @@ (SELECT q_and FROM q2)
  ),
  hit_or AS (
    SELECT b.*, ts_rank(b.sv, (SELECT q_or FROM q2)) AS rank
    FROM base b
    WHERE (SELECT q_or FROM q2) IS NOT NULL
      AND b.sv @@ (SELECT q_or FROM q2)
      AND ts_rank(b.sv, (SELECT q_or FROM q2)) >= 0.05
  )
  SELECT t.id, t.title, t.description, t.video_url, t.platform, t.thumbnail_url,
         t.rank, t.match_mode
  FROM (
    SELECT id, title, description, video_url, platform, thumbnail_url, sort_order,
           rank, 'and'::text AS match_mode FROM hit_and
    UNION ALL
    SELECT id, title, description, video_url, platform, thumbnail_url, sort_order,
           rank, 'or'::text AS match_mode FROM hit_or
    WHERE NOT EXISTS (SELECT 1 FROM hit_and)
  ) t
  ORDER BY t.rank DESC, t.sort_order
  LIMIT greatest(1, least(coalesce(p_limit, 3), 5));
$$;

GRANT EXECUTE ON FUNCTION public.search_support_articles(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_support_videos(text, integer)   TO authenticated;

-- ─── updated_at ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_support_categories_touch ON public.support_knowledge_categories;
CREATE TRIGGER trg_support_categories_touch BEFORE UPDATE ON public.support_knowledge_categories
  FOR EACH ROW EXECUTE FUNCTION public.support_touch_updated_at();

DROP TRIGGER IF EXISTS trg_support_articles_touch ON public.support_knowledge_articles;
CREATE TRIGGER trg_support_articles_touch BEFORE UPDATE ON public.support_knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.support_touch_updated_at();

DROP TRIGGER IF EXISTS trg_support_sessions_touch ON public.support_chat_sessions;
CREATE TRIGGER trg_support_sessions_touch BEFORE UPDATE ON public.support_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.support_touch_updated_at();

-- ─── 8. Custo do suporte visível na auditoria ─────────────────────────────
-- Lista de 11 valores copiada da definição REAL em prod (pg_constraint), não
-- de memória — recriar o CHECK com a lista errada quebraria os inserts de IA
-- que já rodam. Só ACRESCENTA 'chat_suporte'.
ALTER TABLE public.ai_call_log DROP CONSTRAINT IF EXISTS ai_call_log_disparo_chk;
ALTER TABLE public.ai_call_log ADD CONSTRAINT ai_call_log_disparo_chk
  CHECK (disparo_tipo = ANY (ARRAY[
    'inbound_pedro'::text, 'followup_auto'::text, 'reativacao'::text,
    'broadcast_marcos'::text, 'jose_apollo'::text, 'social_media'::text,
    'claude_chat'::text, 'transcricao_audio'::text, 'embedding'::text,
    'manual_test'::text, 'outro'::text,
    'chat_suporte'::text
  ]));

-- ─── 9. Seed: categorias (sem artigo falso) ───────────────────────────────
-- Só categorias. NENHUM artigo: base vazia faz a IA admitir que não sabe, o que
-- é honesto; artigo inventado faria ela mentir com confiança. O conteúdo real
-- entra pela tela de admin (commit 4).
INSERT INTO public.support_knowledge_categories (name, slug, description, icon, sort_order) VALUES
  ('Primeiros passos',        'primeiros-passos',        'Como começar na Logos IA',                       'Rocket',       10),
  ('WhatsApp / UAZAPI',       'whatsapp-uazapi',         'Conectar e manter o número de WhatsApp',         'MessageSquare',20),
  ('Meta Ads',                'meta-ads',                'Conectar Facebook/Instagram Ads',                'Facebook',     30),
  ('Google Ads',              'google-ads',              'Conectar e usar o Google Ads',                   'Search',       40),
  ('Pixel e conversões',      'pixel-conversoes',        'Pixel, CAPI e rastreamento de conversões',       'Target',       50),
  ('Pedro (SDR)',             'pedro-sdr',               'Configurar o agente de atendimento',             'Bot',          60),
  ('Marcos (CRM)',            'marcos-crm',              'Configurar o CRM e o funil',                     'Kanban',       70),
  ('José (Tráfego pago)',     'jose-trafego',            'Configurar o gestor de tráfego',                 'TrendingUp',   80),
  ('Vendedores e responsáveis','vendedores-responsaveis', 'Cadastrar equipe, permissões e fila',            'Users',        90),
  ('CRM e funil',             'crm-pipeline',            'Usar o Kanban, etapas e leads',                  'Columns',     100),
  ('Conversas',               'conversas',               'Caixa de mensagens e histórico',                 'Inbox',       110),
  ('Painel Geral',            'painel-geral',            'Visão consolidada de resultados',                'BarChart3',   120),
  ('Painel ao Vivo',          'painel-ao-vivo',          'Acompanhar leads em tempo real',                 'Radio',       130),
  ('Feedbacks e relatórios',  'feedbacks-relatorios',    'Feedback ao gerente e relatórios',               'FileText',    140),
  ('Planos e pagamentos',     'planos-pagamentos',       'Assinatura, cobrança e renovação',               'CreditCard',  150),
  ('Erros comuns',            'erros-comuns',            'Problemas frequentes e como resolver',           'AlertTriangle',160)
ON CONFLICT (slug) DO NOTHING;
