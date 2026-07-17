# Pedro v3 - Contexto Mestre do Projeto

> Status: documento fundador.
> Criado em: 2026-06-26.
> Fonte de verdade obrigatoria para Claude, Codex, Antigravity e qualquer outro agente que trabalhe no Pedro v3.

## 1. Regra de leitura obrigatoria

Antes de analisar, planejar, programar, testar ou revisar o Pedro v3:

1. Leia TODOS os arquivos `.md` da pasta `Brain`, em ordem alfabetica.
2. Leia `Skiil - n8n/SKILL.md` e as referencias indicadas por ele quando a tarefa envolver arquitetura, fluxo, ferramentas, integracoes, erros ou execucoes.
3. Consulte este arquivo novamente antes de qualquer decisao arquitetural.
4. Nunca presuma que a memoria de outra conversa esta atualizada. O `Brain` e a memoria compartilhada oficial.
5. Ao terminar uma etapa relevante, atualize o `Brain` antes de encerrar o trabalho.

Se houver divergencia entre uma conversa antiga e o `Brain`, pare e apresente a divergencia ao dono do projeto. Nao escolha silenciosamente.

## 2. Diretorios oficiais

### Pedro v3

Diretorio raiz:

`E:\Projetos - Antigravity\HUMANIZEIA\Refatorar - Pedro v3`

Responsabilidade das pastas:

- `Brain/`: memoria tecnica e de produto do Pedro v3. Deve conter contexto, decisoes, contratos, planos, progresso, erros encontrados, testes, riscos, handoffs e proximos passos.
- `Agent/`: todo o codigo-fonte, testes, configuracoes e artefatos executaveis exclusivos do Pedro v3.
- `Skiil - n8n/`: material de referencia. O v3 NAO sera implementado no n8n; os padroes de workflow, tools, execucao, subfluxos, erros e observabilidade serao traduzidos para uma arquitetura TypeScript propria.

### Pedro v2

Repositorio atual de producao:

`E:\Projetos - Antigravity\HUMANIZEIA\humanizeia`

O Pedro v2 continua atendendo clientes reais. Ele e referencia de capacidades, regras e casos reais, mas NAO e a base arquitetural do v3.

## 3. Decisoes imutaveis desta fase

1. O Pedro v2 permanece no ar enquanto o v3 e construido e validado.
2. O v3 sera criado isoladamente dentro de `Agent/`.
3. Nenhum arquivo do v2 sera movido ou alterado como efeito colateral da construcao do v3.
4. Capacidades maduras do v2 podem ser reutilizadas por adaptadores, mas seu orquestrador nao sera copiado.
5. O v3 nao sera um conjunto de remendos reorganizados.
6. O v3 sera uma maquina de conversa com estado central, ferramentas e uma unica decisao por turno.
7. O primeiro ambiente de teste integrado sera o agente da conta `douglasaloan@gmail.com`.
8. Nenhuma ativacao, deploy, escrita em banco, migracao ou troca de roteamento ocorre sem autorizacao explicita do dono.
9. O v3 deve nascer com shadow mode: processa conversas e registra decisoes sem responder ao lead.
10. Somente depois de validado em shadow mode o v3 podera responder pelo agente de teste.

## 4. Missao do Pedro v3

Construir um agente SDR automotivo realmente conversacional, capaz de:

- compreender a mensagem atual dentro do contexto da conversa;
- saber o que acabou de perguntar e interpretar a resposta do lead;
- manter preferencias, restricoes e veiculo em foco;
- conduzir o funil sem parecer um formulario;
- decidir quando responder, esclarecer, buscar estoque, enviar fotos, agendar ou transferir;
- usar ferramentas e incorporar seus resultados antes de responder;
- nunca executar mais de uma decisao comercial conflitante no mesmo turno;
- lembrar o que ja apresentou, perguntou, respondeu e enviou;
- justificar e registrar todas as decisoes importantes;
- falhar de forma segura, observavel e recuperavel.

O objetivo nao e apenas produzir textos melhores. O objetivo e tomar decisoes melhores durante toda a conversa.

## 5. Problema arquitetural que o v3 resolve

O Pedro v2 cresceu como um pipeline de varias autoridades:

- classificadores;
- planner;
- orquestrador;
- busca e fallbacks;
- gerador de resposta;
- guards de pre-envio;
- regras posteriores de transferencia e memoria.

Essas camadas podem interpretar a mesma mensagem de maneiras diferentes. O resultado sao sintomas como:

- repetir listas ou fotos;
- esquecer o veiculo selecionado;
- misturar categorias e faixas de preco;
- interpretar resposta do funil como nova busca;
- transferir antes da hora ou em silencio;
- perguntar novamente algo ja respondido;
- responder corretamente uma pergunta e terminar com uma CTA sem sentido;
- armazenar informacao sem transforma-la em comportamento.

O v3 elimina a disputa entre camadas. Uma decisao tipada governa o turno inteiro.

## 6. Modelo mental inspirado no n8n

O v3 nao usara o n8n em runtime, mas adotara seus melhores principios:

- um trigger inicia a execucao;
- cada etapa recebe e devolve dados estruturados;
- a ordem de execucao e previsivel;
- Switch/IF viram politicas e transicoes explicitas;
- sub-workflows viram tools e servicos reutilizaveis;
- cada tool tem contrato, timeout, retry e saida de erro;
- falhas nao somem: seguem para um fluxo de erro observavel;
- uma execucao possui identificador, entrada, etapas, saidas e status;
- dados e credenciais nao ficam hardcoded;
- integracoes sao modulos, nao regras de conversa;
- testes usam entradas fixas e resultados reproduziveis.

Fluxo conceitual:

```text
WhatsApp/Webhook
  -> normalizar evento
  -> agrupar burst
  -> adquirir lock da conversa
  -> carregar ConversationState
  -> interpretar mensagem e objetivo pendente
  -> produzir UMA TurnDecision
  -> executar tool, se necessario
  -> devolver ToolResult ao mesmo ciclo
  -> validar decisao pelas politicas
  -> compor UMA resposta
  -> persistir estado + eventos atomicamente
  -> enviar ou registrar em shadow mode
```

## 7. Principio central: uma decisao por turno

Todo turno deve gerar exatamente uma `TurnDecision` final.

Acoes iniciais previstas:

- `reply`
- `clarify`
- `collect_slot`
- `search_stock`
- `send_photos`
- `answer_vehicle_question`
- `schedule_visit`
- `handoff`
- `close`
- `no_op`

Contrato conceitual (VISÃO; o contrato AUTORITATIVO e detalhado vive em `02-ARQUITETURA-E-CONTRATOS.md`, refinado nas auditorias do Codex — onde divergir, vale o `02`):

```ts
type TurnDecision = {
  turnId: string;
  action: TurnAction;                       // a ÚNICA ação comercial final
  target?: EntityReference | null;
  reasonCode: string;
  reasonSummary: string;
  confidence: number;
  // ALINHADO com 02 (Codex r3 #8): nada de toolCall único nem statePatch genérico.
  decisionMutations: DecisionMutation[];    // FATOS do inbound, aplicados no commit
  effectPlan: EffectPlan[];                 // efeitos (união semântica); payload materializado após compose+validate
  nextObjective?: PendingObjective | null;  // ativo só após receipt do efeito (PlannedObjective antes)
  responsePlan: ResponsePlan;
  policyChecks: PolicyVerdict[];            // allow/deny/requirements/violations (política não decide)
};
// Loop de queries (read-only, autorizado por chamada) precede a decisão. Estado ENTREGUE (foto sent / pergunta
// asked / handoff completed) avança só via EffectOutcomeMutation com receipt. Ver 02 §2–§9.
```

Regras:

- o LLM pode propor a decisao;
- o motor de politicas valida ou rejeita a proposta;
- tools nao mudam o objetivo da conversa;
- o compositor nao escolhe outra acao;
- o sender nao altera decisao;
- handoff nunca e criado depois de a resposta ja ter sido enviada;
- toda acao perigosa exige `reasonCode` e evidencia no estado.

## 8. Estado central da conversa

O `ConversationState` sera versionado e sera a unica fonte de verdade operacional do turno.

Campos minimos:

```ts
type ConversationState = {
  schemaVersion: number;
  conversationId: string;
  tenantId: string;
  agentId: string;
  leadId?: string | null;
  turnNumber: number;
  stage: ConversationStage;
  currentObjective?: PendingObjective | null;
  slots: FunnelSlots;
  preferences: VehiclePreferences;
  vehicleContext: VehicleContext;
  offers: OfferMemory;
  photoLedger: PhotoLedger;
  handoff: HandoffState;
  scheduling: SchedulingState;
  recentTurns: ConversationTurn[];
  lastDecision?: DecisionSummary | null;
  lastToolResult?: ToolResultSummary | null;
  updatedAt: string;
};
```

### Pergunta/objetivo pendente

Nao usar apenas uma string como `pending_question`.

```ts
type PendingObjective = {
  id: string;
  type: string;
  slot?: string | null;
  askedAt: string;
  expectedAnswerKinds: string[];
  status: "pending" | "satisfied" | "declined" | "superseded";
  attempts: number;
};
```

### Slots do funil

Cada informacao deve carregar valor e proveniencia:

```ts
type FunnelSlot<T> = {
  status: "unknown" | "known" | "declined" | "not_applicable";
  value: T | null;
  sourceTurnId?: string | null;
  confidence: number;
  updatedAt: string;
};
```

Slots iniciais incluem, conforme configuracao do cliente:

- nome;
- interesse;
- tipo de veiculo;
- faixa de preco;
- forma de pagamento;
- entrada;
- parcela desejada;
- possui troca;
- dados do veiculo de troca;
- cidade/localizacao;
- conhecimento da loja;
- interesse em visita;
- dia e horario;
- CPF, somente quando a regra do cliente realmente exigir.

## 9. Memoria: Postgres e Redis

Redis nao e a inteligencia do agente. Ele sera usado onde e tecnicamente adequado:

- lock por conversa;
- agrupamento de bursts;
- idempotencia;
- deduplicacao de eventos;
- cache do estado quente;
- coordenacao entre execucoes concorrentes;
- TTL de dados efemeros.

Postgres/Supabase sera a memoria duravel:

- snapshot versionado do estado;
- eventos de turno;
- tool calls e resultados;
- decisoes;
- mensagens recebidas e enviadas;
- auditoria e metricas;
- configuracoes por tenant/agente.

Uma conversa deve ser processada sob lock, carregar o estado uma vez e persistir estado + eventos uma vez, com controle de versao/compare-and-swap. Dois webhooks concorrentes nao podem criar dois turnos independentes sobre o mesmo estado.

## 10. Tools do Pedro v3

As capacidades de negocio devem ser tools com contratos explicitos:

1. `stock_search`
   - consulta estoque real do tenant;
   - recebe filtros estruturados;
   - nunca decide o que responder;
   - devolve fatos, diagnosticos de match e fonte.
2. `vehicle_details`
   - resolve uma unidade do estoque;
   - devolve apenas dados aterrados.
3. `vehicle_photos`
   - resolve o veiculo-alvo;
   - consulta o ledger;
   - seleciona fotos ainda nao enviadas;
   - nunca escolhe aleatoriamente em caso ambiguo.
4. `knowledge_search`
   - consulta informacoes reais da loja;
   - devolve fontes e grau de confianca.
5. `crm_lead`
   - consulta/atualiza dados permitidos do lead;
   - operacoes de escrita exigem politica e auditoria.
6. `schedule_visit`
   - consulta disponibilidade e registra agendamento.
7. `handoff`
   - valida pre-condicoes;
   - seleciona destinatario;
   - gera briefing;
   - so executa depois de uma decisao final autorizada.
8. `store_info`
   - endereco, horario, unidade e regras da loja.

Cada tool deve possuir:

- schema de entrada;
- schema de saida;
- erros tipados;
- timeout;
- politica de retry;
- idempotency key quando houver escrita;
- teste de contrato;
- log de execucao;
- adaptador real e fake para testes.

## 11. Motor de politicas

As regras atuais do Pedro v2 precisam migrar, mas nao como `if` por frase.

Categorias:

1. **Invariantes:** nunca podem ser violados.
2. **Politicas de negocio:** variam por cliente/agente.
3. **Heuristicas:** ajudam interpretacao, mas nao sao verdade absoluta.
4. **Estilo:** governam como escrever.
5. **Compatibilidade temporaria:** existe apenas durante migracao.

Exemplos de invariantes:

- responder primeiro a pergunta atual do lead;
- uma resposta ao objetivo pendente nao vira nova busca sem mudanca explicita de assunto;
- nunca oferecer veiculo fora de restricao dura sem explicar;
- nunca afirmar estoque sem tool de estoque;
- nunca inventar preco, km, laudo, garantia ou especificacao;
- nunca enviar foto sem veiculo-alvo resolvido;
- nunca repetir fotos sem pedido explicito;
- nunca repetir a mesma lista como se fosse novidade;
- preservar categoria, teto e demais restricoes ate o lead altera-las;
- carro de troca nao vira carro desejado;
- handoff exige slots minimos e mensagem clara ao lead;
- falha de handoff nao deixa o lead em silencio;
- uma tool nao pode disparar outra acao comercial escondida;
- toda decisao e transicao deve ser observavel.

Cada politica deve ter ID estavel, descricao, prioridade, entrada, resultado e testes. Exemplo: `POL-HANDOFF-001`.

## 12. O que reutilizar do Pedro v2

Reutilizar por adaptadores e testes, depois de auditoria:

- integracao de estoque RevendaMais/BNDV;
- normalizacao e matching de veiculos;
- selecao e envio de fotos;
- sender do WhatsApp/UazAPI;
- base de conhecimento;
- regras reais de transferencia e rodizio;
- integracoes com CRM;
- dados e configuracao do funil por cliente;
- medicao de tokens e chaves BYOK;
- catalogo de casos reais;
- testes de regressao que representam invariantes validos.

Nao copiar como arquitetura:

- o orquestrador vivo do v2;
- a separacao atual entre planner, reply e guards concorrentes;
- fallbacks que mudam objetivo;
- mutacoes tardias depois do envio;
- memoria fragmentada sem contrato central;
- regexes de frases especificas;
- arquivos mortos/versionados apenas por historico;
- regras duplicadas entre prompt e codigo.

Toda reutilizacao deve responder:

1. Qual capacidade estamos preservando?
2. Qual contrato novo a envolve?
3. Qual dependencia do v2 foi removida?
4. Qual teste prova que ela funciona isoladamente?

## 13. Estrutura inicial sugerida para `Agent/`

```text
Agent/
  src/
    domain/
      conversation-state.ts
      turn-decision.ts
      events.ts
      policies.ts
    engine/
      conversation-engine.ts
      decision-engine.ts
      policy-engine.ts
      response-composer.ts
    tools/
      contracts/
      stock/
      photos/
      knowledge/
      crm/
      scheduling/
      handoff/
    adapters/
      whatsapp/
      redis/
      supabase/
      llm/
      pedro-v2/
    observability/
    config/
  tests/
    unit/
    contract/
    conversations/
    replays/
    shadow/
  scripts/
  docs/
```

Esta estrutura e direcional. Antes de cria-la, o executor deve propor contratos e obter aprovacao.

## 14. Ciclo atomico de um turno

1. Receber e validar evento.
2. Gerar `eventId`, `correlationId` e `turnId`.
3. Deduplicar evento.
4. Agregar mensagens do burst dentro da janela configurada.
5. Adquirir lock de `conversationId`.
6. Carregar estado e versao.
7. Montar `TurnContext` com mensagens, estado, configuracao e capacidades.
8. Interpretar se a mensagem responde ao objetivo pendente, altera assunto ou combina intencoes.
9. Gerar proposta de `TurnDecision`.
10. Validar proposta no motor de politicas.
11. Se necessario, executar uma tool e devolver o resultado ao mesmo ciclo decisorio.
12. Produzir decisao final.
13. Compor resposta aterrada na decisao e no resultado da tool.
14. Validar resposta sem escolher nova acao.
15. Persistir eventos e novo estado atomicamente.
16. Em shadow mode, encerrar sem envio.
17. Em modo ativo, enviar com idempotencia.
18. Registrar resultado do envio.
19. Liberar lock.

Se qualquer etapa falhar, o evento de erro precisa registrar onde, por que, qual estado foi carregado e se houve efeito externo.

## 15. Observabilidade obrigatoria

Cada turno precisa permitir responder:

- qual mensagem/burst entrou;
- qual estado foi carregado;
- qual objetivo estava pendente;
- quais entidades foram resolvidas;
- qual decisao foi proposta;
- quais politicas aceitaram ou bloquearam;
- qual tool foi chamada e com quais parametros seguros;
- qual resultado a tool devolveu;
- qual decisao final foi tomada;
- qual patch de estado foi persistido;
- qual mensagem foi composta;
- se houve envio, erro, retry, handoff ou no-op;
- qual build, modelo e prompt estavam ativos.

Logs devem ser estruturados. Texto livre e complemento, nao a unica evidencia.

## 16. Estrategia de testes

O v3 nao entra em producao apenas porque testes unitarios passaram.

Camadas obrigatorias:

1. Testes unitarios dos contratos e politicas.
2. Testes de contrato de cada tool com fakes.
3. Testes multiturismo com estado realista.
4. Testes de concorrencia, burst e idempotencia.
5. Testes de propriedade para invariantes de estoque, foto e handoff.
6. Replays anonimizados de conversas reais que falharam no v2.
7. Golden conversations com resultado esperado por turno.
8. Shadow mode comparando v2 e v3.
9. Canary no agente de teste.
10. Rollback comprovado antes de ampliar o trafego.

Casos minimos obrigatorios:

- lead responde nome, troca, entrada e parcela sem o agente perder o trilho;
- typo de modelo resolve contra a oferta atual sem sequestrar modelo novo;
- `mais opcoes` preserva filtros e nao repete;
- foto e enviada uma vez para o veiculo correto;
- pergunta sobre laudo/preco/km permanece no veiculo em foco;
- mensagens consecutivas viram um unico turno coerente;
- mudanca explicita de modelo vence memoria antiga;
- categoria e teto sao preservados;
- lista sempre possui formatacao unica;
- handoff incompleto e bloqueado antes de qualquer efeito externo;
- falha de transferencia recebe tratamento visivel e recuperavel;
- nenhum turno produz duas respostas comerciais conflitantes.

## 17. Metricas de sucesso

Comparar v2 e v3 por dados, nao por impressao isolada:

- repeticao de perguntas;
- repeticao de listas;
- repeticao de fotos;
- veiculo/categoria/preco incorretos;
- buscas sem necessidade;
- clarificacoes necessarias versus desnecessarias;
- handoffs prematuros;
- handoffs silenciosos;
- leads sem resposta;
- correcoes manuais por atendentes;
- conclusao dos slots do funil;
- tempo ate proxima acao util;
- taxa de erro por tool;
- custo e latencia por turno;
- concordancia do shadow v3 com avaliacao humana.

## 18. Estrategia de migracao

### Fase 0 - Descoberta e contratos

- inventariar capacidades e regras do v2;
- identificar fontes de dados e efeitos externos;
- separar invariantes, politicas, heuristicas e estilo;
- definir contratos de estado, decisao, evento e tool;
- produzir ADRs no `Brain`;
- nao escrever integracao de producao ainda.

### Fase 1 - Kernel puro

- implementar tipos e motor de estado;
- implementar decisao e policy engine sem I/O;
- criar fakes e testes multiturismo;
- provar uma decisao por turno.

### Fase 2 - Tools por adaptadores

- encapsular estoque, fotos, conhecimento, CRM, agenda e handoff;
- validar contratos e erros;
- manter efeitos externos desligados por padrao.

### Fase 3 - Shadow mode

- espelhar eventos reais;
- carregar estado v3 independente;
- registrar decisoes sem enviar;
- comparar com v2 e avaliacao humana.

### Fase 4 - Agente de teste

- ativar exclusivamente para `douglasaloan@gmail.com`;
- testar WhatsApp, estoque da Avant, CRM, fotos, agenda e transferencia;
- manter rollback imediato para v2.

### Fase 5 - Canary por cliente

- ativar percentual/tenant controlado;
- acompanhar metricas e eventos;
- expandir somente apos criterios objetivos.

### Fase 6 - Migracao e simplificacao

- migrar clientes gradualmente;
- congelar v2;
- remover compatibilidades temporarias do v3;
- preservar historico e capacidade de auditoria.

## 19. Governanca de producao e dados

- Supabase MCP e somente leitura, salvo mudanca futura expressamente autorizada pelo dono.
- SQL, migracoes, cron e configuracoes de escrita devem ser entregues para revisao antes de execucao.
- Nunca executar `supabase db push` por conta propria.
- Nunca copiar ou registrar segredos no `Brain`, codigo, logs ou prompts.
- Credenciais devem usar o sistema seguro ja existente ou um adaptador equivalente.
- Dados reais usados em testes/replays devem ser anonimizados quando persistidos no v3.
- Todo efeito externo deve suportar idempotencia e auditoria.
- Shadow mode nunca envia WhatsApp, cria transferencia, agenda ou altera CRM.

## 20. Protocolo do `Brain`

Arquivos recomendados para as proximas etapas:

- `00-PEDRO-V3-CONTEXTO-MESTRE.md`: este documento; principios e limites permanentes.
- `01-STATUS-ATUAL.md`: onde paramos, o que esta pronto, bloqueios e proximo passo exato.
- `02-ARQUITETURA-E-CONTRATOS.md`: contratos aprovados e diagrama atual.
- `03-INVENTARIO-PEDRO-V2.md`: regras/capacidades do v2 e destino de cada uma.
- `04-CATALOGO-DE-INVARIANTES.md`: politicas com IDs e testes associados.
- `05-PLANO-DE-TESTES.md`: suites, replays, goldens e metricas.
- `06-ERROS-E-LICOES.md`: incidentes, causa raiz e prevencao estrutural.
- `decisions/ADR-NNN-titulo.md`: decisoes arquiteturais.
- `handoffs/YYYY-MM-DD-agente-topico.md`: handoff detalhado entre agentes.

Ao concluir qualquer mudanca relevante, registrar:

1. objetivo;
2. arquivos alterados;
3. contratos afetados;
4. razao arquitetural;
5. testes executados e resultados;
6. riscos e limitacoes;
7. deploy/ambiente, se houve;
8. commit, se houve;
9. proximo passo exato;
10. duvidas abertas.

Nao escrever no `Brain` frases vagas como "melhoramos a memoria". Informar o contrato, o comportamento e a evidencia.

## 21. Papeis de trabalho

### Douglas Aloan - dono do produto

- define prioridades e regras comerciais;
- autoriza escrita em banco, deploy, ativacao e migracao;
- fornece casos reais e valida qualidade do atendimento.

### Claude - executor principal

- implementa apenas a etapa aprovada;
- mantem codigo, testes e `Brain` sincronizados;
- nao transforma prints em condicionais por frase;
- entrega evidencia antes de pedir ativacao.

### Codex - auditor tecnico

- revisa arquitetura, contratos, riscos, testes e implementacao;
- procura regressao, autoridade duplicada e remendos disfarçados;
- valida se a mudanca aproxima o sistema da arquitetura-alvo;
- pode executar tarefas quando o dono solicitar explicitamente, sem atuar simultaneamente nos mesmos arquivos que outro executor.

### Antigravity - apoio de execucao/analise

- segue os mesmos contratos e o mesmo `Brain`;
- nao cria arquitetura paralela;
- nao edita simultaneamente os mesmos arquivos de outro executor;
- registra handoff completo ao encerrar.

Somente um executor deve editar uma area por vez. Antes de iniciar, conferir `01-STATUS-ATUAL.md` e o worktree.

## 22. Anti-padroes proibidos

- `if` para frase especifica do lead;
- lista manual crescente de typos quando matching contextual resolve;
- prompt como unica fonte de regra obrigatoria;
- estado duplicado em campos concorrentes;
- planner escolhendo uma acao e orquestrador escolhendo outra;
- compositor alterando a decisao;
- tool gerando handoff escondido;
- persistir memoria em varias etapas do mesmo turno sem controle de versao;
- enviar antes de consolidar decisao e estado;
- usar fallback para inventar comportamento comercial;
- capturar excecao e seguir como se nada tivesse acontecido;
- ativar v3 diretamente em cliente real;
- copiar o orquestrador do v2 para "ganhar tempo";
- adicionar abstracao sem contrato ou teste;
- declarar sucesso apenas por uma conversa manual.

## 23. Definition of Done do Pedro v3

O v3 so sera considerado pronto para migracao ampla quando:

- estado central estiver versionado e documentado;
- uma unica decisao governar cada turno;
- tools estiverem isoladas e testadas;
- politicas tiverem IDs e cobertura;
- processamento concorrente estiver protegido;
- eventos permitirem replay completo;
- shadow mode estiver estavel;
- agente de teste tiver passado pelos fluxos de estoque, foto, funil, CRM, agenda e handoff;
- metricas demonstrarem melhora sobre o v2;
- rollback estiver testado;
- nenhum efeito externo puder ocorrer fora da decisao final autorizada;
- o `Brain` permitir que um novo agente continue o projeto sem depender de contexto privado.

## 24. Primeira proxima missao recomendada

Ainda sem criar o runtime do v3:

1. auditar o Pedro v2 em modo leitura;
2. produzir `03-INVENTARIO-PEDRO-V2.md`;
3. classificar cada regra/capacidade como reutilizar, reescrever, transformar em politica, transformar em tool ou descartar;
4. propor `ConversationState`, `TurnDecision`, `TurnEvent`, `ToolCall` e `ToolResult` em `02-ARQUITETURA-E-CONTRATOS.md`;
5. criar os primeiros ADRs;
6. submeter tudo a auditoria antes de escrever codigo em `Agent/`.

O primeiro codigo deve nascer dos contratos aprovados, nao o contrario.

## 25. Contrato permanente LLM-first — 2026-07-17

O contrato operacional aprovado para a próxima refatoração está em
`Brain/2026-07-17-llm-first-contrato-unico-e-plano-de-acao.md`.

Sua regra central é imutável: a LLM interpreta o bloco, decide responder ou chamar
tool, recebe os resultados, redige a resposta e só então a engine valida e despacha.
Handlers comerciais, regex de intenção, condutores de funil e reescritores de texto
não podem voltar ao caminho ativo sob nomes novos. A engine permanece limitada a
contexto, grounding, segurança, schema, execução autorizada e fallback técnico.
