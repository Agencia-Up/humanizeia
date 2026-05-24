# Analise do Agente Pedro - 2026-05-23

## Escopo

Auditoria sem alteracao de codigo, focada no agente Pedro/Carvalho da Icom Motors:

- como o agente funciona hoje;
- linguagem, runtime, banco e integracoes usadas;
- falhas de inteligencia, memoria, busca de estoque e atendimento comercial;
- exemplos reais observados no banco e nas imagens enviadas;
- plano de acao para reformular o agente sem quebrar CRM, transferencias e operacao atual.

Nao foram salvos tokens, senhas, chaves privadas ou valores de variaveis sensiveis neste documento.

## Resumo executivo

O Pedro nao esta ruim apenas por causa do system prompt. O problema principal esta na arquitetura de orquestracao do atendimento.

Hoje o agente tenta fazer muitas coisas no mesmo fluxo: receber WhatsApp, identificar vendedor, salvar historico, extrair memoria, consultar estoque BNDV, conversar com o lead, mover/atualizar CRM e transferir para vendedor. Como isso fica concentrado em uma Edge Function grande, qualquer falha de ordem, contexto ou ferramenta faz o agente responder de forma rasa ou confusa.

Os sintomas vistos nas conversas batem com isso:

- ele pergunta nome/troca antes de resolver a duvida principal do carro;
- ele declara que nao tem veiculo sem explorar bem similares;
- ele nao entende bem erros de portugues ou nomes aproximados;
- ele se perde com "esse carro" quando o lead veio de anuncio ou respondeu uma mensagem anterior;
- ele pode listar opcoes erradas ou fora do contexto;
- ele manda texto com links/markdown de imagem em vez de uma apresentacao limpa;
- ele depende demais do modelo decidir chamar a ferramenta certa.

Para vender melhor, precisamos separar o Pedro em camadas: interpretador de intencao, buscador de estoque, memoria estruturada, politica comercial, gerador de resposta e handoff para vendedor. O prompt continua importante, mas nao pode ser o unico mecanismo de controle.

## Como funciona hoje

### Linguagem e runtime

- Edge Functions Supabase em TypeScript/Deno.
- Frontend React 18 + Vite + TypeScript.
- Banco Supabase Postgres/Auth/RLS.
- Envio/recebimento WhatsApp via Uazapi.
- Estoque via BNDV GraphQL.
- OpenAI para resposta principal e tool calling.
- Claude/Anthropic para algumas extracoes e sumarizacoes auxiliares.

### Arquivos principais analisados

- `supabase/functions/uazapi-webhook/index.ts`
  - Principal entrada do Pedro.
  - Recebe webhook da Uazapi.
  - Decide se a mensagem deve ser tratada como lead, vendedor ou sistema.
  - Salva historico em `wa_chat_history`.
  - Atualiza inbox/CRM.
  - Monta prompt do agente.
  - Chama OpenAI com ferramentas.
  - Executa consulta BNDV, transferencia e envio WhatsApp.

- `supabase/functions/bndv-stock-search/index.ts`
  - Busca de estoque BNDV mais especializada.
  - Tem normalizacao, sinonimos e logica de tipo de veiculo.
  - Parece mais robusta do que a busca embutida no webhook principal.

- `supabase/functions/manual-transfer/index.ts`
  - Transferencia manual de lead para vendedor.

- `supabase/functions/transfer-timeout-checker/index.ts`
  - Regra de inatividade/transferencia por tempo.

- `_shared/qualification/*`
  - Scoring, fallback BNDV e classificacao.

- `_shared/memory/*`
  - Perfil persistente e sumarizacao.

- `_shared/handoff/*`
  - Briefing para transferencia.

- `_shared/prompt/*`
  - Few-shots/persona.

## Fluxo simplificado atual

1. Uazapi envia webhook para `uazapi-webhook`.
2. A function identifica instancia ativa e agente vinculado.
3. Tenta detectar se a mensagem veio de vendedor.
4. Salva a mensagem recebida em `wa_chat_history`.
5. Tenta extrair entidades e atualizar `pedro_conversation_state`.
6. Salva/atualiza inbox e lead no CRM.
7. Busca historico recente.
8. Monta prompt com:
   - system prompt salvo no portal;
   - dados da empresa;
   - regras de transferencia/CRM;
   - contexto de base de conhecimento;
   - perfil persistente, se habilitado;
   - few-shots, se habilitado.
9. Chama OpenAI com ferramentas:
   - consultar estoque BNDV;
   - transferir para vendedor;
   - atualizar etapa/status CRM.
10. Envia resposta pelo WhatsApp/Uazapi.
11. Pode enviar imagens de veiculos se a consulta BNDV retornar imagens.

## Evidencias observadas no banco

Foram consultadas amostras anonimizadas de conversas recentes em `wa_chat_history`, `ai_crm_leads` e `pedro_conversation_state`.

### Caso Strada cabine dupla automatica

O lead pediu "Strada cabine dupla automatico".

Problemas observados:

- O agente respondeu "otima escolha" e pediu nome antes de confirmar disponibilidade.
- Depois informou que nao tinha Strada, mas nao fez uma busca forte por equivalentes comerciais.
- Quando o lead foi especifico com ano/cor/modelo/km, o agente repetiu a negativa.
- O atendimento terminou frio, sem tentativa boa de recuperar a venda.

Leitura critica:

O agente deveria reconhecer a intencao clara: pickup compacta/cabine dupla/automatica. Se nao ha Strada, deveria buscar alternativas reais: Toro, Saveiro, Montana, Oroch, Hilux antiga, ou similares por faixa de preco/ano, sempre avisando que nao e o modelo exato.

### Caso Oroch

O lead pediu Oroch.

Problemas observados:

- O agente pediu nome antes de responder se tinha estoque.
- Quando disse nao ter Oroch, ja perguntou sobre troca.
- Isso pareceu desviar da dor principal do cliente.

Leitura critica:

Antes de qualificar troca, o agente precisa resolver a pergunta de estoque. Perguntar troca cedo demais parece script robotico.

### Caso "esse carro" vindo de anuncio/resposta

O lead respondeu "Esse" ou "quero saber sobre esse carro".

Problemas observados:

- O agente nem sempre consegue resolver o contexto do anuncio ou da mensagem citada.
- Sem resolver o veiculo de referencia, ele pode responder genericamente ou puxar outro veiculo.

Leitura critica:

O agente precisa de uma camada explicita de "referencia atual":

- veiculo do anuncio;
- veiculo citado na mensagem anterior;
- veiculo da ultima consulta BNDV;
- veiculo que recebeu imagem/link.

Sem isso, palavras como "esse", "esse carro", "o branco", "o automatico" ficam perigosas.

### Caso imagens/link de estoque

Foram vistas mensagens com sintaxe de markdown de imagem, como `![Modelo](https://...)`.

Problemas observados:

- No WhatsApp isso fica feio e pouco comercial.
- O ideal e enviar imagem como midia real, com legenda curta, ou texto limpo com link apenas quando necessario.

## Achados criticos

### 1. Extracao de memoria acontece antes de garantir o lead

No fluxo atual, a extracao de entidades tenta encontrar o lead no CRM antes de garantir que ele existe. Em primeiro contato, se o lead ainda nao foi criado, a function registra algo equivalente a "lead ainda nao existe, pulando extracao neste turno".

Impacto:

- A primeira mensagem, que geralmente contem o principal desejo do lead, pode nao entrar no estado estruturado.
- Exemplos: "estou procurando oroch", "Strada cabine dupla automatico", "quero Onix ate 60 mil".
- O agente perde a melhor pista logo no inicio e passa a depender apenas do historico textual.

### 2. O modelo decide quando consultar estoque

O agente recebe instrucao para consultar estoque, mas a chamada da ferramenta ainda depende do LLM escolher corretamente.

Impacto:

- Ele pode elogiar o carro ou fazer pergunta de qualificacao antes de consultar.
- Ele pode declarar ausencia de estoque de forma fraca.
- Ele pode nao fazer fallback/similares quando deveria.

Para um vendedor de veiculos, consulta de estoque precisa ser uma regra deterministica quando o lead cita modelo, preco, ano, cambio, tipo ou anuncio.

### 3. Busca BNDV duplicada e com niveis diferentes de qualidade

Existe uma busca embutida no webhook principal e outra function `bndv-stock-search` mais sofisticada.

Impacto:

- O portal e o agente podem ter resultados diferentes.
- Correcoes feitas em uma busca podem nao valer para a outra.
- Fica mais dificil melhorar sinonimos, ranking e filtros.

### 4. Tool de estoque nao recebe todo o contexto necessario

A ferramenta principal de estoque aceita modelo, marca, cambio, combustivel, ano, preco e km, mas nao deixa claro campos como:

- tipo de veiculo solicitado: carro, moto, pickup, SUV, hatch, sedan;
- contexto de anuncio;
- mensagem citada;
- tolerancia para similar;
- motivo de busca: disponibilidade exata, alternativa ou faixa de preco.

Impacto:

- A IA fica sem uma forma segura de passar contexto.
- A busca pode misturar categorias.
- Casos com erro de portugues ou nome parcial ficam mais frageis.

### 5. Falta um resolvedor de referencia

O agente nao parece ter uma etapa dedicada para transformar frases como "esse", "aquele", "o branco", "o automatico", "o carro do anuncio" em um veiculo concreto.

Impacto:

- Conversas vindas de anuncio ficam mais propensas a erro.
- O agente pode trocar o veiculo no meio da conversa.

### 6. Nao ha uma politica comercial deterministica

O atendimento mistura perguntas de nome, troca, entrada, cidade e disponibilidade sem uma ordem inteligente.

Impacto:

- O lead pergunta estoque, mas recebe qualificacao.
- O lead fica irritado por falta de objetividade.
- A venda esfria.

Exemplo de ordem mais adequada:

1. Entender o carro ou necessidade.
2. Confirmar disponibilidade ou similares reais.
3. Apresentar 1 a 3 opcoes com preco e beneficio.
4. Fazer pergunta comercial curta.
5. So depois aprofundar troca, entrada, financiamento e agenda.

### 7. Estado de conversa incompleto

`pedro_conversation_state` existe, mas amostras recentes indicam muitos estados com campos importantes vazios: modelo, veiculo apresentado, objecoes, proximo passo e score.

Impacto:

- O agente nao carrega bem o contexto comercial.
- Pode perguntar de novo ou mudar de assunto.
- Transferencia pode ir com briefing fraco.

### 8. Feature flags criticas podem estar desligadas

No `.env` local, varias flags aparecem ausentes, incluindo fallback/similares, perfil persistente, few-shots e sumarizacao hierarquica. Isso nao prova o estado de producao, mas e um risco operacional.

Impacto:

- Melhorias ja existentes no codigo podem nao estar ativas.
- O comportamento real pode ser bem inferior ao esperado.

### 9. Resposta com markdown/imagens nao esta ideal para WhatsApp

Enviar `![imagem](url)` dentro do texto nao e bom para WhatsApp.

Impacto:

- O lead ve uma mensagem pouco natural.
- Reduz confianca e profissionalismo.

### 10. CRM, transferencia e conversa estao misturados

O webhook principal tambem contem muita regra de CRM e transferencia.

Impacto:

- Dificulta evoluir a inteligencia sem quebrar operacao.
- Historico recente ja mostrou vendedor virando lead, transferencias falhando e CRM sendo movido indevidamente.

### 11. Drift entre banco e tipos do frontend

O arquivo de tipos do Supabase aparenta estar desatualizado em relacao ao banco real. Exemplo observado: no banco existe `assigned_to_id`, enquanto tipos antigos ainda referenciam nomes diferentes em alguns pontos.

Impacto:

- Bugs silenciosos.
- Queries erradas.
- Erros que so aparecem em runtime.

### 12. Observabilidade insuficiente para depurar inteligencia

Nao ha uma trilha clara por turno contendo:

- intencao detectada;
- veiculo resolvido;
- filtros enviados ao BNDV;
- resultados retornados;
- resultado escolhido;
- motivo da resposta;
- confidence score;
- se transferiu ou nao.

Impacto:

- Cada erro exige garimpar logs e conversas manualmente.
- Escalar para muitos leads fica arriscado.

## Plano de acao recomendado

### Fase 0 - Auditoria e corpus de testes

Objetivo: transformar os erros reais em testes.

- Separar 30 a 50 conversas reais problematicas.
- Anonimizar telefones e nomes quando necessario.
- Classificar por tipo de falha:
  - estoque exato;
  - similar;
  - anuncio/referencia;
  - preco/faixa;
  - troca;
  - financiamento;
  - vendedor/transferencia;
  - lead irritado/inativo.
- Criar uma tabela/arquivo de "entrada esperada x resposta aceitavel".

### Fase 1 - Resolver intencao antes de responder

Criar uma etapa obrigatoria antes do LLM responder:

- detectar se a mensagem tem intencao de compra;
- extrair modelo/marca/tipo/faixa/preco/ano/cambio;
- corrigir erros comuns de portugues;
- resolver contexto de anuncio ou mensagem citada;
- definir se precisa consultar estoque.

Resultado esperado:

- Se o lead cita veiculo ou preco, a resposta so sai depois da busca.

### Fase 2 - Unificar busca de estoque

Criar um unico motor de busca BNDV usado pelo portal e pelo agente.

Esse motor deve:

- normalizar textos;
- aceitar erros de digitacao;
- entender sinonimos;
- diferenciar carro, moto, pickup, SUV, hatch e sedan;
- ranquear por similaridade;
- retornar motivo do match;
- retornar "nao achei exato, mas achei similares" quando aplicavel;
- nunca inventar veiculo.

### Fase 3 - Criar uma memoria comercial confiavel

Manter um estado por lead com:

- veiculo principal;
- veiculos ja apresentados;
- restricoes: preco, entrada, parcela, cidade, troca;
- objecoes;
- ultimo proximo passo;
- nivel de interesse;
- vendedor associado;
- origem/anuncio.

Regra: atualizar memoria depois de toda mensagem, inclusive a primeira.

### Fase 4 - Separar gerador de resposta da operacao

O LLM deve receber um "pacote de fatos" e gerar resposta dentro de limites:

- veiculo encontrado;
- similares permitidos;
- o que nao pode afirmar;
- pergunta comercial recomendada;
- tom da conversa;
- etapa do funil.

O LLM nao deve decidir sozinho se inventa disponibilidade ou muda o veiculo.

### Fase 5 - Politica comercial de atendimento

Definir regras simples e rigidas:

- Pergunta direta sobre estoque recebe resposta direta primeiro.
- Se nao tem exato, oferecer similares com clareza.
- Nao perguntar troca/entrada antes de responder a duvida principal.
- Evitar encerrar cedo se ainda ha alternativa comercial.
- Se o lead ficar irritado, reconhecer e corrigir o rumo.
- Enviar no maximo 2 ou 3 opcoes por vez.
- Sempre terminar com uma pergunta curta e util.

### Fase 6 - Transferencia e CRM fora do cerebro de conversa

Manter a decisao de transferir e o CRM como camada separada:

- vendedor nao vira lead;
- lead recorrente volta para o mesmo vendedor;
- Pedro nao move etapa comercial do CRM, salvo regras que forem explicitamente permitidas;
- feedback para vendedor deve ser gerado a partir da memoria estruturada, nao de improviso.

### Fase 7 - Observabilidade e seguranca operacional

Criar logs estruturados por mensagem:

- `conversation_id`;
- `lead_id`;
- `intent`;
- `vehicle_query`;
- `stock_results_count`;
- `selected_vehicle_id`;
- `fallback_used`;
- `response_type`;
- `handoff_trigger`;
- `error`.

Criar dashboard interno de qualidade:

- % de mensagens com estoque consultado;
- % sem resultado;
- % com similar;
- % transferidas;
- tempo ate transferencia;
- erros por tipo;
- conversas com baixa confianca.

## Recomendacao de reformulacao

Nao recomendo apenas "melhorar o prompt". O caminho mais seguro e criar um Pedro v2 por tras de feature flag, mantendo o fluxo atual funcionando.

Estrutura sugerida:

1. `intent-resolver`
   - entende mensagem, anuncio e historico;
   - resolve veiculo e objetivo.

2. `stock-orchestrator`
   - consulta BNDV;
   - aplica sinonimos/similares;
   - retorna fatos confiaveis.

3. `conversation-state`
   - memoria comercial estruturada.

4. `sales-policy`
   - decide proxima acao: responder, perguntar, oferecer similar, transferir.

5. `response-generator`
   - gera texto natural baseado nos fatos.

6. `handoff-service`
   - cuida de vendedor, fila, retorno ao mesmo vendedor e feedback.

7. `message-sender`
   - envia texto/midia pela Uazapi.

## Prioridades imediatas

1. Corrigir ordem de criacao do lead x extracao de memoria.
2. Forcar consulta de estoque quando houver veiculo/preco/anuncio.
3. Unificar busca BNDV em um motor unico.
4. Adicionar resolvedor de "esse carro" e contexto de anuncio.
5. Criar testes com conversas reais: Strada, Oroch, ASX, Onix/anuncio, faixa de preco, erros de portugues.
6. Separar regra comercial de transferencia/CRM do gerador de conversa.
7. Melhorar logs por turno para saber por que cada resposta saiu.

## Conclusao

O Pedro tem base tecnica suficiente para evoluir, mas hoje a inteligencia esta espalhada e dependente demais de prompt. Para vender bem, ele precisa agir como um vendedor com processo:

- entender;
- consultar;
- comparar;
- responder com fatos;
- conduzir;
- transferir com contexto.

Enquanto essas etapas estiverem misturadas em um fluxo grande, qualquer ajuste de prompt ou regra isolada tende a resolver um caso e quebrar outro. A reformulacao deve ser feita por fases, com testes reais antes de ativar em producao.
