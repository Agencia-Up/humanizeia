# Autoridade de Tools e Telemetria

Data: 2026-07-15

## Objetivo

No `central_active`, o agente LLM e a unica autoridade para decidir a conversa e
as ferramentas comerciais. O prompt do portal continua sendo a fonte de
personalidade, funil, perguntas e forma de conduzir o atendimento.

A engine pode fornecer fatos, contexto e validacao. Ela nao pode deduzir um
pedido comercial de regex, filtro ativo, anuncio, memoria ou pergunta pendente
e executar uma tool por conta propria.

## Contrato aplicado

| Tool | Autoridade valida |
| --- | --- |
| `stock_search` | LLM, com `primaryIntent=search_stock`, capability `stock_search` e evidence do bloco atual |
| `vehicle_photos_resolve` | LLM, com capability `send_photos`, evidence atual e alvo aterrado |
| `vehicle_details` | LLM com capability `vehicle_details`; excecao unica: leitura de grounding para uma acao de veiculo que a LLM ja decidiu |
| `tenant_business_info` | Lookup factual da engine para um topico institucional pedido; nao autoriza qualquer acao comercial |

Cada chamada ativa e validada **antes** de tocar o adaptador. A telemetria
`decision_final.toolAuthorities` registra tool, principal, origem, intent,
capability, evidence atual, ponto de chamada, resultado e latencia.

## Autoridade removida

- Filtro comercial suficiente nao cria mais busca por si so.
- Retomada, anuncio, similaridade e `mais opcoes` nao executam estoque sem ato
  de busca declarado pela LLM.
- Busca vazia nao dispara cascata de relaxamento criada pela engine no piloto.
- O ano do anuncio e similares enriquecem a chamada escolhida pela LLM; nao
  reescrevem uma decisao comercial dela.
- Foto so consulta o alvo que a LLM autorizou no bloco atual; a engine apenas
  resolve o fato de midia do alvo aterrado.

## Protecoes que permanecem hard

As protecoes factuais e de efeito continuam hard: grounding de preco/km/cor/ano,
midia do veiculo errado, PII, chaves internas, promises de handoff ou visita sem
efeito real e detalhes factuais sem fonte. Elas nao escolhem assunto, funil ou
texto comercial; devolvem feedback para a mesma LLM corrigir.

## Provas

- `npm run test:f241`: 44 OK. Inclui contestacao Corolla/sedan sem busca,
  busca declarada pela LLM, bloqueio de evidence stale, capability incompatível,
  ausencia de cascata e agendamento que nao vira ordinal de lista.
- `npx tsc --noEmit`: EXIT 0.
- `npm run test:all`: EXIT 0.

## Trade-off assumido

Se a LLM deixar de declarar uma busca real, a engine nao adivinha e nao busca
por palavras-chave. O prompt e os feedbacks devem fazer a LLM perguntar ou
seguir a intencao correta. Isso troca uma resposta robotica e potencialmente
errada por uma conversa segura e auditavel.
