# Diário de Bordo: Refatoração Davi & Paulo (Storytelling e Copywriting)

## Data e Contexto
**Data:** 13 de Abril de 2026 (Sessão Noturna)
**Objetivo Original:** Elevar o nível das imagens e copy criadas pelo Paulo e Davi ao mesmo nível artístico e detalhado gerado naquele teste no ChatGPT (arquivo `Prompt usado.md`), abandonando imagens vazias e slides genéricos motivacionais.

---

## 1. O Nosso "Modus Operandi" (Protocolo de Deploy)
Para evitar que informações se percam amanhã, este é o nosso fluxo engessado e validado de trabalho:
1. **Frontend (GitHub):** Eu (Agente Antigravity) sempre aplico alterações diretamente no código Front-End (páginas, componentes, hooks), crio os commits usando `dev-aloan`, mesclo para a `main`, e então você faz o deploy normal via **Easypanel**.
2. **Backend (Edge Functions no Supabase):** Acesso direto ao Supabase não é possível por medidas de segurança da sua infraestrutura. Por isso, toda vez que uma lógica na *Edge Function* é modificada (exemplo: `social-media-api`), eu forneço no nosso chat o bloco de código exato `(index.ts)`, e **você deve copiar e colar manualmente** no dashboard web do Supabase.

---

## 2. Avanços Obtidos Hoje
* **Visuais e UI:** Entregamos a **Barra de Progresso** no gerador do Davi. Agora o usuário vê visualmente `RENDERIZANDO 2/5`. O looping infinito de telas pretas quando a Pollinations falhava (Status 429) foi corrigido com uma tolerância à falha (espera e recarrega).
* **Descoberta do Vilão Invisível:** Detectamos que a arquitetura do "Auto-Piloto" (Davi) estava estrangulando o contexto. A *Edge Function* antiga castrava as pautas do Copywriter a um máximo de *800 caracteres*, e forçava lógicas como *máximo 120 letras por slide*, aniquilando qualquer raciocínio profundo que o Claude (Paulo) pudesse ter. Nós estendemos e liberamos este limite brutal.

---

## 3. Frustrações e Bloqueios
Apesar de tirarmos as amarras do sistema, o Paulo e o Davi ainda geraram conteúdos "bosta" (como pontuado por você). 
* **O Problema Visual:** O resultado fica parecendo imagens soltas e artificiais empilhadas em uma interface, distantes do tom grandioso de narrativa (Storytelling). 
* **Pobreza Cognitiva:** Mesmo recebendo meu *System Prompt* exigindo um Diretor de Arte avançado, as IAs limitaram muito as frases de efeito ("Carros elétricos não são tão caros", "Descubra a verdade"). Não teve o peso literário poético do exemplo do ChatGPT ("O sedã elétrico cerâmico descendo o trajeto ladeado de árvores na aurora..."). Eles lutam para fornecer Copy genial quando estão espremidos em uma caixa JSON.

---

## 4. O Caminho (Solução Sugerida para Amanhã)

Ao forçarmos o LLM (como o Claude e GPT-4o) a cuspir os dados OBRIGATORIAMENTE em um *Schema JSON* altamente particionado (`headline`, `body`, `image_prompt`), cortamos pela metade a "fluência" e raciocínio literário dele. A IA deixa de agir como um Marqueteiro para atuar como um *robozinho formatador de código*.

**O Novo Plano:**
Para criar uma copy no nível do *ChatGPT* (que escreveu em Markdown livre), nós vamos reformular a cadeia de pensamento completa amanhã usando a **"Chain of Thought - Duas Etapas"**.

1. **A Extinção da Prisão do JSON (Step 1):** Amanhã vamos instruir o Paulo a produzir um texto 100% corrido (Markdown), com narrativas densas — literalmente imitando a estrutura exata do GPT. Sem pensar em limites de array!
2. **O Funil de Extração (Step 2 - Inteligência Embutida):** Lemos o texto rico recém-escrito do Paulo e, aí sim, forçamos um script oculto (do Davi) a apenas "montar" aqueles parágrafos magistrais nos formatos separados para a tela renderizar, preservando 100% da poesia.
3. **Novos Layouts Front-end:** As imagens da Pollinations são fantásticas quando o prompt é rico, mas o bloqueio preto escuro com as escritas brancas que usamos no layout `glass_overlay` no Davi às vezes mata a estética da arte. Pode ser prudente amanhã estudarmos dar vida própria para a foto falar por si mesma.

*Pronto para seguir amanhã a partir daqui.*
