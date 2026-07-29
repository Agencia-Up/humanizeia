# Pedro V3 — mapa de responsabilidades e fronteira da engine

Atualizado em 2026-07-28 após a auditoria da autoria `central_active`.

## Regra central

O prompt do portal define identidade, conversa, funil e conduta comercial. A LLM lê esse prompt e o `operationalContext` tipado antes de decidir ferramentas, efeitos e resposta. A engine coordena a execução e valida somente contradições objetivas que uma máquina consegue provar.

Depois de a LLM escrever, a engine ativa pode rejeitar somente:

1. saída estruturada ausente ou malformada;
2. referência estruturada inexistente (`vehicle_ref`, `money_ref`, `vehicle_offer_list`);
3. ferramenta fora da allowlist/schema ou efeito inexequível/dirigido ao recurso errado;
4. mídia sem `vehicle_photos_resolve` bem-sucedido e inequívoco para a mesma chave no turno;
5. chave interna, referência sensível ou segredo exposto ao cliente.

Ela não pode rejeitar por estilo, saudação, quantidade de perguntas, ordem comercial, estratégia de preço, repetição, completude conversacional, redação de promessa, redação de visita, nem por tentar reinterpretar marca/modelo/ano/preço em texto livre. Esses sinais podem existir para telemetria, avaliação offline e compatibilidade do replay legado; não podem consumir retry nem provocar `technical_fallback` no `central_active`.

Essa fronteira é código em `src/engine/response-authority.ts` e regressão permanente em `tests/run-f2-91-engine-authority-boundary.ts`.

## Fluxo ativo

1. `pilot-ingest.ts` recebe o evento e preserva a identidade tenant/agente/instância.
2. `debounce-policy.ts` agrega o bloco atual sem perder mensagens.
3. `turn-context-preparer.ts`, `turn-frame-builder.ts` e `turn-understanding.ts` montam fatos, memória e compreensão do turno.
4. `operational-context.ts` entrega fatos e capacidades tipadas à LLM antes da autoria.
5. `openai-agent-brain.ts` combina prompt do portal, contexto e contrato de tools.
6. `tool-authority.ts`, `policy-engine.ts` e `read-query-runner.ts` validam e executam a ação escolhida pela LLM. Uma chamada direta e válida da LLM já é autoridade suficiente; evidência semântica duplicada só existe no caminho indireto legado.
7. `response-renderer.ts` resolve apenas partes estruturadas contra fatos.
8. `response-authority.ts` seleciona a fronteira; `central_active` não julga prosa comercial.
9. `effect-gate.ts` e `effect-materializer.ts` transformam somente efeitos válidos em outbox.
10. dispatchers enviam; receipts e `effect-outcome-commit.ts` confirmam o que realmente aconteceu.
11. `state-reducer.ts` e `working-memory.ts` persistem apenas resultados permitidos pelo contrato.

## Inventário dos módulos de `src/engine`

### Orquestração e composição

| Arquivo | Responsabilidade válida | Limite |
|---|---|---|
| `central-engine.ts` | Sequenciar compreensão, tools, autoria, validação estrutural e commit | Não deve redigir nem julgar a conversa |
| `central-turn-io.ts` | Tipos e portas de entrada/saída do turno | Sem política comercial |
| `decision-engine.ts` | Compor/verificar decisão e timeout | Sem escolha de estratégia de venda |
| `finalizer.ts` | Finalizar decisão tipada | Sem autoria textual |
| `conversation-engine.ts` | Compatibilidade do fluxo anterior | Não é autoridade do `central_active` |
| `conversation-context.ts` | Contexto da conversa | Somente fatos/memória |
| `current-turn-facts.ts` | Fatos observados no bloco atual | Sem inferir conduta |
| `pilot-ingest.ts` | Ingestão idempotente do evento de canal | Não escolhe resposta nem efeito |
| `debounce-policy.ts` | Janela de agregação do bloco atual | Não interpreta intenção comercial |
| `model-context-view.ts` | Visão segura enviada ao modelo | Não altera fatos |
| `response-authority.ts` | Define o único conjunto de vetos pós-autoria | `central_active` mantém apenas estrutura/efeito/segurança |

### Compreensão, contexto e memória

| Arquivo | Responsabilidade válida |
|---|---|
| `turn-context-preparer.ts` | Preparar contexto factual e extratores |
| `turn-frame-builder.ts` | Montar frame tipado do turno |
| `turn-understanding.ts` | Validar a compreensão declarada e proteger evidência/capability |
| `turn-domain.ts` | Classificações de domínio reutilizáveis |
| `lead-intent.ts` | Sinais de intenção para contexto/telemetria |
| `lead-extraction.ts` | Extrair fatos declarados pelo lead |
| `visit-semantics.ts` | Semântica reutilizável de visita para contexto; não autora resposta |
| `question-classify.ts` | Classificação de perguntas; legado/telemetria, nunca veto textual ativo |
| `question-repetition.ts` | Sinal de repetição; nunca motivo de fallback no fluxo ativo |
| `slot-provenance.ts` | Proveniência de slots |
| `working-memory.ts` | Memória tipada e mutações validadas |
| `state-reducer.ts` | Reduz eventos aceitos em estado; não decide o conteúdo do turno |
| `sdr-conduction-frame.ts` | Contexto de condução legado |
| `sdr-conductor.ts` | Condutor legado; não governa o texto do `central_active` |
| `turn-advisories.ts` | Compatibilidade de sinais; fatos ativos viajam em `operationalContext` |

### Estoque, anúncio e identidade de veículo

| Arquivo | Responsabilidade válida |
|---|---|
| `commercial-constraints.ts` | Persistir e combinar filtros sem reinjetar contexto abandonado |
| `explicit-search.ts` | Estruturar busca explicitamente solicitada |
| `read-query-runner.ts` | Executar tools de leitura e devolver sucesso/erro real |
| `catalog-utils.ts` | Grounding de chaves e fatos do catálogo |
| `automotive-claim-extractor.ts` | Extrator lexical para legado/telemetria |
| `ad-context.ts` | Identidade declarada pelo anúncio e prova de inventário separadas |
| `offer-context.ts` | Ofertas efetivamente apresentadas e referenciáveis |
| `vehicle-focus.ts` | Foco tipado do veículo |
| `vehicle-label.ts` | Rótulo canônico sem expor chave |
| `vehicle-offer-render.ts` | Renderização estruturada de ofertas |
| `ordinal.ts` / `ordinal-choice.ts` | Resolver ordinal contra lista realmente exibida |
| `popularity-intent.ts` | Sinal de preferência popular |
| `monetary-semantics.ts` | Papel semântico de valores do lead |
| `fuel-claims.ts` | Classificador offline/telemetria; não veta texto ativo |
| `future-commitment.ts` | Classificador offline/telemetria; não veta texto ativo |

### Fotos e mídia

| Arquivo | Responsabilidade válida |
|---|---|
| `photo-intent.ts` | Pedido semântico de foto |
| `photo-selection.ts` | Resolver qual veículo o lead escolheu |
| `photo-outcome.ts` | Confirmar envio aceito antes de gravar resultado |
| `draft-grounding.ts` | Grounding de partes estruturadas do draft |
| `media-effect-grounding.ts` | Substituir IDs/URLs propostos pelo snapshot factual da tool e validar a mesma `vehicleKey` |
| `response-renderer.ts` | Renderizar parts estruturadas exclusivamente a partir de fatos e memória de oferta aceita |

### Efeitos, entrega e consistência

| Arquivo | Responsabilidade válida |
|---|---|
| `tool-authority.ts` | Aceitar a tool de leitura diretamente escolhida pela LLM quando schema/allowlist são válidos; exigir evidência apenas de execução indireta |
| `policy-engine.ts` | No ativo: validar tools, chaves, referências e efeitos estruturados; regras textuais ficam no legado |
| `effect-gate.ts` | Permitir ou suprimir o despacho conforme o modo operacional (`active`/`shadow`) |
| `effect-materializer.ts` | Materializar plano válido em outbox |
| `effect-outcome-commit.ts` | Aplicar resultado somente após receipt compatível |
| `outbox-dispatcher.ts` | Despachar efeito pendente |
| `provider-delivery-receipt.ts` | Traduzir confirmação do provedor |
| `receipt-policy.ts` | Definir nível de receipt necessário |
| `reconciler.ts` | Reconciliar efeitos e estado sem inventar entrega |
| `automation-execution-gate.ts` | Janela/estado operacional de automações |
| `automation-rules.ts` | Regras configuradas de automação |

### CRM, transferência e follow-up

| Arquivo | Responsabilidade válida |
|---|---|
| `crm-lead-binding.ts` | Vincular conversa e lead com isolamento de tenant |
| `crm-write.ts` | Escrever mutações autorizadas no CRM |
| `handoff-precheck.ts` | Informar disponibilidade real de transferência |
| `handoff-plan.ts` | Materializar a transferência escolhida pela LLM |
| `briefing-builder.ts` | Montar briefing factual do vendedor |
| `transfer-templates.ts` | Rótulos operacionais do handoff |
| `followup-policy.ts` | Elegibilidade e cadência configurada |
| `followup-author.ts` | Autoria do follow-up no fluxo próprio |
| `tenant-business-info.ts` | Consultar fatos institucionais do tenant |
| `channel-time.ts` | Hora/fuso do canal |

### Runtime, canário e legado

| Arquivo | Responsabilidade válida |
|---|---|
| `pilot-active-root.ts` | Composition root do serviço ativo |
| `central-shadow-runner.ts` | Shadow/replay sem efeito real |
| `canary-shadow-root.ts` / `openai-canary-root.ts` / `shadow-harness.ts` | Avaliação isolada |
| `continuity-fallback.ts` | Recuperação legada; não deve sobrepor autoria válida da LLM |
| `legacy/legacy-commercial-authors.ts` | Autores determinísticos quarantinados |
| `legacy/legacy-replay.ts` | Compatibilidade de replay, sem autoridade em produção |

## Mapa das funções de `central-engine.ts`

### Configuração e telemetria

- `readBrainMode`, `isCentralShadowMode`: selecionam runtime; não decidem conversa.
- `classifyDenyCategory`, `classifyRetryReason`, `classifyDegradation`, `classifyProviderFallback`, `isDegradedSource`, `isDegradedResponse`: observabilidade somente.
- `sanitizeOutgoingText`, `stripControlChars`, `repairVisibleLatin1Escapes`: higiene de transporte.

### Fatos, tools e grounding

- `requiredToolBeforeFinal`: requisito do replay legado; retorna `null` no `central_active` e não transforma intenção em tool obrigatória.
- `canonicalizeSelectMutations`, `knownVehicleKeys`: validam foco/chaves conhecidas.
- `enrichStockSearchCall`, `stockSearchFingerprint`: no ativo, executam/deduplicam os filtros declarados pela LLM. Só normalizam papel monetário e limitam `excludeKeys` a carros realmente mostrados; preenchimento comercial automático ficou no legado.
- A antiga conclusão determinística de `stock_search` no pós-loop foi removida: além de concorrente com a LLM, estava dentro de um ramo `!llmFirst` com condição interna `llmFirst` e portanto era código inalcançável.
- `requireVehicleDetailBeforeFinal`: requisito antecipado legado; no ativo, uma referência estruturada sem fato é barrada pelo renderer, sem forçar tool por regex.
- `deriveCurrentTurnIntent`, `clearStalePhotoIntent`: contexto; não autorizam efeito sozinhos.
- `photoLookupStatus`: descreve resultado da consulta de fotos.

### Autoria e validação

- `authorFromBrainDraft`: fronteira pós-autoria. No `central_active`, valida apenas estrutura, referências, efeitos, mídia/alvo e vazamento.
- `PolicyEngine.postQuery`: uma oferta estruturada pode usar fatos frescos ou uma chave já efetivamente apresentada na conversa. O snapshot atual do feed não revalida nem apaga esse histórico aceito; chave livre da LLM continua rejeitada.
- Limites como `appointmentBooking=false` chegam antes da autoria em `operationalContext`. Detectores lexicais de promessa/agendamento permanecem apenas em legado, telemetria e eval; não são promovidos a “efeito inexequível” por interpretação posterior da frase.
- `turnCompletenessFeedback`: retorna `null` no ativo; completude conversacional é responsabilidade do prompt/LLM.
- `renderDeterministicResponse`, `buildContextualRecovery`, `buildEmptySearchConductingRecovery`, `buildBrainUnavailableResponse`: recuperação/legado; nunca substituem uma autoria válida no fluxo ativo.
- `isPassiveLlmFinal`, `passiveFinalIntroducesRejectedOrdinalSelection`: controle de protocolo, sem julgamento de qualidade comercial.

### Funções lexicais de condução

`asksLeadName`, `isPaymentTurn`, `asksDiscoveryQuestion`, `financialDimensionsAsked`, `asksLeadSurname`, `textPromisesSearch`, `mentionsCommercialDiscovery`, `mentionsSelfIntroduction`, `isInitialGreetingOnly`, `mentionsAdVehicle`, `conductsAboutAdVehicle`, `promisesHumanHandoff`, `promisesVisitScheduled`, `hasDoubleActionQuestion`, `factualSlotClaimFeedback`, `isServiceOrInstitutionalQuestion`, `isEmptySearchBeco` e auxiliares equivalentes pertencem à compatibilidade legada/telemetria. Elas não podem produzir hard deny no `central_active`.

### Orquestração principal

- `runCentralConversationTurn`: coordena o turno, recalcula `operationalContext` a cada passo, deixa a LLM escolher tools/resposta/efeitos, executa somente o estruturalmente permitido e persiste receipts. Metadado semântico inválido é descartado sem derrubar a autoria; duplicata de tool é deduplicada sem punição. Não é autor comercial.

## Matriz de decisão

| Situação | `central_active` |
|---|---|
| Saudação diferente da preferida | Publica; prompt/eval mede |
| Duas perguntas, pergunta repetida ou sequência comercial diferente | Publica; prompt/eval mede |
| Marca/modelo/ano/preço escritos em prosa | Não reinterpreta por regex |
| LLM chama `stock_search` com filtros válidos | Executa exatamente os filtros declarados; não reinjeta anúncio/memória |
| LLM repete a mesma tool com o mesmo input | Não reexecuta e não pune; segue para autoria final com o fato já observado |
| `understanding` auxiliar inválido, mas draft/efeitos são válidos | Descarta somente mutações semânticas; preserva a autoria |
| `vehicle_ref` para chave inexistente | Rejeita |
| `money_ref` sem fato correspondente | Rejeita |
| Lista estruturada com veículo não aterrado | Rejeita |
| `send_media` sem resolução factual da mesma chave, sem fotos ou com snapshot inconsistente | Rejeita o efeito; a LLM reautora |
| Handoff proposto sem vínculo/disponibilidade | Rejeita o efeito por inexequibilidade; a LLM reautora sem afirmar transferência |
| Opt-out/despedida sem handoff proposto | Não cria transferência; suspensão de contato e compliance permanecem separados |
| Token/ref sensível no texto | Rejeita |
| Draft vazio/malformado | Rejeita |

## Vetos realmente ativos no `central_active`

Esta lista é exaustiva para a fronteira pós-autoria. Um novo veto ativo exige teste em `F2.91` e precisa caber em uma destas classes:

| Classe | O que a engine consegue provar | Ação |
|---|---|---|
| Contrato do draft | JSON/parts ausentes, vazios ou de tipo não suportado | Solicita nova saída estruturada |
| Grounding estruturado | `vehicle_ref`, `money_ref` ou lista aponta para fato/chave inexistente | Rejeita somente a referência |
| Mídia executável | Não houve `vehicle_photos_resolve` inequívoco da mesma chave, IDs estão vazios ou snapshot diverge | Rejeita somente `send_media` |
| Transferência executável | A LLM propôs `handoff`, mas não existe vínculo/vendedor/capacidade operacional | Rejeita somente o efeito |
| Tool executável | Tool fora da allowlist, input/schema inválido ou `vehicleKey` não aterrado para detalhes/fotos | Não executa a chamada |
| Papel monetário | O mesmo valor foi objetivamente classificado como ano/entrada/parcela, não orçamento de busca | Remove apenas o filtro monetário contraditório |
| Segurança | Segredo, referência sensível ou chave interna aparece na saída | Rejeita a saída |
| Grafo de efeitos | IDs, dependências, outcomes ou alvos do plano são inconsistentes | Não materializa o plano |

Não são vetos ativos: saudação, nome, objeção, número de perguntas, ordem do funil, qualidade da despedida, promessa em prosa, visita em prosa, menção lexical a marca/modelo, relevância comercial, repetição de tool ou exigência automática de consulta.

## Autoria dos efeitos depois da LLM

- `send_message`: é o envelope estrutural da resposta que a própria LLM escreveu.
- `send_media`: só existe se a LLM propôs; a engine troca IDs/URLs pelo snapshot factual da tool.
- `handoff`: só existe se a LLM propôs; a engine escolhe o vendedor conforme a fila configurada e monta briefing/dependências. Não cria nem renomeia o motivo comercial.
- `crm_write`: persiste fatos/mutações aceitos; não altera a conversa.
- follow-up: é um fluxo operacional separado. A engine pode suspender a cadência por handoff/opt-out/encerramento declarado, mas não usa o follow-up para cumprir promessas individuais da resposta atual.

## Candidatos à remoção física

A remoção física deve ocorrer em uma fase separada, depois de telemetria e regressões, para não misturar mudança de comportamento com movimentação de código:

1. extrair de `central-engine.ts` os blocos de execução de tool, autoria e materialização;
2. mover todos os analisadores lexicais comerciais para `legacy/` ou `eval/`;
3. remover autores determinísticos e recoveries que não tenham consumidor ativo;
4. eliminar compatibilidades booleanas após migrar todos os testes para `ResponseAuthorityMode` explícito;
5. impedir por teste estático que `central_active` use um parser de prosa para retornar `ok:false`.

O arquivo central ainda tem aproximadamente 3,6 mil linhas porque preserva replay e compatibilidade histórica. Nesta rodada, a prioridade é retirar sua autoridade indevida do runtime com baixo risco. A modularização física deve ocorrer depois de a fronteira estar comprovada pela suíte completa e por telemetria de produção; mover código agora junto com a mudança comportamental ampliaria desnecessariamente o risco.
