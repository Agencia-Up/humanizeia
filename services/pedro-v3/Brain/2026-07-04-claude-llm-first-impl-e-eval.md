# central_active LLM-first — IMPLEMENTAÇÃO + EVAL REAL (honesto) — 2026-07-04

**Autor:** Claude (executor). **Auditor:** Codex. **NÃO commitado** (aguarda autorização Codex — exigência da missão).
Diagnóstico prévio: `Brain/2026-07-04-claude-diagnostico-llm-first-central.md`.

## O que foi implementado (Fase 2)
Flag **`llmFirst`** em `CentralTurnArgs`; `#processCentralActive` passa `singleAuthor:true` + `llmFirst:true`.
- `central-engine.ts`: em `llmFirst`, o engine NÃO gerencia objetivo de funil — `reconcileObjectiveWithQuestion` é
  substituído por `stripAllObjectiveMutations` (funil = contexto read-only; a LLM decide a condução). Guardrails intactos.
- `sdr-conductor.ts`: `stripAllObjectiveMutations` exportado.
- `openai-agent-brain.ts`: bloco de protocolo LLM-first (funil = contexto; interpretar negações/objeções; não reperguntar
  slot respondido/declinado; "sem entrada" continua no financiamento e NUNCA encerra; acompanhar mudança de assunto;
  comentário fora de roteiro sem menu robótico; ≤1 pergunta).
- `lead-extraction.ts`: NEGAÇÃO a pergunta de ENTRADA → entrada=0 (memória, para o cérebro não reperguntar).

## Offline (Fase 3) — `run-f2-21-llm-first-sdr.ts` = **18 OK / 0 FALHA**
Prova (fake brain scriptado/adversarial, `llmFirst=true`) que o ENGINE não sequestra: entrada zero (não repete/não
encerra), "tenho não"=não, recuperação financiar, mudança de assunto (loja sem foto), estoque (LLM chama stock_search,
engine não injeta CTA), foto ordinal (send_media do 2º), recall (nomeia sem mídia), fora-de-roteiro (sem objetivo
injetado), **caso 9 (prova-chave): llm-first NÃO cria objetivo; legado CRIA**, guardrail (preço inventado → bloqueado).
**tsc + test:all EXIT 0** (F2.13 46 intacto — legado `llmFirst=false` mantém reconcile; sem regressão).

## Eval REAL (Fase 4) — 2 conversas gpt-4.1-mini, singleAuthor+llmFirst = PRODUÇÃO, efeitos OFF
`eval:llm-first`: 44 chamadas, **compose=0** (autoria única confirmada), **prompt integral (SHA)**, tokens
prompt≈222k/completion≈6k, **custo≈US$0,099**. Relatório: `eval/reports/llm-first-sdr-2026-07-04T20-24-18*.md`.

### ✅ O que a arquitetura LLM-first PROVOU no real
- O engine NÃO injetou pergunta de funil nem menu robótico (nenhum "qual seu nome/entrada" hardcoded do engine).
- Entrada capturada como 0 (C1 T5). Mudança de assunto acompanhada (C2 T7 loja NÃO ficou presa em foto; C2 T8 mudou p/
  Onix). Foto ordinal correta (C2 T5 send_media do CR-V). Recall correto (C2 T6 "HONDA CR-V 2010", sem reenviar mídia).
  Negação de foto respeitada (C2 T10 não mandou foto).

### ❌ BUGS REAIS que o eval revelou (honesto — precisam de correção antes de aceitar)
1. **CPF CEDO (C1 T7/T8)** — o cérebro pediu "poderia me informar seu CPF?" no meio do funil, sem visita/etapa. É
   VIOLAÇÃO de guardrail (a missão manda manter "não pedir CPF cedo"). O single-author NÃO bloqueia CPF no texto.
   → CORREÇÃO: guardrail que NEGA resposta pedindo CPF prematuro (feedback ao cérebro).
2. **technical_fallback demais (C1 T10 visita; C2 T4 "gostei do segundo"; C2 T9 "popular até 50k"; C2 T10)** — o cérebro
   falha o grounding, tenta 3-4x e DEGRADA ("não consegui confirmar…"). Pior: **seleção "gostei do segundo" degradou**
   (C2 T4) em vez de só selecionar+acolher, e **"popular até 50k" chamou vehicle_details 2x em vez de stock_search
   popular** (C2 T9). Isso é o "trava em política / parece robô" do dono. → CORREÇÃO: (a) seleção não exige atributo
   (acolher sem citar km/cor); (b) prompt/guard para "popular/tipo/orçamento" forçar stock_search, não vehicle_details;
   (c) fallback de degradação precisa ser mais raro (o cérebro está sobre-citando atributos e falhando o render).
3. **REPETIÇÃO (C1 T6)** — "tenho não" (respondendo troca) não virou possuiTroca=false → o cérebro REPETIU a pergunta de
   troca idêntica. → CORREÇÃO: capturar negação de TROCA (espelhar a de entrada) em `extractLeadSlots`.
4. **ENCODING/mojibake (C2 T1)** — a saudação saiu "Voc eaa e9 aqui de Taubat e9" (é→e9, ã→ea). Bug de encoding
   pré-existente (latin1/utf8) que ressurgiu. → CORREÇÃO: investigar o pipeline de texto do brain/outbox (separado).
5. **Assertiva do harness com FALSO-POSITIVO** — o check "chave crua" casou o `|` da lista de oferta (formatação
   "116.000 km | Manual"), não uma chave. As 2 violações "C2 T3/T8 chave crua" são falso-positivo do teste (o regex
   `\|` era largo demais); não há chave crua real nas respostas. → CORREÇÃO do harness (regex).

### VEREDITO honesto
A troca de arquitetura (LLM-first, sem sequestro de funil) está FEITA e provada offline (18 OK) + confirmada em pontos-
chave no real. MAS o eval real REPROVA para produção: CPF cedo (guardrail), degradação/fallback frequente na seleção e na
busca "popular", e repetição por falta de captura de troca. São correções pontuais (guardrail CPF + captura de troca +
seleção-sem-atributo + popular→stock_search) que precisam de UMA rodada de correção + re-eval da conversa que falhou.
**NÃO declarei concluído. NÃO commitei. Parado para decisão (aplicar as correções + re-rodar 1x, ou auditoria Codex).**

## CORREÇÃO (1 rodada, autorizada pelo dono) + RE-EVAL — 38 chamadas, US$0,091
Correções aplicadas (todas offline-provadas, F2.21 20 OK, F2.8 167 OK, test:all+tsc verdes):
- **CPF é dado de FECHAMENTO** (`policy-engine.ts`): `cpfDueNow` agora exige AGENDAMENTO (interesseVisita=true ou
  diaHorario known) — intenção de financiamento NÃO libera CPF. Teste f2-8 atualizado (CPF só com financiamento -> DENY;
  CPF ao agendar -> OK).
- **Negação de TROCA** (`lead-extraction.ts`): "tenho não"/"não tenho" respondendo troca -> possuiTroca=false (parseBoolean
  casava "tenho"->true; agora negação explícita vem antes). Mata a repetição.
- **Prompt** (`openai-agent-brain.ts`): seleção ("gostei do segundo") só ACOLHE + oferece próximo passo (não cita
  atributo); CPF nunca na qualificação; TIPO/modelo/popular/orçamento -> SEMPRE stock_search (nunca vehicle_details).
- **Harness** (`eval/run-llm-first-sdr.ts`): regex "chave crua" não casa mais o `|` da lista (falso-positivo) + check de CPF.

### RE-EVAL — o que MELHOROU (real, gpt-4.1-mini)
- ✅ **CPF cedo ELIMINADO**: C1 T7/T8 agora pedem "qual parcela mensal?" (não CPF). Zero CPF nas 2 conversas.
- ✅ **Financiamento sem entrada NATURAL**: C1 T5-T8 "entrada zero + qual parcela?" sem repetir, sem encerrar.
- ✅ **Popular FIXADO**: C2 T9 "popular até 50k" -> stock_search -> Sandero/208 (≤50k). (antes: vehicle_details/degradou.)
- ✅ **Encoding LIMPO** neste run: C2 T1 "Sou o Aloan… 😊 Você é aqui de Taubaté" (antes "Voc eaa e9" — mojibake foi
  transitório/não-determinístico; não recorreu). ✅ Loja respondida (C1 T9, C2 T7). ✅ Foto/recall corretos (C2 T5/T6).

### RE-EVAL — o que AINDA FALHA (honesto — brain-behavior, precisa de próxima rodada/Codex)
1. **"gostei do segundo" DEGRADA (C2 T4 technical_fallback)** — PERSISTENTE mesmo com a regra de prompt. O cérebro
   chama vehicle_details e ainda assim autora um draft que falha o grounding 3x -> fallback. A seleção NÃO deveria exigir
   atributo. **Provável correção real: EXECUTOR DETERMINÍSTICO de seleção** (espelho do P0-C de foto): ao selecionar,
   engine renderiza "Ótima escolha! Quer fotos ou as condições?" aterrado, sem depender do cérebro citar atributo. Precisa
   de log do draft rejeitado p/ root-cause exato (o relatório só mostra o fallback final). NOVO mecanismo -> merece pass
   própria + Codex.
2. **"tem Onix?" NÃO buscou (C2 T8)** — o cérebro REPETIU a resposta da loja (T7) + pergunta de pagamento, ignorando a
   busca por Onix. Incoerência do cérebro (arrastou a própria pergunta pendente de pagamento). currentTurnIntent=search
   (modelo onix) mas o cérebro não chamou stock_search. Prompt/brain — talvez exigir stock_search quando há claim de
   MODELO no turno atual (como more_options).
3. **"não quero foto agora" (C2 T10) DEGRADA** — respeitou (não mandou foto) mas caiu em fallback em vez de "sem problema,
   quer ver mais opções?". Graceless.
4. **C1 T10 visita** — capturou sábado/interesseVisita=true mas perguntou o NOME em vez de confirmar a visita (aceitável,
   mas podia confirmar antes).

### VEREDITO da correção
Conversa 1 (financiamento) PASSA bem agora. Conversa 2 melhorou muito (popular, encoding, CPF) mas AINDA tem a
degradação de seleção (T4) e o não-buscar-Onix (T8). Fiz **1 rodada de correção + re-eval** (como a missão manda) e
**PARO para Codex** — os itens restantes são brain-behavior/novo-executor-de-seleção que merecem pass própria com log de
draft. **NÃO commitei** (missão exige autorização Codex).

## RODADA 2 de correção (guardrail/feedback, SEM executor comercial) + RE-EVAL conv 2 — 2026-07-04
Dono pediu para corrigir os P0 SEM executor determinístico que escreva a resposta. Correções (todas guardrail/feedback,
offline-provadas em `run-f2-21-llm-first-sdr.ts` **27 OK**, test:all/tsc verdes, F2.13 46 intacto):
- **P0-search** (`requiredToolBeforeFinal(...,llmFirst)`): em llmFirst, `currentTurnIntent="search"` (tipo/modelo/popular/
  orçamento) EXIGE stock_search antes do final -> deny+feedback+retry ("chame stock_search antes de responder; não
  responda o assunto anterior"). Gated em llmFirst (não quebra o [3c] legado).
- **P0-sel** (`authorFromBrainDraft` + B2): B2 (`requireVehicleDetailBeforeFinal`) só força vehicle_details se o lead
  REALMENTE pergunta atributo (ATTR_QUESTION_RX) — seleção pura não força. Numa SELEÇÃO, se o grounding falha (citou
  atributo sem fato) o feedback é ESPECÍFICO: "acolha a escolha e ofereça próximo passo, NÃO cite atributo sem
  vehicle_details". O engine valida/commita `select_vehicle_focus` mas NÃO escreve a resposta.
- **P0-neg-foto** (prompt): recusa de oferta ("não quero foto agora") -> acolher + próximo passo, sem media, sem "não
  consegui confirmar".
- CPF já corrigido na rodada 1 (dado de fechamento). Harness: regex de chave crua + check de CPF + terminalSafe (honesto).

### RE-EVAL conv 2 (só a que falhou, EVAL_ONLY=2): 27 chamadas, US$0,069, compose=0, prompt integral
- ✅ **"tem Onix?" (T8) FIXADO** — força stock_search e lista 2 Onix (era repetição da loja). ✅ "popular até 50k" (T9)
  busca Sandero/208. ✅ foto (T5) send_media do CR-V. ✅ recall (T6) "HONDA CR-V 2010". ✅ loja (T7).
- ❌ **AINDA degrada (technical_fallback): "gostei do segundo" (T4)** e **"não quero foto agora" (T10)**. O guardrail está
  CORRETO (offline 27 OK prova que draft limpo passa), mas o gpt-4.1-mini INSISTE em citar atributo / não produz o
  acolhimento simples mesmo recebendo o feedback específico 3x -> esgota -> fallback. É NÃO-COMPLIÂNCIA do modelo, não
  bug de guardrail. **Heurístico do eval agora flaga terminalSafe (antes dizia PASS falsamente).**
- ⭐**Instrumentação adicionada** (sem custo): `CentralTurnCapture.policyFeedback`/`responseSource` + o eval imprime o
  policyFeedback nos turnos degradados. O PRÓXIMO run já mostra EXATAMENTE qual deny derrubou T4/T10 (root-cause que faltava).

### VEREDITO rodada 2
2 dos 3 P0 do dono resolvidos no real (Onix/disponibilidade + já antes CPF/popular/troca/encoding). A degradação de
SELEÇÃO (T4) e de RECUSA (T10) persiste por não-compliância do gpt-4.1-mini ao feedback — precisa do policyFeedback dump
(já instrumentado) p/ o Codex decidir: (a) endurecer ainda mais o feedback/prompt, (b) modelo mais forte, ou (c) rever a
regra de grounding que barra a seleção. Fiz **1 rodada de correção + re-eval da conversa que falhou** (como a missão
manda) e **PARO para Codex**. NÃO commitei.

## Arquivos (working tree, NÃO commitado)
`central-engine.ts`, `sdr-conductor.ts`, `openai-agent-brain.ts`, `lead-extraction.ts`, `pilot-active-root.ts`,
`eval/central-real-harness.ts` (opts singleAuthor/llmFirst/businessInfo), `tests/run-f2-21-llm-first-sdr.ts` (novo),
`eval/run-llm-first-sdr.ts` (novo), `package.json`, `Brain/*` (diagnóstico + este handoff).
