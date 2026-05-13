# LogosIA - Ambiente de Testes

Atualizado em: 2026-05-13

## Ambientes

- Producao:
  - Pasta local: `E:\Projetos - Antigravity\HUMANIZEIA\humanizeia`
  - Branch: `main`
  - Supabase: `seyljsqmhlopkcauhlor`
  - Script: `scripts\supabase-logosia.cmd`

- Staging / LogosIA-baseTeste:
  - Pasta local: `E:\Projetos - Antigravity\HUMANIZEIA\humanizeia-staging`
  - Branch: `staging`
  - Supabase: `ezoltigtqgbmftmiwjxh`
  - Script: `scripts\supabase-logosia-staging.cmd`

## Regra de Ouro

Claude, Codex ou qualquer alteracao experimental deve trabalhar primeiro em `humanizeia-staging` e na branch `staging` ou em uma branch `feature/*`.

Nada deve ser enviado para `main` ou para o Supabase de producao antes de passar pelo checklist de validacao.

## Secrets

O staging possui acesso local separado em:

- `supabase\.env.staging.local`
- `.env.staging.local`

Esses arquivos sao ignorados pelo Git. Nao comitar tokens, service keys, chaves da UAZAPI, Meta, Asaas, OpenAI ou qualquer credencial.

As integracoes externas podem ser ativadas no staging quando o objetivo for testar igual producao, mas com cuidado: filas antigas de disparo nao devem ser copiadas. Isso evita que o ambiente de testes dispare WhatsApp, cobranca, webhook ou campanha real sem acao humana.

## Sincronizar Dados de Producao Para Staging

Gerar usuarios espelho no Auth do staging, com os mesmos UUIDs da producao:

```bat
node scripts\sync-staging-auth-users.mjs
scripts\supabase-logosia-staging.cmd db query --linked -f "E:\Projetos - Antigravity\HUMANIZEIA\humanizeia\supabase\.temp\logosia-staging-auth-users.sql"
```

Copiar configuracoes, integracoes, agentes, Pedro/CRM, inbox, contatos, historicos, formularios e bases de conhecimento:

```bat
node scripts\sync-staging-from-production.mjs
```

Ativar secrets de functions que podem ser derivados das integracoes copiadas, como UAZAPI/Evolution e fallback Meta:

```bat
node scripts\build-staging-function-secrets.mjs
scripts\supabase-logosia-staging.cmd secrets set --project-ref ezoltigtqgbmftmiwjxh --env-file "E:\Projetos - Antigravity\HUMANIZEIA\humanizeia-staging\supabase\.env.staging.function-secrets.local"
```

O sync pula propositalmente tabelas de fila/runtime como `wa_queue`, `followup_queue`, `rule_execution_log`, `agent_executions`, `orchestrator_tasks`, `notifications`, `meta_capi_batches` e `meta_capi_events`.

## Comandos

Validar projeto Supabase staging:

```bat
scripts\supabase-logosia-staging.cmd projects list
scripts\supabase-logosia-staging.cmd functions list --project-ref ezoltigtqgbmftmiwjxh
```

Deploy de functions para staging:

```bat
scripts\supabase-logosia-staging.cmd functions deploy --project-ref ezoltigtqgbmftmiwjxh --no-verify-jwt
```

Build frontend apontando para staging:

```bat
npm.cmd run build -- --mode staging
```

## Checklist Antes de Subir Para Producao

- Build do staging passa.
- Site staging abre sem erro critico no console.
- Login/cadastro de teste funciona.
- Pedro aparece no painel.
- `ai_crm_leads` tem colunas `assigned_to_id`, `assigned_to_member_id`, `instance_id`, `message_count`, `ai_paused`, `status_crm`.
- `ai_team_members` tem `auth_user_id`.
- `wa_inbox`, `wa_ai_agents`, `ai_lead_transfers`, `pedro_crm_notes` existem.
- Edge Functions do staging estao ativas.
- Webhook de teste aponta para `https://ezoltigtqgbmftmiwjxh.supabase.co/functions/v1/...`.
- Nenhum webhook de teste aponta para o projeto de producao.
- Se testar WhatsApp, usar numero/instancia de teste.
- Se testar pagamento, usar Asaas sandbox.
- Se testar Meta/Google/LinkedIn, usar conta de teste.
- Pedro responde quando `ai_paused = false`.
- Pedro nao responde quando `ai_paused = true`.
- Inbox IA mostra texto e imagem.
- Vendedor cadastrado nao vira lead.
- Transferencia respeita fila/rodizio.
- Lead recorrente preserva vendedor anterior quando existir.

## Promocao Staging Para Producao

1. Fazer merge da feature em `staging`.
2. Rodar build e checklist no staging.
3. Revisar diff.
4. Fazer merge controlado para `main`.
5. Aplicar migrations em producao somente depois da validacao.
6. Deploy das Edge Functions de producao somente depois do banco estar pronto.
7. Monitorar Pedro, Inbox IA e CRM nas primeiras mensagens reais.

## Observacoes do Bootstrap Inicial

As migrations antigas do projeto tinham alguns problemas para recriar um Supabase do zero:

- arquivos fora de ordem cronologica;
- versoes duplicadas;
- uma migration com caracteres corrompidos em `notifications`;
- uma migration usando `CREATE POLICY IF NOT EXISTS`, sintaxe nao aceita pelo Postgres;
- tabelas/colunas que existiam na producao por evolucao manual, mas nao estavam no historico local.

Por isso foram criadas migrations de compatibilidade com correcoes seguras usando `IF NOT EXISTS`, incluindo `20260513001000_pedro_staging_schema_backfill.sql` e `20260513002000_staging_schema_compatibility.sql`.
