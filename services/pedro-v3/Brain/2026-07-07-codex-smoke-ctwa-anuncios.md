# 2026-07-07 — Codex Smoke CTWA/Anuncios

## Objetivo

Criar um teste barato e repetivel para simular entrada Click-to-WhatsApp/Facebook Ads no Pedro v3 sem depender de um anuncio real disparando no WhatsApp.

O teste injeta `raw.adContext` no primeiro evento do inbox, exatamente no formato que o bridge envia para o v3, e roda o `central_active` com:

- LLM real (`gpt-4.1-mini`) quando `PEDRO_V3_REAL_EVAL=1`.
- `singleAuthor=true` e `llmFirst=true`.
- efeitos OFF (`send_message`/`send_media` apenas no outbox in-memory).
- sem judge LLM.
- relatorio por turno: lead, resposta, tools, effects, `adVehicle`, source e violacoes deterministicas.

## Comando

```powershell
cd services/pedro-v3/Agent
$env:PEDRO_V3_REAL_EVAL="1"
$env:EVAL_USE_PLATFORM_KEY="1"
npm run smoke:ctwa
```

Para rodar um cenario especifico:

```powershell
$env:CTWA_SMOKE_SCENARIO="compass"
npm run smoke:ctwa
```

Opcoes atuais:

- `compass` — anuncio realista de Jeep Compass; valida saudacao/referencia, foto, correcao para Onix e pergunta de loja.
- `ranger` — payload baseado no fixture real do bridge (`externalAdReply` Ranger XLT TD 3.2 2016); valida que o anuncio guia a busca e que o agente nao pergunta modelo de novo.
- `generic-suv` — anuncio generico de SUV; valida que o refinamento do lead (`ate 100k automatico`) usa o contexto do anuncio e busca SUV.

## Arquivos

- `services/pedro-v3/Agent/eval/run-ctwa-ad-smoke.ts`
- `services/pedro-v3/Agent/package.json` (`smoke:ctwa`)

## Criterios

O smoke falha se:

- cair em fallback tecnico/terminal safe visivel;
- pedir telefone no WhatsApp;
- mostrar padrao de reset/reintroducao estilo v2;
- ignorar o anuncio quando o lead pergunta "esse ainda tem?";
- deixar o anuncio vencer uma correcao explicita do lead ("na verdade quero Onix");
- deixar pergunta institucional acionar estoque;
- nao acionar `stock_search` quando o anuncio + fala do lead ja dao filtro suficiente.

## Observacao

Este teste nao substitui trafego real, mas cobre o ponto que o WhatsApp manual nao consegue simular facilmente: o payload de anuncio chegando junto do primeiro evento.

## Execucao Codex 2026-07-07

Comando usado:

```powershell
cd services/pedro-v3/Agent
$env:PEDRO_V3_REAL_EVAL="1"
$env:EVAL_USE_PLATFORM_KEY="1"
$env:CTWA_SMOKE_SCENARIO="compass"
npm run smoke:ctwa
```

Resultados:

- `generic-suv`: PASS, 8 chamadas, custo aprox. US$0,0255.
- `ranger`: FAIL, 8 chamadas, custo aprox. US$0,0245.
- `compass`: FAIL, 22 chamadas, custo aprox. US$0,0679.

Relatorios:

- `services/pedro-v3/Agent/eval/reports/ctwa-ad-smoke-2026-07-07T11-10-30-362Z.md`
- `services/pedro-v3/Agent/eval/reports/ctwa-ad-smoke-2026-07-07T11-13-45-272Z.md`
- `services/pedro-v3/Agent/eval/reports/ctwa-ad-smoke-2026-07-07T11-14-57-321Z.md`

## Bugs Encontrados

### P0-A — Foto do veiculo exato do anuncio nao usa o ano do anuncio

Entrada:

- Anuncio: `Ola! Quer saber mais sobre o Jeep Compass 2019?`
- Lead T1/T2: `Boa tarde` / `esse ainda tem?`
- Estoque real: Compass 2017 e Compass 2019.
- Lead T3: `me manda fotos dele`

Comportamento observado:

- T3 repetiu a lista de Compass e nao gerou `send_media`.
- O engine/brain tratou o anuncio como `jeep Compass`, sem usar `2019` como desambiguador quando o ano esta escrito no anuncio e existe no estoque.

Invariante esperado:

- Quando `adContext` contem modelo + ano e o estoque tem exatamente esse modelo+ano, esse veiculo vira referencia do anuncio.
- Pedido pronominal de foto (`dele`, `desse`, `esse`) deve resolver para esse veiculo exato.
- Se houver mais de um veiculo com mesmo modelo+ano, perguntar qual. Se houver um unico, enviar a foto.
- Nao usar if por marca; a regra e `ad vehicle identity = marca/modelo/ano quando presentes e aterrados`.

### P0-B — "Algo parecido" apos anuncio sem estoque continua preso no modelo do anuncio

Entrada:

- Anuncio: `Ford Ranger XLT TD 3.2 2016`
- T1: `tem esse?` -> stock_search Ranger retorna 0.
- T2: `tem algo parecido ate 100 mil?`

Comportamento observado:

- T2 executou `stock_search` com `{"precoMax":100000,"marca":"ford","modelo":"Ranger","tipo":"pickup","cambio":"automatic"}`.
- Resposta: "Nao temos Ford Ranger automatica ate 100 mil... Quer que eu veja outras picapes..."
- Ou seja: prometeu alternativas, mas a busca continuou presa em Ranger.

Invariante esperado:

- Quando o lead pede `algo parecido`, `opcoes parecidas`, `outras semelhantes`, depois de um anuncio sem match, o filtro deve relaxar modelo/marca e preservar apenas dimensoes de similaridade seguras:
  - tipo/categoria (ex.: pickup/picape),
  - precoMax informado,
  - cambio se explicitamente pedido pelo lead atual ou se for essencial do anuncio e houver estoque,
  - anos so se explicitamente pedidos pelo lead.
- A busca executada nao pode manter `modelo=Ranger` nesse turno.
- Se nao houver alternativas, a resposta deve dizer que nao encontrou picapes/alternativas na faixa, nao "nao temos Ranger".

## Prompt Para Claude

Missao: corrigir os dois P0 acima por invariantes no Pedro v3 central_active/CTWA, sem if por frase e sem handler que roube autoria do cerebro.

Obrigatorio:

1. Use `npm run smoke:ctwa` como gate real barato.
2. Corrija P0-A: adContext com marca/modelo/ano deve produzir referencia exata quando ha match unico no estoque. Essa referencia precisa alimentar selecao/foto pronominal.
3. Corrija P0-B: intencao de similaridade/alternativas apos anuncio sem match deve relaxar modelo/marca do anuncio e buscar por tipo/categoria + filtros do lead.
4. Adicione/ajuste testes offline cobrindo:
   - anuncio Compass 2019 com Compass 2017+2019 no estoque -> `me manda fotos dele` envia media do 2019;
   - anuncio Ranger sem estoque -> `tem algo parecido ate 100 mil?` executa stock_search sem `modelo=Ranger` e com `tipo=pickup`;
   - correcao explicita do lead (`na verdade quero Onix`) continua vencendo o anuncio;
   - institucional (`onde fica a loja?`) nao usa estoque do anuncio.
5. Rode:
   - `npx tsc --noEmit`
   - `npm run test:all`
   - `PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 CTWA_SMOKE_SCENARIO=compass npm run smoke:ctwa`
   - `PEDRO_V3_REAL_EVAL=1 EVAL_USE_PLATFORM_KEY=1 CTWA_SMOKE_SCENARIO=ranger npm run smoke:ctwa`

Nao declarar concluido sem smoke real PASS nos dois cenarios P0. Se faltar chave/quota, parar e reportar bloqueio externo.
