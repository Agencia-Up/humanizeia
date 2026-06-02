# Pendencias e Riscos

## Alta prioridade

- OTIMIZACOES de custo OpenAI ainda NAO aplicadas (so a #1 planner->mini foi feita em 2026-06-01). Propostas, com economia estimada e baixo risco de qualidade: (#2) enxugar input do REPLY — mandar ~8 veiculos em vez de ate 24 (`stockFacts`/`facts` em pedroBrainReply), cap no `recent_history`, e estruturar pra maximizar prompt caching do system_prompt (~1636tok fixo) -> ~$50/mes/conta, qualidade quase intacta; (#3) NAO rodar visao (gpt-4o-mini) no thumbnail do anuncio quando o veiculo ja foi resolvido por texto/memoria (mediaContext/adContext) -> corta desperdicio recorrente em leads CTWA; (#4) 2a chamada de reply no fluxo de foto (fechamento/brainClosing no orquestrador ~1124) -> usar gpt-4o-mini ou template; (#5) respeitar `agent.model` (hoje `sanitizeModel` no REPLY ignora e forca gpt-4o) para o gerente poder escolher modelo mais barato por agente. NAO ha log de tokens — avaliar adicionar `usage` (prompt/completion tokens) no `pedro_v2_turn_logs.result` pra medir de verdade.

- MIGRACAO Pedro v1->v2 — FASE B (remover o v1), so APOS validar Carvalho em producao no v2. Estado atual (Fase A feita 2026-06-01): `PEDRO_V2_ENABLED=true`, todas as instancias CONECTADAS reapontadas p/ `pedro-webhook-v2` (v1 `uazapi-webhook` segue deployado como rede). FASE B quando o usuario confirmar estabilidade: (1) hardcodar `pedro-webhook-v2` no `resolveWebhookFunction` de `sync-evolution-webhook` E `create-evolution-instance` (remover o gate); (2) deletar a function `uazapi-webhook` (3850 linhas, Pedro v1); (3) deletar helpers `pedro-*` MORTOS — `pedro-crm-sync`, `pedro-identify-contact`, `pedro-intent-router`, `pedro-lead-memory`, `pedro-message-sender`, `pedro-process-feedback`, `pedro-sales-reply`, `pedro-seller-ack`, `pedro-stock-search`, `pedro-transfer-router`, `pedro-trigger-followup` — SO apos ANALISE DE ALCANCE confirmando que nada vivo importa deles (cuidado: alguns importam de `_shared/pedro-v2`); (4) remover o branch v1 classico do `cron-lead-followup` e o gate; (5) opcional: limpar env vars de gate. REVERSAO da Fase A (se precisar antes da B): `PEDRO_V2_ENABLED=false` + reapontar webhooks p/ `uazapi-webhook`.
- MIGRACAO — instancia `wander-carvalho-34` (Sarah, user wandercarvalho31) ficou no v1: estava DESCONECTADA, o POST/GET no /webhook deu 401 (token invalido enquanto offline). Sem trafego ate reconectar. AO RECONECTAR: rodar o reapontamento de novo (ou `sync-evolution-webhook` com o flag on ja manda p/ v2). Verificar tambem se ela precisa de novo token apos reconexao.
- INVESTIGAR persistencia de memoria / resolucao de lead do Pedro v2 (descoberto 2026-06-01): `pedro_conversation_state.veiculos_apresentados` esta SEMPRE vazio (15 states recentes checados, todos count 0; nenhum `ultima_foto` salvo) e a lead do numero de teste `558588323679` NAO foi encontrada em `ai_crm_leads` (nem por sufixo `88323679`); os `lead_id` dos states recentes nao batem com `ai_crm_leads`. Hipoteses: (a) descasamento do 9o digito BR (jid `558588323679` 12 digitos vs lead salvo com o 9 -> `ensurePedroV2Lead` nao acha/cria -> `lead.id` null -> nada e salvo em state); (b) `updatePedroMemoryFromIntent` (roda no INICIO do turno) sobrescreve o state sem preservar `veiculos_apresentados` do turno anterior; (c) a lista de SUVs de 13:37 nao foi salva (state mais recente era 13:17, anterior aos turnos 13:36-13:39). IMPACTO: memoria de veiculos apresentados/fotos/qualificacao pode nao persistir entre turnos -> planner sempre acha `hasPresentedVehicles=false`. NAO corrigido (exige investigacao com calma; mexer as cegas pode quebrar qualificacao/debounce/follow-up que dependem do state). MITIGADO em parte pelo build `photo-from-stock-v15` (fotos saem da busca fresca do mesmo turno, sem depender da memoria). PROXIMO PASSO: ler `leadMemory.ts` (`ensurePedroV2Lead`/`findPedroV2Lead`/`loadPedroMemory`/`updatePedroMemoryFromIntent`) + normalizacao de telefone/jid; logar/confirmar se `lead.id` resolve nos turnos reais ANTES de qualquer mudanca.
- SEGREDOS VAZADOS (descoberto 2026-05-29): `.env` e `secrets.txt` estao RASTREADOS no Git (`git ls-files`), portanto ja foram para o repo remoto `Agencia-Up/humanizeia`. `.env` expoe `SUPABASE_SERVICE_ROLE_KEY`/`LEGACY_SUPABASE_SERVICE_ROLE_KEY`; `secrets.txt` referencia ANTHROPIC, OPENAI, EVOLUTION/Uazapi, META e SERVICE_ROLE. Acoes: (1) PENDENTE/URGENTE — ROTACIONAR todos esses segredos + o access token Supabase (staging+prod) e o GitHub PAT que estavam no `pedro_v2_architecture_and_credentials.md`; (2) FEITO em 2026-05-29 (commit `f253efe` dev-wander / `e59c341` main, com push) — `.env` e `secrets.txt` deixaram de ser rastreados (arquivos mantidos localmente); (3) FEITO — `.gitignore` cobre `/.env`, `/secrets.txt` e `pedro_v2_architecture_and_credentials.md`, e o `.md` teve os valores trocados por placeholders; (4) PENDENTE/OPCIONAL — avaliar limpeza do historico do Git (filter-repo/BFG): operacao destrutiva, exige force-push e alinhamento com o socio antes. Enquanto (1) nao for feito, os segredos seguem validos no historico remoto.
- Validar seguranca de Edge Functions com `verify_jwt = false`: cada function precisa autenticar/autorizacao internamente quando manipula dados reais.
- Resolver historico de migrations antes de aplicar novas migrations em producao. Em 2026-05-24, `supabase db push --linked` pediu `--include-all` por migrations antigas nao registradas no remoto; nao aplicar em massa sem auditoria.
- Revisar RLS das tabelas criticas para garantir isolamento entre gerente, vendedor e usuario comum.
- Garantir idempotencia das filas de WhatsApp, campanhas e follow-ups para evitar mensagens duplicadas.
- Consolidar nomenclatura Uazapi/Evolution: o produto usa Uazapi, mas ainda ha nomes historicos `evolution` em functions/componentes.
- Revisar regra de vendedor respondendo `ok`: telefone deve ser a chave, vendedor nao pode virar lead.
- Revisar retorno de lead ja atendido: deve voltar para o mesmo vendedor quando houver historico confiavel.
- Reformular inteligencia do Pedro por fases conforme `.codex-brain/plano-pedro-v2.md`: manter Pedro v1 intacto, criar Pedro v2 paralelo com intent resolver, busca BNDV unificada, memoria estruturada desde a primeira mensagem, resolvedor de anuncio/`esse carro`, politica comercial, transferencia isolada e logs por turno.
- Evoluir Pedro v2 do paralelo para teste controlado:
  - criar corpus de testes com conversas reais problematicas;
  - adicionar idempotencia forte no sender antes de habilitar envio real em producao;
  - validar em WhatsApp real o envio de imagens de veiculos pelo Pedro v2 depois do hotfix `2026-05-25-sales-stock-photos-v1`;
  - conectar transferencia automatica do v2 com briefing e confirmacao `ok`, preservando coluna `Novo`;
  - validar em WhatsApp real o novo resolvedor de anuncio/link depois que a instancia `agente-ia-hpic` foi apontada para `pedro-webhook-v2`, especialmente cards do Facebook/Instagram com imagem e links encurtados;
  - estudar fonte confiavel de criativos/anuncios Meta para mapear post/link de anuncio ao veiculo anunciado quando a Uazapi entregar apenas link generico sem thumbnail/metadados;
  - apos o hotfix `2026-05-24-humanized-ad-reply-v2`, repetir teste real no WhatsApp e conferir se o payload da Uazapi agora traz thumbnail/imagem; se continuar vindo apenas texto generico do Facebook, Pedro v2 deve pedir modelo/print em vez de tentar adivinhar;
  - apos o hotfix `2026-05-24-media-context-followup-v1`, repetir teste real no WhatsApp com link/card e com print do anuncio. Conferir em `pedro_v2_turn_logs` o bloco `media_context.diagnostics` para saber se a Uazapi entregou thumbnail embutida, id de mensagem para download ou apenas texto;
  - apos o hotfix `2026-05-25-greeting-ad-context-v1`, repetir teste real no WhatsApp com cumprimento simples, mensagem comum sem link e link real de anuncio para confirmar que apenas payloads de anuncio entram no fluxo de anuncio;
  - apos o hotfix `2026-05-25-sales-stock-photos-v1`, testar conversa real completa: cumprimento, busca por modelo, pedido "fotos do segundo" e retorno a partir de anuncio/print;
  - apos o hotfix `2026-05-25-stock-format-photo-variety-v1`, testar no WhatsApp real: lista de estoque com quebras entre veiculos, pedido "fotos do segundo", "fotos do painel", "fotos da roda" e "fotos do interior";
  - apos o hotfix `2026-05-25-photo-flow-v2`, testar no WhatsApp real a sequencia: buscar modelo, pedir "fotos do 4", depois pedir "foto do painel/interior" e confirmar que as fotos continuam do mesmo veiculo escolhido;
  - apos o build `2026-05-25-brain-orchestrator-v1`, testar no WhatsApp real:
    - cumprimento simples sem anuncio (`Bom dia`);
    - busca por modelo com erro de digitacao (`oroqui`, `oroki`, `onis`);
    - troca de assunto depois de fotos, garantindo que a mensagem atual vença a memoria antiga;
    - link/card de anuncio com e sem thumbnail;
    - pedido de foto especifica (`painel`, `interior`, `roda`) depois de escolher um veiculo;
  - apos o hotfix de memoria curta/social-context, testar no WhatsApp real:
    - `Boa noite` -> `Como voce ta?` -> `Perguntei como voce esta`;
    - confirmar que o agente nao se reapresenta, nao aciona estoque e responde a pergunta social antes de vender;
    - conferir em `pedro_conversation_state.state.recent_turns` se as ultimas trocas foram gravadas;
  - apos o build `2026-05-26-photo-targeting-stock-format-v1`, testar no WhatsApp real:
    - pedir `Voce tem onix?` e confirmar lista numerada com `Foto:` por veiculo;
    - pedir `fotos do automatico` apos uma lista com apenas um automatico e confirmar que as fotos sao do veiculo automatico correto;
    - pedir `fotos do painel` e confirmar que a selecao prioriza painel/interior e nao troca de veiculo;
    - confirmar que mensagens formatadas de estoque continuam com quebras de linha e exibem digitacao antes do envio;
  - apos o build `2026-05-26-ad-thumbnail-full-stock-v1`, testar no WhatsApp real:
    - enviar card/link Facebook ou Instagram com thumbnail visivel e confirmar se o Pedro v2 identifica o veiculo anunciado antes de responder;
    - conferir `pedro_v2_turn_logs` para diagnosticos `ad_context.diagnostics.image_fetch_ok` e `used_image_inference`;
    - pedir `Voce tem onix?` e confirmar que todos os itens retornados pela tool aparecem numerados;
    - pedir `Me manda fotos do segundo` e `Tem fotos do automatico?` logo depois da lista, confirmando que o alvo continua sendo o veiculo correto;
  - apos o hotfix `2026-05-26-brain-memory-orchestrator`, testar no WhatsApp real:
    - conversa social com pelo menos 3 mensagens, confirmando que o agente nao repete saudacao/apresentacao;
    - troca de assunto apos estoque/fotos, confirmando que a mensagem atual vence memoria antiga;
    - pedido de fotos, confirmando que a tool envia midia e o cerebro faz apenas fechamento humano;
    - verificar logs e `wa_inbox` para garantir que os ultimos turnos estao sendo usados como memoria;
  - evoluir a selecao de fotos do Pedro v2 para classificacao por visao/cache de imagens do BNDV. O hotfix atual usa heuristica pela ordem das fotos; para precisao maxima, cada URL deve ser classificada como frente, lateral, traseira, roda, painel, bancos, porta-malas etc.;
  - revisar configuracao/sincronismo de estoque BNDV do perfil de teste `douglasaloan@gmail.com`: dry-run com print de Duster reconheceu o veiculo corretamente, mas a busca BNDV desse perfil/instancia retornou 0 Duster;
  - testar em usuario liberado por `PEDRO_V2_ALLOWED_USER_EMAILS`/`PEDRO_V2_ALLOWED_USER_IDS` antes de qualquer rollout global;
  - validar idempotencia e logs com `PEDRO_V2_MUTATIONS_ENABLED` e `PEDRO_V2_SEND_ENABLED` ligados somente no teste controlado.
- Apos novo teste real no WhatsApp do usuario liberado, conferir se `pedro_v2_turn_logs` recebeu eventos; se continuar vazio, investigar payload da Uazapi antes de alterar inteligencia do agente.
- O historico de migrations continua desalinhado: a tabela `pedro_v2_turn_logs` foi aplicada com `db query --file`, mas `db push --include-all` segue proibido sem auditoria das migrations antigas.

## Roadmap Pedro v2 — melhorias de venda (planejado 2026-05-29, fazer uma de cada vez, GATED na conta do usuario para nao afetar v1/Marcos)

- ETAPA A (FEITA): split conversacional por LLM (`gpt-4o-mini`) evitando separar modelo/ano; fallback heuristico. Ver historico.
- ETAPA B (A FAZER): follow-up de inatividade contextual em 3 tempos, substituindo 5min(fixo)/10min(transfere). Novo: 5min = pergunta contextual gerada pela IA conforme a conversa; 8min = pergunta se ainda precisa de ajuda; 12min = avisa amigavelmente que vai transferir + agradece + transfere (fila/round-robin/"aguardando" como hoje). CRITICO: o `cron-lead-followup` (linhas ~602-802) processa `ai_crm_leads` SEM gate v1/v2 -> mexer cru afeta o Pedro v1 da OUTRA conta. Solucao: ramificar por allowlist/`isPedroV2EnabledForUser(lead.user_id)`; usuarios v2 -> fluxo novo; resto -> codigo atual byte a byte. Mensagens contextuais exigem carregar `pedro_conversation_state` + chamada LLM por lead no cron.
- ETAPA C (A FAZER): inteligencia de parar follow-up + transferir quando o lead QUALIFICOU / AGENDOU visita / esta PRONTO pra comprar (tem troca, quer dar entrada, fechar). Hoje o orquestrador do v2 NAO executa transferencia real (so loga `needs_handoff`); a unica transferencia que atinge v2 e a de inatividade no cron compartilhado. Implementar: detectar agendamento/pronto-pra-comprar (intentRouter/planner), executar transferencia real reusando `chooseSellerForPedroTransfer` + insert `ai_lead_transfers` + status, despedir avisando que um consultor vai chamar, e marcar o lead para o cron NAO fazer follow-up (cron ja pula quem saiu de `novo/interessado`/ja atribuido). Usuario tem vendedor (`ai_team_members`) cadastrado na conta de teste. NAO mudar o fluxo de transferencia do v1/Marcos.
- (Nota: ETAPAS A, B e C ja FORAM FEITAS — ver historico. O system prompt do portal foi tornado driver principal. Ajustes pre-lancamento de foto/audio/briefing tambem feitos.)
- DEBOUNCE / CONCATENAR MENSAGENS (FEITO 2026-05-30, build `debounce-v11`): implementado no orquestrador (apos salvar a msg do usuario): espera 7s, "ultimo vence" por id em wa_chat_history (invocacoes anteriores retornam `debounced_superseded`), e a ultima junta as msgs nao-respondidas (`gatherUnansweredUserText`) como UM turno. Gated v2, !dry_run. Otimizacao futura: mover o debounce pra ANTES do mediaContext/historico (hoje invocacoes superseded ainda gastam esse processamento).

## Media prioridade

- Atualizar base teste/staging periodicamente a partir da producao sem copiar segredos indevidos.
- Criar/checkar testes automatizados para:
  - transferencia manual;
  - transferencia automatica por inatividade;
  - vendedor `ok`;
  - lead recorrente;
  - card/link de anuncio com thumbnail do WhatsApp sendo baixado pela Uazapi e identificado pela visao;
  - campanha com texto + midia;
  - campanha com variacoes IA;
  - follow-up com midia;
  - permissoes gerente/vendedor.
- Melhorar observabilidade em Edge Functions com logs estruturados, correlation id e registro de erro por lead/campanha.
- Verificar performance de consultas em `ai_crm_leads`, `crm_leads`, filas e contatos com indices adequados.
- Limpar arquivos temporarios/diagnostico antigos se confirmado que nao sao usados.

## Problemas conhecidos

- Build gera avisos existentes:
  - Browserslist antigo.
  - Utility Tailwind com theme invalido em radial gradient.
  - `ConnectionsTab.tsx` possui case duplicado `instagram_publisher`.
  - Aviso de dynamic import em `dynamicFields`.
- Existem arquivos sensiveis RASTREADOS no Git (`.env`, `secrets.txt`) e um doc local com credenciais (`pedro_v2_architecture_and_credentials.md`); nao copiar valores para documentacao. Ver item de SEGREDOS VAZADOS em "Alta prioridade".
- Ha diretorios temporarios/untracked (`.tmp-edge-mockup/`, `docs/mockups/`) que nao devem ser incluidos em commits sem decisao explicita.
- UAZAPI — queda transitoria da sessao ("host not mapped"): em 2026-06-01 um "Bom dia" ficou em "digitando" sem responder. Log real (`pedro_v2_turn_logs`) mostrou cerebro OK (`reply_source: brain_reply`) e falha SO no envio (`send_result.error: message-sendText: HTTP 404 host not mapped`). O `GET /instance/status` da instancia voltou `connected:true` minutos depois -> foi um blip do Uazapi (instancia nao mapeada a uma sessao ativa naquele instante; "online" do WhatsApp nao garante a ponte). MITIGADO (build `2026-06-01-send-retry-v14`): `sendPedroTextOnce` agora re-tenta os 3 endpoints em ate 3 rodadas com backoff (1.2s/2.0s) e `try/catch` por tentativa; so re-tenta com `res.ok=false` (nao duplica). NAO resolve a raiz (reconexao da instancia e do lado do provedor) — se as quedas forem frequentes, investigar a estabilidade da instancia no painel Uazapi. Observabilidade futura: alertar quando `send_result.ok=false` persistir apos os retries.
- Historico recente teve problemas de:
  - login/Supabase timeout;
  - Uazapi/cota/pagamento;
  - campanha sem enviar ou duplicando;
  - midia sem acompanhar texto;
  - vendedor sendo tratado como lead;
  - Pedro e Marcos misturando leads;
  - colunas/etapas duplicadas no CRM.

## Proximos passos recomendados

1. Criar checklist de testes de producao controlado para Pedro e Marcos.
2. Auditar RLS/function auth por grupo de tabelas.
3. Criar testes de regressao para regras criticas de transferencia e campanhas.
4. Padronizar nomenclatura Uazapi no codigo ou documentar claramente aliases legados.
5. Melhorar indices e queries para escala de leads.
6. Revisar arquivos sensiveis no repo/local e garantir `.gitignore` adequado.
7. Manter staging sincronizado antes de mudancas grandes.
8. Criar uma bateria de teste com payloads reais de anuncio Facebook/Instagram para o Pedro v2, cobrindo `thumbnailDirectPath`, `jpegThumbnail`, imagem anexada e link puro.
