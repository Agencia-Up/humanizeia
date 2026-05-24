# Plano de Acao - Pedro v2

## Status

Implementacao inicial em andamento.

Gatilho recebido em 2026-05-24: Douglas autorizou iniciar com **"Pode comecar"**.

Primeira entrega criada:

- scaffold paralelo `pedro-webhook-v2`, sem substituir `uazapi-webhook`;
- modulos compartilhados em `supabase/functions/_shared/pedro-v2`;
- tools separadas para identidade, intencao, memoria, transferencia, estoque, resposta, CRM, `ok` do vendedor e envio;
- tabela de logs `pedro_v2_turn_logs`;
- flags de seguranca:
  - `PEDRO_V2_ENABLED`;
  - `PEDRO_V2_MUTATIONS_ENABLED`;
  - `PEDRO_V2_SEND_ENABLED`;
  - `PEDRO_V2_INTERNAL_TOKEN`.

Estado atual: Pedro v2 fica desligado por padrao e, mesmo ligado, nao deve gravar dados nem enviar WhatsApp sem flags explicitas de teste controlado.

## Objetivo

Criar o Pedro v2 em paralelo ao Pedro v1, sem quebrar o agente atual.

O Pedro v1 deve continuar funcionando normalmente em producao enquanto o Pedro v2 e desenvolvido, testado e validado. Somente depois de validado o Pedro v2 deve substituir o Pedro v1.

## Problema atual

O Pedro v1 concentra muitas responsabilidades em um unico fluxo/Edge Function:

- receber webhook da Uazapi;
- identificar lead ou vendedor;
- salvar historico;
- atualizar memoria;
- consultar estoque BNDV;
- gerar resposta;
- enviar mensagens e midias;
- transferir para vendedor;
- lidar com `ok` do vendedor;
- atualizar CRM.

Isso deixa o atendimento fragil, pois o agente depende demais do prompt e do LLM escolher a acao certa. O resultado atual e um atendimento ruim em casos como:

- nomes de veiculos com erro de portugues;
- pedidos de veiculos similares;
- contexto de anuncio;
- mensagens como "esse carro";
- filtro por preco, cambio, ano ou tipo;
- lead pedindo uma coisa e o agente perguntando outra;
- busca de estoque inconsistente;
- transferencia e CRM misturados com conversa.

## Principio do Pedro v2

O Pedro v2 deve funcionar como um orquestrador leve, parecido com a ideia de fluxos/tools:

1. Recebe a mensagem.
2. Identifica quem enviou.
3. Recupera contexto/memoria.
4. Entende a intencao.
5. Chama a tool certa.
6. Gera resposta baseada em fatos.
7. Executa envio, transferencia ou atualizacao necessaria.

A personalidade continua vindo do portal pelo system prompt do cliente, mas as regras operacionais criticas nao devem depender apenas do prompt.

## Arquitetura proposta

### `pedro-webhook-v2`

Funcao principal/orquestrador.

Responsabilidades:

- receber webhook da Uazapi;
- gerar `correlation_id`;
- chamar as etapas corretas;
- nao concentrar regra pesada;
- registrar logs estruturados do turno.

Nao deve:

- conter toda a logica de estoque;
- conter toda a logica de transferencia;
- decidir sozinho comportamento comercial complexo.

### `pedro-identify-contact`

Identifica se o numero e:

- lead;
- vendedor;
- gerente;
- instancia propria;
- numero bloqueado;
- contato interno.

Regra critica:

- vendedor nunca pode virar lead;
- a chave principal deve ser o telefone normalizado, nao o nome salvo.

### `pedro-lead-memory`

Cria e atualiza memoria estruturada do lead desde a primeira mensagem.

Campos importantes:

- nome;
- telefone;
- cidade;
- veiculo principal;
- tipo de veiculo;
- faixa de preco;
- entrada;
- parcela desejada;
- troca;
- objecoes;
- origem/anuncio;
- ultima referencia de veiculo;
- veiculos apresentados;
- vendedor anterior;
- etapa conversacional;
- ultimo proximo passo.

Regra critica:

- a primeira mensagem do lead nunca pode ser descartada da memoria.

### `pedro-intent-router`

Entende o que o lead quer no turno atual.

Intencoes principais:

- perguntar disponibilidade;
- pedir preco;
- pedir foto;
- pedir financiamento;
- informar troca;
- pedir endereco;
- perguntar "esse carro";
- responder anuncio;
- pedir humano/vendedor;
- demonstrar irritacao;
- abandonar conversa;
- retomar conversa antiga.

### `pedro-stock-search`

Motor unico de busca BNDV para o Pedro v2.

Responsabilidades:

- normalizar texto;
- corrigir erros comuns;
- interpretar nomes aproximados;
- diferenciar carro, moto, pickup, SUV, hatch, sedan etc.;
- buscar exato;
- buscar similares;
- respeitar preco, ano, cambio, combustivel e km;
- retornar score/confidence;
- explicar motivo do match;
- nunca inventar disponibilidade.

Importante:

- unificar a logica de busca para evitar divergencia entre tool do agente e endpoint do portal.

### `pedro-sales-reply`

Gera a resposta final ao lead.

Entrada obrigatoria:

- memoria do lead;
- intencao;
- resultado de estoque;
- regras comerciais;
- prompt/persona do cliente;
- contexto de conversa.

Regra critica:

- a resposta deve ser baseada em fatos validados;
- se nao consultou estoque quando precisava, nao deve afirmar disponibilidade;
- nao deve perguntar troca/entrada antes de responder a duvida principal.

### `pedro-transfer-router`

Cuida somente da transferencia.

Regras:

- se o lead ja teve vendedor antes, enviar para o mesmo vendedor;
- se nao teve, respeitar fila/rodizio;
- manter lead na coluna `Novo`;
- campo de vendedor fica `Aguardando` ate o vendedor responder `ok`;
- enviar briefing para vendedor;
- nao mover etapa comercial do CRM;
- nao depender da IA para escolher livremente a transferencia.

### `pedro-seller-ack`

Cuida somente da resposta do vendedor.

Regras:

- identificar vendedor pelo telefone normalizado;
- aceitar `ok` e variacoes configuradas;
- atribuir o lead correto ao vendedor;
- manter a coluna do CRM como estiver;
- nunca cadastrar vendedor como lead;
- registrar confirmacao no historico/feedback.

### `pedro-crm-sync`

Sincroniza estados necessarios no CRM.

Regra atual desejada:

- o agente Pedro nao move etapa comercial do CRM;
- vendedor ou gerente move o lead manualmente;
- o Pedro pode manter informacoes operacionais como `Aguardando`, vendedor atribuido, feedback e resumo.

### `pedro-message-sender`

Centraliza envio Uazapi.

Responsabilidades:

- texto;
- imagem;
- audio;
- video;
- retries;
- idempotencia;
- logs;
- evitar duplicidade de envio.

## Regras de transferencia consolidadas

1. Lead novo chega e entra como `Novo`.
2. IA atende normalmente.
3. Se precisa transferir, chama `pedro-transfer-router`.
4. Primeiro verifica se o lead ja teve vendedor associado antes.
5. Se sim, transfere para o mesmo vendedor.
6. Se nao, usa fila/rodizio.
7. Lead permanece em `Novo`.
8. Campo de vendedor fica `Aguardando`.
9. Vendedor recebe briefing pelo WhatsApp.
10. Quando vendedor responde `ok`, `pedro-seller-ack` confirma pelo telefone do vendedor.
11. O lead passa a mostrar o nome do vendedor.
12. O CRM nao muda de coluna automaticamente.
13. Vendedor e gerente movem o lead manualmente.
14. Vendedor nunca e cadastrado como lead.

## Politica comercial desejada

O Pedro v2 deve seguir uma ordem comercial mais inteligente:

1. Entender o que o lead pediu.
2. Se houver veiculo, preco ou anuncio, consultar estoque antes de responder.
3. Responder direto a duvida principal.
4. Se nao tiver o exato, oferecer similares reais.
5. Apresentar poucas opcoes, com clareza.
6. Fazer uma pergunta comercial curta.
7. So aprofundar troca, entrada, financiamento e visita depois de resolver a necessidade principal.
8. Se o lead se irritar, reconhecer e corrigir a rota.
9. Nao encerrar cedo quando ainda houver oportunidade de venda.

## Maquina de estado sugerida

Estados possiveis:

- `novo_contato`;
- `entendendo_interesse`;
- `consultando_estoque`;
- `apresentando_opcoes`;
- `qualificando_compra`;
- `aguardando_resposta`;
- `transferencia_pendente`;
- `vendedor_assumiu`;
- `ia_pausada`;
- `encerrado`.

## Logs obrigatorios

Cada turno deve registrar:

- `correlation_id`;
- `lead_id`;
- `remote_jid`;
- `agent_id`;
- `intent`;
- `vehicle_query`;
- `stock_search_called`;
- `stock_results_count`;
- `selected_vehicle_id`;
- `fallback_used`;
- `seller_target`;
- `handoff_status`;
- `response_type`;
- `error`;
- timestamp.

## Estrategia de implementacao segura

1. Nao alterar Pedro v1 de imediato.
2. Criar Pedro v2 em paralelo.
3. Usar feature flag ou configuracao para ativar v2 apenas em testes.
4. Montar corpus de conversas reais problematicas:
   - Strada cabine dupla automatico;
   - Oroch;
   - "esse carro";
   - anuncio de Instagram;
   - erro de portugues;
   - faixa de preco;
   - carro x moto;
   - retorno de lead ja atendido;
   - vendedor respondendo `ok`.
5. Testar Pedro v2 com esses casos antes de producao.
6. Comparar Pedro v1 x Pedro v2.
7. Ativar em poucos numeros/controlado.
8. Ativar em producao somente apos validacao.
9. Depois de estabilizado, apos decisao explicita, desativar/remover Pedro v1.

## Criterios de sucesso

- Lead que cita veiculo recebe resposta baseada em estoque real.
- Erros de digitacao e nomes aproximados sao entendidos.
- "Esse carro" resolve corretamente anuncio/mensagem citada.
- Se nao houver o exato, o agente oferece similares coerentes.
- O agente nao pergunta troca/entrada antes de responder disponibilidade.
- Vendedor nao vira lead.
- Lead recorrente volta para o mesmo vendedor.
- Transferencia respeita fila/rodizio.
- Vendedor confirma com `ok` e o lead e atribuido corretamente.
- Pedro nao move coluna comercial do CRM automaticamente.
- Logs permitem explicar cada resposta.
- Midias sao enviadas como midia real, nao markdown solto.

## Primeiro passo quando retomar

Quando o Douglas autorizar com "Pode comecar":

1. Ler `.codex-brain/00-index.md`.
2. Ler este arquivo.
3. Ler `.codex-brain/analise-pedro-agente-2026-05-23.md`.
4. Mapear novamente arquivos atuais do Pedro.
5. Criar um plano tecnico de implementacao incremental.
6. So entao iniciar a criacao da estrutura Pedro v2, sem alterar o Pedro v1.
