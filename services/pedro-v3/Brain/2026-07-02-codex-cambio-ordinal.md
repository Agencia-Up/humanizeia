# 2026-07-02 - Codex: cambio em busca + ordinal fora da lista

## Objetivo
Fechar dois erros vistos no eval real/conversa:

1. `hatch automatico` precisava virar busca semantica `{ tipo: "hatch", cambio: "automatic" }`, e `mais opcoes` precisava herdar esse cambio.
2. `Quero o terceiro` quando a lista atual so tem 1 item nao pode ir para o LLM inventar, nem virar terminal-safe, nem mandar foto/estoque errado.

## Alteracoes principais

- `TransmissionPreference` entrou no contrato de busca e no estado operacional (`searchPreferences.transmission`).
- `explicit-search` detecta cambio manual/automatico, remove termos de cambio dos candidatos de modelo, passa `cambio` para `stock_search`, herda em `mais opcoes` e filtra defensivamente os resultados.
- `openai-chat-model` e `prompt-bound-conversation` aceitam `cambio` no tool input.
- Novo guard `ordinal-choice.ts`: se existe `lastRenderedOfferContext` e o lead pede item N fora do tamanho da lista, o engine responde de forma segura e condutiva (`ordinal_out_of_range`) antes do LLM.
- `conversation-engine` pluga o guard depois de foto/busca/mais-opcoes e antes de continuidade/runTurn.

## Provas locais

- `npm run test:f2712` => 22 OK / 0 falha.
- `npm run test:f2713` => 45 OK / 0 falha.
- `npm run test:f28` => 163 OK / 0 falha.
- `npm run test:all` => exit 0.
- `npx tsc --noEmit` => exit 0.

## Eval real

Comando rodado:

```powershell
$env:PEDRO_V3_REAL_EVAL='1'; $env:EVAL_SCENARIO='s2'; npm.cmd run eval:conversation:real
```

Resultado relevante:

- 50 chamadas OpenAI, 50 2xx, prompt integral, `gpt-4.1-mini-2025-04-14`.
- `s2-direcao-referencias`: judge 85/70, criticas 0/0, terminal-safe 0/20.
- Turno `Quero o terceiro` nas duas runs: `reason=ordinal_out_of_range`, sem send_media, sem stock_search, resposta: lista atual tinha apenas 1 opcao e nao havia item 3.
- O bug de `hatch automatico` foi corrigido: eval anterior confirmou `stock_search({tipo:"hatch", precoMax:80000, cambio:"automatic"})` e oferta apenas do hatch automatico real.

## Pendencias honestas

- O gate universal ainda nao fecha por qualidade de conducao/prompt em alguns cenarios, nao por erro de veiculo/foto no s2.
- A run s2 ainda variou 85/70: sem criticas estruturais, mas o judge penaliza condução de funil/naturalidade.
- Proxima etapa recomendada: continuar a camada de conducao SDR/CRM e reduzir variancia de compose, agora com os invariantes de busca/foco mais firmes.
