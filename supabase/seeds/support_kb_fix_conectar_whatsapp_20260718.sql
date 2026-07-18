-- ════════════════════════════════════════════════════════════════════════════
-- Correção de conteúdo do Suporte (18/07) — "Como conectar meu WhatsApp?"
-- ════════════════════════════════════════════════════════════════════════════
-- JÁ APLICADO EM PRODUÇÃO. Este arquivo é o REGISTRO da mudança (a fonte da
-- verdade do conteúdo é o BANCO, editável em /administracao → Base de
-- Conhecimento). Serve pra prod e git não divergirem e pra rastrear o porquê.
--
-- SINTOMA (dono): perguntar "Como conectar meu WhatsApp?" trazia o vídeo
-- "Disparo em Massa" — assunto errado pra quem só quer conectar o número.
--
-- DUAS CAUSAS, medidas em prod (nenhuma era "não achou material"):
--
-- 1. VÍDEO ERRADO. `search_support_videos` casava "Disparo em Massa" no modo OU
--    (rank 0.061) e a edge colava como "Tutorial recomendado" MESMO por cima de
--    uma resposta canônica correta. Raiz: os 7 vídeos estavam com
--    `keywords = '{}'` — as colunas de enriquecimento existiam mas nunca foram
--    preenchidas, então a busca só tinha título/descrição pra casar e escorregava
--    pra qualquer vídeo que citasse "whatsapp".
--    Corrigido nos DOIS níveis: keywords preenchidas (abaixo) + a edge passou a
--    aceitar só vídeo do modo E (mesma regra que o artigo já tinha).
--
-- 2. ARTIGO DESATUALIZADO. O passo 3 mandava na aba "Conexões" — que é de
--    CONTAS DE ANÚNCIO. O número da operação se conecta na aba "Instâncias do
--    WhatsApp" (Integrations.tsx:136 diz isso na própria tela) pelo botão verde
--    "Conectar Número" (WhatsAppInstances.tsx:414).
--    Rótulos conferidos no código, não inventados: aba "Instâncias do WhatsApp",
--    botão "Conectar Número", opção "WhatsApp (QR Code)", campo "Nome da
--    conexão", botão "Gerar QR Code", passo "Escanear QR Code" e status
--    "Conectado!" (UazapiConnectDialog.tsx:435-436,484-498).
--
-- VERIFICADO depois: as 5 formas de perguntar ("Como conectar meu WhatsApp?",
-- "conectar número", "instância WhatsApp", "QR Code", "escanear QR") caem no
-- artigo certo em modo E (resposta literal) e com ZERO vídeo. Os vídeos
-- legítimos seguem aparecendo ("disparo em massa" → Disparo em Massa,
-- "agente Pedro" → Introdução ao Pedro, etc).
-- ════════════════════════════════════════════════════════════════════════════

UPDATE public.support_knowledge_articles
SET content =
'Para conectar seu número de WhatsApp:' || chr(10) || chr(10) ||
'1. No menu do lado esquerdo, clique no título "Sistema" para abrir a seção.' || chr(10) ||
'2. Clique em "Integrações".' || chr(10) ||
'3. Abra a aba "Instâncias do WhatsApp" (a aba "Conexões" é só para contas de anúncio).' || chr(10) ||
'4. Clique no botão verde "Conectar Número".' || chr(10) ||
'5. Escolha a opção "WhatsApp (QR Code)".' || chr(10) ||
'6. Em "Nome da conexão", dê um nome (ex: o nome da sua empresa) e clique em "Gerar QR Code".' || chr(10) ||
'7. No seu celular, abra o WhatsApp → Aparelhos conectados → Conectar um aparelho, e aponte a câmera para o QR Code na tela.' || chr(10) ||
'8. Aguarde. Quando aparecer "Conectado!", está pronto. O número passa a mostrar a etiqueta verde "Conectado".' || chr(10) || chr(10) ||
'Importante: este é o número da sua operação (usado no follow-up e no disparo). O número do robô de atendimento (agente de IA) é conectado dentro do próprio agente, na configuração do Pedro.',
    keywords = ARRAY['whatsapp','zap','conectar whatsapp','qr code','qrcode','uazapi','numero','número',
                     'conectar numero','conectar número','instancia','instância','instancias do whatsapp',
                     'chip','ler qr','escanear','escanear qr','escaneando qr','conexao','conexão'],
    updated_at = now()
WHERE slug = 'conectar-whatsapp-qrcode';

-- Enriquecimento dos vídeos do /treinamento (colunas de suporte; não altera o
-- vídeo em si). NADA de conexão/WhatsApp no "Disparo em Massa" — foi justamente
-- por casar em assunto alheio que ele era sugerido errado.
UPDATE public.training_videos SET keywords = CASE title
  WHEN 'Disparo em Massa'                 THEN ARRAY['disparo','disparo em massa','massa','campanha','campanhas','envio em massa','disparar','fazer disparo','enviar campanha','mandar mensagem em massa']
  WHEN 'Agente Marcos: Panorama Geral'    THEN ARRAY['marcos','agente marcos','crm','panorama','pipeline','kanban']
  WHEN 'Introdução ao Agente Pedro (SDR)' THEN ARRAY['pedro','agente pedro','sdr','atendimento','robo','robô']
  WHEN 'SDR: Como Trabalhar seu Lead'     THEN ARRAY['lead','leads','trabalhar lead','sdr','follow-up','followup','atender lead']
  WHEN 'Painel Geral (para o Vendedor)'   THEN ARRAY['painel','painel geral','vendedor','metricas','métricas','indicadores']
  WHEN 'Introdução — Parte 01'            THEN ARRAY['introducao','introdução','primeiros passos','comecar','começar','visao geral','visão geral']
  WHEN 'Introdução — Parte 02'            THEN ARRAY['introducao','introdução','primeiros passos','comecar','começar','visao geral','visão geral']
  ELSE keywords END
WHERE is_global = true;
