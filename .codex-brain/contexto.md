# Contexto do Produto

## Nome

LogosIA (`logosia-platform`).

## Objetivo

Plataforma para agencia/operacao comercial com IA, CRM e WhatsApp. O foco atual e atender leads automotivos da Icom Motors, separar canais automaticos e manuais e permitir que vendedores e gerentes acompanhem leads, funis, follow-ups, disparos e performance.

## Principais areas do produto

- Tela inicial: hub de entrada com saudacao, acoes rapidas e cards dos agentes.
- Dashboard: visao comercial comparativa entre Pedro e Marcos, com indicadores de leads automaticos e manuais.
- Pedro SDR: funil do agente de IA para leads que chegam pelo WhatsApp/anuncios/trafego e sao atendidos automaticamente.
- Marcos CRM & Leads: CRM manual, contatos, listas, disparo em massa, instancias, automacoes e follow-ups para vendedores.
- CRM ao Vivo do Pedro: monitoramento em tempo real para TV/operacao, incluindo fila, rodizio, transferencias e cards por etapa.
- Inbox IA: acompanhamento de conversas entre leads e IA.
- Configuracoes, integracoes e planos: conexoes com provedores e controle de acesso por plano/perfil.

## Regras de negocio importantes

- Pedro e Marcos sao fluxos diferentes:
  - Pedro recebe leads atendidos por IA e segue regras de transferencia.
  - Marcos e CRM manual/operacional para vendedores e campanhas, sem agente respondendo lead como Pedro.
- A IA do Pedro nao deve mover etapas do CRM por conta propria. Leads chegam em `Novo`; vendedor ou gerente decide a etapa manualmente.
- Transferencias do Pedro:
  - Devem respeitar fila/rodizio de vendedores ativos.
  - Devem enviar feedback/resumo ao vendedor quando aplicavel.
  - Devem manter o lead com status de vendedor `Aguardando` ate o vendedor responder `ok`.
  - Quando o vendedor responde `ok`, a atribuicao deve ocorrer pelo telefone do vendedor, nao pelo nome salvo.
  - Vendedores cadastrados nao devem ser tratados como leads.
  - Se um lead ja foi atendido por um vendedor e voltar a falar, deve ser direcionado preferencialmente ao mesmo vendedor.
- Marcos:
  - Vendedores podem adicionar/importar leads no CRM manual.
  - Leads importados/adicionados devem ficar associados ao vendedor responsavel quando aplicavel.
  - Gerente ve tudo; vendedor deve ver/operar o que tem permissao.
  - Disparo em massa e follow-up enviam mensagens programadas; nao devem responder como agente conversacional.
- Disparo em massa:
  - Deve enviar apenas uma mensagem por destinatario por campanha.
  - Deve respeitar intervalos/delays configurados.
  - Quando usar IA, o prompt base gera variacoes; `Mensagem Fixa` e alternativa quando nao quiser IA.
  - Midias (imagem/audio/video) precisam seguir junto com texto quando configurado.
  - Agendamento deve ter janela minima de 10 minutos quando inicio e fim forem preenchidos.
- BNDV/estoque:
  - Pedro deve consultar estoque real antes de sugerir veiculos.
  - Nao deve inventar disponibilidade.
  - Deve diferenciar carro, moto e outros tipos conforme pedido do lead.

## Perfis

- Gerente/master: acesso amplo, pode ver dados do time, ajustar vendedores e operar funis.
- Vendedor: acesso limitado ao CRM/instancias/campanhas conforme permissao/plano e isolamento por usuario/vendedor.
- Admin/superadmin: rotas administrativas e configuracoes sensiveis.

## Cuidados

- Nao misturar base de producao com base teste/staging.
- Nao salvar segredos neste cerebro.
- Antes de alterar regras do Pedro/Marcos, entender se a alteracao afeta IA, CRM, vendedor ou campanhas.
- Em producao, alteracoes de Edge Functions e banco podem impactar atendimento real.

