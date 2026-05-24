# Codex Brain - LogosIA

Este diretorio e a memoria local persistente deste projeto. Antes de iniciar qualquer nova sessao neste repositorio, leia este arquivo primeiro e use os demais arquivos como contexto de produto, arquitetura, deploy, decisoes e pendencias.

## Regras de uso

1. Leia `.codex-brain/00-index.md` no inicio de cada sessao neste projeto.
2. Antes de mudancas relevantes, consulte `contexto.md`, `arquitetura.md`, `decisoes.md`, `deploy.md` e `pendencias.md`.
3. Depois de mudancas importantes, atualize `historico.md` e, se necessario, `decisoes.md`, `pendencias.md`, `deploy.md` ou `runbook.md`.
4. Nunca salve tokens, senhas, chaves privadas, service role keys, PATs, API keys ou segredos reais aqui.
5. Se uma informacao sensivel for relevante, registre apenas o nome da variavel ou do segredo, nunca o valor.
6. Este cerebro pertence somente a este projeto e fica em `humanizeia/.codex-brain`.
7. Use este cerebro para evitar confundir producao, staging/base teste, Pedro, Marcos, regras de CRM e integracoes.

## Mapa dos arquivos

- `contexto.md`: produto, objetivo, agentes, regras de negocio e glossario.
- `arquitetura.md`: stack, estrutura do frontend, Supabase, Edge Functions, banco e integracoes.
- `decisoes.md`: decisoes tecnicas e de produto ja tomadas.
- `deploy.md`: fluxo de branch, build, Docker, Easypanel, Supabase e staging.
- `pendencias.md`: riscos, problemas conhecidos e proximos passos recomendados.
- `runbook.md`: comandos operacionais, checklist de alteracao, testes e rollback.
- `historico.md`: linha do tempo resumida das mudancas importantes.

## Estado atual resumido

- Projeto: LogosIA (`logosia-platform`) no repositorio `Agencia-Up/humanizeia`.
- Raiz real do repo: `E:\Projetos - Antigravity\HUMANIZEIA\humanizeia`.
- Produto: plataforma de atendimento, CRM e automacao comercial com IA no WhatsApp.
- Agentes centrais hoje: Pedro SDR, Marcos CRM & Leads, Jose Trafego Pago, alem de outros modulos/agents.
- Frontend: React 18 + Vite + TypeScript + Tailwind + shadcn/Radix.
- Backend principal: Supabase (Auth, Postgres, RLS, Edge Functions, Storage/Realtime quando aplicavel).
- Deploy frontend: GitHub `main` aciona Easypanel; Dockerfile compila Vite e serve via Nginx.
- Ambiente de teste/staging existe em diretorio separado `humanizeia-staging` e projeto Supabase separado.
- Importante: producao e staging nao devem ser misturados. Validar o ambiente antes de qualquer push ou deploy.

## Primeira leitura recomendada por tipo de tarefa

- Ajuste visual/frontend: leia `contexto.md`, `arquitetura.md`, `decisoes.md`.
- Mudanca em CRM/Pedro/Marcos: leia `contexto.md`, `arquitetura.md`, `decisoes.md`, `pendencias.md`.
- Mudanca em Supabase/Edge Functions/RLS: leia `arquitetura.md`, `deploy.md`, `runbook.md`, `pendencias.md`.
- Deploy ou GitHub/Easypanel: leia `deploy.md` e `runbook.md`.
- Incidente em producao: leia `runbook.md`, `pendencias.md`, `historico.md`.

