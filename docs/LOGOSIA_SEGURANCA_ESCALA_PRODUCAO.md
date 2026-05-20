# LogosIA - auditoria de seguranca e escala da producao

Data: 2026-05-20
Escopo: ambiente de producao, banco Supabase, Edge Functions, filas, CRM Pedro, CRM Marcos, disparo em massa, follow-ups e integracoes criticas.

Este arquivo guarda o diagnostico e o plano de acao para preparar o LogosIA para escalar de poucos leads para varios clientes/contas, mantendo seguranca, previsibilidade e capacidade de processamento.

## Diagnostico principal

O projeto ja tem uma base funcional importante: separacao entre Pedro e Marcos, fila de disparos, isolamento por vendedor, ambiente de teste e uso de Edge Functions para regras sensiveis. O ponto de atencao e que varias regras cresceram rapido e hoje existem funcoes publicas, politicas RLS complexas e fluxos que misturam CRM, WhatsApp, automacoes e permissoes em muitos lugares.

Para vender e escalar, precisamos transformar essas regras em uma base mais previsivel: funcoes com autenticacao consistente, acesso ao banco controlado, jobs de fila idempotentes, logs auditaveis e indices para evitar lentidao quando o volume de leads subir.

## Riscos criticos

1. Edge Functions expostas

Algumas funcoes precisam ser publicas por natureza, como webhooks. Outras precisam aceitar somente usuario autenticado. O risco e uma funcao aceitar dados do navegador ou de fora e usar `service_role` sem validar se aquele usuario pode executar a acao.

Acao: classificar cada funcao como `webhook publico`, `usuario autenticado`, `job interno` ou `admin`. Em funcoes autenticadas, validar JWT e derivar `user_id` do token, nunca apenas do body.

2. Service role em excesso

O `service_role` deve ficar somente no servidor e somente onde for necessario. Ele ignora RLS, entao qualquer falha de validacao vira risco real.

Acao: manter `service_role` apenas em Edge Functions e scripts internos. Nunca expor em frontend, logs ou variaveis publicas. Revisar funcoes que recebem `user_id`, `seller_member_id`, `lead_id`, `campaign_id` e confirmar permissao antes de alterar dados.

3. Webhooks sem assinatura forte

Webhooks de WhatsApp/Uazapi/BNDV precisam provar que vieram da fonte esperada. Se aceitarem qualquer chamada, alguem pode criar leads, disparar mensagens ou simular eventos.

Acao: exigir token secreto por header, assinatura HMAC quando possivel, allowlist por origem quando fizer sentido e logs de rejeicao.

4. RLS e permissoes complexas

As politicas de RLS protegem, mas podem ficar lentas ou conflitantes quando existem muitas politicas permissivas na mesma tabela. Tambem ha risco de recursao se uma politica consulta a propria tabela ou uma cadeia que volta nela.

Acao: revisar tabelas principais (`profiles`, `organizations`, `organization_members`, `pedro_leads`, `marcos_crm_leads`, `wa_campaigns`, `wa_queue`, `wa_instances`, `wa_contacts`). Simplificar politicas duplicadas, usar funcoes `security definer` bem auditadas quando necessario e indexar colunas usadas nas politicas.

5. Escala de leads e disparos

O volume deve crescer em tres pontos: entrada de leads, movimentacao de CRM e disparos/follow-ups. A fila precisa impedir duplicidade, retry infinito e concorrencia que envie duas vezes.

Acao: manter `wa_queue` com processamento atomico, travas por status, janela de `scheduled_for`, limite de tentativas e chaves unicas por campanha/contato quando aplicavel.

## Plano de acao

### P0 - Antes de vender em escala

- Inventariar todas as Edge Functions e marcar tipo de acesso.
- Bloquear qualquer funcao sensivel que aceite `user_id` do body sem conferir usuario autenticado.
- Revisar webhooks publicos com token/assinatura.
- Confirmar que nenhuma chave `service_role`, OpenAI, Uazapi ou BNDV esta no frontend.
- Criar log central para acoes sensiveis: transferencia, aceite do vendedor, importacao, campanha, follow-up, conexao de instancia e alteracao manual de CRM.
- Criar testes de regressao para os fluxos criticos:
  - lead entra pelo webhook e fica no Pedro como Novo;
  - IA atende, mas nao move etapa do CRM;
  - transferencia por fila escolhe vendedor correto;
  - vendedor responde OK e nao vira lead;
  - Marcos importa lead manual sem misturar com Pedro;
  - campanha com prompt IA gera variacoes;
  - campanha com mensagem fixa ignora IA;
  - imagem/audio/video sao enviados uma unica vez.

### P1 - Performance e banco

- Adicionar ou confirmar indices em:
  - `pedro_leads(user_id, status, created_at)`
  - `pedro_leads(phone)`
  - `marcos_crm_leads(user_id, seller_member_id, status, created_at)`
  - `wa_queue(status, scheduled_for)`
  - `wa_queue(campaign_id, contact_id)`
  - `wa_campaigns(user_id, seller_member_id, status, created_at)`
  - `wa_instances(user_id, seller_member_id, status, is_active)`
  - tabelas de vendedores por telefone normalizado.
- Revisar policies que chamam `auth.uid()` muitas vezes e transformar em forma otimizada quando o advisor indicar.
- Criar rotina de limpeza/arquivamento para logs, inbox e mensagens antigas.
- Separar contadores pesados em views/materialized views ou tabelas agregadas se os dashboards ficarem lentos.

### P2 - Resiliencia operacional

- Adicionar idempotencia em webhooks e jobs: o mesmo evento nao pode criar lead, transferir ou enviar mensagem duas vezes.
- Criar rate limit por organizacao, instancia, vendedor e campanha.
- Melhorar retry: falha temporaria tenta novamente; falha permanente para e registra motivo.
- Criar alertas para:
  - fila parada;
  - muitas falhas Uazapi;
  - campanha sem progresso;
  - instancia desconectada;
  - Edge Function com erro acima do normal.

### P3 - Governanca e deploy

- Manter producao e base teste sincronizadas por processo controlado.
- Toda alteracao deve ir primeiro na base teste.
- Validar com checklist funcional antes de subir para producao.
- Evitar alteracoes diretas no Supabase de producao sem migration/script versionado.
- Guardar rollback claro para cada mudanca de banco ou Edge Function.

## Checklist de validacao antes de producao

- Build frontend concluido sem erro.
- Edge Functions alteradas publicadas no ambiente correto.
- Migration aplicada primeiro na base teste.
- Teste com usuario gerente e usuario vendedor.
- Teste de Pedro e Marcos separados.
- Teste de vendedor respondendo OK.
- Teste de campanha com IA e com mensagem fixa.
- Teste de midia em follow-up e disparo em massa.
- Teste de fila com pelo menos 20 contatos.
- Conferir logs sem erro 4xx/5xx inesperado.

## Regra de ouro

O frontend pode facilitar a experiencia, mas a seguranca e as regras de negocio precisam estar no backend. Qualquer acao sensivel deve ser validada pela Edge Function ou pelo banco antes de alterar dados.
