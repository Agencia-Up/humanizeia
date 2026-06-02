# Decisoes

## Produto e funis

- Pedro e Marcos devem permanecer separados:
  - Pedro e o funil do agente IA/SDR.
  - Marcos e CRM manual, listas, campanhas e follow-up de vendedores.
- A IA do Pedro nao deve mover etapas do CRM. Ela atende, transfere e registra informacoes; quem move etapa e vendedor/gerente.
- O lead chega em `Novo` no Pedro e permanece em `Novo` ate acao humana.
- O campo de vendedor pode ficar `Aguardando` ate o vendedor aceitar/responder `ok`.
- A atribuicao por `ok` deve usar telefone do vendedor como chave, nao nome salvo.
- Vendedores cadastrados nao devem entrar como leads quando respondem o agente.
- Se lead retornar depois de ja ter sido atendido, deve ser preferido o mesmo vendedor que ja assumiu o atendimento.

## Marcos

- Marcos nao deve receber automaticamente todos os leads do Pedro, exceto em fluxos explicitos de migracao/exportacao.
- Marcos deve permitir operacao por gerente e vendedores com isolamento/permissao.
- Leads adicionados/importados por vendedor devem receber o vendedor responsavel quando aplicavel.
- Follow-up do Marcos e disparo em massa sao robos de envio, nao agentes conversacionais.
- Instancias do Marcos usam Uazapi. Nomes historicos com `evolution` ainda existem em algumas functions/componentes, mas a operacao atual deve tratar Uazapi como provedor real.

## Campanhas e follow-up

- `Mensagem Fixa` e opcional e deve ser usada quando nao quiser variacoes de IA.
- Prompt base de IA deve gerar variacoes sem preencher indevidamente `Mensagem Fixa`.
- Campanhas/follow-ups devem enviar texto + midia quando ambos forem configurados.
- Evitar duplicidade de envios; cada campanha/destinatario deve ter controle idempotente.
- Agendamento de campanha com inicio/fim deve respeitar janela minima de 10 minutos.

## Frontend/navegacao

- A tela antiga de `/dashboard` virou `/tela-inicial`.
- `/dashboard` agora e a visao analitica/comercial comparativa Pedro x Marcos.
- Ambas ficam sob o grupo `Painel` no sidebar.
- Login e redirecionamentos padrao devem abrir `/tela-inicial`.

## Deploy e ambiente

- `main` e producao/Easypanel.
- Staging/base teste usa projeto Supabase separado e diretorio separado; nunca misturar credenciais.
- Mudancas grandes devem ser testadas em staging antes de producao quando possivel.
- Alteracoes puramente visuais podem ir direto para producao se o usuario pedir explicitamente e o build passar.
- Pedro v2 deve entrar primeiro por allowlist de usuario/email, nao por flag global. A flag `PEDRO_V2_ENABLED` fica reservada para rollout geral depois de validacao.
- Para usuarios na allowlist do Pedro v2, criacao/sincronizacao de instancia Uazapi deve configurar webhook para `pedro-webhook-v2`; usuarios fora da allowlist continuam em `uazapi-webhook`.
- A sincronizacao de webhook deve checar allowlist por user id antes da consulta por email, para nao depender de lookup de Auth quando o usuario de teste ja esta identificado.
- Pedro v2 nunca deve abandonar contexto de anuncio dizendo que nao acessa links externos. O orquestrador deve tratar cards/links do WhatsApp como contexto de negocio: extrair metadados, inferir veiculo quando possivel, buscar no BNDV e so pedir confirmacao quando o anuncio nao tiver contexto suficiente.
- Pedro v2 nao pode consultar estoque usando apenas texto generico de anuncio/link. Se nao identificar marca/modelo/tipo com confianca, deve pedir modelo ou print antes de oferecer qualquer veiculo.
- Pedro v2 deve funcionar como orquestrador com tools, nao como fluxo fixo:
  - a mensagem atual vence memoria antiga quando houver novo modelo/assunto;
  - o resolvedor de veiculo decide se existe sinal confiavel de carro antes da busca;
  - o planner decide a acao antes da resposta final;
  - a resposta final usa o system prompt do portal e somente fatos retornados pelas tools;
  - regras de transferencia, vendedor `ok` e CRM nao devem ser alteradas por ajustes de inteligencia conversacional.
- A resposta final do Pedro v2 deve ser sempre gerada pelo cerebro/LLM com historico real de conversa e system prompt do portal. Tools de fotos/estoque/transferencia executam tarefas e retornam fatos; elas nao devem ditar a conversa como script fixo.

## Segredos

- Nunca registrar valores reais de tokens/API keys em arquivos do repo ou cerebro.
- No cerebro, registrar apenas nomes de variaveis e locais esperados.

## Pedro v2 — personalidade vs codigo

- A PERSONALIDADE e o passo-a-passo de vendas vem do PORTAL (`wa_ai_agents.system_prompt`), por duas vias a escolha do cliente: aba "general" (prompt manual) OU aba "Funil do Agente" (gera e sobrescreve o `system_prompt`, com `system_prompt_backup`). O `pedroBrainReply` injeta esse texto como "PERSONALIDADE / SYSTEM PROMPT DO PORTAL".
- Ficam NO CODIGO (nao no portal): (a) o "BLOCO 2 - comportamento obrigatorio fixo" (uma pergunta por msg, termina com pergunta de conducao, nao pressiona, nao fala preco antes de qualificar, nao tenta fechar, trata pelo nome, varia tom) — como rede de seguranca, porque o cliente pode esquecer de preencher e e critico na venda de veiculos; (b) o contrato tecnico (formato JSON, `presented_vehicle_indices`, anti-alucinacao, tratamento de `tool_result` de fotos); (c) as tools (estoque BNDV, fotos, transferencia) e o planner (roteamento de acao).
- ENVIO: respostas conversacionais saem quebradas em ate 3 mensagens curtas (rajada humana); a LISTA de estoque sai em mensagem unica (caminho `typingOnly`, `preserveFormatting`). Nao misturar os dois caminhos.
- Regra de ouro do usuario: mudancas no Pedro v2 sao "teste em producao" no WhatsApp dele (deploy gated por allowlist so pro usuario dele). Nunca quebrar inteligencia ja funcionando (imagem/audio/link/BNDV). Mudar pouco, isolado, e testar antes de considerar pronto.

## Identidade e versionamento (por maquina)

- Modelo trunk-based: tanto `dev-aloan` quanto o socio Wander commitam e empurram para a `main`. A branch local `dev-wander` e compartilhada; a branch `dev-aloan` esta obsoleta e nao deve ser usada.
- Cada maquina deve commitar com a identidade do seu dono. NESTA maquina (do dev-aloan): `user.name=dev-aloan`, `user.email=douglasaloan@gmail.com` no `.git/config` local; NAO usar `--author` de outra pessoa.
- Guarda local instalada: `.git/hooks/pre-commit` bloqueia commits cujo autor nao seja `douglasaloan@gmail.com` (protege contra confusao de identidade por ferramentas como o Antigravity). Hook nao e versionado — recriar apos novo clone. Pular so com `git commit --no-verify`.
- Pushes para `origin` usam o wrapper `scripts/git-logosia.cmd` (PAT do `github/.env.local`).
