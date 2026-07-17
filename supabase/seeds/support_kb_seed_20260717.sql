-- ============================================================================
-- Base de Conhecimento do Chat de Suporte - conteudo inicial (17/07/2026)
-- 18 passos a passo extraidos de AUDITORIA do codigo (menu/botao reais).
-- Resposta canonica: a edge support-ai-chat devolve o content LITERAL quando
-- a pergunta casa (modo E) - a IA nao reescreve.
-- FONTE DA VERDADE = O BANCO. Apos edicao em /administracao > Base de
-- Conhecimento este arquivo defasa; e so registro/backup. WHERE NOT EXISTS
-- evita sobrescrever edicoes. Regra: tela mudou de lugar -> regerar e substituir.
-- ============================================================================

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='vendedores-responsaveis'), 'Como cadastrar um vendedor', 'cadastrar-vendedor', 'Cadastrar um vendedor na aba Vendedores do Pedro.', 'Para cadastrar um vendedor da sua equipe:

1. No menu, abra "Agentes" e clique em "Pedro SDR".
2. Clique na aba "Vendedores".
3. No card "Cadastrar Vendedor", preencha:
   - "Nome" (ex: João Silva)
   - "WhatsApp" (ex: 5511999999999)
   - "E-mail (para login)" (ex: joao@empresa.com)
4. Clique em "Cadastrar".
5. Aparece "✅ Vendedor cadastrado!" e ele entra na lista "Equipe".

Importante: cadastrar ainda NÃO dá login pra ele. Para liberar o acesso, veja o passo a passo "Como dar acesso e permissões ao vendedor".

Observação: por padrão, só o dono da conta (master) vê a aba "Vendedores".', '{vendedor,"cadastrar vendedor","adicionar vendedor",equipe,responsavel,responsável,"time de vendas","novo vendedor"}'::text[], '{"como cadastro um vendedor?","como adiciono alguém na equipe?","como coloco um vendedor novo?"}'::text[], 'published', 'pedro', 100
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='cadastrar-vendedor');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='meta-ads'), 'Como conectar o Meta Ads (Facebook e Instagram)', 'conectar-meta-ads', 'Conectar a conta de anúncios da Meta pelo menu Integrações.', 'Para conectar sua conta de anúncios do Facebook/Instagram (Meta):

1. No menu, abra a seção "Sistema" e clique em "Integrações".
2. Na aba "Conexões", encontre o card "Meta Ads" e clique em "Conectar".
3. Leia o aviso (você precisa ser Administrador da conta de anúncios) e clique em "Conectar agora — Meta Ads".
4. Na próxima tela ("Conectar Meta Ads"), clique em "Conectar Meta".
5. Abre a tela do Facebook. Faça login e autorize o acesso.
6. Você volta automaticamente para o sistema. Se você tiver mais de uma conta de anúncios, clique em "Usar esta" na conta que quer usar.
7. Pronto: o card mostra "Conectado" e o nome da conta em verde.

Observações:
- A mesma conexão cobre Facebook e Instagram (não precisa conectar o Instagram separado).
- Este recurso está disponível nos planos Pro e Pro Max. No plano Básico o card aparece com cadeado e um botão "Fazer upgrade".', '{meta,"meta ads",facebook,instagram,face,"conta de anuncio",anúncio,"conectar facebook","conectar meta",trafego,tráfego}'::text[], '{"como conecto o facebook?","como ligo minha conta de anúncios?","como conectar meta ads?","como conecto o instagram?"}'::text[], 'published', 'jose', 100
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='conectar-meta-ads');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='whatsapp-uazapi'), 'Como conectar meu WhatsApp (QR Code)', 'conectar-whatsapp-qrcode', 'Conectar o número de WhatsApp lendo o QR Code em Integrações.', 'Para conectar seu número de WhatsApp:

1. No menu do lado esquerdo, clique no título "Sistema" para abrir a seção.
2. Clique em "Integrações".
3. Na aba "Conexões", encontre o card "Instância do WhatsApp" e clique em "Conectar WhatsApp" (ou "Gerenciar instâncias", se já tiver algum número).
4. Clique em "Conectar Meu Número" (ou "Conectar Número").
5. Escolha a opção "WhatsApp (QR Code)".
6. Dê um nome para a conexão (ex: o nome da sua empresa) e clique em "Gerar QR Code".
7. No seu celular, abra o WhatsApp → Aparelhos conectados → Conectar um aparelho, e aponte a câmera para o QR Code na tela.
8. Aguarde. Quando aparecer "Conectado!", está pronto. O número passa a mostrar a etiqueta verde "Conectado".

Importante: este é o número da sua operação (usado no follow-up e no disparo). O número do robô de atendimento (agente de IA) é conectado dentro do próprio agente, na configuração do Pedro.', '{whatsapp,zap,"conectar whatsapp","qr code",uazapi,numero,número,"conectar numero",instancia,instância,chip,"ler qr"}'::text[], '{"como conecto meu whatsapp?","como ligo meu zap?","onde leio o qr code?","como conectar meu número?"}'::text[], 'published', 'integrations', 100
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='conectar-whatsapp-qrcode');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='pedro-sdr'), 'Como configurar o Pedro (editar o comportamento e o prompt)', 'configurar-pedro-prompt', 'Editar o comportamento do agente Pedro na aba Agente IA.', 'Para configurar como o Pedro atende (o "prompt" dele):

1. No menu, abra a seção "Agentes" e clique em "Pedro SDR".
2. Clique na aba "Agente IA".
3. No card do agente, clique em "Configurar". (Se ainda não tiver nenhum agente, clique em "Criar Primeiro Agente".)
4. Abre a janela de configuração, já na aba "Geral".
5. No campo "System Prompt", escreva como o agente deve se comportar: quem ele é, como fala, o que oferecer, o que perguntar.
6. Clique em "Salvar".
7. Aparece "Agente atualizado!" e as mudanças já valem.

Dica: nas outras abas dessa mesma janela você ajusta a Empresa, o modelo de IA, a base de conhecimento, os vendedores de repasse, as regras de follow-up e as mensagens. Só a aba "Geral" mexe no comportamento/prompt.

Observação: por padrão, só o dono da conta (master) vê a aba "Agente IA".', '{pedro,"configurar pedro",prompt,"system prompt",comportamento,"agente ia","editar agente","treinar pedro",instrucoes,instruções}'::text[], '{"como configuro o pedro?","como mudo o prompt do pedro?","como edito o comportamento do agente?","onde treino o pedro?"}'::text[], 'published', 'pedro', 100
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='configurar-pedro-prompt');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='marcos-crm'), 'Como ver meus leads e mover no Kanban (Marcos)', 'marcos-ver-leads-kanban', 'Ver os leads no quadro e mover entre colunas no Marcos.', 'Para ver e organizar seus leads no Marcos:

1. No menu, abra "Agentes" e clique em "Marcos CRM".
2. Clique na aba "CRM". Aparece o quadro (Kanban) com os leads em colunas.

Para mover um lead de coluna, você tem duas formas:
- Arrastar: segure o card do lead e arraste até a coluna que quer.
- Pelo botão: no card do lead, clique em "Mover" e escolha a coluna de destino na lista.

Quando mover, aparece "✅ Lead movido para (nome da coluna)".

Dica: no celular, use o botão "Mover" — é mais fácil que arrastar.

Observação: "Marcos CRM" aparece no menu nos planos Pro e Pro Max.', '{marcos,crm,kanban,"ver leads","meus leads","mover lead",pipeline,quadro,coluna,funil,"arrastar lead"}'::text[], '{"como vejo meus leads?","como uso o kanban?","como movo um lead de coluna?","onde vejo o funil?"}'::text[], 'published', 'marcos', 100
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='marcos-ver-leads-kanban');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='primeiros-passos'), 'Como criar minha empresa e começar', 'primeiros-passos-criar-empresa', 'Primeiro acesso: criar a organização e cair na tela inicial.', 'Assim que você entra pela primeira vez, o sistema pede para criar sua empresa. É rápido:

1. Na tela "Bem-vindo ao LogosIA", clique em "Criar nova empresa".
2. Digite o nome da sua empresa no campo "Nome da empresa".
3. Clique em "Criar empresa".
4. Pronto! Aparece a mensagem "🎉 Empresa criada!" e você vai direto para a Tela inicial.

Na Tela inicial você vê o menu do lado esquerdo e os seus agentes (Pedro, Marcos e José) no meio da tela. É só clicar no agente que quer usar.

Dica: se você recebeu um convite para entrar na empresa de outra pessoa, na primeira tela clique em "Aceitar convite" em vez de "Criar nova empresa".', '{comecar,começar,"primeiro acesso","criar empresa","primeiros passos",entrar,"conta nova",organizacao,organização,onboarding}'::text[], '{"como eu começo?","acabei de entrar, e agora?","como crio minha empresa?"}'::text[], 'published', 'all', 100
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='primeiros-passos-criar-empresa');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='jose-trafego'), 'Como usar o José (ligar, pausar e ver a Cabine)', 'usar-jose-trafego', 'Abrir o José, ligar/pausar e entender a Cabine de Comando.', 'O José é o gestor de tráfego. Para usar:

1. Antes de tudo, conecte sua conta Meta Ads (veja o passo a passo "Como conectar o Meta Ads"). Sem isso, o José mostra um aviso amarelo pedindo para conectar.
2. No menu, abra "Agentes" e clique em "José Tráfego Pago".
3. No topo, o selo mostra "José: ATIVO" ou "José: PARADO". Para ligar ou pausar, clique em "Ligar José" / "Pausar José". Quando ativo, ele age sozinho (auto-piloto e relatório automático); quando pausado, ele para de agir, mas o chat continua respondendo.
4. Para conversar com ele, clique em "Conversar com o José".
5. A tela principal é a "Cabine de Comando": os números que importam sempre à vista (custo por lead, custo por lead BOM, custo por venda, investido, CPM, CPC), com o filtro de período "Hoje / Ontem / 7 dias / 30 dias".

Botões úteis na Cabine: "Número do responsável e limites" (quem recebe as aprovações), "Relatório automático" (liga o auto-piloto diário) e "Criar campanha".

Observação: o José aparece no menu nos planos Pro e Pro Max.', '{jose,josé,trafego,tráfego,"gestor de trafego","ligar jose","pausar jose",cabine,"cabine de comando","custo por lead",anuncios}'::text[], '{"como uso o josé?","como ligo o josé?","como pauso o josé?","o que é a cabine de comando?"}'::text[], 'published', 'jose', 100
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='usar-jose-trafego');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='vendedores-responsaveis'), 'Como dar acesso (login) e permissões ao vendedor', 'acesso-permissoes-vendedor', 'Enviar convite de login e configurar o que o vendedor vê.', 'Depois de cadastrar o vendedor, você libera o acesso e escolhe o que ele pode ver:

Para dar login:
1. Na aba "Vendedores" (dentro do Pedro), ache o vendedor na lista "Equipe".
2. No campo de e-mail ao lado do nome dele, confira o endereço e clique em "Enviar Convite".
3. Aparece "✅ Convite enviado!". Ele recebe um e-mail para criar a senha. Depois disso o card mostra "Conta ativa".

Para escolher o que ele vê (permissões):
1. Na linha do vendedor, clique no ícone de engrenagem ("Configurar painel do vendedor").
2. Abre a janela "Permissões". Ative ou desative os itens em: "Acesso aos Agentes", "Abas do Pedro SDR", "Abas do Marcos CRM" e "Menu Lateral".
3. Clique em "Salvar Permissões".
4. Aparece "✅ Painel do vendedor configurado!".

Dica: o vendedor só vê os leads, conversas e o número atribuídos a ele — nunca os dos outros.', '{permissao,permissão,acesso,"login do vendedor",convite,"enviar convite","liberar acesso","configurar painel","o que o vendedor ve",vê}'::text[], '{"como dou acesso ao vendedor?","como envio o convite de login?","como escolho o que o vendedor vê?","como configuro as permissões?"}'::text[], 'published', 'pedro', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='acesso-permissoes-vendedor');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='pixel-conversoes'), 'Como cadastrar o Pixel e o token de conversões', 'cadastrar-pixel-capi', 'Cadastrar um Pixel da Meta e o token da API de Conversões.', 'Para cadastrar seu Pixel e ativar o envio de conversões (CAPI):

1. No menu, abra a seção "WhatsApp" e clique em "Pixel & Conversões".
2. Clique em "Adicionar Pixel".
3. Preencha:
   - "Pixel ID" (o número do seu pixel na Meta)
   - "Nome" (um apelido para você identificar)
   - "Domínio (opcional)"
   - "Token da API de Conversões (chave API)"
4. Para gerar o token, no Facebook vá em: Gerenciador de Eventos → seu Pixel → Configurações → API de Conversões → Gerar token de acesso. Copie e cole no campo.
5. Clique em "Adicionar Pixel".
6. O pixel aparece na lista com a etiqueta "Chave conectada". Para conferir, clique em "Testar" e depois em "Enviar Evento".

Observação: esta tela é do dono da conta (master).', '{pixel,capi,conversoes,conversões,token,"api de conversoes","meta pixel",rastreamento,traqueamento,evento}'::text[], '{"como cadastro meu pixel?","onde coloco o token de conversões?","como configuro o capi?","como ativo o rastreamento?"}'::text[], 'published', 'settings', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='cadastrar-pixel-capi');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='google-ads'), 'Como conectar o Google Ads', 'conectar-google-ads', 'Conectar a conta do Google Ads pelo menu Integrações.', 'Para conectar sua conta do Google Ads:

1. No menu, abra a seção "Sistema" e clique em "Integrações".
2. Na aba "Conexões", encontre o card "Google Ads" e clique em "Conectar".
3. Clique em "Conectar agora — Google Ads".
4. Abre a tela de login do Google. Faça login e autorize o acesso.
5. Depois de autorizar, o Google devolve você ao sistema (pode passar rapidinho pela tela de Configurações e pelo assistente de conexão — é normal).
6. Se tiver mais de uma conta, clique em "Usar esta conta" na que quiser.
7. Pronto: aparece "Google Ads conectado!" e o card fica com status "Conectado".

Observação: este recurso está disponível nos planos Pro e Pro Max. Se aparecer a mensagem "Google Ads ainda não disponível", fale com o suporte para confirmar a liberação.', '{google,"google ads",adwords,"conectar google","conta google","trafego google","tráfego google"}'::text[], '{"como conecto o google ads?","como ligo minha conta do google?","como conectar google?"}'::text[], 'published', 'jose', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='conectar-google-ads');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='pedro-sdr'), 'Como configurar o follow-up e as mensagens do Pedro', 'configurar-followup-mensagens-pedro', 'Ajustar follow-up automático, transferência e mensagens do Pedro.', 'O follow-up e as mensagens ficam dentro da configuração do agente:

1. No menu, abra "Agentes" e clique em "Pedro SDR".
2. Aba "Agente IA" → no card, clique em "Configurar".
3. Para follow-up e transferência, clique na aba "Regras":
   - Em "Follow-up automático" você liga/desliga e define os tempos: "1º (min)", "2º (min)", "3º (min)".
   - Em "Transferência para vendedor" você define o "Tempo de resposta do vendedor (min)" e o horário de repasse.
4. Para as mensagens, clique na aba "Mensagens":
   - "Mensagem para o vendedor" (o texto que o vendedor recebe quando ganha um lead).
   - "Relatório para o gerente".
   - Você pode usar as etiquetas mostradas na caixa "Etiquetas que você pode usar", ou clicar em "Restaurar modelo padrão".
5. Clique em "Salvar".

Atenção: existe também um botão "Follow-up IA" na aba "CRM Avançado" — esse é para DISPARAR uma campanha de reativação de leads parados, diferente das regras de follow-up do atendimento acima.', '{follow-up,followup,"follow up","mensagem do vendedor",transferencia,transferência,repasse,regras,"tempo de resposta",reativacao,reativação}'::text[], '{"como configuro o follow-up?","como mudo a mensagem que o vendedor recebe?","onde ajusto o tempo de repasse?"}'::text[], 'published', 'pedro', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='configurar-followup-mensagens-pedro');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='feedbacks-relatorios'), 'Como consultar os feedbacks enviados ao gerente', 'consultar-feedbacks', 'Ver e filtrar o histórico de feedbacks na aba Feedbacks.', 'Todo feedback que você envia ao gerente fica registrado e você pode consultar depois:

1. Abra o "Pedro SDR" ou o "Marcos CRM" no menu.
2. Clique na aba "Feedbacks".
3. Você vê a lista com data, lead, tipo, origem e o status de envio (Enviado, Pendente, Falhou ou Registrado).
4. Para achar um específico, use a busca "Buscar por nome ou telefone do lead" ou os filtros de Tipo, Envio, Origem e Período. O botão "Limpar" tira os filtros.
5. Clique em qualquer linha para ver o detalhe completo (motivo, observações e a mensagem que foi enviada ao gerente).

Se você é vendedor, vê só os seus feedbacks; se é o dono da conta, vê os de toda a equipe (com a coluna "Vendedor").', '{feedback,feedbacks,"enviei ao gerente",comprovar,"historico de feedback",pendente,enviado,"consultar feedback"}'::text[], '{"onde vejo os feedbacks que enviei?","como comprovo que mandei o feedback?","como consulto meus feedbacks?"}'::text[], 'published', 'all', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='consultar-feedbacks');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='erros-comuns'), 'O menu aparece só com os títulos, sem as opções', 'erros-menu-fechado', 'As seções do menu começam fechadas; basta clicar no título para abrir.', 'Isso é normal no primeiro acesso: as seções do menu começam FECHADAS. Você vê os títulos (PAINEL, AGENTES, WHATSAPP, SISTEMA) mas não vê os itens embaixo.

Para abrir:

1. Clique em cima do título da seção que você quer (por exemplo, "Sistema").
2. A seção abre e mostra os itens dela (por exemplo, "Integrações", "Meu Plano", "Treinamento").
3. Clique no item que você precisa.

O sistema lembra o que você abriu, então da próxima vez já aparece aberto. Se ainda assim algum item não aparecer, pode ser que ele seja só do dono da conta (master) ou dependa do seu plano.', '{menu,sidebar,"nao aparece","não aparece",sumiu,opcoes,opções,"item do menu","nao acho","não acho","integracoes sumiu"}'::text[], '{"o menu está vazio","não acho o menu","sumiram as opções do lado","cadê o menu?"}'::text[], 'published', 'all', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='erros-menu-fechado');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='marcos-crm'), 'Como adicionar um lead na mão (Marcos)', 'marcos-adicionar-lead', 'Cadastrar um lead manualmente no Marcos.', 'Para adicionar um lead manualmente:

1. No menu, abra "Agentes" e clique em "Marcos CRM".
2. Na aba "CRM", clique em "Adicionar Lead".
3. Preencha:
   - "Nome"
   - "Telefone (WhatsApp)" (ex: 5511999999999)
   - "Origem" (de onde veio o lead; se não estiver na lista, escolha "Outra origem (personalizada)")
   - Opcional: cidade, carro de interesse, data da visita, data que o lead chegou.
4. Clique em "Salvar".
5. Aparece "✅ Lead adicionado ao CRM!" e ele entra no quadro.

Dica: para trazer vários leads de uma vez, use o botão "Importar Planilha".', '{"adicionar lead","novo lead","cadastrar lead","lead manual","criar lead","importar planilha","colocar lead"}'::text[], '{"como adiciono um lead?","como cadastro um lead na mão?","como coloco um lead novo no marcos?"}'::text[], 'published', 'marcos', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='marcos-adicionar-lead');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='conversas'), 'Como responder um lead em Conversas', 'responder-lead-conversas', 'Abrir a conversa de um lead e responder pelo menu Conversas.', 'Para responder um lead:

1. No menu, abra a seção "WhatsApp" e clique em "Conversas".
2. Do lado esquerdo aparece a lista de conversas. Use a busca "Buscar por nome ou telefone..." ou os filtros "Todos / Pedro / Marcos" para achar o lead.
3. Clique na conversa. O histórico completo abre do lado direito.
4. Na caixa de baixo ("Digite uma mensagem"), escreva sua resposta e envie. Para anexar arquivo, use o ícone de clipe; se a caixa estiver vazia, o botão vira microfone para gravar áudio.

Importante: se aquele lead ainda estava sendo atendido pela IA do Pedro, assim que você envia a primeira mensagem a IA para de responder sozinha naquela conversa (para não falar por cima de você). Isso acontece automaticamente.

Observação: você só vê as conversas dos leads atribuídos a você.', '{conversas,"responder lead",inbox,"caixa de mensagens",mensagem,historico,histórico,"atender lead",chat,"falar com lead"}'::text[], '{"como respondo um lead?","onde vejo as conversas?","como atendo pelo sistema?","como mando mensagem pro lead?"}'::text[], 'published', 'all', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='responder-lead-conversas');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='planos-pagamentos'), 'Como faço upgrade de plano', 'upgrade-de-plano', 'Onde ver o plano atual e como pedir upgrade.', 'Para ver seu plano atual:

1. No menu, abra a seção "Sistema" e clique em "Meu Plano".
2. Ali você vê o plano atual (Básico, Pro ou Pro Max), o preço e a próxima cobrança.

Sobre o upgrade: no momento, a troca de plano não é feita sozinha pelo painel. Para subir de plano (por exemplo, do Básico para o Pro e liberar o Marcos e o José), fale com o suporte da Logos que a gente faz a mudança pra você.

Observação: a tela "Meu Plano" é só do dono da conta. Vendedores não têm acesso a essa parte.', '{plano,upgrade,"mudar de plano","meu plano",pagamento,assinatura,pro,"pro max",basico,básico,cobranca,cobrança,"subir plano"}'::text[], '{"como faço upgrade?","como mudo meu plano?","como assino o pro?","onde vejo minha cobrança?"}'::text[], 'published', 'billing', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='upgrade-de-plano');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='painel-ao-vivo'), 'Como usar o Painel ao Vivo', 'usar-painel-ao-vivo', 'Acompanhar leads e produção em tempo real no Painel ao Vivo.', 'O Painel ao Vivo mostra a produção comercial em tempo real — ótimo para deixar numa TV.

1. No menu, abra a seção "Painel" e clique em "Painel ao Vivo".
2. Escolha o período no topo: "Hoje", "Ontem", "7 dias", "30 dias" ou "Personalizado".
3. Você vê os cartões: Total de Leads, Custo por Lead (Real x Painel do Meta), Qualidade Média, Taxa de Transferência e Vendas / Meta do mês.
4. Mais abaixo: a origem dos leads, a fila de vendedores e a produção individual de cada vendedor.
5. Botões úteis: "Atualizar agora", "Tela cheia (F11)" e os controles de zoom e "Paisagem/Retrato".

Observação: se você é vendedor, vê os seus próprios números; alguns controles (meta do mês, fila, bolsão) são só do dono da conta.', '{"painel ao vivo","tempo real",tv,dashboard,producao,produção,"ao vivo","tela cheia",metas,"leads ao vivo"}'::text[], '{"como uso o painel ao vivo?","como coloco na tv?","onde vejo os leads em tempo real?"}'::text[], 'published', 'all', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='usar-painel-ao-vivo');

INSERT INTO public.support_knowledge_articles (category_id, title, slug, summary, content, keywords, related_questions, status, agent_scope, priority)
SELECT (SELECT id FROM public.support_knowledge_categories WHERE slug='painel-geral'), 'Como usar o Painel Geral', 'usar-painel-geral', 'Ver resultados consolidados e filtrar por período no Painel Geral.', 'O Painel Geral junta seus resultados de vendas (Pedro + Marcos) num lugar só.

1. No menu, abra a seção "Painel" e clique em "Painel Geral".
2. No topo, escolha o período: "Este mês", "Mês passado", "Este ano" ou "Personalizado" (com datas). Você também navega mês a mês com as setas.
3. Se você é o dono da conta, pode filtrar por "Vendedor" (ou deixar "Todos os vendedores").
4. Abaixo você vê o funil por vendedor (Atendidos, Qualificados, Perdidos, Vendas, Conversão média, Tempo até vender), o comparativo Pedro x Marcos, os alertas inteligentes e o ranking de vendedores.

Cada cartão mostra uma setinha ▲/▼ com a variação em relação ao período anterior.', '{"painel geral",resultados,"relatorio geral",relatório,vendas,funil,desempenho,ranking,metricas,métricas,conversao}'::text[], '{"como uso o painel geral?","onde vejo meus resultados?","como filtro por período?","onde vejo o ranking de vendedores?"}'::text[], 'published', 'all', 90
WHERE NOT EXISTS (SELECT 1 FROM public.support_knowledge_articles WHERE slug='usar-painel-geral');
