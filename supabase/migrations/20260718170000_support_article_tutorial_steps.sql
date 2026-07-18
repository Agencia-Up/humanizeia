-- ════════════════════════════════════════════════════════════════════════════
-- Passo a passo COM IMAGEM no Chat de Suporte
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hoje o artigo é só texto (`content`), então o chat só consegue responder
-- texto. Esta coluna guarda o MESMO passo a passo em forma estruturada, para o
-- chat montar cards com print de cada etapa.
--
-- POR QUE JSONB E NÃO UMA TABELA `support_article_steps`:
-- os passos nunca são consultados isoladamente — são sempre lidos junto do
-- artigo, na ordem, e renderizados inteiros. Uma tabela filha exigiria join,
-- ordenação e RLS próprios para ganhar zero: não há busca por passo, nem passo
-- compartilhado entre artigos. JSONB mantém o passo a passo atômico com o
-- artigo (editar/regerar substitui tudo de uma vez, que é exatamente a regra
-- de manutenção pedida pelo dono: "quando a tela muda, substitui o tutorial").
--
-- FORMATO (validado por CHECK para não entrar lixo):
-- {
--   "tutorialId": "conectar-whatsapp",
--   "title": "...",
--   "summary": "...",
--   "steps": [ { "title": "...", "description": "...", "imageUrl": "/help/..." } ]
-- }
--
-- `imageUrl` é SEMPRE caminho público do próprio app (/help/tutorials/...),
-- servido de `public/`. Nunca caminho local de máquina, nunca host externo
-- (o app tem CSP e um link externo quebraria silenciosamente).
--
-- `imageUrl` é OPCIONAL por passo: o chat mostra o card do passo com título e
-- descrição mesmo sem imagem. Passo a passo sem print continua ajudando; passo
-- escondido por falta de print, não.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.support_knowledge_articles
  ADD COLUMN IF NOT EXISTS tutorial jsonb;

-- Guarda-corpo: ou é NULL, ou tem a forma esperada com pelo menos 1 passo.
-- Evita que uma edição pela tela de admin publique um tutorial quebrado que o
-- front tentaria renderizar.
ALTER TABLE public.support_knowledge_articles
  DROP CONSTRAINT IF EXISTS support_article_tutorial_shape_chk;

ALTER TABLE public.support_knowledge_articles
  ADD CONSTRAINT support_article_tutorial_shape_chk CHECK (
    tutorial IS NULL OR (
      jsonb_typeof(tutorial) = 'object'
      AND tutorial ? 'tutorialId'
      AND tutorial ? 'steps'
      AND jsonb_typeof(tutorial -> 'steps') = 'array'
      AND jsonb_array_length(tutorial -> 'steps') > 0
    )
  );

COMMENT ON COLUMN public.support_knowledge_articles.tutorial IS
  'Passo a passo estruturado (cards com print) do Chat de Suporte. NULL = artigo só texto. imageUrl deve ser caminho público do app (/help/tutorials/...).';
