# Pedro v3 - servico piloto

Servico HTTP isolado do Pedro v3. Nesta fase, somente o tenant e o agente piloto
fixos no dominio podem executar o modo ativo. Todos os demais clientes continuam
no Pedro v2.

## EasyPanel

- Build context: `services/pedro-v3`
- Dockerfile: `Dockerfile`
- Porta interna: `3000`
- Health check: `GET /health`

Variaveis obrigatorias:

- `PORT=3000`
- `PEDRO_V3_BRIDGE_SECRET` com pelo menos 32 caracteres aleatorios
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PEDRO_V3_OPENAI_MODEL=gpt-4.1-mini`
- `PEDRO_V3_ALLOWED_UAZAPI_HOSTS` com os hosts HTTPS permitidos, separados por virgula

> **NAO** configurar `OPENAI_API_KEY` no EasyPanel (F2.6J). A chave OpenAI e BYOK: vem do perfil
> do tenant (Vault, via `get_client_ai_key` service-role), resolvida por tenant em cada turno — igual
> ao Pedro v2. Sem chave valida do tenant, o turno falha fechado (sem chave global, sem mensagem dupla).
> `PEDRO_V3_OPENAI_MODEL` continua sendo so o NOME do modelo (default/override), nao a credencial.

Nao habilite o roteamento ativo no webhook antes de o health check estar verde.
No webhook v2, configure a mesma chave em `PEDRO_V3_BRIDGE_SECRET`, a URL HTTPS do
servico em `PEDRO_V3_SERVICE_URL` e somente entao use `PEDRO_V3_PILOT_MODE=active`.

O contrato da ponte impede fallback para o v2 quando a ingestao no v3 for confirmada
ou incerta. Isso evita resposta dupla durante timeout ou falha depois do insert.

## Pre-requisitos (bloqueios factuais antes de ativar)

1. SQL F2.6H aplicado no Supabase (`Brain/sql/v3_f2_6h_receipt_patch.sql`).
2. `wa_ai_agents.instance_id` do agente piloto **preenchido** com a instancia Uazapi conectada
   (o servico exige `instance_id` singular; se NULL, o piloto ativo falha fechado).
3. Webhook Uazapi da instancia piloto com o evento `messages_update` (validar via
   `GET {api_url}/webhook/find/{instance}`; nao re-sincronizar pelo `sync-uazapi-webhook`).

Detalhes factuais (instancia exata, SQL e validacao) no handoff
`Brain/handoffs/2026-06-28-claude-f2.6i-prep-ativacao.md`.

## Ordem de ativacao

1. Deploy do servico v3 no EasyPanel com as ENVs acima.
2. Healthcheck verde (`GET /health` = 200).
3. Deploy do webhook v2 (build `2026-06-28-pedro-v3-delivery-receipt-v221`).
4. No webhook (edge function): `PEDRO_V3_SERVICE_URL` + `PEDRO_V3_BRIDGE_SECRET` (identico ao do servico).
5. `PEDRO_V3_PILOT_MODE=shadow` primeiro -> smoke test (sem resposta dupla; receipt promove outbox).
6. So depois: `PEDRO_V3_PILOT_MODE=active`.

## Rollback

- Reversao instantanea: `PEDRO_V3_PILOT_MODE=off` na edge function -> o Aloan volta 100% ao Pedro v2.
  Nenhum outro cliente e afetado em nenhum momento.
- Se o servico cair em `active`, o contrato anti-resposta-dupla evita execucao por dois agentes;
  voltar para `off` encerra qualquer duvida. Se preciso, redeploy do webhook build anterior (`...v220`).
