# Deploy

## Repositorio

- GitHub: `Agencia-Up/humanizeia`.
- Branch de producao: `main`.
- Branch/diretorio de teste: existe fluxo de staging/base teste separado (`humanizeia-staging` no workspace e projeto Supabase separado).

## Deploy frontend em producao

O deploy do frontend e feito pelo Easypanel a partir do GitHub.

Fluxo comum:

1. Conferir escopo com `git status --short`.
2. Rodar build local: `npm.cmd run build`.
3. Fazer commit com mensagem objetiva.
4. Fazer `git fetch origin` e integrar remoto se necessario.
5. Push para `main`.
6. Easypanel detecta o push e faz deploy.

## Build Docker

`Dockerfile`:

- Usa `node:20-alpine` para build.
- Executa `npm ci`.
- Recebe build args:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_SUPABASE_PROJECT_ID`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`
- Executa `npm run build:prod`.
- Copia `dist/` para imagem `nginx:alpine`.

`nginx.conf`:

- Serve SPA em `/usr/share/nginx/html`.
- Usa `try_files $uri $uri/ /index.html` para React Router.
- Cache forte para assets estaticos.

## Scripts principais

No `package.json`:

- `npm.cmd run dev`: inicia Vite.
- `npm.cmd run build`: build Vite padrao.
- `npm.cmd run build:prod`: build Vite em modo production com log reduzido.
- `npm.cmd run build:dev`: build em modo development.
- `npm.cmd run lint`: ESLint.
- `npm.cmd run preview`: preview Vite.
- `npm.cmd test`: Vitest.
- `npm.cmd run preview:features`: testes de features preview.
- `npm.cmd run chat:local`: script local de chat.

Scripts utilitarios:

- `scripts/supabase-logosia.cmd`: operacoes Supabase producao.
- `scripts/supabase-logosia-staging.cmd`: operacoes Supabase staging.
- `scripts/sync-staging-from-production.mjs`: sincroniza staging a partir de producao.
- `scripts/sync-staging-auth-users.mjs`: sincroniza usuarios auth para staging.
- `scripts/git-push.cmd`, `scripts/git-logosia.cmd`: helpers de Git.
- `scripts/build-staging-function-secrets.mjs`: helper de secrets de function para staging.

## Supabase deploy

- Config local: `supabase/config.toml`.
- Producao `project_id`: `seyljsqmhlopkcauhlor`.
- Migrations em `supabase/migrations`.
- Functions em `supabase/functions`.

Cuidados:

- Antes de aplicar migration, confirmar se esta apontando para producao ou staging.
- Nao rodar scripts de staging contra producao.
- Nao copiar valores de `.env`/tokens para documentacao.
- Para Edge Functions, confirmar variaveis de ambiente no Supabase antes de deploy.

## Ambiente local

Com dependencias instaladas:

```powershell
cd "E:\Projetos - Antigravity\HUMANIZEIA\humanizeia"
npm.cmd run dev -- --host 127.0.0.1
```

Porta padrao no `vite.config.ts`: `5200` com `strictPort: true`.

URL local:

```text
http://127.0.0.1:5200
```

Build local:

```powershell
npm.cmd run build
```

## Avisos conhecidos do build

O build pode passar com avisos existentes:

- Browserslist/caniuse-lite desatualizado.
- Tailwind nao gera uma utility de `bg-[radial-gradient(...theme(colors.primary/0.15)...)]`.
- `ConnectionsTab.tsx` tem `case` duplicado para `instagram_publisher`.
- Aviso de chunk/dynamic import em `dynamicFields`.

Esses avisos devem ser tratados em tarefa separada, pois nao necessariamente quebram producao.

