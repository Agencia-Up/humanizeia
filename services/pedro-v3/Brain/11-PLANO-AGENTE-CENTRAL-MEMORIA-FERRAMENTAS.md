# 11 - Correcao de rumo: agente central com memoria de trabalho e ferramentas

> **Status:** AUTORITATIVO E OBRIGATORIO antes de CRM/handoff ativo.
> **Data:** 2026-07-02.
> **Decisao do dono:** o Pedro v3 deve atuar como um atendente humano no WhatsApp: compreender o bloco atual,
> lembrar o que aconteceu, responder a pergunta real, consultar ferramentas somente quando necessario e conduzir
> o lead sem menus roboticos ou mudancas arbitrarias de assunto.

## 1. Motivo da correcao

O runtime atual ainda e handler-first. Antes de o cerebro decidir, `conversation-engine.ts` tenta foto, ranking,
economy, busca explicita, mais opcoes, ordinal e continuidade. Esses caminhos podem encerrar o turno ou preparar
uma resposta antes de existir uma decisao central da LLM. Policies, fallbacks e handlers passaram a conduzir a
conversa, quando deveriam apenas fornecer fatos, executar efeitos e impedir dano.

O incidente real do telefone `85988323679` provou o problema:

- `recentTurns` continha `Aqui estao as fotos do NISSAN KICKS 2018`, mas o agente nao respondeu qual carro era;
- `vehicleContext.selected` estava nulo, `photoLedger` vazio e a ultima lista estruturada ja era outra;
- uma pergunta sobre a loja foi sequestrada pelo fluxo de foto e virou `photo_ask_which`;
- `Quero saber da loja` gravou `possuiTroca=true`;
- tres turnos de estoque consecutivos terminaram em `terminal_safe`/fallback;
- o outbox persistiu texto com caractere de substituicao (`U+FFFD`).

Conclusao: historico textual sozinho nao e memoria operacional, e LLM usada apenas para redacao nao e autonomia.

## 2. Regra arquitetural central

Existe exatamente um cerebro comercial por turno. Ele recebe o bloco consolidado, prompt/config do tenant, memoria
de trabalho, historico recente e resultados de ferramentas. Ele pode fazer um loop limitado de ferramentas de
leitura e, ao final, emite uma unica decisao comercial.

```text
bloco do lead + prompt do portal + WorkingMemory + historico
                         |
                         v
                   AgentBrain (LLM)
                         |
               solicita QueryTools quando precisa
                         |
            fatos tipados voltam somente ao AgentBrain
                         |
                         v
                   FinalDecision unica
                         |
              policies validam, nao decidem
                         |
             outbox executa efeitos autorizados
                         |
             reducer atualiza WorkingMemory
```

Ferramentas nunca escrevem a resposta ao lead e nunca escolhem o proximo assunto. Elas retornam dados tipados ao
cerebro. Policies nunca selecionam a acao comercial e nunca redigem menus; apenas allow/deny/requirements.

## 3. WorkingMemory autoritativa

A memoria de trabalho deve ser tipada, versionada e separada do transcript. Campos minimos:

- `activeTopic`: assunto atual e origem do assunto;
- `currentLeadIntent`: intencao atual, confianca e evidencias do bloco;
- `unansweredLeadQuestions[]`: perguntas reais ainda nao respondidas;
- `selectedVehicle`: vehicleKey, label, origem e turno de selecao;
- `lastOffer`: filtros, vehicleKeys em ordem, itens excluidos e turno;
- `lastPhotoAction`: vehicleKey, label, photoIds, effectId e `acceptedAt`;
- `lastToolResults[]`: ferramenta, resumo factual, turno e validade;
- `funnel`: slots known/declined/deferred, objetivo sugerido e historico por slot;
- `commitments[]`: promessas feitas ao lead e seu status;
- `conversationSummary`: resumo semantico curto, sem substituir `recentTurns`;
- `lastAgentAction` e `lastAnsweredLeadQuestion`.

`lastPhotoAction` e memoria operacional accepted-safe do que o agente tentou/enviou ao provider. Nao substitui o
ledger oficial de entrega, que continua dependente de delivered/read.

O reducer e a unica autoridade de escrita. A LLM propoe fatos/mutacoes tipadas; nao escreve JSON arbitrario.

## 4. AgentBrain e ferramentas

O AgentBrain usa `gpt-4.1-mini` no piloto e segue o prompt real do portal. O contrato deve suportar:

1. `proposeNextQueryOrFinal(turnFrame)`;
2. zero ou mais QueryTools dentro de limite de passos/tempo;
3. `FinalDecision` unica com resposta estruturada, effects propostos e `WorkingMemoryMutation[]`;
4. compose/render/validate da resposta final;
5. replanejamento dirigido quando policy negar, sem trocar o assunto do lead;
6. fallback contextual somente em falha tecnica real, nunca menu generico desconectado.

QueryTools iniciais, reaproveitando adaptadores existentes:

- `stock_search`;
- `vehicle_details`;
- `vehicle_photos_resolve`;
- `tenant_business_info` (endereco, horario e dados configurados);
- `crm_read` somente quando houver necessidade e escopo autorizado.

Effect tools continuam via outbox: `send_message`, `send_media`, `crm_write`, `schedule_visit`, `handoff` e
`notify_seller`. O AgentBrain propoe; Finalizer/policies autorizam; dispatcher executa.

## 5. O que deixa de governar o turno

Os seguintes modulos nao podem mais executar early-return comercial antes do AgentBrain:

- `photo-intent.ts`;
- `popularity-intent.ts`;
- `explicit-search.ts`;
- `continuity-fallback.ts`;
- `more-options` e resolucoes equivalentes.

Sua logica util deve virar uma destas categorias:

- extrator de sinal para enriquecer `TurnFrame`;
- QueryTool;
- validador/policy;
- executor deterministico de uma decisao ja tomada;
- fallback tecnico, sem conduzir o funil.

Reconhecer palavras continua permitido como evidencia auxiliar. Palavra-chave isolada nunca pode decidir a acao.
Exemplo: mencionar `foto` pode ser pedido de envio, pergunta de disponibilidade, pergunta de memoria ou negacao.

## 6. Invariantes conversacionais

1. O bloco atual do lead tem prioridade sobre memoria antiga.
2. Responder a pergunta atual vem antes de qualquer qualificacao.
3. Nenhuma ferramenta e chamada sem necessidade explicavel na decisao.
4. Resultado de ferramenta volta ao cerebro; ferramenta nao fala com o lead.
5. No maximo uma pergunta clara ao final da resposta, salvo exigencia explicita do prompt.
6. O agente nao muda de assunto por causa de objetivo pendente.
7. O agente lembra selecao, oferta e acao de foto entre turnos.
8. Pergunta de memoria recebe resposta de memoria, nao repete a acao.
9. Pergunta institucional usa configuracao/knowledge, nao estoque/foto.
10. Nenhum veiculo, atributo, preco ou foto fora dos fatos tipados.
11. Nenhum handoff silencioso ou antes dos requisitos do tenant.
12. Nenhum texto com `U+FFFD`, segredo ou dado sensivel em estado/log.

## 7. Implementacao em fatias

### R13-A - Contratos e caminho shadow

- criar `WorkingMemory`, `TurnFrame`, `AgentBrainDecision` e mutacoes tipadas;
- criar adapter do cerebro com FakeLlm e OpenAI real;
- montar o caminho central atras de flag local/shadow, default OFF;
- nenhum efeito externo e nenhuma mudanca no caminho ativo.

### R13-B - Ferramentas sob comando do cerebro

- adaptar estoque, detalhes, fotos e informacao institucional como QueryTools;
- remover resposta textual dos handlers no caminho central;
- provar que perguntas simples nao chamam estoque/fotos;
- provar que consultas comerciais chamam somente as ferramentas necessarias.

### R13-C - Memoria operacional e reducer

- persistir `selectedVehicle`, `lastOffer`, `lastPhotoAction`, perguntas pendentes e compromissos;
- separar accepted-safe de delivered;
- migracao retrocompativel do JSONB, sem apagar conversas;
- replay apos restart deve produzir a mesma decisao.

### R13-D - Gate real e piloto

- executar replays com OpenAI real e efeitos OFF;
- comparar caminho central shadow com caminho atual;
- somente apos aceite do Codex, ativar no tenant/agente piloto;
- rollback imediato continua sendo flag OFF para o caminho atual/v2.

CRM, handoff, briefing e follow-up ativos so entram depois do gate conversacional R13-D.

## 8. Testes obrigatorios

### 8.1 Offline deterministico

- reducer e contratos de WorkingMemory;
- tool loop limitado e autorizacao por chamada;
- nenhuma ferramenta fala com o lead;
- nenhuma policy escolhe a acao;
- idempotencia e replay apos restart;
- estados antigos carregam com defaults seguros.

### 8.2 Dry-run com LLM real

Comando gated fora de `test:all`, usando `gpt-4.1-mini`, prompt/config/estoque reais e efeitos OFF. Deve provar:

- modelo retornado pela API;
- SHA-256 do prompt integral, sem gravar o prompt no relatorio;
- zero FakeLlm;
- zero dispatcher externo;
- transcricao, ferramentas solicitadas, fatos e decisao final por turno;
- duas execucoes por cenario na temperatura de producao;
- retry/backoff para 429 sem mascarar falha de quota.

### 8.3 Replay P0 autoritativo

Reproduzir integralmente a conversa do telefone `85988323679`, incluindo oferta de SUV, mais opcoes, fotos do
Kicks, mudanca para hatch/sedan, pergunta sobre qual carro recebeu fotos e pergunta sobre endereco da loja.

Aceite obrigatorio:

- responde `Nissan Kicks 2018` nas perguntas de memoria;
- nao envia/reenvia foto sem pedido atual;
- responde endereco/horario a partir da configuracao real;
- `possuiTroca` nao muda com `Quero saber da loja`;
- filtros de busca e listas permanecem coerentes;
- zero `photo_ask_which` indevido;
- zero `terminal_safe` no replay;
- zero `U+FFFD`;
- zero veiculo/foto/preco/atributo errado;
- no maximo uma pergunta por resposta;
- nenhuma ferramenta desnecessaria.

### 8.4 Conversas longas adicionais

No minimo tres conversas de 12+ turnos: descoberta/estoque/fotos; mudanca de direcao/referencias; qualificacao,
compra forte e handoff bloqueado. Assercoes deterministicas sao o gate; judge LLM e apenas sinal secundario.

## 9. Gate e proibicoes

Nao declarar a fase concluida apenas porque `test:all` esta verde ou o judge subiu. O gate e o replay real e as
assercoes acima. Nao fazer push/deploy/SQL/reset da conversa durante R13-A/B/C. Nao afrouxar grounding. Nao copiar
handlers para dentro do AgentBrain. Nao criar `if` por frase para os incidentes. Nao tocar Pedro v2/bridge/webhook.

## 10. Fontes autoritativas

- Este documento: governanca conversacional e memoria de trabalho.
- `02-ARQUITETURA-E-CONTRATOS.md`: persistencia, outbox, receipts e separacao query/effect.
- `04-CATALOGO-DE-INVARIANTES.md`: policies existentes, desde que nao escolham a acao.
- `05-PLANO-DE-TESTES.md`: camadas gerais, complementadas pelos gates R13 deste documento.
- `10-PLANO-REBALANCEAMENTO-COMPOSICAO-PROMPT.md`: somente historico das rodadas anteriores.
