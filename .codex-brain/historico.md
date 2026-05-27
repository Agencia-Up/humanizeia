# Historico

## 2026-05-27

- Pedro v2: Reestruturação da inteligência para torná-la 100% dinâmica e alinhada ao prompt do portal.
- Anúncios: Adicionada extração de marca/modelo por LLM (`gpt-4o-mini`) em anúncios no `adContext_20260525.ts` e remoção de filtros de modelos locais fixos.
- Resolvedor de Veículos: O `vehicleResolver_20260525_brain.ts` passou a suportar detecção dinâmica por marcas conhecidas + termos significativos seguintes (ex: Fiat Cronos, Peugeot 208, etc.).
- Busca de Estoque: O `stockSearch_20260525_photo_flow.ts` foi atualizado para extrair termos de modelo da query (`modelTerms`) de forma dinâmica, aplicando bônus e penalidades sem depender de listas estáticas de keywords ou aliases.
- Personalidade: Desativado o formatador determinístico rígido em `pedroBrainReply_20260525.ts` para que as respostas usem as próprias palavras da IA orientadas pelo System Prompt do Portal. Simplificação e reestruturação do prompt da OpenAI para priorizar a personalidade do portal.

## 2026-05-26

- Pedro v2: reforcada a leitura de anuncio/link com tentativa de localizar e baixar thumbnail/imagem do card antes da analise por visao; isso melhora casos de Facebook/Instagram em que o texto do link nao traz o veiculo, mas a imagem traz.
- Pedro v2: ampliado limite de busca/listagem do estoque BNDV e memoria de veiculos apresentados para evitar cortar modelos disponiveis e quebrar referencias como "o segundo" ou "tem mais modelos".
- Pedro v2: `pedro-webhook-v2` implantada em producao com build `2026-05-26-ad-thumbnail-full-stock-v1`.

## 2026-05-26

- Pedro v2: refatorado o fluxo de resposta final para evitar comportamento de robo/script fixo.
- O orquestrador agora carrega ate 24 turnos recentes combinando `pedro_conversation_state.recent_turns` com historico real de `wa_inbox`.
- `pedroBrainReply` deixou de responder small talk por regra deterministica e passou a montar mensagens reais de chat para o LLM usando o system prompt cadastrado no portal.
- A tool de fotos continua selecionando/enviando midias, mas a mensagem humana de fechamento agora passa pelo cerebro com contexto da tool.
- Deploy realizado da Edge Function `pedro-webhook-v2` no Supabase de producao `seyljsqmhlopkcauhlor`.

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
- Evoluido o Pedro v2 in paralelo:
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
  - deploy realizado em `pedro-webhook-v2` and `pedro-sales-reply`.
- Hotfix do Pedro v2 em producao para teste controlado do usuario Douglas:
  - confirmado por chamada remota que `pedro-webhook-v2` esta publicado no Supabase com build `2026-05-24-humanized-ad-reply-v2`;
  - adicionada humanizacao no envio do v2 com presenca de digitacao, atraso realista e divisao de mensagens longas;
  - corrigido fallback de anuncio sem veiculo para se apresentar como Carvalho e pedir modelo/print, sem chutar modelo especifico;
  - reforcada extracao de thumbnails/imagens em payloads Uazapi with arrays de bytes e objetos tipo Buffer;
  - versionados os imports do orquestrador/reply/adContext/sender para evitar cache antigo de modulo compartilhado no Edge Runtime;
  - validado por `dry_run` remoto que o Supabase responde sem oferecer carro aleatorio quando o card do Facebook nao traz o veiculo.
- Hotfix do Pedro v2 para contexto de midia e follow-up:
  - criado `mediaContext_20260524.ts` para extrair contexto de imagens/midias recebidas pela Uazapi, incluindo thumbnails embutidas e tentativa de download via endpoint de midia da Uazapi;
  - criado orquestrador versionado `orchestrator_20260524_media.ts`, mantendo o Pedro v1 intacto;
  - Pedro v2 passou a usar visao para identificar veiculo em print/imagem de anuncio antes da busca BNDV;
  - corrigido registro de `last_agent_reply_at` apos resposta do Pedro v2, requisito para as regras de follow-up de 5 minutos e transferencia por 10 minutos voltarem a enxergar conversas atendidas pelo v2;
  - deploy realizado em producao da Edge Function `pedro-webhook-v2` com build `2026-05-24-media-context-followup-v1`;
  - validado por dry-run remoto com print real de Duster: o v2 identificou `Renault Duster Authentique 1.6 2020 Automático` e acionou busca de estoque. No perfil de teste/instancia `agente-ia-hpic`, a busca retornou 0 unidades desse modelo.

- Hotfix do Pedro v2 para saudacao e deteccao de anuncio:
  - criado `adContext_20260525.ts` para exigir contexto explicito de anuncio/link antes de marcar a conversa como vinda de anuncio;
  - criado `replyGenerator_20260525.ts` com saudacao dinamica pelo horario de Sao Paulo e resposta simples para cumprimentos como "bom dia";
  - o orquestrador `orchestrator_20260524_media.ts` passou a usar os modulos versionados de 2026-05-25;
  - deploy realizado em producao da Edge Function `pedro-webhook-v2` com build `2026-05-25-greeting-ad-context-v1`;
  - validado por dry-run remoto: "Bom dia" respondeu com "Bom dia" e nao entrou como anuncio; texto comum de veiculo fez busca de estoque sem motivo de anuncio; link real do Facebook continuou caindo no fluxo de anuncio sem veiculo seguro.
- Hotfix do Pedro v2 para apresentacao de estoque e fotos:
  - criado orquestrador versionado `orchestrator_20260525_sales.ts`;
  - criado roteador versionado `intentRouter_20260525_sales.ts` com intencao `photo_request`;
  - criado `stockSearch_20260525_sales.ts` preservando ate 12 fotos do BNDV por veiculo em `fotos`;
  - criado `replyGenerator_20260525_sales.ts` para voltar ao formato antigo de lista de estoque, com campos por linha e imagem em markdown;
  - Pedro v2 passou a salvar os veiculos apresentados em `pedro_conversation_state.veiculos_apresentados`;
  - pedidos como "fotos desse segundo" passam a usar o veiculo ja apresentado e enviar ate 5 imagens via Uazapi;
  - saudacao simples ficou menos transacional e mais alinhada ao prompt do consultor;
  - deploy realizado em producao da Edge Function `pedro-webhook-v2` com build `2026-05-25-sales-stock-photos-v1`;
  - validado por dry-run remoto: "Bom dia" responde com saudacao correta e "Voce tem onix?" retorna 5 opcoes do BNDV no formato antigo com imagens.
- Hotfix do Pedro v2 para formatacao de estoque e variedade de fotos:
  - criado orquestrador versionado `orchestrator_20260525_photo_variety.ts`;
  - `pedro-webhook-v2` passou a apontar para o build `2026-05-25-stock-format-photo-variety-v1`;
  - respostas de lista de estoque (`stock_fact_reply`) passaram a preservar quebras de linha, sem o humanizador juntar todos os itens em uma mensagem confusa;
  - pedidos de fotos agora detectam alvo aproximado (`roda`, `painel`, `bancos/interior`, `porta-malas`, `traseira`, `lateral`, `frente`) e selecionam imagens diferentes do BNDV em vez de sempre enviar as primeiras;
  - pedidos gerais de fotos tentam misturar fotos externas e internas usando a ordem das fotos do BNDV;
  - deploy realizado em producao da Edge Function `pedro-webhook-v2`;
  - validado por dry-run remoto na instancia `agente-ia-hpic`: busca por Renegade retornou 5 opcoes, status 200, build correto e quebras em branco entre os itens da lista.
- Hotfix do Pedro v2 para referencia de fotos do mesmo veiculo:
  - criado orquestrador versionado `orchestrator_20260525_photo_flow.ts`;
  - criados `replyGenerator_20260525_photo_flow.ts` e `stockSearch_20260525_photo_flow.ts` para evitar cache antigo no Edge Runtime;
  - `pedro-webhook-v2` passou a apontar para o build `2026-05-25-photo-flow-v2`;
  - pedidos de foto agora gravam `ultima_foto` e `referencia.ultimo_veiculo_*` em `pedro_conversation_state`, evitando que "foto do painel/interior" caia em outro carro depois de "fotos do 4";
  - envio de fotos do Pedro v2 agora manda as imagens primeiro e so depois envia um comentario curto/variado, mais natural para WhatsApp;
  - selecao geral de fotos passou a priorizar ordem aproximada `1, 4, 6, 7, 8` do BNDV; pedidos de painel/interior/bancos priorizam fotos mais internas/laterais tardias antes de voltar ao inicio da lista;
  - nomes de veiculos foram higienizados para reduzir duplicacoes e nomes colados como `RENEGADE1.8`;
  - deploy realizado em producao da Edge Function `pedro-webhook-v2`;
  - validado por dry-run remoto: build `2026-05-25-photo-flow-v2`, busca por Renegade com status 200, 6 itens e quebras de linha preservadas.

## 2026-05-25

- Evolucao do Pedro v2 para orquestrador real, preservando as regras de transferencia que ja estavam funcionando:
  - criado `vehicleResolver_20260525_brain.ts` para resolver o veiculo da mensagem atual, anuncio, midia ou memoria, com prioridade para a mensagem atual;
  - criado `pedroBrainPlanner_20260525.ts` para decidir a proxima acao antes da resposta final (`reply_only`, `stock_search`, `photo_request`, `handoff`, `clarify`);
  - criado `pedroBrainReply_20260525.ts` para gerar a resposta final usando o system prompt do portal, fatos do estoque e horario real de Sao Paulo;
  - `orchestrator_20260525_photo_flow.ts` passou a chamar resolvedor -> planner -> tool de estoque/foto -> resposta final, em vez de seguir um fluxo fixo por regex;
  - corrigido risco de usar memoria antiga quando o lead muda de assunto/modelo, como no caso `oroqui` apos Renegade;
  - cumprimento simples como `bom dia` nao deve mais entrar como anuncio sem payload real de anuncio/midia;
  - deploy realizado em producao da Edge Function `pedro-webhook-v2` com build `2026-05-25-brain-orchestrator-v1`;
  - build frontend validado com `npm.cmd run build`.
- Hotfix do Pedro v2 para memoria curta e perguntas sociais:
  - adicionado `recent_turns` em `pedro_conversation_state.state` para o Pedro v2 lembrar as ultimas trocas entre lead e agente;
  - planner e reply passaram a receber `recent_history`, evitando que o agente se reapresente quando ja conversou com o lead;
  - perguntas sociais como "como voce esta?", "e voce?" e correcoes como "perguntei como voce esta" agora viram `reply_only/small_talk`, sem acionar estoque, anuncio ou fluxo de primeiro contato;
  - resposta social passa a responder primeiro a pergunta do lead, com tom humano e humilde quando errou a interpretacao;
  - deploy realizado em producao da Edge Function `pedro-webhook-v2`;
  - build frontend validado com `npm.cmd run build`.
- Hotfix do Pedro v2 para refinamento de estoque/fotos:
  - `pedro-webhook-v2` recebeu build `2026-05-26-photo-targeting-stock-format-v1`;
  - pedidos de fotos com atributos do lead, como "automatico", "manual", cor, ano ou carroceria, agora tentam escolher o veiculo correto entre os ultimos apresentados antes de cair na memoria antiga;
  - listas de estoque geradas pelo cerebro passaram a ter fallback deterministico com numeracao `1.`, `2.`, `3.` e linha `Foto:` quando a tool do estoque retorna imagem;
  - mensagens formatadas de estoque preservam quebras de linha, mas agora ainda enviam presenca de digitacao antes do texto;
  - pedidos de fotos passam a enviar uma frase curta antes das imagens, citando o veiculo/detalhe selecionado, e depois enviam as midias;
  - a ordem heuristica de fotos foi ajustada para tentar misturar frente/traseira/interior/painel com base na ordem do BNDV, sem alterar regras de transferencia/CRM;
  - build frontend validado com `npm.cmd run build` e deploy realizado em producao da Edge Function `pedro-webhook-v2`.
- Hotfix do Pedro v2 para leitura real de cards/anuncios do WhatsApp:
  - `pedro-webhook-v2` recebeu build `2026-05-26-uazapi-full-media-v2`;
  - tempo de download de imagem configurado com downloads completos via endpoint `/message/download`;
  - a visao do anuncio agora prioriza texto visivel do card;
  - build frontend validado com `npm.cmd run build` e deploy realizado em producao da Edge Function `pedro-webhook-v2`.
- Hotfix do Pedro v2 para atendimento consultivo de anuncio identificado:
  - `pedro-webhook-v2` recebeu build `2026-05-26-ad-vehicle-consultative-v3`;
  - limitacao do estoque ao primeiro match do anuncio para manter foco no carro anunciado;
  - build frontend validado com `npm.cmd run build` e deploy realizado em producao da Edge Function `pedro-webhook-v2`.
- Hotfix do Pedro v2 para busca estrita e audio:
  - `pedro-webhook-v2` recebeu build `2026-05-26-strict-stock-audio-v4`;
  - buscas estritas sem fallbacks com carros aleatorios;
  - transcreve audios usando Whisper / OpenAI API;
  - build frontend validado com `npm.cmd run build` e deploy realizado em producao da Edge Function `pedro-webhook-v2`.
- Hotfix do Pedro v2 para aceite de fotos:
  - `pedro-webhook-v2` recebeu build `2026-05-27-photo-offer-tool-v1`;
  - garante envio de fotos em lote e fechamento humano posterior;
  - build frontend validado com `npm.cmd run build` e deploy realizado em producao da Edge Function `pedro-webhook-v2`.

## Historico funcional recente consolidado

- Pedro recebeu varias correcoes em regras de transferencia, vendedor `ok`, CRM ao vivo, colunas e isolamento do agente.
- Marcos recebeu evolucoes em CRM manual, importacao/listas, campanhas, follow-up, instancias para vendedores, performance e exclusao em massa.
- Base teste/staging e scripts isolados configurados em producao e homologacao.
- Corrigidos bugs historicos de conexao com Supabase e fluxos Uazapi.
