# P0 - anuncio real com autoria LLM e fatos aterrados

Data: 2026-07-15

## Incidente

No anuncio real do Fiat Fastback 2025 da conta do Bruno, a `stock_search`
encontrava a unidade exata no BNDV, mas a abertura podia terminar em
`technical_fallback`. O estoque e o reconhecimento do anuncio estavam corretos.

## Causa-raiz

Depois de negar um draft livre que deveria usar `vehicle_offer_list`, o engine
priorizava o feedback generico de abertura antes do feedback factual de
listagem. Assim, ele exigia que a LLM listasse os resultados, mas escondia dela
as `vehicleKey`s aterradas necessarias para fazer isso. O mesmo cerebro insistia
em texto livre ate esgotar os passos.

Havia ainda um segundo desvio: declarar `send_photos` no understanding permitia
consultar fotos durante a abertura, mesmo sem pedido ou aceite de fotos no bloco
atual.

## Invariantes aplicados

1. A LLM continua sendo a unica autora da resposta comercial.
2. Pedido humano e visita atuais continuam tendo prioridade.
3. Quando uma busca do turno tem itens, o feedback de listagem com as chaves
   reais vence a orientacao generica de abertura; a mesma LLM reescreve o draft.
4. O engine nao escolhe veiculo, nao escreve oferta e nao decide buscar.
5. `vehicle_photos_resolve` exige pedido/aceite de foto semanticamente ligado ao
   bloco atual ou resposta a uma pergunta pendente de alvo. Oferecer fotos em
   texto continua permitido.
6. Mudanca comercial explicita do lead vence o anuncio e a memoria anterior.

## Provas offline

- `test:f238`: 25 OK, incluindo draft livre invalido -> `brain_retry` com o
  veiculo exato e tentativa proativa de foto -> zero consulta de fotos.
- `test:f220`: 22 OK, incluindo pivot explicito para sedan automatico ate 120
  mil.
- `test:f232`: 30 OK.
- `test:f233`: 21 OK.
- `test:f241`: 32 OK.
- `test:all`: EXIT 0.
- `tsc --noEmit`: EXIT 0.
- `git diff --check`: limpo.

## Provas reais, efeitos externos desligados

Provider/modelo: OpenAI `gpt-4.1-mini`. Prompt real do portal, anuncios CTWA
historicos reais do Bruno e estoque BNDV real.

### Fastback especifico

Relatorio: `eval/reports/bruno-real-ad-media-2026-07-15T04-16-19-434Z.md`

- PASS, 15 chamadas, zero falhas.
- T1 mostrou somente o Fiat Fastback 2025 real do anuncio.
- T1 nao consultou fotos sem pedido.
- Pergunta de atributo foi respondida sem trocar o foco.
- Pivot para sedan automatico ate 120 mil fez nova busca e mostrou Ford Focus
  Sedan.
- Visita e pedido de vendedor foram conduzidos; houve `handoff` e
  `notify_seller`.

### HB20X especifico

Relatorio: `eval/reports/bruno-real-ad-media-2026-07-15T04-22-08-781Z.md`

- PASS, 8 chamadas, zero falhas.
- Abriu no Hyundai HB20X 2019 correto.
- Fotos foram resolvidas somente depois do pedido.
- Entrada, financiamento, visita e transferencia foram conduzidos.

### Anuncio generico + midia normalizada

Relatorio: `eval/reports/bruno-real-ad-media-2026-07-15T04-23-11-255Z.md`

- PASS, 11 chamadas, zero falhas.
- Contexto normalizado do audio acionou busca de SUVs automaticos ate 100 mil.
- A imagem manteve o contexto comercial.
- Selecao do segundo enviou fotos do Peugeot 2008 correto.
- Pedido humano gerou `handoff` e `notify_seller`.

## Limite declarado

O terceiro canario valida o consumo, pelo Pedro v3, do contexto de audio/imagem
ja normalizado pela camada multimidia. Ele nao substitui um teste do download do
binario UAZAPI, transcricao e visao antes do ingest.
