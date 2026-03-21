# Prompt para o Wander colar no Claude Code / Cursor

**Instrução:** Copie o texto abaixo (exatamente como está) e envie para a sua Inteligência Artificial (Claude Code, Cursor ou GPT):

---
Copiar Texto Abaixo 👇
---

**Contexto:**
Nós acabamos de profissionalizar o fluxo de trabalho do nosso projeto HumanizeAI no GitHub para suportar escala e deploy seguro no Vercel. A partir de agora, nós vamos trabalhar no formato de "Branches de Desenvolvimento Isoladas".

O Douglas já está trabalhando na branch `dev-douglas` e já preparou a minha branch pessoal de trabalho `dev-wander`.

**O seu objetivo (AI) agora é:**
1. Acessar o meu terminal e rodar o comando para puxar as novidades do repositório remoto (`git fetch --all`).
2. Mudar a minha área de trabalho para a minha branch oficial de desenvolvimento rodando: `git checkout dev-wander`. Se ela não existir localmente por algum motivo, crie ela espelhando a que já está no GitHub (`git checkout -b dev-wander origin/dev-wander`).
3. Confirmar pelo terminal que estamos apontando para a branch `dev-wander` com `git status`.
4. Garantir que as dependências (`npm install`) estão atualizadas no meu computador.

A partir desse ponto, todo código novo que nós construirmos para as minhas ferramentas (Agent, Meta Ads, etc.) você vai sempre enviar com `git add .` e `git commit` para a branch **`dev-wander`**, NUNCA para a `main`.

Quando terminarmos grandes módulos, eu mesmo ou o Douglas vamos abrir um *Pull Request* da `dev-wander` para a `main` lá no painel do GitHub, para que o Vercel atualize a produção de forma controlada.

Gere essa configuração inicial agora na minha máquina.
