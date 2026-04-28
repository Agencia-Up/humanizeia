# Guia de Gerenciamento e Deploy de Edge Functions (Supabase)

Este guia foi criado para auxiliar agentes de IA (como Codex, Cursor, etc) e desenvolvedores a editarem e publicarem Edge Functions diretamente no banco de dados Supabase do projeto HumanizeIA.

> [!IMPORTANT]
> A autenticação com o Supabase CLI já está configurada neste ambiente local. Não é necessário rodar `supabase login` novamente a menos que o token expire.

## 1. Onde estão os arquivos?
Todas as Edge Functions ficam armazenadas no diretório:
`e:\Projetos - Antigravity\HUMANIZEIA\humanizeia\supabase\functions\`

Cada função possui sua própria pasta (ex: `uazapi-webhook`, `knowledge-embed`). Dentro de cada pasta, a lógica principal sempre reside no arquivo `index.ts`.

## 2. Como Editar o Código
- As Edge Functions rodam em um ambiente **Deno**, então você verá importações no formato de URL (ex: `https://esm.sh/...`).
- Ao realizar manutenção, foque sempre no arquivo `index.ts` da função alvo. 
- *Atenção:* Testes de compilação com o Node (`tsc`) vão apontar erros falsos nas importações, pois o ambiente é Deno.

## 3. Como Fazer o Deploy (Comando Exato)
Como não há Docker rodando nativamente na máquina para validação local robusta das funções, nós fazemos o deploy e a validação pulando verificadores que causariam falha (como o JWT verify).

Após editar qualquer arquivo `index.ts`, abra o terminal, garanta que está no diretório raiz (`e:\Projetos - Antigravity\HUMANIZEIA\humanizeia`) e rode o comando padrão:

```powershell
npx supabase functions deploy <NOME_DA_FUNCAO> --project-ref seyljsqmhlopkcauhlor --no-verify-jwt
```

**Exemplos Práticos:**
- Deploy do webhook do Uazapi:
  `npx supabase functions deploy uazapi-webhook --project-ref seyljsqmhlopkcauhlor --no-verify-jwt`
- Deploy do motor de base de conhecimento:
  `npx supabase functions deploy knowledge-embed --project-ref seyljsqmhlopkcauhlor --no-verify-jwt`

> [!TIP]
> O parâmetro `--no-verify-jwt` é crucial. Sem ele, a CLI pode bloquear o deploy reclamando de falhas locais na validação de tokens da Edge Function.

## 4. Onde Ver os Logs de Erro
Caso a função quebre ou não esteja executando como o esperado:
1. Abra o painel do Supabase no navegador.
2. Acesse: `https://supabase.com/dashboard/project/seyljsqmhlopkcauhlor/functions/`
3. Clique na função correspondente (ex: `knowledge-embed`) e abra a aba **Logs**.
4. Procure por `Exceptions` ou analise os `console.log` que você espalhou pelo código.

## 5. Checklist para IAs (Codex, Cursor, etc)
1. **Sempre verifique os logs via Browser/Terminal** se a lógica estiver falhando silenciosamente no front-end.
2. Não altere chaves do tipo `SUPABASE_SERVICE_ROLE_KEY` nos códigos. Elas são injetadas automaticamente pelo `Deno.env.get()`.
3. Lembre-se que as Edge Functions não se atualizam sozinhas ao salvar o arquivo localmente. **Sempre dispare o comando de Deploy** após finalizar sua refatoração.
