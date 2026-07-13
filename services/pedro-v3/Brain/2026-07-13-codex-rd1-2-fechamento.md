# RD1-2 - Fechamento Codex

Data: 2026-07-13
Estado: concluido e verificado; sem commit, push ou deploy neste fechamento.

## Lacuna final encontrada

O smoke fixo ainda apresentava uma falha intermitente em T4. A LLM podia pedir
`vehicle_photos_resolve` com a `vehicleKey` de outro carro, embora o alvo
canonico do turno fosse o veiculo selecionado. A validacao final bloqueava a
midia errada corretamente, mas tarde demais: o fato da consulta errada ja havia
entrado nas observacoes e contaminava os retries, terminando em
`technical_fallback`.

## Correcao arquitetural

Em `central-engine.ts`, antes do adapter:

- uma chamada de foto e comparada ao alvo unico de `resolveTargetWithAd()`;
- se a key divergir, a tool errada nao executa e nao produz fato;
- o engine devolve `PHOTO_TARGET_MISMATCH` com a key aterrada;
- a propria LLM deve decidir novamente, chamar a tool correta e redigir a
  resposta;
- o engine nao reescreve nem substitui a chamada silenciosamente.

Isso e validacao factual no limite da tool, nao autoria comercial do engine.

## Prova adversarial permanente

F2.23 `P4b` obriga o cerebro a propor uma key errada primeiro. O teste exige:

- a proposta errada foi realmente feita;
- o feedback `PHOTO_TARGET_MISMATCH` foi observado pelo cerebro;
- zero chamada da key errada chegou ao adapter;
- somente a key do C3 Aircross selecionado executou;
- a resposta e a midia finais continuam autoradas pela LLM.

## Gates finais

- `test:f223`: 43 OK / 0 falha;
- `test:f255`: parte 1 = 56 OK, parte 2 = 40 OK;
- `npx tsc --noEmit`: exit 0;
- `test:all`: exit 0;
- `smoke:f252` real: 2 PASS consecutivos;
- nos dois runs, T4 enviou cinco fotos do C3 Aircross selecionado;
- T8/T9 compuseram `segunda 15h` sem reperguntar dimensoes respondidas;
- T10 gerou `handoff + notify_seller`;
- `COMPOSE=0`, mantendo autoria unica do brain.

## Conclusao

A flutuacao de T4 nao foi aceita como comportamento inevitavel do modelo. A
contradicao factual agora e contida antes do efeito, mantendo a LLM como autora
e decisora exclusiva da conversa e as guardas apenas como limites de seguranca.
