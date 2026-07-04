# F2.19 - Taxonomia de mercado e recuperacao de turnos

## Incidentes observados

1. Uma busca por SUV exibiu `CITROEN C3`, embora o registro real fosse um `C3 Aircross` (`versionName=C3 AIRCROSS EXCM`, `bodyType=suv`). O tipo factual estava correto, mas o rotulo truncado enganava o lead.
2. A rajada `Queria um carro popular` + `de ate 50k` foi agregada corretamente, porem ficou presa em `v3_inbox.status=claimed` depois que a lease expirou. O finder antigo enxergava apenas `pending`, logo o turno nunca voltava ao poller.

## Correcao

- A taxonomia passou a resolver tanto a carroceria quanto o modelo comercial canonico pela entrada mais especifica.
- O filtro `popular:true` usa modelos compactos/de entrada da planilha `carros_brasil_categorias.xlsx`; SUV, picape e modelos medios nao entram apenas por serem baratos.
- O frame detecta a intencao `popular` e o engine enriquece a chamada real de `stock_search`, sem depender de a LLM lembrar o parametro.
- `v3_find_settled_conversations` remove leases expiradas e reabre claims orfaos com mais de dois minutos. O claim/lease normal continua protegendo concorrencia e idempotencia.

## Evidencia

- Estoque real, SUV: `C3 Aircross`, `CR-V`, `2008`, `Renegade`; nunca `C3` truncado.
- Estoque real, popular ate R$ 50 mil: `Sandero 2018`, `208 2015`, `HB20 2015`.
- Testes adversariais distinguem `C3` hatch de `C3 Aircross` SUV e impedem que a substring `C3` classifique o Aircross como popular.
- Teste SQL cria claim orfao + lease expirada e prova retorno atomico a `pending` e nova descoberta pelo poller.

## Operacao

- Patch manual/idempotente: `Brain/sql/v3_f2_19_stale_claim_recovery.sql`.
- O deploy deve preceder ou acompanhar o patch. A conversa presa e recuperada automaticamente no tick seguinte.
- Nenhuma alteracao no Pedro v2, CRM ou bridge.
