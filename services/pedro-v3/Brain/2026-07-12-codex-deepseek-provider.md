# Pedro v3 - provider DeepSeek (F2.53)

Data: 2026-07-12

## Objetivo

Permitir que o mesmo Pedro v3 `central_active` use DeepSeek sem bifurcar o agente. A troca altera apenas
credencial, endpoint, modelo e o nome do parametro de limite de tokens. Prompt integral, AgentBrain,
TurnUnderstanding, ferramentas, memoria, policies de seguranca, CRM, handoff e follow-up continuam sendo
os mesmos componentes.

## Arquitetura

- `PEDRO_V3_AI_PROVIDER=openai|deepseek` seleciona o provider; default `openai` preserva producao atual.
- `resolveAiProviderRuntime` e a fonte unica de endpoint, host permitido, modelo, retry model e parametro
  de tokens.
- A chave continua BYOK e tenant-scoped por `get_client_ai_key(provider)`, com o mesmo fallback de
  plataforma para contas grandfathered. Nenhuma chave entra em env, log, estado, outbox ou JSON.
- O adapter existente de Chat Completions e reutilizado. DeepSeek usa
  `https://api.deepseek.com/chat/completions` e `max_tokens`; OpenAI preserva
  `https://api.openai.com/v1/chat/completions` e `max_completion_tokens`.
- `/health` expoe apenas `aiProvider` e `aiModel`, nunca a credencial.
- O harness real usa a mesma configuracao do runtime. Para DeepSeek, aceita somente
  `EVAL_DEEPSEEK_API_KEY` como override de teste; `EVAL_OPENAI_API_KEY` nao vaza entre providers.

## Invariantes

1. Nao existe engine DeepSeek, policy DeepSeek ou prompt DeepSeek.
2. O provider nao decide quando buscar estoque, fotos, CRM ou transferir.
3. Provider/modelo desconhecido falha fechado antes de processar o turno.
4. A credencial e opaca e so materializada no header Authorization do request HTTPS allowlisted.
5. OpenAI permanece byte-compativel quando `PEDRO_V3_AI_PROVIDER` esta ausente.

## Provas offline

- `test:f253`: contrato do provider, segredo, BYOK, endpoint, body e health.
- `test:tenant-openai-key`: compatibilidade da resolucao BYOK existente.
- `tsc --noEmit` e `test:all`: regressao completa.

## Estado factual da credencial em 2026-07-12

As tres fontes OpenAI do piloto responderam `429 insufficient_quota`. A consulta read-only do tenant piloto
nao encontrou chave DeepSeek propria nem chave DeepSeek de plataforma. Por isso um smoke real DeepSeek
nao pode ser executado ainda; afirmar PASS real sem a chave seria falso.

## Ativacao supervisionada

1. No portal, salvar novamente uma chave DeepSeek para a conta/tenant do piloto.
2. Confirmar por uma consulta opaca que `get_client_ai_key(..., 'deepseek')` retorna valor configurado,
   sem imprimir o segredo.
3. Rodar barato, efeitos OFF:
   `PEDRO_V3_REAL_EVAL=1 PEDRO_V3_AI_PROVIDER=deepseek npm run smoke:f252`.
4. Exigir jornada completa, tools corretas, zero fallback tecnico, CRM/handoff apenas nos atos corretos.
5. Commit/push e adicionar no EasyPanel `PEDRO_V3_AI_PROVIDER=deepseek`; opcionalmente
   `PEDRO_V3_DEEPSEEK_MODEL=deepseek-chat`.
6. Conferir `/health`: `configuredBrainMode=central_active`, `aiProvider=deepseek`,
   `aiModel=deepseek-chat`.
7. Testar uma conversa no WhatsApp do piloto antes de considerar producao.

Rollback: `PEDRO_V3_AI_PROVIDER=openai` e redeploy. Nenhuma migracao de estado ou banco e necessaria.
