# Historico

## 2026-05-23

- Criado o cerebro local do projeto em `.codex-brain`.
- Auditoria inicial documentou:
  - stack React/Vite/Supabase;
  - rotas principais;
  - deploy Docker/Nginx/Easypanel;
  - Edge Functions principais;
  - separacao Pedro x Marcos;
  - problemas conhecidos e proximos passos.
- Criada e publicada antes deste cerebro a divisao:
  - `/tela-inicial`: hub inicial existente;
  - `/dashboard`: novo dashboard comercial comparativo Pedro x Marcos.
- Build validado antes do push da mudanca de dashboard.
- Criada auditoria tecnica do agente Pedro em `.codex-brain/analise-pedro-agente-2026-05-23.md`, sem alteracao de codigo, apontando falhas de orquestracao, memoria, busca BNDV, contexto de anuncio e plano de reformulacao por fases.
- Protocolado o plano do Pedro v2 em `.codex-brain/plano-pedro-v2.md`: manter Pedro v1 em paralelo, criar orquestrador leve, separar tools/Edge Functions de identificacao, memoria, intencao, estoque, resposta, transferencia, `ok` do vendedor, CRM e envio.

## 2026-05-24

- Iniciada a implementacao paralela do Pedro v2, sem alterar o Pedro v1 (`uazapi-webhook`).
- Criado scaffold de Edge Functions:
  - `pedro-webhook-v2`;
  - `pedro-identify-contact`;
  - `pedro-intent-router`;
  - `pedro-lead-memory`;
  - `pedro-transfer-router`;
  - `pedro-stock-search`;
  - `pedro-sales-reply`;
  - `pedro-crm-sync`;
  - `pedro-seller-ack`;
  - `pedro-message-sender`.
- Criado modulo compartilhado `supabase/functions/_shared/pedro-v2` com identidade por telefone, memoria, roteamento de intencao, transferencia e orquestracao.
- Criada migration `20260524090000_pedro_v2_scaffold.sql` para logs de turno do Pedro v2.
- Pedro v2 foi mantido desligado e protegido por flags de ambiente para evitar escrita/envio acidental.
- Evoluido o Pedro v2 em paralelo:
  - `pedro-stock-search` passou a usar busca real BNDV por tool compartilhada, com normalizacao, tolerancia a erros de digitacao e separacao carro/moto;
  - `pedro-sales-reply` passou a gerar resposta factual com base em memoria, intencao e resultado de estoque;
  - `pedro-message-sender` passou a centralizar envio Uazapi de texto e midia, ainda protegido por `PEDRO_V2_SEND_ENABLED`;
  - `pedro-webhook-v2` passou a orquestrar intencao -> estoque -> resposta -> envio planejado/enviado, sem tocar no Pedro v1.
- Build frontend validado com `npm.cmd run build`; avisos exibidos sao os ja conhecidos do projeto.
- Commit `c2b1294` enviado para `origin/main` com o Pedro v2 paralelo e cerebro local.
- Edge Functions do Pedro v2 publicadas no Supabase de producao:
  - `pedro-webhook-v2`;
  - `pedro-identify-contact`;
  - `pedro-intent-router`;
  - `pedro-lead-memory`;
  - `pedro-transfer-router`;
  - `pedro-stock-search`;
  - `pedro-sales-reply`;
  - `pedro-crm-sync`;
  - `pedro-seller-ack`;
  - `pedro-message-sender`.
- Migration `20260524090000_pedro_v2_scaffold.sql` nao foi aplicada via `db push`, pois o Supabase exigiu `--include-all` para migrations antigas locais que nao constam no historico remoto. Nao usar `--include-all` sem auditoria; o log do v2 falha de forma nao bloqueante se a tabela ainda nao existir.
- Corrigido o caminho seguro para teste controlado do Pedro v2:
  - migration `20260524090000_pedro_v2_scaffold.sql` aplicada manualmente com `supabase db query --linked --file`, sem usar `--include-all`;
  - `pedro_v2_turn_logs` criada em producao;
  - `pedro-webhook-v2` passou a permitir ativacao por `PEDRO_V2_ALLOWED_USER_EMAILS` ou `PEDRO_V2_ALLOWED_USER_IDS`, mantendo o global desligado;
  - `create-evolution-instance` e `sync-evolution-webhook` passaram a apontar usuarios liberados para `pedro-webhook-v2`, mantendo os demais em `uazapi-webhook`;
  - secrets de producao configurados pelos nomes `PEDRO_V2_ENABLED`, `PEDRO_V2_ALLOWED_USER_EMAILS`, `PEDRO_V2_MUTATIONS_ENABLED` e `PEDRO_V2_SEND_ENABLED`, sem registrar valores no repo/cerebro.
- Corrigido primeiro problema real do Pedro v2 no teste por WhatsApp: contexto de anuncio/link.
  - criado resolvedor de contexto de anuncio em `supabase/functions/_shared/pedro-v2/adContext.ts`;
  - `pedro-webhook-v2` passou a ignorar mensagens `fromMe` e a operar em modo real quando mutations estiverem habilitadas, deixando `dry_run` apenas para payload explicito ou flag desligada;
  - orquestrador v2 passou a extrair card/link de anuncio, URL, texto rico e thumbnail/imagem quando disponivel, enriquecendo memoria/intencao antes da busca BNDV;
  - Pedro v2 nao deve responder que "nao consegue acessar links externos"; deve usar metadados do anuncio e, se faltar contexto, perguntar pelo modelo ou print;
  - deploy realizado das Edge Functions `pedro-webhook-v2` e `pedro-sales-reply` em producao.
- Corrigido roteamento real da instancia de teste do Pedro v2:
  - confirmado que chamada direta ao `pedro-webhook-v2` para o usuario `douglasaloan@gmail.com` tratava anuncio/link corretamente;
  - identificado que a instancia Uazapi `agente-ia-hpic` ainda apontava para `uazapi-webhook`, por isso o WhatsApp continuava caindo no Pedro v1;
  - webhook da instancia foi sincronizado para `pedro-webhook-v2`;
  - `sync-evolution-webhook` foi atualizado para respeitar allowlist por user id/email via helper compartilhado do Pedro v2 e nao reverter usuarios liberados para o webhook antigo;
  - function `sync-evolution-webhook` publicada em producao como V8.3.
- Ajustada a seguranca da busca de estoque do Pedro v2 em anuncios:
  - log real mostrou que a Uazapi entregou apenas titulo/descricao genericos do Facebook, sem o modelo do veiculo;
  - o v2 deixou de consultar estoque quando o anuncio nao identifica um veiculo com confianca;
  - adicionada tentativa curta de leitura de metadados/imagem do link antes de desistir;
  - resposta de anuncio sem veiculo agora pede modelo ou print, evitando oferecer carro aleatorio;
  - deploy realizado em `pedro-webhook-v2` e `pedro-sales-reply`.
- Hotfix do Pedro v2 em producao para teste controlado do usuario Douglas:
  - confirmado por chamada remota que `pedro-webhook-v2` esta publicado no Supabase com build `2026-05-24-humanized-ad-reply-v2`;
  - adicionada humanizacao no envio do v2 com presenca de digitacao, atraso realista e divisao de mensagens longas;
  - corrigido fallback de anuncio sem veiculo para se apresentar como Carvalho e pedir modelo/print, sem chutar modelo especifico;
  - reforcada extracao de thumbnails/imagens em payloads Uazapi com arrays de bytes e objetos tipo Buffer;
  - versionados os imports do orquestrador/reply/adContext/sender para evitar cache antigo de modulo compartilhado no Edge Runtime;
  - validado por `dry_run` remoto que o Supabase responde sem oferecer carro aleatorio quando o card do Facebook nao traz o veiculo.

## Historico funcional recente consolidado

- Pedro recebeu varias correcoes em regras de transferencia, vendedor `ok`, CRM ao vivo, colunas e isolamento do agente.
- Marcos recebeu evolucoes em CRM manual, importacao/listas, campanhas, follow-up, instancias para vendedores, performance e exclusao em massa.
- Foi criada base teste/staging em Supabase separado e servico separado no Easypanel para validar mudancas sem quebrar producao.
- Foram corrigidos problemas recorrentes de:
  - login com timeout Supabase;
  - Uazapi/instancias;
  - duplicidade em follow-up/campanhas;
  - midia em disparo;
  - vendedor virando lead;
  - Pedro e Marcos misturando dados.
