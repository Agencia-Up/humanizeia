# R12-B — Deferimento de slot + condução natural quando o lead ignora o funil (Claude executor) — 2026-07-02

> Continuação a partir do commit `05b5339e` (R12-A em produção só no piloto tenant ecb26258 / agente d4fd5c38).
> NÃO commitado/deployado. Sem SQL. Regras honradas: sem `if` por frase; sem afrouxar grounding; sem tocar
> Pedro v2/bridge/webhook/CRM; sem limpar conversas do piloto.

## Problema
O agente podia ficar preso perguntando um slot (ex.: nome) enquanto o lead demonstrava intenção comercial clara
("Qual seu nome?" → "Tem SUV automático?" → repergunta o nome). Após R12-A, o deferimento vivia só no
`applySdrConduction` (legado, que só pega photo/ranking/ordinal), então o caminho moderno (frame→compose→reconcile)
NÃO deferia — o frame guiava o LLM a reperguntar o slot pendente todo turno → SLOT_FIXATION (s2 T7–T10 no R12-A).

## Desenho — fonte ÚNICA `decideFunnelNext` (sem `if` por frase, invariante geral)
`src/engine/sdr-conductor.ts`: nova função PURA `decideFunnelNext(state, policy)` que TODOS os caminhos consultam:
- Se não há pendente / o pendente foi respondido / o funil já seguiu → **normal** (`nextSlot = view.nextSlot`).
- Se o funil quer REPERGUNTAR o slot pendente (não respondido) → território de deferimento:
  - `deferrals < DEFER_LIMIT(=1)` → **defer**: `nextSlot=null` (não empurra pergunta), emite `defer_objective`.
  - `deferrals >= 1` e há outro slot faltante → **advance**: `nextSlot=próximo diferente`, emite `supersede_objective`.
- **DEFER_LIMIT=1 é deliberado:** mantém `deferrals` < 2 (⇒ OBJECTIVE_STARVED=0) e o mesmo slot < 3× seguidas
  (⇒ SLOT_FIXATION=0), dando ao lead 1 turno extra antes de o funil seguir.

Consumidores (TODOS os caminhos comerciais respeitam a MESMA decisão — invariante 11):
1. **`conductDecision` (frame guidance)** — passa `nextSlot`/`deferredSlot` ao frame; guidance `[DEFERIR]`/`[DEFERIR+AVANCAR]`.
2. **`reconcileObjectiveWithQuestion` (mutações)** — recebe `policy`; se 0 perguntas e o funil pedia o pendente,
   emite `defer_objective` (conta) ou `supersede_objective` (avança). Só supersede pendente **diferente E não
   respondido** (fix: não sobrescreve "satisfied" por "superseded" quando o lead acabou de responder).
3. **`applySdrConduction` (legado photo/ranking/ordinal)** — alinhado ao mesmo `DEFER_LIMIT` (não persiste deferrals≥2).
4. **`adjustDraftSafeguards` (backstop determinístico)** — se o LLM DESOBEDECE e pergunta o slot deferido, corrige o
   DRAFT antes de renderizar (defere=remove a pergunta mantendo a resposta; avança=troca pela próxima). Garante
   SLOT_FIXATION=0 mesmo com o LLM ignorando a guidance.

`sdr-conduction-frame.ts`: aceita `nextSlot`/`deferredSlot`; `[DEFERIR]`/`[DEFERIR+AVANCAR]` mandam "responda a
intenção PRIMEIRO, NÃO repita '{slot}'". `conversation-engine.ts`: passa `policy` ao reconcile.

## Testes
- NOVO `tests/run-f2-11-slot-deferral-conduction.ts` (`test:f211`) — **37 OK**. Casos A–J + K(continuity) + L(rajada)
  + backstop, pelo engine REAL in-memory com `sdrPolicy` + `currentObjective` semeado (o deferimento lê o objetivo
  ATIVO, ativado por receipt em produção). Cobre os 4 caminhos: runTurn (A/E/G/H), explicit_offer (B/C), more_options
  (D), continuity_conduct (K), preço/detalhe (F). Prova: A resolve; B defere (deferrals=1) sem virar nome; C avança
  (supersede) sem travar; D preserva filtros; E resolve troca=false; F responde preço sem inventar troca; G acelera
  sem handoff; H anúncio precede transferência; I bloqueia REASK; J sem objetivo artificial.
- Sem regressão: `run-f2-10` **30 OK**, `f29` 34, `f28` 166, `f2714` 49, `f2711` 46, `f2713` 45.

## Gates offline (VERDES)
- `tsc --noEmit` → **EXIT 0**. `npm run test:all` → **EXIT 0**, 0 FALHA (F2.11=37 novo).

## Eval real (gpt-4.1-mini, temp 0.7, efeitos OFF, prompt integral SHA 009edd16)
**Direcionado s2,r3** (69 chamadas 2xx) e **matriz s1,s2,s3,r2,r3** (205 chamadas 2xx):
| cenário | judge (r1/r2) | críticas |
|---|---|---|
| s1 | 56/85 | 2/1 |
| s2 | 65/75 | 3/2 |
| s3 | 80/69 | 0/0 |
| r2 | 77/70 | 0/0 |
| r3 | 65/38 | 0/0 |

## ACEITE (determinístico — o veredito, não o judge)
- ✅ **SLOT_FIXATION = 0** (matriz inteira; s2 tinha 2 no R12-A).
- ✅ **REASK_KNOWN_SLOT = 0**.
- ✅ **OBJECTIVE_STARVED = 0**.
- ✅ **Nenhum terminal-safe causado pela condução R12-B** — os 8/76 são pré-existentes: 2 POL-ATTR-VALUE (cor/câmbio),
  2 POL-GROUND-STOCK (ONIX), 1 POL-GROUND-PRICE, 2 POL-QUESTION-OBJECTIVE (pergunta empilhada, advisory), 1 POL-COMPOSE-FAIL (infra).
- ✅ **Sem regressão nos 30 testes do R12-A** + continuity intacto (s1 run2=85).

## PROVA do deferimento (transcrição real, s2 run1)
- T1 "Quero sedan…" → oferta + pede **nome**. T2 "**prefiro hatch automático**" → oferta do hatch **SEM repetir nome**
  (antes reperguntava todo turno). T4 "mais opções" → **avançou para troca**. T8 "qual o valor dele?" → **avançou para
  veiculoTroca**. Nenhuma sequência de 3 perguntas do mesmo slot. **Fixação eliminada, funil segue.**

## Falhas restantes (honestas)
1. **OBJECTIVE_REPLACED_WITHOUT_SUPERSEDE = 31 (warn)** — dominado por `nome→possuiTroca` (6×, o AVANÇO do
   deferimento) e transições afins. São supersedes LEGÍTIMOS (o F2.11 caso C prova que `supersede_objective` é
   emitido); o detector rotula errado porque checa MUDANÇA DE SLOT, não a mutação supersede (mesma limitação notada
   no R11). Como R12-B avança objetivos de propósito, o warn sobe. **Follow-up: tornar o detector supersede-aware.**
2. **Bounce de objetivo** (`possuiTroca→nome` 2×) — nome ressurge no topo do funil após ser superseded, AMPLIFICADO
   por um bug PRÉ-EXISTENTE: "Quero o terceiro" setou `possuiTroca=true` espúrio (ordinal/lead-extraction, área Codex).
   **Follow-up R12-C: de-priorizar slot recém-superseded na ordem do funil.**
3. **"Responda a intenção primeiro" nem sempre honrado** — no avanço, o LLM às vezes troca a resposta pela pergunta
   do próximo slot (ex.: s2 T8 respondeu com pergunta de troca em vez do preço). Advisory; o backstop garante a
   não-fixação, mas não força o LLM a responder a intenção. Diminishing returns; anotado.
4. **Judge ruidoso** (não é o veredito): s1 56/85 (variância temp 0.7), **r3 38 = ALUCINAÇÃO** (notas alegam
   "repetição do nome" — a transcrição prova que o agente capturou "Douglas" no T1, NUNCA reperguntou, e o USOU no T3).
5. **Fora do escopo (área Codex):** ONIX em texto livre (s2 T3), cor/câmbio em detalhe (POL-ATTR-VALUE), ordinal→possuiTroca.

## Recomendação
**R12-B ATINGIU o objetivo escopado (fixação eliminada: SLOT_FIXATION/REASK/STARVED = 0 na matriz inteira), com
gates verdes, deferimento provado no eval real e ZERO regressão. PODE ir para auditoria Codex. NÃO deployar antes.**
Seguindo a regra "não usar judge como veredito", o aceite é determinístico e foi cumprido; os judges baixos são
variância/alucinação documentada. Follow-ups: (R12-C) de-priorizar slot superseded + detector supersede-aware;
(Codex) ordinal→possuiTroca + grounding ONIX/cor.
