# Ativacao Bruno BNDV

## Objetivo

Habilitar o Pedro v3 para o agente Carvalho do tenant Bruno sem retirar o
piloto Douglas. A selecao e explicita por par `tenantId` + `agentId`; nunca
por tenant isolado ou por nome do agente.

## Preflight concluido

- Carvalho: `aee7e916-31b1-431c-ba6f-f38178fd4899`
- Bruno: `f49fd48a-4386-4009-95f3-26a5100b84f7`
- Prompt efetivo: `funnel_generated`
- Estoque: BNDV, 50 itens na verificacao
- Automacao: transferencia e follow-up configurados, oito vendedores com
  WhatsApp no escopo do agente.
- Canary real, sem efeitos externos: PASS. O fluxo usou prompt e BNDV reais,
  selecionou o Peugeot 2008, enviou fotos dele, entendeu visita e planejou
  `handoff + notify_seller`.

## Variavel de ativacao

Definir a mesma variavel no servico `agent-pedrov3` e nos secrets da Edge
Function `pedro-webhook-v2`:

```json
[{"tenantId":"ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0","agentId":"d4fd5c38-dd37-4da5-a971-5a7b7dfb9185"},{"tenantId":"f49fd48a-4386-4009-95f3-26a5100b84f7","agentId":"aee7e916-31b1-431c-ba6f-f38178fd4899"}]
```

Nome: `PEDRO_V3_ACTIVE_SCOPES`.

Sem essa variavel, ou com JSON invalido, o comportamento continua fail-closed
no piloto Douglas legado. O runtime expõe `activeScopeCount` no `/health`.

## Ordem operacional

1. Publicar o servico Node e a Edge Function com o codigo desta leva, ainda
   sem a variavel de escopos.
2. Adicionar a variavel no servico Node e validar `/health` com
   `activeScopeCount: 2`.
3. Adicionar a mesma variavel aos secrets da Edge Function e publicar
   `pedro-webhook-v2`.
4. Fazer um canario no WhatsApp do Bruno: anuncio BNDV -> modelo/anuncio ->
   foto -> visita -> vendedor. Confirmar CRM, briefing e notificacao.

## Rollback

Remover somente a entrada Bruno da lista e republicar primeiro a Edge Function
e depois o Node. Douglas continua autorizado. Remover a variavel inteira volta
ao modo legado Douglas-only.
