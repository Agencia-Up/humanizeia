# LogosIA / Pedro CRM - Memoria Operacional

Atualizado em: 2026-05-11

Este documento guarda a logica de negocio, arquitetura e decisoes ja validadas no LogosIA para servir de base em manutencoes futuras e em novos projetos.

## Visao Geral

O Pedro e o agente SDR da LogosIA para atendimento, qualificacao e transferencia de leads automotivos vindos do WhatsApp, anuncios e CRM. Ele trabalha integrado ao painel, ao CRM avancado, ao CRM ao vivo, aos vendedores e a UAZAPI.

A ideia central e:

1. O lead chega pelo WhatsApp/anuncio.
2. A mensagem entra pelo webhook da UAZAPI.
3. O Pedro registra a conversa no `wa_inbox`.
4. O Pedro cria ou atualiza o lead em `ai_crm_leads`.
5. O agente conversa, qualifica, consulta contexto/estoque quando aplicavel e move o lead no CRM.
6. Quando o lead esta pronto para vendedor, ele e transferido respeitando fila/rodizio.
7. O vendedor confirma pelo WhatsApp/fluxo interno e o sistema vincula o lead ao vendedor correto.
8. O painel permite acompanhar conversas, pausar IA, responder manualmente e auditar o funil.

## Componentes Principais

### Frontend

- `src/pages/PedroSDR.tsx`
  - Tela principal do Pedro.
  - Abas de Performance, CRM Avancado, Inbox IA, Agente IA, CRM ao Vivo, Instancias e Vendedores.
  - Os numeros de Total, Hoje, Semana e Mes devem vir de contagens exatas no Supabase, nao da lista limitada do kanban.

- `src/components/pedro/AgentInboxTab.tsx`
  - Inbox IA do Pedro.
  - Lista conversas vindas de `ai_crm_leads`.
  - Busca mensagens em `wa_inbox` por telefone limpo e por JID.
  - Exibe mensagens de texto e imagens quando existe `media_url`.
  - Permite pausar IA antes de responder manualmente.
  - Polling deve ser silencioso para nao resetar loading, nao reabrir conversa e nao causar flicker.

- `src/pages/CrmAoVivo.tsx`
  - Monitoramento de leads qualificados e transferencia manual para vendedores.
  - Usado para ver leads pendentes, fila inteligente e status da transferencia.

- `src/pages/WhatsAppInbox.tsx`
  - Inbox geral do WhatsApp.
  - Tambem possui logica de transferencia manual e registro em `ai_lead_transfers`.

### Supabase / Banco

- `ai_crm_leads`
  - Fonte principal dos leads do Pedro.
  - Campos relevantes:
    - `user_id`
    - `agent_id`
    - `lead_name`
    - `phone`
    - `status`
    - `assigned_to_id`
    - `assigned_to_member_id`
    - `transferred_at`
    - `transfer_reason`
    - `last_interaction_at`
    - `instance_id`
    - `message_count`
    - `ai_paused`
    - `next_followup_at`
    - campos de notas, midia e follow-up adicionados nas migracoes do Pedro CRM.

- `ai_lead_transfers`
  - Historico e estado das transferencias de leads.
  - Usada pelo rodizio, confirmacao do vendedor, redistribuicao e auditoria.
  - Status importantes:
    - `pending`
    - `confirmed`
    - `expired`

- `ai_team_members`
  - Vendedores e membros da equipe.
  - Deve diferenciar vendedor de lead para evitar que numero de vendedor vire lead no CRM.

- `wa_inbox`
  - Historico bruto/operacional das conversas WhatsApp.
  - Deve registrar entrada e saida.
  - Campos importantes:
    - `user_id`
    - `instance_id`
    - `phone`
    - `contact_name`
    - `content`
    - `direction`
    - `message_type`
    - `media_url`
    - `caption`
    - `created_at`

## Edge Functions Importantes

### `supabase/functions/uazapi-webhook/index.ts`

Funcao critica de entrada do WhatsApp.

Responsabilidades:

- Receber eventos da UAZAPI.
- Normalizar telefone/JID.
- Ignorar mensagens do proprio sistema quando necessario.
- Salvar mensagens recebidas em `wa_inbox`.
- Criar/atualizar lead em `ai_crm_leads`.
- Respeitar `ai_paused`: se o lead/conversa estiver pausado, salva a mensagem, mas nao chama IA nem responde automaticamente.
- Chamar a IA do Pedro quando aplicavel.
- Enviar resposta ao lead.
- Salvar respostas enviadas pelo agente no `wa_inbox`.
- Quando enviar imagem de veiculo/BNDV, registrar tambem uma mensagem outgoing com:
  - `message_type = 'image'`
  - `media_url`
  - `caption`/`content`

Ponto de atencao:

- Imagens antigas enviadas antes do registro em `wa_inbox` podem nao aparecer no Inbox IA se nunca foram persistidas no banco.

### `supabase/functions/wa-inbox-webhook/index.ts`

Funcao relacionada a inbox/webhook de WhatsApp.

Deve ficar compativel com:

- `ai_crm_leads.instance_id`
- `ai_crm_leads.message_count`
- registros de mensagens em `wa_inbox`

### `supabase/functions/cron-lead-followup/index.ts`

Funcao de automacao de follow-up e repasse.

Responsabilidades relevantes:

- Repassar transferencia pendente quando vendedor nao confirma em tempo habil.
- Respeitar horario operacional.
- Usar `ai_lead_transfers.created_at` como fonte para janela de repasse.
- Expirar transferencia antiga antes de criar nova.
- Evitar repasse de lead que ja saiu do status qualificado.

### `supabase/functions/bulk-transfer-leads/index.ts`

Funcao de redistribuicao em massa.

Usada em situacoes excepcionais quando a regra automatica falhou e varios leads ficaram pendentes. Deve respeitar a fila/rodizio e, em operacoes corretivas pontuais, pode transferir de forma silenciosa sem avisar novamente o lead quando o lead ja foi avisado antes.

## Regras de Negocio Essenciais

### 1. Vendedor nao pode virar lead

Se o telefone estiver cadastrado como vendedor/membro da equipe, uma resposta desse numero ao agente nao deve criar lead no CRM.

Uso esperado:

- Vendedor recebe transferencia.
- Vendedor responde/confirmar.
- Sistema interpreta como acao do vendedor.
- Sistema move/confirma o lead relacionado.
- Nao cria card novo para o vendedor em `ai_crm_leads`.

### 2. Transferencia respeita fila

O proximo vendedor deve seguir o rodizio configurado no painel.

Quando um lead qualificado precisa ir para vendas:

- Selecionar proximo vendedor ativo.
- Atualizar `ai_crm_leads.assigned_to_id`/`assigned_to_member_id`.
- Criar registro em `ai_lead_transfers`.
- Marcar status conforme fluxo.
- Atualizar estado visual no CRM.

### 3. Transferencia silenciosa e excecao

Transferencia silenciosa so deve ser usada como correcao operacional quando:

- O lead ja recebeu mensagem dizendo que seria transferido.
- A regra automatica falhou.
- E necessario redistribuir sem duplicar aviso ao lead.

No fluxo normal, o agente pode avisar o lead conforme a regra de atendimento.

### 4. Lead recorrente deve ir para o mesmo vendedor

Quando o numero do lead ja tem historico de atendimento/vendedor:

- O sistema deve tentar reenviar para o mesmo vendedor anterior.
- Isso evita quebra de contexto e conflito comercial.
- Se o vendedor nao estiver ativo/disponivel, aplicar fallback para fila/rodizio.

### 5. Pausar IA para atendimento manual

No Inbox IA:

- Enquanto `ai_paused = false`, o agente pode continuar respondendo automaticamente.
- Para humano responder manualmente, primeiro pausar IA.
- Depois de pausado, mensagens recebidas continuam sendo salvas, mas o webhook nao gera resposta automatica.
- Resposta manual deve sair pelo canal WhatsApp e ser registrada no historico.

### 6. Estoque e anuncios automotivos

Problema ja observado:

- Lead veio de anuncio de um veiculo.
- O agente disse que nao tinha o carro no estoque, mesmo existindo modelo equivalente no estoque.

Regra desejada:

- O agente nao deve alucinar disponibilidade.
- Deve comparar marca, modelo, versao, ano/modelo, cambio, combustivel e preco com tolerancia.
- Exemplo real:
  - Anuncio: Renault Duster Authentique 1.6 2020 automatico.
  - Estoque: Renault Duster, Duster Authent. 1.6 Flex 16V Aut., ano 2019/2020, branco, automatico, flex, placa BYY3639, R$ 73.990.
  - Resultado correto: reconhecer como estoque correspondente/proximo, nao dizer indisponivel.

### 7. Metricas do CRM

As metricas do Pedro CRM Avancado devem ser contagens exatas:

- Total Leads: count total de `ai_crm_leads` do usuario/agente.
- Hoje: `created_at` entre inicio e fim do dia no timezone correto.
- Na Semana: semana calendario, iniciando segunda-feira.
- No Mes: do primeiro dia do mes ate agora.

Nao usar lista paginada/limitada do kanban como base para esses numeros.

## Inbox IA - Comportamento Esperado

O Inbox IA deve:

- Mostrar conversas do agente por lead.
- Permitir busca por nome ou telefone.
- Manter conversa selecionada estavel durante atualizacoes.
- Atualizar mensagens sem piscar a tela.
- Nao resetar scroll/loading em polling silencioso.
- Buscar historico amplo da conversa.
- Renderizar imagens quando houver `media_url`.
- Registrar mensagens enviadas pelo Pedro, inclusive imagens.
- Permitir pausa/retomada da IA.
- Bloquear envio manual se a IA nao estiver pausada.

Correcoes importantes ja feitas:

- Busca de mensagens por telefone limpo e por JID.
- Polling silencioso a cada intervalo.
- Evitar loop de estado que fazia a conversa recarregar rapidamente.
- Busca de ate 1000 mensagens por conversa.
- Registro de imagem enviada pelo agente no `wa_inbox`.

## Instancias WhatsApp / UAZAPI

Fluxo esperado:

1. Usuario gera QR Code para conectar WhatsApp.
2. UAZAPI cria/conecta instancia.
3. Painel detecta a instancia conectada.
4. Instancia aparece sem precisar Ctrl+F5.
5. Usuario consegue selecionar a instancia no agente.
6. O agente salva a instancia e passa a responder por ela.

Problemas ja observados:

- Tela piscando como se desse F5 apos QR Code.
- Instancia conectada na UAZAPI mas nao aparecendo no painel ate Ctrl+F5.
- Instancia aparecendo mas nao selecionada no modal do agente.

Cuidados:

- Evitar reload completo durante polling/status de QR.
- Atualizar estado local da instancia depois de conectar.
- Persistir relacao `agent.instance_id` ou `agent.instance_ids` corretamente.

## Commits Recentes Relevantes

- `19da679` - restaurou entrada de leads do Pedro apos mudancas de inbox.
- `84f81a5` - corrigiu metricas exatas do CRM do Pedro.
- `17e1f07` - tornou Inbox IA utilizavel com pausa/resposta manual.
- `a8db4ab` - estabilizou polling do Inbox IA e registro de imagens.

## Principios Para Reaproveitar em Outro Projeto

1. Separar conversa bruta (`wa_inbox`) de entidade comercial (`ai_crm_leads`).
2. Toda mensagem importante deve ser persistida antes de qualquer processamento de IA.
3. Automacao deve ser pausavel por conversa/lead.
4. Transferencia comercial precisa de trilha auditavel (`ai_lead_transfers`).
5. Vendedor/membro interno nunca deve entrar como lead.
6. Fila/rodizio deve ser fonte unica para distribuicao justa.
7. Lead recorrente deve preservar vendedor anterior quando possivel.
8. Interface de inbox precisa atualizar em silencio para nao atrapalhar atendimento.
9. Midias enviadas pela IA devem ser gravadas como mensagens para aparecer no painel.
10. Metricas devem vir de queries de contagem, nao de dados ja paginados na tela.

## Checklist de Saude do Sistema

Antes de considerar o Pedro funcionando:

- Mensagem nova entra em `wa_inbox`.
- Lead novo aparece em `ai_crm_leads`.
- Numero de vendedor nao cria lead.
- Pedro responde quando `ai_paused = false`.
- Pedro nao responde quando `ai_paused = true`.
- Resposta manual exige IA pausada.
- Imagem enviada aparece no Inbox IA.
- Transferencia cria/atualiza `ai_lead_transfers`.
- CRM mostra vendedor correto.
- Metricas Total/Hoje/Semana/Mes batem com contagem do banco.
- Instancia WhatsApp conectada aparece sem forcar reload.

## Observacoes Para Futuro Produto

Esse modelo serve como base para qualquer projeto com:

- agente SDR por WhatsApp,
- CRM de leads,
- vendedor humano assumindo conversa,
- transferencia por rodizio,
- auditoria de atendimento,
- pausa de automacao,
- inbox unificado com texto e midia,
- prevencao de IA inventar disponibilidade ou status comercial.

Para outro projeto, manter a mesma separacao:

- `messages/inbox`: historico de conversa.
- `leads/deals`: oportunidade comercial.
- `team_members`: pessoas internas.
- `transfers/assignments`: posse e auditoria.
- `automation_state`: IA pausada, status, ultima interacao e regras ativas.
