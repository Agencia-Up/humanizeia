# Pendencias e Riscos

## Alta prioridade

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
  - evoluir a selecao de fotos do Pedro v2 para classificacao por visao/cache de imagens do BNDV. O hotfix atual usa heuristica pela ordem das fotos; para precisao maxima, cada URL deve ser classificada como frente, lateral, traseira, roda, painel, bancos, porta-malas etc.;
  - revisar configuracao/sincronismo de estoque BNDV do perfil de teste `douglasaloan@gmail.com`: dry-run com print de Duster reconheceu o veiculo corretamente, mas a busca BNDV desse perfil/instancia retornou 0 Duster;
  - testar em usuario liberado por `PEDRO_V2_ALLOWED_USER_EMAILS`/`PEDRO_V2_ALLOWED_USER_IDS` antes de qualquer rollout global;
  - validar idempotencia e logs com `PEDRO_V2_MUTATIONS_ENABLED` e `PEDRO_V2_SEND_ENABLED` ligados somente no teste controlado.
- Apos novo teste real no WhatsApp do usuario liberado, conferir se `pedro_v2_turn_logs` recebeu eventos; se continuar vazio, investigar payload da Uazapi antes de alterar inteligencia do agente.
- O historico de migrations continua desalinhado: a tabela `pedro_v2_turn_logs` foi aplicada com `db query --file`, mas `db push --include-all` segue proibido sem auditoria das migrations antigas.

## Media prioridade

- Atualizar base teste/staging periodicamente a partir da producao sem copiar segredos indevidos.
- Criar/checkar testes automatizados para:
  - transferencia manual;
  - transferencia automatica por inatividade;
  - vendedor `ok`;
  - lead recorrente;
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
- Existem arquivos locais potencialmente sensiveis (`.env`, `secrets.txt`); nao copiar valores para documentacao.
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
