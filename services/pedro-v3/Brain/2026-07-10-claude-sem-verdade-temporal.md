# F2.48 — Verdade temporal e semântica por turno (missão SEM) — IMPLEMENTADA, aguarda auditoria Codex

**Data:** 2026-07-10 · **Autor:** Claude (executor) · **Missão:** dono ("Eliminar divergência entre turno atual,
WorkingMemory, slots e CRM") · **Status:** ⛔ **NADA commitado/deployado.** Flags: `PEDRO_V3_CRM_WRITE` OFF ·
`PEDRO_V3_BRAIN_MODE=central_active` (piloto) inalterada · `PEDRO_V3_HANDOFF` inexistente.

## 1. Diagnóstico (auditoria REAL no banco — conversa do piloto 2026-07-10 17:43–17:54 UTC)
Conversa `wa:8ed13714…`, lead `426a7120…` (criado pela F2.47 — identidade/routing/state funcionaram ✅).
Turno a turno (decision_final + state + outbox + ai_crm_leads):

| T | Lead | O que aconteceu de verdade |
|---|---|---|
| T3 "Gostei do Aircross" | trusted ✓, CRM interesse ✓ — mas `selected=null`: o claim do catálogo não reconhece o SUBMODELO solto ("Aircross" ⊄ claims de "C3 Aircross") → `resolveSelectedVehicle` claims=[] → sem seleção |
| T4 "Sim" | cérebro emitiu **evidence do turno ANTERIOR** ("Gostei do Aircross") → trusted=false → `deterministic_recovery` ("De qual carro…?") |
| T7 "Não" | evidence herdada ("Vocês financiam?") → trusted=false; a EXTRAÇÃO acertou (pendingSlot=entrada → entrada=0 ✓) mas o cérebro, entendendo o turno errado, re-perguntava entrada → anti-repetição negou 5× → **technical_fallback** ("Me conta um pouco mais…") |
| T8 "Quero financiar ele mesmo / Mas não tenho entrada" | trusted ✓, entrada=0 ✓ — mas **`possuiTroca=false` FANTASMA**: `trocaNeg=/\bnao\s+tenho\b/` casava SEM vínculo com pergunta de troca (lead-extraction.ts) → CRM gravou `trade_in_vehicle="não possui"` |
| T10 "Douglas" | evidence herdada ("Até 1200") → trusted=false; nome=Douglas ✓ (extração) mas o cérebro tentou perguntar TROCA (a pergunta CERTA!) e a anti-repetição negou (o slot estava "known" com o **valor inventado** do T8) → 3 denies → **technical_fallback** |
| Estado final | WM presa em greeting; `conheceLoja=true` também inventado (T2: "tem SUV?" — pergunta nova — respondeu o slot pendente da saudação) |

**Cascata-chave:** o fantasma do T8 (extração sem vínculo) bloqueou a condução legítima do T10. As evidences
herdadas (T4/T7/T10) eram detectadas mas o tratamento degradava em vez de corrigir.

## 2. Correções (LLM-first preservado: zero handler comercial, zero if-por-frase; engine valida e orienta)

**Invariante 1 — proveniência temporal do understanding** (`central-engine.ts`):
- Final do cérebro com evidence NÃO-vazia toda fora do bloco atual (herdada), OU understanding não-confiável
  tentando DIRIGIR fato (set_slot/capabilities) → **deny `UNDERSTANDING_STALE` com feedback específico**
  (inclui o bloco atual + a última pergunta do agente) + retry bounded (`PROVENANCE_RETRY_CAP=2`).
  Esgotado → o understanding inválido é **descartado** (o fallback derivado do próprio bloco vira hint
  conservador que nunca autoriza ação). Entendimento de outro turno NUNCA dirige resposta/tool/mutação.
- Turno trivial sem evidence nenhuma (smalltalk sem capability/mutação) segue o fluxo antigo (já era seguro).
- Prompt do brain (`openai-agent-brain.ts`): regra explícita — quote SEMPRE do bloco ATUAL, mesmo monossílabo
  ("Sim"/"Não"/nome); evidence de turno passado é rejeitada e refeita.

**Invariante 2 — autoridade geral de slots** (`slot-provenance.ts` NOVO, puro):
`filterBrainSlotMutations` — mutação `set_slot` da LLM só persiste com proveniência: (a) extração determinística
do bloco cobriu o slot (ELA vence; a da LLM cai como `extraction_authority`); (b) understanding VÁLIDO **e**
valor presente no bloco / objeto do slot mencionado / resposta booleana curta à pergunta pendente. Inventado →
descartado + **observado** (`decision_final.droppedSlotMutations`). Generaliza a autoridade que valia só para
os slots financeiros (F2.43).

**Invariante 3 — negação resolve a pergunta pendente** (`lead-extraction.ts`):
- `trocaNeg` ("não tenho" NU) agora exige VÍNCULO: pergunta pendente de troca OU o bloco fala de troca/carro/
  veículo; negação com OUTRO objeto explícito (entrada/parcela/valor) pertence àquele contexto — **mata o fantasma**.
- Guard de pergunta POR CLÁUSULA: "vocês não aceitam troca?" (pergunta) não responde; "Não tenho carro pra troca\ntem
  SUV até 100k?" (negação em statement + pergunta separada) segue válida (caso P0-1f da F2.44 preservado).
- `conheceLoja`: pergunta nova do lead nunca vira resposta booleana (o "tem SUV?"→conheceLoja=true morreu).
- WM rastreia `pendingAgentQuestion` (derivada do texto AUTORADO — fonte única `questionSlotFromAgentText`,
  estrita: statement sem "?" não registra) e `lastResolvedSlotAnswer` (quando a extração resolve a pendente).

**Invariante 4 — reconciliação de memória** (`working-memory.ts` + engine):
Mutações de SISTEMA novas (`reconcile_turn_semantics`/`set_pending_agent_question`/`set_resolved_slot_answer`,
aplicadas SÓ pelo engine): após entendimento ACEITO, `activeTopic`/`currentLeadIntent` refletem o turno (a LLM
não precisa emitir mutações redundantes; se ELA setar, a escolha dela fica). WM nunca mais presa em greeting.
`state.stage` NÃO foi tocado (contrato "só avança via EffectOutcome" preservado — decisão documentada).

**Invariante 5 — seleção canônica** (`lead-extraction.ts` resolveSelectedVehicle):
fallback GROUNDED NA LISTA: palavra do bloco (≥4 chars) idêntica a um token do modelo de UM ÚNICO item da última
oferta seleciona ("Gostei do **Aircross**" → "C3 Aircross"); ambíguo (2 Renegade) não seleciona. Prompt: UMA
pergunta acionável por vez (nunca "fotos ou condições?").

**Invariante 6 — fallback:** o T7/T10 morrem pela raiz (retry orientado + fantasma morto + anti-repetição com
orientação de avanço no feedback). Recovery degradado continua existindo como último recurso honesto.

**Invariante 7 — nome inicial** (bridge→ingest→engine→CRM):
`pedroV3Bridge.ts` extrai `pushName/notifyName` SANITIZADO (`leadNameHint`) → viaja no raw do inbox (como o
adContext) → `buildCrmFields` o usa como `lead_name` inicial SÓ se `isRealLeadName` (emoji/lixo nunca; declarado
vence hint; `client_name` é exclusivo do nome declarado). Placeholder de criação virou
**"Contato WhatsApp • final XXXX"** (nunca "Lead"; `isRealLeadName` rejeita `^contato` → segue promovível).

## 3. Arquivos
NOVOS: `src/engine/slot-provenance.ts` · `tests/run-f2-48-semantic-provenance.ts` · `eval/run-sem-smoke.ts`.
ALTERADOS: `central-engine.ts` (deny proveniência + filtro de mutações + reconcile WM + observabilidade
`provenanceRetries`/`droppedSlotMutations`) · `lead-extraction.ts` (trocaNeg vinculada, cláusula-pergunta,
conheceLoja, seleção por token, `questionSlotFromAgentText`) · `working-memory.ts` + `domain/agent-brain.ts`
(campos+ops de sistema) · `crm-write.ts` (leadNameHint + isRealLeadName^contato) · `openai-agent-brain.ts`
(prompt: proveniência + pergunta única) · `pilot-ingest.ts`/`pilot-http-app.ts`/`server.ts`/`pedroV3Bridge.ts`
(cadeia do leadNameHint) · `supabase-crm-lead-store.ts` (placeholder) · `run-central-gate-offline.ts` (caso (e):
extração é a autoridade do valor) · `package.json` (test:f248). Diff: ~246+/31- em 11 arquivos + 3 novos.

## 4. Testes — F2.48 `test:f248`: **42 OK / 0 FALHA**
[R] conversa REAL reproduzida com evidence herdada DE PROPÓSITO nos turnos curtos: retry corrige (T4/T7/T10
brain_final; zero texto genérico), entrada=0/parcela=1200/nome=Douglas, **possuiTroca permanece unknown**,
selected=C3 Aircross canônico, WM.activeTopic≠greeting + pendingAgentQuestion/lastResolvedSlotAnswer, CRM final
SEM "não possui" + lead_name promovido. [N] "Não" após entrada/troca/visita/conheceLoja resolve SÓ o perguntado
(+bloco misto+perguntas do lead). [M] mutações da LLM: inventada descartada+observada; untrusted zero mutação;
extração vence; booleana curta à pendente aceita. [S] seleção por token (única/ambígua/sem token). [P] pushName
(real/lixo/declarado-vence/placeholder-promovível). [W] fonte única da pergunta de slot.
Gates: `tsc` EXIT 0 · **`test:all` EXIT 0 (2204 OK / 0)** · `git diff --check` limpo. Ajustes de contrato:
`run-central-gate-offline` caso (e) (extração autoridade) e F2.44 P0-1f preservado via guard por cláusula.

## 5. Smokes REAIS (gpt-4.1-mini + prompt/estoque reais do piloto, efeitos OFF) — **2× PASS consecutivos**
Roteiro semântico do incidente por ORDINAL (o estoque real mudou — o Aircross saiu do feed; "Gostei do segundo"
preserva seleção→"Sim"→fotos→financiamento→negações). PASS automático: zero technical_fallback (T≥3), zero
recovery comercial, **possuiTroca unknown em TODOS os turnos**, entrada known:0, parcela 1200, nome Douglas,
faixaPreco intacta, compose=0, foco registrado.
- Run 1: BRAIN 18 chamadas (2xx), PASS — fotos do carro CERTO após o "Sim"; "Anotado, parcela de até R$ 1.200".
- Run 2: BRAIN 20 chamadas, PASS — T7 `brain_retry` visível: "Entendi que você não tem valor para dar de
  entrada. Qual parcela mensal caberia?" (o deny de proveniência corrigindo AO VIVO).
- (1º run exploratório FALHOU por harness — roteiro fixava "Aircross" inexistente no estoque atual + parse do
  slotsDelta; corrigido o RUNNER, não o engine.) Custo total ≈63 chamadas gpt-4.1-mini.
Relatórios: `eval/reports/sem-smoke-2026-07-10T22-29-38-*.md` e `…22-31-43-*.md` (não versionados).

## 6. CRM antes/depois
- **ANTES (linha real do incidente, lead 426a7120):** `trade_in_vehicle="não possui"` (fantasma) · lead_name
  "Douglas" (promoção OK) · demais campos corretos.
- **DEPOIS (provado):** offline F2.48 [R-F3] — CRM final SEM troca inventada; smokes 2× — possuiTroca unknown
  do início ao fim. ⚠️ A linha REAL do lead de teste continua com `trade_in_vehicle="não possui"` gravado — o
  fill-only NÃO corrige valor já escrito (por design): limpar MANUALMENTE o campo (ou resetar o lead de teste)
  antes da conversa de aceite.
- `status_crm="qualificado"` na linha veio de PROCESSO DO V2 (cron de categorização) — não é escrita do v3.

## 7. Riscos/observações honestas
1. Pergunta DUPLA ainda escapa às vezes no real (T3 dos smokes: "fotos dele ou…?") — guidance de prompt não é
   enforcement; o dano do "Sim" ambíguo agora é contido pela seleção persistida. Se o Codex quiser, dá para
   virar deny de output (validação), não handler.
2. T4 do smoke: o cérebro leu "Sim" como "pode chamar consultor" (a resposta anterior ofereceu). Legítimo no
   contexto, sem efeito real (handoff não existe); a conversa se recuperou no turno seguinte.
3. O deny de proveniência consome passos do brain (cap 2) — turnos curtos com evidence herdada ficam ~1 chamada
   mais caros quando o cérebro erra (medido: 18-20 chamadas/11 turnos, ~1.7/turno — saudável).
4. `stage` do state segue greeting por contrato (EffectOutcome); a fase viva agora está em WM.activeTopic.

**PARADO — aguardando auditoria do Codex. Sem commit/push/deploy/SQL; flags inalteradas (CRM OFF).**
