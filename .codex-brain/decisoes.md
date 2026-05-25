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

## Segredos

- Nunca registrar valores reais de tokens/API keys em arquivos do repo ou cerebro.
- No cerebro, registrar apenas nomes de variaveis e locais esperados.
