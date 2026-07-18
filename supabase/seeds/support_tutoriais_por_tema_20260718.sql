-- ════════════════════════════════════════════════════════════════════════════
-- Tutoriais ILUSTRADOS por tema — Chat de Suporte (18/07)
-- ════════════════════════════════════════════════════════════════════════════
-- JÁ APLICADO EM PRODUÇÃO. Registro da mudança (a fonte da verdade do conteúdo
-- é o BANCO, editável em /administracao → Base de Conhecimento).
--
-- Preenche a coluna `tutorial` de 7 artigos que já existiam e cria 1 artigo novo
-- (`responsaveis-entregas`), cada um com passos title/description/imageUrl.
--
-- IMAGENS: recortadas de docs/help/source-screenshots-private/raw/ (fonte única
-- permitida) e publicadas em public/help/tutorials/<tema>/. Procedência de cada
-- uma em docs/help/tutorials-private/<tema>.md.
--
-- SANITIZAÇÃO aplicada (o dono confirmou que nome/telefone dos prints são dados
-- de DEMONSTRAÇÃO, então esses ficaram; o resto saiu):
--   • faixa do cabeçalho (58px) cortada de toda captura de tela cheia — é onde
--     aparece o e-mail de ACESSO da conta;
--   • QR Code real de pareamento tampado (conectar-whatsapp/06);
--   • barra de tarefas do Windows removida (pedro-conversas/02, -42px);
--   • tooltip do navegador com URL removido (pedro-conversas/01, -26px);
--   • faixa de chrome do SO removida (marcos-crm/01, -6px).
-- Revisão visual: 100% das imagens publicadas foram abertas e conferidas.
-- Nenhum token, chave, URL privada ou e-mail de acesso restou.
--
-- DOIS DESENCONTROS DE TEMA corrigidos antes de publicar (imagem × texto do
-- artigo), que é o erro que o dono explicitamente proibiu:
--   • "conversa aberta" era a tela Pedro > Conversas IA, mas o artigo
--     `responder-lead-conversas` fala de WhatsApp > Conversas — troquei pelo
--     print da tela certa;
--   • "origem do lead" é do formulário de ADICIONAR lead, estava no tutorial de
--     VER/MOVER leads — movido para `marcos-adicionar-lead`.
--
-- ROTEAMENTO: `cadastrar-vendedor` reivindicava as keywords 'responsavel' e
-- 'responsável' (herança de quando não havia artigo de Responsáveis). Com o
-- artigo novo, as duas casavam no modo E e o de vendedor ganhava por rank
-- (0,9988 × 0,9931), levando "como adicionar responsável" pro tutorial errado.
-- Corrigido na ORIGEM (removendo as keywords indevidas), não no rank.
--
-- VERIFICADO: 9 perguntas reais → 9 artigos corretos, todas no modo E, nenhuma
-- com vídeo anexado; 24 imageUrl ↔ 24 arquivos no dist (0 faltando, 0 órfão).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Roteamento: vendedor não reivindica mais "responsável" ───────────────────
UPDATE public.support_knowledge_articles
SET keywords = array_remove(array_remove(keywords,'responsavel'),'responsável'), updated_at = now()
WHERE slug = 'cadastrar-vendedor';

-- ── Artigo novo: Responsáveis & entregas ────────────────────────────────────
INSERT INTO public.support_knowledge_articles (slug, title, summary, content, keywords, category_id, status, tutorial)
SELECT 'responsaveis-entregas',
 'Como cadastrar responsáveis e escolher o que cada um recebe',
 'Quem são as pessoas da conta (gerente, vendedor, gestor de tráfego) e o que cada uma recebe.',
 'Os "responsáveis" são as pessoas da sua conta e o que cada uma recebe (relatórios, avisos, leads):' || chr(10) || chr(10) ||
 '1. No menu, abra "Configurações".' || chr(10) ||
 '2. Clique na aba "Responsáveis".' || chr(10) ||
 '3. Você vê a lista com cada responsável e os botões que ligam ou desligam o que ele recebe.' || chr(10) ||
 '4. Para incluir alguém, clique em "Adicionar responsável".' || chr(10) ||
 '5. Em "Tipo de acesso", escolha:' || chr(10) ||
 '   - "Vendedor" — recebe leads;' || chr(10) ||
 '   - "Gerente" — acesso total ao painel e recebe os relatórios;' || chr(10) ||
 '   - "Gestor de tráfego" — acesso restrito ao José, podendo acompanhar o Pedro.' || chr(10) ||
 '6. Preencha os dados e salve.' || chr(10) || chr(10) ||
 'Observação: cada pessoa tem um número. É por ele que a plataforma envia relatórios e avisos.',
 ARRAY['responsavel','responsáveis','responsaveis','entregas','quem recebe','destinatario','destinatário',
       'gerente','gestor de trafego','gestor de tráfego','relatorio para quem','adicionar responsavel'],
 (SELECT category_id FROM public.support_knowledge_articles WHERE slug='cadastrar-vendedor'),
 'published',
 jsonb_build_object('tutorialId','responsaveis','title','Responsáveis e entregas',
  'summary','Onde você define quem é quem na conta e o que cada pessoa recebe.',
  'steps', jsonb_build_array(
   jsonb_build_object('title','Abra Configurações → "Responsáveis"','description','A lista mostra cada responsável e os botões que ligam ou desligam o que ele recebe.','imageUrl','/help/tutorials/responsaveis/01-responsaveis.png'),
   jsonb_build_object('title','Clique em "Adicionar responsável"','description','Em "Tipo de acesso" escolha Vendedor (recebe leads), Gerente (acesso total + relatórios) ou Gestor de tráfego (restrito ao José).','imageUrl','/help/tutorials/responsaveis/02-adicionar-responsavel.png')))
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='responsaveis-entregas');

-- ── Tutoriais dos artigos que já existiam ───────────────────────────────────
-- (os passos derivam do `content` já auditado de cada artigo — se um mudar, o
--  outro tem que mudar junto, senão texto e imagem se contradizem na resposta)

UPDATE public.support_knowledge_articles SET tutorial = jsonb_build_object(
 'tutorialId','pedro-agente-ia','title','Configurar o Pedro',
 'summary','Onde fica o comportamento do agente: a aba "Agente IA", dentro do Pedro SDR.',
 'steps', jsonb_build_array(
  jsonb_build_object('title','Abra a aba "Agente IA"','description','No menu, abra "Agentes" → "Pedro SDR" e clique na aba "Agente IA". O card do agente aparece com o botão "Configurar".','imageUrl','/help/tutorials/pedro-agente-ia/01-abrir-agente-ia.png'),
  jsonb_build_object('title','Clique em "Configurar"','description','Abre a janela já na aba "Geral". É no campo "System Prompt" que você escreve como o agente deve se comportar.','imageUrl','/help/tutorials/pedro-agente-ia/02-editar-agente.png'),
  jsonb_build_object('title','Ajuste o restante e salve','description','No fim da janela ficam o horário comercial e as categorias bloqueadas. Clique em "Salvar" — as mudanças já valem.','imageUrl','/help/tutorials/pedro-agente-ia/03-horario-e-regras.png')
 )), updated_at=now() WHERE slug='configurar-pedro-prompt';

UPDATE public.support_knowledge_articles SET tutorial = jsonb_build_object(
 'tutorialId','pedro-conversas','title','Responder um lead em Conversas',
 'summary','A tela onde você assume a conversa e responde o lead pelo WhatsApp.',
 'steps', jsonb_build_array(
  jsonb_build_object('title','Abra "Conversas"','description','No menu, abra "WhatsApp" → "Conversas". A lista fica à esquerda, com busca e os filtros Todos / Pedro / Marcos.','imageUrl','/help/tutorials/pedro-conversas/01-lista-de-conversas.png'),
  jsonb_build_object('title','Clique na conversa e responda','description','O histórico abre do lado direito. Escreva na caixa de baixo e envie. O clipe anexa arquivo; com a caixa vazia o botão vira microfone.','imageUrl','/help/tutorials/pedro-conversas/02-conversa-aberta.png')
 )), updated_at=now() WHERE slug='responder-lead-conversas';

UPDATE public.support_knowledge_articles SET tutorial = jsonb_build_object(
 'tutorialId','feedbacks','title','Consultar os feedbacks enviados',
 'summary','Todo feedback enviado ao gerente fica registrado e pode ser consultado depois.',
 'steps', jsonb_build_array(
  jsonb_build_object('title','Abra a aba "Feedbacks"','description','Dentro do "Pedro SDR" ou do "Marcos CRM", clique na aba "Feedbacks". Use a busca por nome/telefone ou os filtros de Tipo, Envio, Origem e Período.','imageUrl','/help/tutorials/feedbacks/01-aba-feedbacks.png'),
  jsonb_build_object('title','De onde vem cada feedback','description','É este formulário, aberto pelo card do lead, que gera o registro que aparece na lista.','imageUrl','/help/tutorials/feedbacks/02-formulario-feedback.png')
 )), updated_at=now() WHERE slug='consultar-feedbacks';

UPDATE public.support_knowledge_articles SET tutorial = jsonb_build_object(
 'tutorialId','vendedores','title','Cadastrar um vendedor',
 'summary','Cadastrar coloca o vendedor na equipe. O login é um passo separado.',
 'steps', jsonb_build_array(
  jsonb_build_object('title','Abra a aba "Vendedores"','description','No menu, abra "Agentes" → "Pedro SDR" e clique na aba "Vendedores".','imageUrl','/help/tutorials/vendedores/01-aba-vendedores.png'),
  jsonb_build_object('title','Preencha e clique em "Cadastrar"','description','No card "Cadastrar Vendedor", informe Nome, WhatsApp e E-mail (para login). Ele entra na lista "Equipe".','imageUrl','/help/tutorials/vendedores/02-cadastrar-vendedor.png')
 )), updated_at=now() WHERE slug='cadastrar-vendedor';

UPDATE public.support_knowledge_articles SET tutorial = jsonb_build_object(
 'tutorialId','marcos-crm','title','Ver e mover leads no Marcos',
 'summary','O quadro (Kanban) com seus leads em colunas.',
 'steps', jsonb_build_array(
  jsonb_build_object('title','Abra o CRM do Marcos','description','No menu, abra "Agentes" → "Marcos CRM" e clique na aba "CRM". Para mover um lead, arraste o card até a coluna — ou use o botão "Mover" do card, que é mais fácil no celular.','imageUrl','/help/tutorials/marcos-crm/01-kanban-marcos.png')
 )), updated_at=now() WHERE slug='marcos-ver-leads-kanban';

UPDATE public.support_knowledge_articles SET tutorial = jsonb_build_object(
 'tutorialId','marcos-adicionar-lead','title','Adicionar um lead na mão',
 'summary','Para cadastrar um lead que não veio pelo WhatsApp.',
 'steps', jsonb_build_array(
  jsonb_build_object('title','Clique em "Adicionar Lead"','description','Na aba "CRM" do Marcos. Preencha Nome e Telefone (WhatsApp); cidade, carro e datas são opcionais.','imageUrl','/help/tutorials/marcos-adicionar-lead/01-adicionar-lead.png'),
  jsonb_build_object('title','Escolha a "Origem"','description','De onde o lead veio. Se não estiver na lista, escolha "Outra origem (personalizada)". Depois clique em "Salvar".','imageUrl','/help/tutorials/marcos-adicionar-lead/02-origem-do-lead.png')
 )), updated_at=now() WHERE slug='marcos-adicionar-lead';

UPDATE public.support_knowledge_articles SET tutorial = jsonb_build_object(
 'tutorialId','pixel-capi','title','Cadastrar o Pixel e o token de conversões',
 'summary','Liga seu Pixel da Meta à plataforma e ativa o envio de conversões (CAPI).',
 'steps', jsonb_build_array(
  jsonb_build_object('title','Abra "Pixel & Conversões"','description','No menu, abra a seção "WhatsApp" e clique em "Pixel & Conversões".','imageUrl','/help/tutorials/pixel-capi/01-tela-pixel.png'),
  jsonb_build_object('title','Clique em "Adicionar Pixel"','description','Preencha o "Pixel ID", um "Nome" para identificar e o "Token da API de Conversões". O token você gera no Facebook: Gerenciador de Eventos → seu Pixel → Configurações → API de Conversões → Gerar token de acesso.','imageUrl','/help/tutorials/pixel-capi/02-novo-pixel.png'),
  jsonb_build_object('title','Confira os eventos','description','Na aba "Eventos CAPI" você acompanha o que foi enviado para a Meta.','imageUrl','/help/tutorials/pixel-capi/03-eventos-capi.png')
 )), updated_at=now() WHERE slug='cadastrar-pixel-capi';
