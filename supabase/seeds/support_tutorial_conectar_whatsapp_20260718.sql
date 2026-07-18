-- ════════════════════════════════════════════════════════════════════════════
-- Passo a passo ILUSTRADO — "Como conectar meu WhatsApp" (18/07)
-- ════════════════════════════════════════════════════════════════════════════
-- JÁ APLICADO EM PRODUÇÃO. Registro da mudança (a fonte da verdade do conteúdo
-- é o BANCO, editável em /administracao → Base de Conhecimento).
--
-- Preenche a coluna `tutorial` (criada em
-- 20260718170000_support_article_tutorial_steps.sql) com o MESMO passo a passo
-- do texto, agora estruturado, para o chat montar cards com print por etapa.
--
-- Os passos espelham 1:1 o `content` do artigo — se um mudar, o outro tem que
-- mudar junto, senão o texto e as imagens se contradizem na mesma resposta.
--
-- Rótulos conferidos no código (não inventados):
--   aba "Instâncias do WhatsApp" ......... Integrations.tsx:98,136
--   botão "Conectar Número" .............. WhatsAppInstances.tsx:414
--   "WhatsApp (QR Code)" / "Nome da conexão" / "Gerar QR Code" /
--   "Escanear QR Code" / "Conectado!" .... UazapiConnectDialog.tsx:435-436,458,484-498
--
-- As imagens ficam em `public/help/tutorials/conectar-whatsapp/` (servidas pelo
-- próprio app em /help/tutorials/...). Ver o README daquela pasta para os nomes
-- de arquivo esperados. Passo sem print continua aparecendo no chat com aviso
-- discreto — nunca escondemos o passo por falta de imagem.
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.support_knowledge_articles
SET tutorial = jsonb_build_object(
  'tutorialId', 'conectar-whatsapp',
  'title',      'Como conectar seu WhatsApp',
  'summary',    'Conecte o número da sua operação lendo um QR Code. Leva menos de 2 minutos e o celular precisa estar com você.',
  'steps', jsonb_build_array(
    jsonb_build_object('title','Abra as Integrações',
      'description','No menu do lado esquerdo, clique em "Sistema" para abrir a seção e depois em "Integrações".',
      'imageUrl','/help/tutorials/conectar-whatsapp/01-menu-integracoes.png'),
    jsonb_build_object('title','Vá para "Instâncias do WhatsApp"',
      'description','Abra essa aba. A aba "Conexões", ao lado, é só para contas de anúncio — não é ali.',
      'imageUrl','/help/tutorials/conectar-whatsapp/02-aba-instancias.png'),
    jsonb_build_object('title','Clique em "Conectar Número"',
      'description','É o botão verde no canto superior direito da tela.',
      'imageUrl','/help/tutorials/conectar-whatsapp/03-conectar-numero.png'),
    jsonb_build_object('title','Escolha "WhatsApp (QR Code)"',
      'description','É a opção mais simples: você conecta lendo o código com o celular.',
      'imageUrl','/help/tutorials/conectar-whatsapp/04-escolher-qrcode.png'),
    jsonb_build_object('title','Dê um nome para a conexão',
      'description','No campo "Nome da conexão", escreva algo que te ajude a identificar o número (ex: o nome da sua empresa).',
      'imageUrl','/help/tutorials/conectar-whatsapp/05-nome-da-conexao.png'),
    jsonb_build_object('title','Clique em "Gerar QR Code"',
      'description','O código aparece na tela em alguns segundos.',
      'imageUrl','/help/tutorials/conectar-whatsapp/06-gerar-qrcode.png'),
    jsonb_build_object('title','Escaneie com o celular',
      'description','No seu celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. Aponte a câmera para o código na tela.',
      'imageUrl','/help/tutorials/conectar-whatsapp/07-escanear-qrcode.png'),
    jsonb_build_object('title','Aguarde aparecer "Conectado!"',
      'description','Pronto. O número passa a mostrar a etiqueta verde "Conectado" na lista.',
      'imageUrl','/help/tutorials/conectar-whatsapp/08-conectado.png')
  )
),
updated_at = now()
WHERE slug = 'conectar-whatsapp-qrcode';
