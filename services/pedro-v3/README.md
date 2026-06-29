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
- `OPENAI_API_KEY`
- `PEDRO_V3_OPENAI_MODEL=gpt-4.1-mini`
- `PEDRO_V3_ALLOWED_UAZAPI_HOSTS` com os hosts HTTPS permitidos, separados por virgula

Nao habilite o roteamento ativo no webhook antes de o health check estar verde.
No webhook v2, configure a mesma chave em `PEDRO_V3_BRIDGE_SECRET`, a URL HTTPS do
servico em `PEDRO_V3_SERVICE_URL` e somente entao use `PEDRO_V3_PILOT_MODE=active`.

O contrato da ponte impede fallback para o v2 quando a ingestao no v3 for confirmada
ou incerta. Isso evita resposta dupla durante timeout ou falha depois do insert.
