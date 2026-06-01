# Pendencias e Riscos

## Alta prioridade

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
