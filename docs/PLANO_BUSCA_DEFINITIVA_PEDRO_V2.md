# Plano de Ação — Busca de Estoque DEFINITIVA do Pedro v2

> Objetivo: parar o ciclo de "remendo por typo" e deixar a busca **inteligente de verdade**,
> sem bugar o que já funciona. Autor: dev-aloan. Data: 2026-06-08.

---

## 1. A verdade da arquitetura (fundamentada no código real)

- O Pedro busca o estoque **AO VIVO** na API GraphQL externa do BNDV
  (`https://api-estoque.azurewebsites.net/graphql`, query `vehiclesBy`).
- Essa query **não tem filtro no servidor** → o BNDV devolve a **lista inteira** de veículos
  do lojista (token por loja em `platform_integrations`).
- **Todo o "matching" acontece DEPOIS, em JS** (`stockSearch_20260525_photo_flow.ts`):
  `normalizeText` (mapa de apelidos), `WEAK_WORDS`, `levenshtein/tokenSimilarity`,
  `scoreVehicle` (dezenas de regrinhas) + os reforços recentes do Codex.
- Os carros **NÃO estão no nosso Postgres** → `pg_trgm no nosso banco` **não se aplica direto**.
- O estoque é **pequeno** (~24-50 carros/loja). Logo: o problema **não é velocidade, é QUALIDADE do matching.**

### Por que o jeito atual nunca "termina"
A pilha atual **adivinha** se cada palavra é um modelo e mantém **listas de typo/palavras-fracas
escritas à mão**. Cada novo typo, lojista ou modelo exige uma regrinha nova. É o "cambiarras".

---

## 2. A virada (RECOMENDADA): um motor único que GENERALIZA, contra o estoque REAL

**Princípio central:** em vez de adivinhar se "flontie" é um modelo, perguntamos:
> "flontie" se parece com algum modelo que **ESTE lojista REALMENTE tem no estoque**?

O próprio inventário (que já vem do BNDV a cada busca) vira o **dicionário**:
- `flontie` ~ `frontier` (existe no estoque) → casa por **similaridade**, sem lista de typo.
- `preta` / `entrada` → não se parecem com nenhum modelo real **e** estão num **léxico finito
  de não-modelos** (cores, termos de pagamento, saudações) → nunca viram modelo.
- Funciona para **qualquer lojista** automaticamente (cada um tem seus modelos reais).

### Componentes
1. **Módulo único `vehicleMatch.ts`** (substitui a pilha espalhada):
   - 1 função de normalização canônica (acento, caixa, separadores).
   - **Similaridade (trigram + Jaro-Winkler)** entre os tokens da fala e os modelos/marcas
     **reais do inventário vivo** — sem mapa de apelidos por typo.
   - **Léxico finito de categorias não-modelo** (cores, pagamento/financiamento, saudações,
     filler) como **DADO versionado** — estável, não cresce por typo.
   - Score = melhor similaridade de modelo + bônus de marca/ano/versão + filtros numéricos
     (faixa de preço/km/ano), com **limiar claro** e camada "provável/aproximado"
     (não dizer "não temos" sem necessidade).
   - Resolução de tipo (carro/moto/picape/suv/sedan/hatch) por **tabela de categorias** (consolidar a que já existe).
2. **Bateria de testes de verdade (`vitest`)**: todos os casos auditados
   (flontie, disel, mini cooper, preta, entrada, frontier, anúncio com preço divergente,
   "o que tiver de picape", "qual o valor que você tem") + **testes de propriedade**
   (palavra comum NUNCA vira modelo; typo de 1-2 letras de um modelo real SEMPRE casa).
3. **Camada fina de compatibilidade**: orchestrator/planner ficam iguais; trocamos só o "miolo"
   do matching. As redes de segurança do Codex que **não são typo-list** (trava de mídia,
   força-busca em pergunta objetiva, busca ampla) **permanecem**.

### Por que é definitivo (e não mais um remendo)
- Acaba a manutenção de listas de typo — a similaridade **generaliza**.
- O dicionário é o **estoque real** → zero config por lojista.
- **Um** módulo testado, em vez de regrinhas espalhadas em 5 arquivos.

---

## 3. Alternativa — Opção B (espelho local + pg_trgm)

Sincronizar o estoque do BNDV numa tabela local (`bndv_stock_cache`, por lojista) a cada ~15min
via cron, com índice `pg_trgm`, e o Pedro consultaria a tabela com `similarity()`.
- **Vantagem:** fonte única para dashboard/analytics, menos chamadas ao BNDV, fuzzy no banco.
- **Custo:** job de sync + **migração** (você aplica — eu não tenho a senha do banco) +
  **risco de defasagem** (carro vendido ainda no cache).
- **Recomendação:** **NÃO agora.** O matching em si fica igual (mesma lógica de similaridade,
  só que em SQL, e ainda com o problema preta/creta). Fazer só se quisermos o espelho local
  por OUTROS motivos (dashboard). A virada da Seção 2 resolve o que dói hoje, sem essa infra.

---

## 4. Faseamento seguro (staging-first, sem bugar o que funciona)

- **Fase 0 — Casos de teste reais (SEM deploy):** levantar de `pedro_v2_turn_logs` as buscas
  que falharam nos últimos ~30 dias → vira a suíte de testes "verdade".
- **Fase 1 — Motor novo isolado + testes (SEM ligar no fluxo vivo):** escrever `vehicleMatch.ts`
  + suíte `vitest`. Verde local. Nada em produção.
- **Fase 2 — Ligar atrás de feature-flag (kill-switch):** `PEDRO_FF_NEW_MATCH='on'`, default OFF.
  Deploy em **STAGING** (`ezoltigtqgbmftmiwjxh`) primeiro.
- **Fase 3 — Sombra / dry-run comparativo:** rodar as MESMAS falas reais nos **dois** motores
  (antigo vs novo) e comparar lado a lado. Só seguimos se o novo for **≥** o antigo em todos os
  casos auditados e **não regredir nenhum**.
- **Fase 4 — Produção gradual:** flag ON em prod, monitorar logs reais por alguns dias com
  kill-switch pronto. Qualquer problema → desliga a flag (volta ao antigo **na hora**, sem deploy).
- **Fase 5 — Aposentar a pilha antiga:** depois de estável, remover as listas de typo/heurísticas mortas.

---

## 5. Controles de risco (regras do dev-aloan)

- Diagnóstico só de **log/dado real**; nada de chute.
- Tudo validado por **dry-run** antes de qualquer ON.
- **Staging antes de prod**; deploy sempre do `main`.
- **Kill-switch** (flag) → rollback instantâneo sem deploy.
- **Nunca** regride o que funciona (a Fase 3 trava isso objetivamente).
- Português no código e nos comentários.
- Só dev-aloan mexe no Pedro v2 (anti-clobber com Antigravity/Codex).

---

## 6. Alavancas paralelas (fora do escopo deste plano de BUSCA, mas anotadas)

- **Cérebro mais esperto:** o planner roda em `gpt-4o-mini`. Subir o planner para `gpt-4o`
  melhora entendimento de intenção (ex.: despedida → encerrar + transferir; "qual o valor?"
  com contexto). É outra alavanca, independente da busca.
- **Despedida → encerrar + transferir** (imagens 1 e 2 do print): é regra de **brain/transfer**,
  não de busca. Tratar num plano à parte.

---

## 6.5. Fase 0 — RESULTADOS (dados reais, `pedro_v2_turn_logs`, 2026-05 a 06-08)

> Decisão tomada com o usuário: **motor único (Seção 2)** + **subir planner para gpt-4o**.

**Números crus:** de **389** turnos de busca, **162 (42%) voltaram ZERO resultado.** Mas, cruzando
com o **inventário real da Icom (24 carros**; mais barato Peugeot 207 R$22.990, depois pula p/ Kwid
R$55.990 — **nada entre R$23k e R$55k**), a maioria dos "zeros" **NÃO é bug de matching**:

| Bucket | Exemplos reais | É bug? | Onde resolve |
|---|---|---|---|
| **B1. Sem modelo / "mais carros" / faixa** | "Vc tem mais carros", "carro na faixa de 30-40 mil" | **SIM (parcial)** | regra "sem modelo → mostrar estoque"; widening do trigger |
| **B2. Faixa de preço vazia** | "15 a 20 mil" (nada abaixo de 22.9k) | resposta ruim | oferecer **o mais próximo**, não "não temos/qual modelo" |
| **B3. Modelo real com typo/formato sujo** | "unos.200.13" (Uno 2013), "flontie" | **SIM** | **motor de matching** (Seção 2) |
| **B4. Anúncio TEM modelo mas busca 0** | ad "Peugeot 207" → 0 | **SIM** | extração de ad_context |
| **B5. Intenção mal classificada** | "só a SPIN pra dar de entrada" (troca), "Lindo o carro" | **SIM** | **planner gpt-4o** + gating de intenção |
| **B6. Sem modelo no anúncio / ruído** | "Olá, tenho interesse" + ad genérico, URLs | **NÃO** | comportamento correto (saudar + perguntar) |
| **B7. Realmente não tem no estoque** | "palio 1.4", "Honda ou corolla", "Stepway" | **NÃO** | "não temos" está **CERTO** (sem alucinar) |

**Conclusão honesta:** o motor de matching (B3) é real, mas **não é o maior balde**. Os maiores ganhos
de venda são **B1+B2 (sem-modelo/faixa → mostrar estoque ou o mais próximo)** e **B5 (intenção, gpt-4o)**.
E há uma boa notícia: nos casos B7 o agente **acerta** ("não temos" quando realmente não tem) — não está alucinando.

### Reprioridade de execução (por impacto em venda × risco)
1. **B1+B2** — qualquer turno de intenção-de-estoque **sem modelo** → mostrar estoque (filtrado por preço/tipo);
   se a faixa exata estiver vazia, **oferecer o mais próximo**. Nunca "qual modelo?"/"não temos nessa faixa" seco.
2. **Motor único `vehicleMatch.ts` (B3)** — typos/formatos sujos por similaridade contra o estoque real.
3. **Intenção (B5) — RESOLVIDO via LÓGICA, não troca de modelo (v71c).** Medido mini vs gpt-4o vs
   DeepSeek (5 casos): EMPATAM em intenção (todos erravam "Lindo demais esse carro" → gap de
   prompt/lógica, não de modelo). Custo: mini $0.0018 < DeepSeek $0.0034 (2x) < gpt-4o $0.0304 (17x)
   → **mantido gpt-4o-mini**. Causa real: o resolver tratava "carro" (genérico) como sinal de veículo
   e a rede de segurança forçava busca, sobrescrevendo o reply_only correto do LLM. Fix:
   `isPureVehicleComment` (elogio/comentário sem pedido de info NÃO força busca). Infra DeepSeek/gpt-4o
   fica ligável por env (PEDRO_PLANNER_PROVIDER/MODEL) + `_planner_meta` mede custo/latência.
4. **ad_context (B4)** — quando o anúncio traz modelo, buscar esse modelo.

## 7. O que preciso de você

1. Aprovar a **abordagem recomendada** (Seção 2 — motor único que generaliza) **ou** a Opção B (Seção 3).
2. Com o "ok", eu começo pela **Fase 0/1 sem tocar no fluxo vivo** e te mostro a suíte de testes
   + o motor novo **antes de ligar qualquer coisa**.
