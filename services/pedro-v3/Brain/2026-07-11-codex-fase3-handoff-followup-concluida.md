# Fase 3 concluída no working tree: handoff, briefing e follow-up

**Data:** 2026-07-11
**Estado:** pronto para commit e aceite supervisionado; nenhuma flag ativada; nenhum envio real a vendedor/gerente.

## Arquitetura entregue

- A LLM continua sendo a autora da conversa e dos follow-ups T1/T2/T3.
- A LLM propõe apenas o ato de transferência e o motivo permitido. Ela nunca escolhe vendedor, UUID, telefone operacional ou texto de briefing.
- O engine valida a promessa e monta a cadeia operacional factual:
  `resposta entregue -> crm_write -> handoff -> notify_seller entregue`.
- O briefing usa somente estado/CRM/estoque/memória aterrados. Interesse de compra e veículo de troca permanecem separados.
- A saga resolve vendedor anterior/roster/rodízio, cria transferência pendente compatível com o aceite `Ok` e com a rotação já existente no v2.
- O vendedor efetivo é lido da transferência correlacionada. O `notify_seller` não aceita `sellerId` vindo da LLM.
- O estado só entra em `handoff` depois do callback de entrega do aviso ao vendedor.
- T1/T2/T3 usam as regras atuais do portal. T3 pode usar a mesma saga quando `t3_transfers` estiver ativo.
- Mensagem nova do lead, conversa encerrada ou saga de handoff ativa cancelam o follow-up.
- Entrada de vendedor no webhook do piloto não é enviada ao v3; segue para o fluxo v2 que já processa o `Ok`.

## Hardening da auditoria Codex

- Receipt de `notify_seller` preserva `accepted`; nunca finge `delivered`.
- Callback `delivered` aceita `notify_seller`, aplica o outcome e libera dependências sem esperar nova mensagem do lead.
- Handoff e notify usam `correlationId` exato; uma transferência antiga não pode receber a notificação nova.
- Falha de insert reverte o status anterior do lead por CAS.
- Todas as leituras/escritas da saga são tenant/agent scoped.
- Varredura de follow-up prioriza `v3_conversation_state.updated_at DESC`.
- Uma saga de handoff em andamento bloqueia follow-up mesmo antes do callback do vendedor.
- O v3 atualiza atividade do lead sem escrever `last_agent_reply_at`; os motores de follow-up v2 não disputam propriedade.

## Gates executados

- `npx tsc --noEmit`: EXIT 0.
- `npm run test:f249`: **38 OK / 0 falha**.
- `npm run test:active-root`: **26 OK / 0 falha**, incluindo callback realista `notify_seller delivered -> stage handoff`.
- `npm run test:bridge-inc1`: **24 OK / 0 falha**, incluindo lead/vendedor/unknown.
- `npm run test:pilot-http`: **21 OK / 0 falha**.
- `npm run test:f246`: **31 OK / 0 falha**.
- `npm run test:all`: EXIT 0, incluindo F2.48 64 OK e F2.49 38 OK.
- `git diff --check`: limpo (somente avisos de normalização LF/CRLF do Git).

## Flags e ativação

Defaults continuam OFF:

- `PEDRO_V3_CRM_WRITE`
- `PEDRO_V3_HANDOFF`
- `PEDRO_V3_FOLLOWUP`

Sequência segura no piloto:

1. Commit/push somente da leva da Fase 3 e do guard pilot-scoped do webhook.
2. Deploy do `agent-pedrov3` e deploy separado de `pedro-webhook-v2` por causa do guard do vendedor.
3. Confirmar `/health`: `central_active`, CRM ativo, handoff/follow-up ainda OFF.
4. Ativar `PEDRO_V3_HANDOFF=active`; avisar a vendedora de teste antes do aceite real.
5. Conversa supervisionada pedindo explicitamente um vendedor; conferir reply entregue, CRM, transferência pending, notificação e `Ok` no v2.
6. Só depois ativar `PEDRO_V3_FOLLOWUP=active` e testar T1/T2/T3 com tempos temporariamente reduzidos no portal.
7. Restaurar os tempos reais após o aceite.

Rollback: desligar `PEDRO_V3_HANDOFF` e `PEDRO_V3_FOLLOWUP` e reiniciar o serviço. O Pedro v2 permanece responsável pelo aceite/rotação; nenhum mecanismo v2 foi substituído.

## Riscos declarados

- Um follow-up enviado e aceito, mas sem callback `delivered`, fica planejado e não avança. É fail-closed para não duplicar mensagem.
- A varredura está limitada às 100 conversas mais recentemente atualizadas do piloto. É suficiente para o piloto; antes de rollout multi-tenant deverá virar paginação/worker dedicado.
- Falha do lookup de identidade de vendedor no edge retorna `unknown`; o comportamento atual privilegia não bloquear leads. Monitorar `seller_lookup_error` no aceite.
- Não foi executado smoke que envie WhatsApp real à vendedora nesta etapa; isso exige aviso e autorização operacional.
