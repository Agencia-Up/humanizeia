# RD1-2 — CONCLUSÃO P0 (agendamento, POL-TRACK, gate portal-first, jornada integrada)

**Autor:** Claude (executor) · **Data:** 2026-07-13 · **Encomenda:** Codex "MISSÃO P0 — concluir RD1-2 de verdade".
**Status:** CÓDIGO COMPLETO, gates offline VERDES. **NÃO commitado.** Smokes reais no fim deste doc.
Base: [[2026-07-13-claude-rd1-2-denies-estilo-advisory]]. Continuidade: [[pedro-v3-rd1-denies-advisory]], [[pedro-v3-llm-first-no-handler]].

## Causa-raiz de cada falha (do checkpoint anterior)
1. **T8/T9 "Pra segunda"/"Às 15h" → technical_fallback.** `turn-understanding.ts` (gate `:80-83`) exigia que a evidência do
   understanding de `visit` casasse `VISIT_ACT_RX` (visita/agendar). Um valor só TEMPORAL não casa → issue de autoridade →
   retry esgota (AUTHORITY_RETRY_CAP=3 no loop `central-engine.ts:2111`; FINAL cap=2 em `:2731`) → `lockedU=null` →
   `technical_fallback`. A função é PURA e stateless: NÃO recebia estado/WM, então não sabia que havia visita em andamento.
2. **POL-TRACK-001 com 2º cérebro.** `policy-engine.ts:272` abstinha por `ctx.currentTurnIntent === "search"` — heurística
   `deriveCurrentTurnIntent` (`central-engine.ts:1001`), anterior e alheia ao understanding validado da LLM.
3. **Gate T1 do f252** exigia frases de descoberta comercial hardcoded — contradiz portal-first.
4. **F2.55** só tinha helpers puros — faltava jornada integrada pelo engine.

## Invariantes implementados

### P0-A — continuação semântica de agendamento (contrato PURO + contextual)
- `turn-understanding.ts`: `hasSchedulingTemporalValue(block)` (reconhecimento GERAL de dia-da-semana/relativo/horário/
  período; colon "HH:MM" checado no bloco cru pois `normalizeText` troca ":" por espaço) + `hasActiveVisitContext({interesseVisita,
  pendingSchedulingSlot,recentTurns})` (interesseVisita=true OU pergunta pendente diaHorario/interesseVisita OU última
  pergunta do agente pediu dia/horário) + `TurnValidationContext{visitActive?}`. O gate de visit passa a aceitar quando
  `explicitVisit || (visitActive && hasSchedulingTemporalValue(block))`. **NÃO é `if`-por-frase; NÃO afrouxa o regex global.**
  A mensagem atual continua sendo a evidência; a memória só fornece a relação.
- `central-engine.ts`: computa `turnValidationContext` (de `contextState.slots.interesseVisita` + `persisted0.pendingAgentQuestion`
  + `recentTurns`) e o passa aos 3 call-sites de `validateTurnUnderstanding` (brainVU `:1963`, loop `:2111`, final `:2731`).
- `lead-extraction.ts`: `composeSchedule(existing, incoming)` PURA — mescla dia+horário sem apagar a outra dimensão (segunda +
  15h → "segunda 15h"; corrigir dia mantém horário e vice-versa). Usada no set_slot de `diaHorario`. **Robustez (do smoke real):**
  a extração de `diaHorario` também dispara quando a VISITA está em andamento (`interesseVisita=true`) + valor temporal —
  mesmo que o agente tenha perguntado outro slot (ex.: o nome). Sem isso, "às 15h" se perdia quando a LLM pedia o nome no
  turno anterior (pendingAgentQuestion="nome"). extractDayPeriod/visitScheduleAnswer só casam dia/horário → respostas
  financeiras (1500 / "não tenho entrada") não vazam.
- Invariantes provados: sem contexto, "segunda" não inicia agendamento; em visita ativa "pra segunda" é continuação; "às
  15h" compõe; mudança de assunto ("na verdade quero Onix" = search_stock) e request_human vencem (o gate de visit só afeta
  primaryIntent=visit); pergunta pendente STALE não transforma mensagem alheia (exige valor temporal + contexto + a LLM
  declarar visit); nenhuma tool comercial no agendamento; a LLM escreve a resposta.

### P0-B — POL-TRACK com autoridade da LLM (fim do 2º cérebro)
- `context.ts`: `TurnContext.currentTurnIntent` (heurístico) REMOVIDO; adicionado `acceptedPrimaryIntent?: PrimaryIntent`.
- `central-engine.ts` (2 call-sites de authorFromBrainDraft): ctx passa `acceptedPrimaryIntent = (llmFirst && brainVU()?.trusted)
  ? brainVU()!.understanding.primaryIntent : undefined`. `deriveCurrentTurnIntent` continua como enriquecimento de FRAME/gate,
  mas NÃO alimenta mais a policy.
- `policy-engine.ts:272`: `currentTurnIsSearch = ctx.acceptedPrimaryIntent === "search_stock"` (já implica capability+evidence
  porque só é setado quando `trusted`). Legado (ausente) preserva o deny antigo.

### P0-C — gate T1 do f252 portal-first
- `run-f252-production-journey-smoke.ts`: substituído "T1 fez descoberta comercial" por INVARIANTES: autoria brain_*, não
  terminalSafe, apresentou-se conforme identidade do portal, no máximo UMA pergunta, sem nome/telefone prematuros. NÃO exige
  taxonomia de carroceria.

### P0-D — jornada integrada + telemetria + smokes dirigidos
- `tests/run-f2-55b-scheduling-journey.ts` (NOVO, engine real + cérebro scriptado válido, 23 asserções): abertura→SUV→
  seleção Compass→fotos→TROCA Hilux 2009/78km(→78000)→entrada 0/parcela 1500 (SEM virar busca)→visita (segunda + 15h
  compostos, SEM technical_fallback)→handoff+notify. Compass permanece selecionado o tempo todo.
- `eval/central-real-harness.ts` + `central-assertions.ts`: `pendingAgentQuestion` exposto no `CentralTurnCapture` + opção
  `driver` (rajada vem do driver que lê `pendingSlot`, não de lista fixa).
- `eval/run-f252-driven-smoke.ts` (NOVO): modo ADAPTATIVO (driver segue `pendingAgentQuestion`) + ADVERSARIAL (lead ignora a
  pergunta pendente: "Pra segunda"/"Às 15h" isolados). Ambos com LLM real, efeitos OFF, vendedor/lead sintéticos.

## Como a LLM permaneceu AUTORA exclusiva
Nenhuma mudança escreve resposta comercial no engine. P0-A só afeta a VALIDAÇÃO do understanding (aceitar/rejeitar), nunca a
autoria; a LLM redige toda resposta de agendamento. `composeSchedule` compõe um SLOT (fato), não texto ao lead. P0-B tira um
detector do caminho da policy — a LLM (understanding validado) é a autoridade. Zero recovery determinístico de agendamento.

## Como o PORTAL permaneceu autoridade do funil
Advisory sem DEFAULT_QUESTIONS (RD1-2); gate T1 portal-first (P0-C); a abertura/funil vêm do prompt do portal. Nada de
pergunta padrão interna.

## Gates offline
- `npm run test:f255` (F2.55 pura 51 OK + jornada integrada 23 OK): VERDE.
- `npx tsc --noEmit`: EXIT 0.
- `npm run test:all`: EXIT 0 (zero regressão; inclui a jornada integrada) — rodado 2× (antes e depois do fix de composição).
- `git diff --check`: EXIT 0 (só avisos benignos "LF→CRLF" em package.json/f2-48/f2-8; nenhum erro de whitespace).

## git status / stage recomendado (NÃO commitar — só p/ auditoria)
Modificados (Claude): eval/central-assertions.ts, eval/central-real-harness.ts, eval/run-f252-production-journey-smoke.ts,
package.json, src/domain/context.ts, src/engine/central-engine.ts, src/engine/lead-extraction.ts, src/engine/policy-engine.ts,
src/engine/turn-understanding.ts + as ~11 suítes de teste do RD1-2 (f2-8/22/24/31/32/37/38/39/40/41/48) + turn-frame-builder.ts
e agent-brain.ts e openai-agent-brain.ts (RD1). Novos (Claude): src/engine/turn-advisories.ts, tests/run-f2-55-turn-advisories.ts,
tests/run-f2-55b-scheduling-journey.ts, eval/run-f252-driven-smoke.ts, Brain/2026-07-13-*.
⚠️ EXCLUIR do stage os untracked do CODEX: eval/run-audit-v2-vs-v3.ts, eval/run-conversation-quality-audit.ts,
eval/run-cross-agent-ad-audit.ts (não são meus).

## Arquivos alterados (Claude)
- `src/engine/turn-understanding.ts` (P0-A: temporal/visitActive/TurnValidationContext + gate visit; assinatura +context)
- `src/engine/central-engine.ts` (P0-A: turnValidationContext nos 3 call-sites; P0-B: acceptedPrimaryIntent no ctx; import)
- `src/engine/lead-extraction.ts` (P0-A: composeSchedule + set_slot diaHorario)
- `src/engine/policy-engine.ts` (P0-B: POL-TRACK usa acceptedPrimaryIntent)
- `src/domain/context.ts` (P0-B: -currentTurnIntent +acceptedPrimaryIntent)
- `eval/central-real-harness.ts` + `eval/central-assertions.ts` (P0-D: pendingAgentQuestion + driver)
- `eval/run-f252-production-journey-smoke.ts` (P0-C: gate T1 portal-first)
- `tests/run-f2-55-turn-advisories.ts` (+parte 1c helpers P0-A) · `tests/run-f2-55b-scheduling-journey.ts` (NOVO)
- `eval/run-f252-driven-smoke.ts` (NOVO) · `package.json` (test:f255 + test:all + smoke:f252d)

## Smokes reais (provider=openai, modelo=gpt-4.1-mini, chave via EVAL_OPENAI_API_KEY/plataforma; efeitos OFF, vendedor FAKE)
- **`smoke:f251` → PASS** ✅ "o ato atual de visita venceu foco/memoria e a LLM conduziu o turno." (BRAIN≈4)
- **`smoke:f252` (fixo, 10 turnos, com P0-A + gate portal-first P0-C) → PASS** ✅ "jornada completa conduzida pela LLM com
  estoque, fotos, mudanca, visita, CRM e handoff." BRAIN=17. ⭐ T1 portal-first OK (abertura Taubaté/loja aceita); **T8 "Pra
  segunda" e T9 "Às 15h" = `brain_final` intent=visit, ZERO technical_fallback** (era o incidente); T10 handoff+notify.
- **`smoke:f252d` ADVERSARIAL (lead ignora a pergunta pendente) → PASS nos 2 runs consecutivos** ✅✅ ⭐ o fluxo que
  apresentava variância: "Pra segunda"→`brain_final` visit dh="segunda", "Às 15h"→`brain_final` visit **dh="segunda 15h"
  (COMPOSTO)**, sem technical_fallback, sem voltar à descoberta, sem perder o carro selecionado; handoff no fim.
- **`smoke:f252d` (ADAPTATIVO + ADVERSARIAL juntos) → PASS nos 2 runs consecutivos** ✅✅ (BRAIN adapt≈16-23, adv≈12-14).
  ADAPTATIVO: driver segue `pendingAgentQuestion` via mapa slot->resposta + progressão cumulativa (fases pré-lista de
  critério de busca -> seleção -> pós-seleção -> visita -> agendamento -> handoff). ADVERSARIAL: mini-driver com prefixo fixo
  (lead ignora a pergunta pendente) + retry do pedido humano até o handoff materializar. **O driver 1ª versão era frágil
  (não-cumulativo + não respondia conheceLoja/possuiTroca) — SCAFFOLD do teste, não produto**; reescrito e agora estável.
  A continuação de agendamento P0-A (o incidente) passou em 100% dos runs desde a 1ª versão.

Custo aproximado: só chamadas de BRAIN (COMPOSE=0 em singleAuthor), gpt-4.1-mini. f252=17, f251≈4, f252d ~20-40/run.
Provider/efeitos: LLM real; persistência in-memory; dispatch OFF; receipts simulados; lead/vendedor sintéticos (crmLeadId
de teste, nenhum vendedor real notificado).

## Critérios de aprovação do Codex — TODOS atendidos
- Gates offline verdes (test:f255 incl. jornada, tsc, test:all, git diff --check). ✅
- Todos os smokes exigidos passam (f251, f252 fixo, f252d adaptativo+adversarial ×2 consecutivos). ✅
- T8 não é technical_fallback (f252 + adversarial: "Pra segunda" = brain_final/retry visit). ✅
- T9 registra/compõe dia+horário ("segunda 15h"). ✅
- Compass/veículo permanece selecionado durante o agendamento. ✅
- T10 gera handoff/notify. ✅
- T1 respeita o prompt do portal (gate portal-first). ✅
- POL-TRACK usa a intenção CONFIÁVEL da LLM (acceptedPrimaryIntent), não detector heurístico. ✅
- Nenhuma resposta comercial vem do engine; nenhuma policy de estilo derruba resposta. ✅
- Grounding/PII/effects continuam hard. ✅
- F2.55 tem jornada integrada permanente (run-f2-55b). ✅

## PARE p/ Codex — sem commit/push/deploy.
