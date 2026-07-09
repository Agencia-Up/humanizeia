# Codex F2.44 - Slots semanticos pre-CRM

Data: 2026-07-09
Status: implementado, testado offline, sem commit/push.

## Problema

O audit de 3 conversas reais v2->v3 mostrou tres P0 antes de ligar CRM/transferencia:

1. Pergunta ou negacao do lead virava fato do slot.
   - Ex.: "Entrada, ou sem entrada?" podia virar entrada=0.
   - Ex.: "nao sou de Guaratingueta" podia virar cidade=Guaratingueta.
2. Dados do carro de troca contaminavam o interesse de compra.
   - Ex.: "Logan 2015 100 mil km" depois de pergunta de troca precisava virar veiculoTroca, nao interesse/filtro de compra.
3. Interesse de compra virava carro de troca.
   - Ex.: "me interessou o Jeep" precisava ser alvo comercial, nao veiculoTroca.

## Correcao

Arquivo principal: Agent/src/engine/lead-extraction.ts.

Invariantes adicionados:

- Uma fala interrogativa nao grava slots de resposta como se fossem fatos, exceto declaracoes explicitas dentro do mesmo bloco.
- Negacao explicita de troca continua sendo fato mesmo quando o mesmo bloco tambem contem uma pergunta de compra.
- Perguntas de disponibilidade ("tem Logan 2015?") sao compra/busca, nunca veiculo de troca.
- Verbos de interesse ("gostei", "curti", "me interessou", "tenho interesse") entram no alvo comercial.
- Dados de troca sao capturados por contexto de troca, posse ou pergunta pendente, sem contaminar interesse.
- Cidade negada ("nao sou/moro de X") nao grava cidade.

## Teste novo

Agent/tests/run-f2-44-semantic-slot-boundaries.ts cobre:

- pergunta de entrada nao vira entrada=0;
- negacao clara de entrada ainda grava entrada=0;
- negacao de cidade nao grava cidade;
- negacao de troca + pergunta de compra no mesmo bloco grava possuiTroca=false e preserva a busca;
- descricao de carro de troca sem "tenho" apos pergunta de troca grava veiculoTroca;
- pergunta/compra de modelo apos pergunta de troca nao vira troca;
- interesse em Jeep nao vira troca;
- clausula mista "tenho Logan para troca, mas me interessou Jeep" separa troca e compra.

## Gates

- npm run test:f244 -> 21 OK / 0 FALHA
- npm run test:f239 -> 56 OK / 0 FALHA
- npm run test:f240 -> 65 OK / 0 FALHA
- npm run test:f242 -> 20 OK / 0 FALHA
- npm run test:f243 -> 30 OK / 0 FALHA
- npx tsc --noEmit -> EXIT 0
- npm run test:all -> EXIT 0

## Observacao

Nao rodei LLM real nesta fatia porque a alteracao e deterministica no extrator de slots. O proximo gate ideal e reexecutar o audit real v2->v3 de 3 conversas apos commit/push, exigindo que os P0 acima nao reaparecam e que o briefing de troca fique correto.
