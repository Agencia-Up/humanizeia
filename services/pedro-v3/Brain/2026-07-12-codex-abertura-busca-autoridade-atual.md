# Auditoria Codex - abertura, busca e soberania do turno atual

Data: 2026-07-12

## Incidente de producao

Conversa observada:

1. Lead: `Boa tarde`.
2. O agente respondeu sem a identidade configurada no prompt do portal.
3. Lead (mesmo bloco): `Quero suv` + `Tem?`.
4. O estado extraiu `tipoVeiculo=suv` e `activeSearchConstraints={tipo:suv}`, mas nenhuma tool foi executada.
5. O turno terminou em `recovery_stock_not_run`, repetindo uma pergunta que o lead ja havia respondido.

O agrupamento do bloco estava correto. O CRM tambem estava operacional e com vinculo real do lead. A falha estava na autoridade do ato: quando a LLM classificava um pedido inequivoco de estoque como `other`, o engine aceitava o final e um recovery deterministico falava depois dela.

## Correcao estrutural

### Abertura

- Primeiro contato frio e composto apenas por saudacao exige apresentacao conforme a identidade do prompt do portal.
- O engine nao injeta nome, loja, personalidade nem texto pronto.
- Se a LLM omitir a identidade, recebe feedback e reescreve a propria abertura.
- O antigo escritor deterministico de abertura foi removido.

### Pedido de estoque malclassificado

- O detector de constraints nao executa `stock_search` e nao redige resposta.
- Quando o bloco atual contem filtro comercial suficiente, mas a LLM finaliza como `other` sem declarar a capability, o engine devolve `SEARCH_ACT_EXPECTED`.
- A mesma LLM reavalia somente o bloco atual, declara `search_stock`, fornece evidence literal e decide chamar a tool.
- Atos semanticos explicitos (`conversation_repair`, `financing`, `trade_in`, fotos, visita, institucional, humano e smalltalk) vencem palavras de veiculo e nunca sao convertidos em busca pelo detector.
- Retry limitado a duas correcoes; nao ha loop infinito nem tool executada por regex.

## Provas offline

- F2.41: incidente real `Boa tarde` -> `Quero suv / Tem?`, autoria `brain_retry`, uma `stock_search`, lista de SUVs, zero recovery.
- F2.41: contestacao `Corolla e sedan?` continua sem tool e sem relistar.
- F2.25: `Ate 50 mil e que seja da volks` recebe feedback de ato; a LLM chama a tool e lista sem reperguntar o filtro.
- F2.32: anuncio generico recebe discovery escrito pela LLM, sem backstop deterministico.
- F2.39: compra e troca no mesmo bloco continuam separadas; sanitizacao da abertura continua valida.
- F2.49/F2.50, CRM, handoff, follow-up e dados sensiveis permanecem na cadeia completa.

Gates finais:

- `npx tsc --noEmit`: EXIT 0.
- `npm run test:all`: EXIT 0.
- `git diff --check`: limpo.

## Smoke real F2.52

Foi criado um smoke de 10 turnos com prompt, estoque e modelo reais:

1. abertura;
2. busca SUV em bloco quebrado;
3. selecao ordinal;
4. fotos do selecionado;
5. mudanca para Compass 2019;
6. nova selecao;
7. pedido de visita;
8. dia;
9. horario;
10. pedido de vendedor, CRM e handoff.

O smoke nao recebeu uma resposta da LLM: a chave `EVAL_OPENAI_API_KEY` retornou HTTP 429 `insufficient_quota` em todas as chamadas. Portanto, esses runs nao sao aprovacao nem reprovacao do agente. O runner permanente ficou em `eval/run-f252-production-journey-smoke.ts` e deve ser reexecutado assim que a quota da chave de avaliacao for restaurada.

## Veredito

A regressao especifica foi corrigida no nivel de autoridade: o turno atual nao e substituido por estado antigo, o detector nao toma a tool da LLM e o engine nao escreve a abertura. CRM e transferencia permanecem protegidos pelos gates offline, mas a jornada real completa ainda exige reexecucao do F2.52 com uma chave de avaliacao com quota.
