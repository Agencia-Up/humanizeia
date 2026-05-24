# Runbook

## Inicio de sessao

1. Ler `.codex-brain/00-index.md`.
2. Ler arquivos relacionados ao tipo de tarefa.
3. Conferir diretorio:

```powershell
cd "E:\Projetos - Antigravity\HUMANIZEIA\humanizeia"
```

4. Conferir estado do Git:

```powershell
git status --short
```

5. Identificar se a tarefa e producao ou staging/base teste.

## Checklist antes de alterar

- Confirmar escopo exato com o pedido mais recente do usuario.
- Verificar arquivos alterados existentes para nao sobrescrever trabalho de outra pessoa.
- Se envolver Pedro/Marcos, revisar `contexto.md` e `decisoes.md`.
- Se envolver banco/functions, revisar `arquitetura.md`, `deploy.md` e `pendencias.md`.
- Nunca abrir/copiar valores de `.env`, `secrets.txt` ou tokens para o chat/cerebro.

## Rodar localmente

```powershell
npm.cmd run dev -- --host 127.0.0.1
```

URL padrao:

```text
http://127.0.0.1:5200
```

## Build

```powershell
npm.cmd run build
```

Se passar com avisos conhecidos, registrar apenas se forem relevantes para a tarefa.

## Commit e push producao

Somente quando o usuario pedir para subir:

```powershell
git status --short
git add <arquivos-do-escopo>
git commit -m "mensagem objetiva"
git fetch origin
git rebase origin/main
npm.cmd run build
git push origin main
```

Se houver conflito:

1. Ler os arquivos conflitantes.
2. Preservar mudancas remotas e locais quando possivel.
3. Nao apagar mudancas que nao foram feitas por voce sem autorizacao.
4. Rodar build apos resolver.

## Deploy Supabase

Antes de qualquer acao:

- Confirmar ambiente: producao ou staging.
- Confirmar projeto Supabase.
- Conferir migrations/functions afetadas.
- Evitar deploy de functions nao relacionadas.

Scripts conhecidos:

```powershell
cmd /c scripts\supabase-logosia.cmd
cmd /c scripts\supabase-logosia-staging.cmd
```

Nao registrar tokens. Se precisar de segredo, orientar o usuario a configurar no Supabase/Easypanel sem colar no codigo.

## Testes manuais criticos

Pedro:

- Novo lead entra em `Novo`.
- IA responde lead real e nao vendedor.
- Transferencia manual envia feedback e nao retorna `Lead not found`.
- Transferencia automatica respeita fila.
- Vendedor responde `ok` e lead e atribuido pelo telefone.
- Vendedor nao entra como lead.
- Lead recorrente volta ao mesmo vendedor quando possivel.

Marcos:

- Gerente ve CRM, contatos, campanhas, instancias e performance.
- Vendedor adiciona/importa lead e vendedor responsavel e preenchido.
- Vendedor conecta instancia Uazapi dentro das regras do plano.
- Campanha cria, agenda, envia texto e midia.
- Variacoes IA nao preenchem indevidamente `Mensagem Fixa`.
- Follow-up envia texto e midia sem duplicar.
- Exclusao em massa de listas funciona para gerente e vendedores.

## Incidente em producao

1. Parar e entender sintoma com prints/logs.
2. Verificar se problema e frontend, Edge Function, banco/RLS, Uazapi/BNDV ou quota externa.
3. Reproduzir local/staging quando possivel.
4. Corrigir com menor escopo.
5. Build local.
6. Push/deploy somente se solicitado ou se for emergencia autorizada.
7. Atualizar `historico.md` e `pendencias.md`.

