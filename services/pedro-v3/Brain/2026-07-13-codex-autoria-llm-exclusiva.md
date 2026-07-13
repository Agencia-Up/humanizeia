# Pedro v3 - autoria comercial exclusiva da LLM (rodadas 1 e 2)

Data: 2026-07-13

## Objetivo

Eliminar o "segundo atendente" do `central_active`. A LLM decide o ato do turno,
escolhe a conducao e escreve tudo o que o lead le. O engine continua responsavel
por fatos, seguranca e execucao, mas nao promove uma falha da LLM a uma resposta
comercial deterministica.

## Fronteira de autoridade

### A LLM e dona de

- intencao e mudanca de assunto do turno atual;
- proxima pergunta e conducao SDR;
- abertura, personalidade e texto visivel;
- decisao de usar uma capacidade/tool;
- escolha entre responder, esclarecer, buscar, detalhar, enviar foto ou transferir.

### O engine pode

- agrupar/debounciar o bloco atual;
- validar evidence contra o bloco atual;
- resolver ordinal/modelo para uma `vehicleKey` factual;
- executar a tool escolhida e devolver fatos estruturados;
- renderizar referencias estruturadas sem inventar atributos;
- bloquear dano real: fato inventado, PII, chave interna, foto do carro errado,
  efeito duplicado ou promessa de acao sem efeito executavel;
- persistir estado factual derivado de um ato validado da LLM;
- devolver feedback e pedir reautoria a mesma LLM.

### O engine nao pode no `central_active`

- escrever lista, abertura, pergunta de funil, resposta institucional ou comercial;
- escolher o proximo assunto por regex ou memoria antiga;
- substituir a resposta da LLM por handler/recovery comercial;
- editar silenciosamente o texto final;
- tratar capability de tool como requisito para reconhecer uma intencao
  conversacional sem tool.

## Rodada 1 - fim da autoria deterministica no central_active

- Adicionado um passe final de autoria da mesma LLM depois que tools/fatos foram
  resolvidos. O passe recebe as observacoes e deve produzir o `draft` final.
- O passe final nao pode abrir novas tools; ele apenas redige com os fatos ja
  disponiveis. Ha no maximo duas tentativas adicionais.
- `deterministic_photo`, `deterministic_institutional`, `deterministic_recovery`,
  `deterministic_discovery`, `deterministic_conduct` e `deterministic_recall`
  ficaram isolados no caminho legado/shadow.
- Se o provider nao produzir autoria valida depois do limite, o unico fallback do
  `central_active` e operacional e degradado. Ele nao interpreta o pedido, nao
  lista carros, nao conduz funil e nao cria uma segunda personalidade.
- `trimToOneQuestion` e recall textual deterministico tambem ficaram apenas no
  legado. O texto da LLM nao e mais reescrito silenciosamente no caminho ativo.

## Rodada 2 - semantica separada de capability

- `selected_vehicle` com `subjectSource=current_turn` e canonizado para `memory`
  quando o alvo veio da oferta anterior. Isso corrige apenas a proveniencia; nao
  muda intent, capability, evidence nem resposta.
- Uma intencao `select_vehicle` confiavel pode persistir o foco conversacional
  mesmo sem capability `select`. Persistir o carro escolhido nao e executar tool.
- Capability `select` e evidence propria continuam obrigatorias para mutacoes e
  efeitos propostos diretamente pelo modelo. Assim, a separacao nao abre envio de
  foto, detalhe ou selecao arbitraria.
- A `vehicleKey` continua resolvida somente por ordinal/modelo contra oferta e
  fatos conhecidos. A LLM decide o ato; o engine materializa a referencia factual.

## Matriz inicial das guardas

### Veto necessario (permanece)

- grounding de preco/km/ano/cor/cambio/modelo;
- teto de preco e catalogo/fato fresco;
- PII e referencias sensiveis;
- `vehicleKey` interna no texto;
- foto sem pedido ou do veiculo errado;
- promessa de foto, visita ou handoff sem efeito executavel;
- idempotencia, dependencia de efeitos e isolamento tenant;
- evidence que nao pertence ao bloco atual.

### Qualidade/conducao (candidata a sair de deny duro)

- numero de perguntas e pergunta dupla;
- ordem de perguntas financeiras;
- abertura/apresentacao/descoberta;
- anti-repeticao de pergunta;
- pergunta gancho depois de resposta institucional;
- ordem de nome, troca, entrada e parcela;
- reconhecimento textual obrigatorio de um dado antes de avancar.

Essas regras de qualidade ainda existem em pontos antigos. Nesta rodada elas
podem solicitar reautoria, mas nao conseguem mais promover o engine a autor. A
proxima consolidacao deve move-las para prompt/advisory e manter deny duro apenas
para dano factual, privacidade e efeito operacional falso.

## Provas

- `npm run test:f223`: 42 OK / 0 falha.
- `npm run test:all`: EXIT 0, incluindo F2.53 (DeepSeek) 19 OK e F2.54 14 OK.
- `npx tsc --noEmit`: EXIT 0.
- `git diff --check`: limpo (somente avisos locais de LF/CRLF).
- Smoke real barato com `gpt-4.1-mini`: PASS, cinco chamadas totais, `compose=0`.

### Smoke real

1. Pedido de SUV automatico: `brain_final`, `stock_search`, lista factual.
2. Escolha de um item: `brain_final`, foco persistido no Renault Duster 2015,
   nenhuma tool comercial desnecessaria.
3. Mudanca para visita: `brain_retry`, nenhuma tool comercial; a primeira autoria
   prometia transferencia sem efeito e foi reescrita pela mesma LLM.

O turno de visita venceu a memoria de estoque e o carro selecionado continuou
preservado como contexto, nao como comando.

## DeepSeek

O contrato de provider esta coberto por F2.53/F2.54. O smoke local com DeepSeek
nao iniciou chamada porque o segredo configurado como custom secret da Edge nao e
materializado pelo RPC usado pelo eval local (`EVAL_PLATFORM_KEY_INVALID`). Isso
e uma fronteira de segredo do ambiente, nao uma falha do adapter. Para validar a
arquitetura sem expor segredo foi usada a chave local OpenAI ja existente.

## Proximas rodadas recomendadas

1. Consolidar as guardas de qualidade acima: prompt/advisory, nao deny duro.
2. Auditar os gatilhos deterministas de tool restantes: eles podem preencher
   argumentos ou executar um ato validado da LLM, nunca criar o ato.
3. Remover fisicamente builders comerciais legados quando shadow/legacy nao
   dependerem mais deles.
4. Gate de producao: em `central_active`, toda resposta deve ser `brain_final`,
   `brain_retry` ou `technical_fallback` estritamente operacional.

## Estado

Nada commitado ou pushado nesta rodada.
