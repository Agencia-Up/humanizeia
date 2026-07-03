# Suíte de Avaliação Conversacional REAL do Pedro v3 — handoff

> **Status:** FASE A concluída e provada (harness + LLM real). Fases B–E pendentes. **Sem commit/deploy/produção.**
> **Autor:** Claude (executor) · **Data:** 2026-07-01 · Piloto: tenant `ecb26258` / agent `d4fd5c38` (Aloan) · modelo `gpt-4.1-mini`.
> **Objetivo:** gate repetível que roda conversas longas com **OpenAI REAL + prompt/config/estoque REAIS**, estado in-memory, **zero** WhatsApp/CRM/handoff. Parar de descobrir erro na mão.

---

## FASE A — FEITA (harness real + prova de LLM real)

**Arquivos criados:**
- `Agent/eval/real-harness.ts` — REUSA a fiação viva (mesma montagem de `runtime/server.ts` + `pilot-active-root.ts`): `SupabaseServiceGateway` (RPC do Vault) → `resolveTenantOpenAiSecret` → `SupabaseReadOnlyDatabase` + `createOpenAiModelFactory(FetchModelHttpTransport, gpt-4.1-mini)` + `V2TenantConfigSource` (prompt real) + `V2StockLoader/Source` (RevendaMais real, read-only) + `PromptBoundConversationAdapter` + `createReadQueryRunner` + `buildSdrQualificationPolicy`. Estado: `InMemoryPersistence`. **Efeitos OFF:** `providerCapability { send_message:"none", send_media:"none" }` e **nunca** cria o dispatcher (o dispatch fica no bloco separado de `processConversation`, que NÃO chamamos). `CountingModelHttpTransport` conta cada POST real à OpenAI (a PROVA). `sanitize()` redige chave/JWT/CPF/telefone.
- `Agent/eval/run-eval.ts` — CLI **gated por `PEDRO_V3_REAL_EVAL=1`**, FORA do `test:all`. FALHA se zero chamadas HTTP reais (proibido FakeLlm).
- `Agent/package.json` — script `eval:conversation:real` (não entra no test:all).

**Comando:** `PEDRO_V3_REAL_EVAL=1 npm run eval:conversation:real`

**Evidência de LLM real (execução 2026-07-01):**
- `promptSource=raw_system_prompt`, **promptLen=6516** (prompt real do Aloan), `temp=0.7`, `stock=revendamais`.
- T1 "Bom dia" → *"Bom dia! Sou o Aloan, consultor aqui da Icom Motors 😊 Você é aqui de Taubaté mesmo já conhece a nossa loja?"* (persona + apresentação + conexão = Bloco 3 do prompt).
- **4 chamadas HTTP a `api.openai.com`, todas 2xx**; modelo retornado pela API = **`gpt-4.1-mini-2025-04-14`**; tokens 29040 prompt / 204 completion; latências 5989/2099/1435/1527 ms.
- Efeitos OFF: `outbox=send_message` gerado, **nunca despachado**.

**Viabilidade confirmada:** piloto criado 2026-03-20 → **grandfathered** → chave OpenAI = **plataforma via Vault RPC** (`get_platform_ai_key`), sem chave de cliente. `.env` tem `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Rede OpenAI/Supabase OK. `V2PlaintextApiKeyReader` = passthrough (sem segredo de cripto p/ o feed).

**⚠️ Já surgiu um erro real (a diagnosticar, NÃO corrigir agora):** T2 "Quero SUV até 70 mil" → `stock_search({modelo:"suv", tipo:"suv", precoMax:70000})` → 0 → "não achei um SUV até R$70.000". O **`modelo:"suv"`** é suspeito ("suv" virou *modelo* além de tipo) — candidato a bug no frame/interpretação (ou o feed real não tem SUV ≤70k). Diagnóstico na Fase E.

---

## FASES PENDENTES (B–E)

- **B — Cenários + motor de asserções determinísticas.** Os 3 roteiros sintéticos obrigatórios (descoberta/estoque/memória/fotos; mudança de direção/referências; SDR/anti-handoff-precoce) + as asserções críticas (nenhum veículo fora dos QueryResults; nada fora da categoria/teto; preferência atual > memória; "mais opções" preserva filtros e exclui mostrados; ordinal → mesmo vehicleKey; foto → send_media correto; negação de foto → sem mídia; não repergunta slot known/declined; não reapresenta após turno 1; uma decisão por rajada; sem texto técnico; sem handoff antes do funil; sem ação externa; prompt presente em toda chamada; registrar turnos comerciais que ainda desviam pro handler).
- **C — Judge (rubric fixa, temp 0, não-autoridade) + relatórios JSON+MD sanitizados** (transcrição, decisões/reasonCode, tools/filtros, fatos, delta de slots, efeitos planejados, #chamadas LLM, modelo real, latência/tokens, violações, nota, comparação entre 2 execuções).
- **D — 3 replays do Pedro v2 anonimizados.** ⚠️ Limitação a registrar: acesso seguro às conversas reais do v2 exige anonimização (nome/telefone/CPF/IDs); se não for viável com segurança, usar os casos DOCUMENTADOS no Brain (memória: "mais opções" perdeu categoria; foto/ordinal errado; funil/handoff).
- **E — Rodar matriz (cada cenário ≥2×, detectar variância) + análise por causa-raiz + propor correções por INVARIANTES (sem implementar).** Depois **PARAR para auditoria do Codex** antes de tocar produção ou iniciar a Fase 1.

**Critério de qualidade (E):** zero falhas críticas + ≥85/100 por cenário no judge.

## Regras honradas
Sem FakeLlm (prova HTTP real exigida); sem mudança de produção; sem deploy/SQL-write/db push/reset; CLI gated fora do test:all; sanitização de chave/prompt/telefone/CPF; `tsc` verde; `test:all` inalterado.

---

## FASE E — RESULTADO DA MATRIZ (execução real 2026-07-01) + ANÁLISE

**Prova LLM real:** 205 chamadas HTTP à OpenAI, **todas 2xx**, modelo `gpt-4.1-mini-2025-04-14`, **prompt do portal presente em TODAS (`allPromptPresent=true`)**. Efeitos OFF (nenhum dispatch). Relatórios em `Agent/eval/reports/eval-report.{json,md}`.

**Notas do judge (temp 0), 6 cenários × 2 (tudo << 85 = GATE FAIL, esperado):**
| cenário | judge | críticas |
|---|---|---|
| s1 descoberta/estoque/memória/fotos | 28 / 38 | 0 |
| s2 direção/referências | 53 / 53 | **1** (foto negada gerou mídia) |
| s3 SDR/anti-handoff | 37 / 37 | 0 |
| r1 "mais opções" perdeu categoria | 20 / 20 | 0 |
| r2 foto/ordinal | 57 / 47 | 0 |
| r3 repergunta/funil | 45 / 47 | 0 |

### Falhas agrupadas por CAUSA-RAIZ (ranqueadas por impacto)

- **RC1 — LAÇO INFINITO "Qual é seu nome?" (o assassino nº1, em TODO cenário).** A pergunta pendente do funil NÃO liga a resposta ao slot. s1 T3 lead="Douglas" → agente repergunta o nome; a partir daí TODO turno termina em "Qual é seu nome?", inclusive s1 T13 onde o agente escreve *"Ótimo, Douglas!"* e **mesmo assim** repergunta. O slot `nome` nunca é preenchido (bare name não é capturado; a resposta à pergunta pendente não é vinculada), o funil trava, e o condutor cospe o 1º slot faltante (nome) em todo fallback/continuity/terminal-safe.
  - **Invariante proposta:** *"Quando há `currentObjective` pendente (ex.: perguntou nome), a próxima mensagem do lead que satisfaz o `expectedAnswerKind` PREENCHE o slot; um slot cuja pergunta foi respondida nunca é reperguntado."* (answer-binding do objetivo pendente — determinístico, não `if` por frase).
- **RC2 — Palavra de TIPO vaza como MODELO na busca.** s1 T4 "SUV até 70k" → `stock_search({modelo:"suv", tipo:"suv", precoMax:70000})` → 0 (idem T10 "picape"→`modelo:"picape"`). O `modelo:"suv"` (filtro textual) zera a busca **mesmo havendo SUVs reais no estoque** — o A/B/C consertou o handler determinístico, mas o caminho **interpret/claim do LLM** re-injeta "suv" como modelo.
  - **Invariante proposta:** *"Um termo de TIPO (suv/sedan/hatch/picape) NUNCA é aceito como `modelo`; tipo vai só em `tipo`."* (excluir o vocabulário de tipo das claims de modelo em `collectClaims`/aceitação da interpretação).
- **RC3 — Turnos comerciais caindo em `terminal_safe`.** s1 T5 "Tem mais opções?" e T12 "Quero financiar…" → `terminal_safe` (grounding negou após retries) → fallback genérico. Pergunta comercial legítima virando resposta técnica-disfarçada.
  - **Invariante proposta:** *"Pergunta comercial legítima nunca vira terminal-safe genérico: o determinístico aterra os fatos e o LLM compõe seguindo o prompt."* → é a **Fase 1 do rebalanceamento** (Brain/10).
- **RC4 — Condutor spamma o mesmo slot.** Consequência de RC1: o funil nunca avança, então o condutor repete o slot faltante todo turno. Resolve com RC1 + a seleção/ordem de slots vir do prompt (Fase 1/§8 do Brain/10).
- **RC5 — Handler bypass (rebalanceamento).** Turnos comerciais que desviam do LLM+prompt via handler (texto fixo): s1 `[4,6,7,10]`, s2 `[1,2,3,10]`, r1 `[1]` etc. Confirma, com dado real, a necessidade da **Fase 1**.
- **RC6 — Negação de foto gerou mídia (CRÍTICA).** s2 T7 "Não quero mais fotos" → `send_media`. O guard de negação (`isNegatedPhotoRequest`/Layer 2) não pegou o caso real.
  - **Invariante proposta:** *"Negação de foto no turno atual → NUNCA `send_media` (fail-closed na negação)."*
- **RC7 — "Mais opções" perde teto e não exclui mostrados.** r1/s2 T5 → `stock_search({modelo:"suv"})` sem `precoMax` nem `excludeKeys`. (Parcialmente encoberto por RC2/RC3, que primeiro precisam de uma oferta real.)
  - **Invariante proposta:** *"'mais opções' herda tipo+precoMax do último pedido e exclui os `vehicleKeys` já mostrados."*
- **RC8 — Alucinação de veículo não-ofertado.** s1 T9 "Ele é automático?" → *"Sim, o SUV que você gostou é automático"* — **nenhum SUV foi ofertado** (T4 deu 0). O grounding não pegou porque a alucinação é genérica ("o SUV"), sem `vehicleKey`.
  - **Invariante proposta:** *"O agente não afirma detalhe de um veículo se não há veículo em foco/ofertado aterrado no turno/estado."*

### Prioridade (maior impacto primeiro)
**RC1 (answer-binding do nome/slot) e RC2 (tipo-como-modelo)** sozinhas explicam a maior parte das notas baixas — corrigi-las deve destravar quase todos os cenários. RC3/RC4/RC5 são a **Fase 1** (rebalanceamento). RC6/RC7/RC8 são guardas pontuais aterrados.

### NÃO IMPLEMENTADO (por ordem da missão)
As propostas acima são por INVARIANTE, **sem implementação nesta rodada**. **PARAR para auditoria do Codex** antes de tocar produção ou iniciar a Fase 1. `tsc` verde; `test:all` inalterado; nada commitado.

---

## AUDITORIA CODEX — CORREÇÃO OBRIGATÓRIA DO EVALUADOR (2026-07-01, 2ª rodada)

> **O Codex REPROVOU o baseline e as causas-raiz acima (mantém a ESTRUTURA aprovada).** Achado P0: o harness chamava `runConversationTurn` e lia o outbox, mas **NÃO simulava o ciclo de receipt `accepted`** → **amnésia artificial** (`append_assistant_turn`/`activate_objective` nunca aplicavam; `currentObjective` ficava `null`; o "Douglas" seguinte não satisfazia o nome; o condutor cuspia o slot faltante todo turno). **RC1 (laço "Qual seu nome?") era ARTEFATO DO MEU HARNESS, não bug do agente.**

### O que foi corrigido no evaluador (9 itens, todos feitos)
1. **Ciclo de receipt `accepted` REAL** (`eval/real-harness.ts`): após cada turno, o harness faz `claimOutbox` + `commitEffectOutcome` **reais** com um `EffectResult` `accepted` sintético — replica o `OutboxDispatcher` **SEM despachar** (sem sender, sem rede). Descoberto no meio: `commitEffectOutcome` exige o record **claimed** (senão `outbox_result_transition_invalid`); pular o `claimOutbox` manteria a amnésia. Estado recarregado a cada turno.
2. **Dois modos:** `pilot-realistic` (baseline oficial: `accepted`; mídia **não** vira `delivered`, ledger não avança — reproduz a Issue C real) e `ideal-delivered` (opcional; `send_media` com `delivered` p/ inspecionar o ledger pretendido).
3. **Prova por TESTE** (`tests/run-f2-7-18-eval-receipt-cycle.ts`, offline, no `test:all`, **14/14 OK**): `send_message` `accepted` → objetivo `nome` vira **ATIVO** (`currentObjective` pending, `expectedAnswerKinds` preservado) + fala do agente em `recentTurns`; `send_media` `accepted` **não** aplica o ledger; `delivered` aplica; `accepted→delivered` não trava. Receipt sintético (`providerMessageId eval-*`), zero dispatcher.
4. **`assertions.ts`:** grounding **por turno** (removido `allReturnedKeys` global; veículo anterior só via lista renderizada em foco); **RC1 answer-binding** agora exige resposta **compatível** com o `expectedAnswerKind` do slot **+ pergunta interrogativa** (não casa acknowledgment); **outbox exposto** (`status`/`receiptLevel`, `outboxAudit`) provando zero dispatch. Novos detectores: **`SLOT_FIXATION`** (mesmo slot ≥3× consecutivas) e **`HALLUCINATED_VEHICLE`** (atributo de veículo sem oferta aterrada).
5. **Judge:** recebe o **prompt real do portal EM MEMÓRIA** (mede `fidelidade_prompt` contra ele); o prompt **nunca** é escrito no relatório (só o SHA-256).
6. **Prova de prompt integral:** o transporte parseia o JSON enviado à OpenAI, compara o system prompt **na íntegra** (`promptExact`) e registra **SHA-256** — não os 32 chars.
7. **Rename:** `replay_v2` → **`synthetic_v2_incident`** (não são conversas reais; são fixtures documentadas).
8. **Rerun:** `PEDRO_V3_REAL_EVAL=1 npm run eval:conversation:real` + `npm run test:all` + `npx tsc --noEmit` — **todos verdes** (eval = GATE FAIL esperado).
9. **Comparação antes/depois** entregue nos relatórios + abaixo.

### PROVA (rerun final 2026-07-01T19:41Z, `eval/reports/run-final.log`)
- **206 chamadas à OpenAI (204 2xx; 2 falhas transitórias), `gpt-4.1-mini-2025-04-14`, prompt INTEGRAL em TODAS (SHA `009edd16…`).**
- **`dispatchExterno=false` · erros de commit de aceite=0** (efeitos OFF confirmados).
- **Fim da amnésia:** `recentTurnsMax=26` (era 0), objetivo ativo em **todo** turno, `nomeKnown=true` em s1/s2/s3/r3.

| cenário | judge ANTES (harness defeituoso) | judge DEPOIS (corrigido) | críticas DEPOIS |
|---|---|---|---|
| s1 descoberta/estoque/memória/fotos | 33 | **65** | 3 (fixação possuiTroca ×2 + alucinação) |
| s2 direção/referências | 53 | **55** | 1 (fixação nome) |
| s3 SDR/anti-handoff | 37 | **54** | 3 (fixação tipoVeiculo 3→5×) |
| r1 mais-opções | 20 | **41** | 0–1 (variância) |
| r2 foto/ordinal | 52 | **60** | 0–1 (variância) |
| r3 repergunta/funil | 46 | **60** | 0 |

### Causas-raiz REVISADAS (baseline fiel; ranqueadas)
- **RC1 (laço do nome) = REFUTADA como bug do agente.** Era artefato da amnésia do harness. Com o aceite aplicado, o nome vincula (`nomeKnown=true`). ⚠️ Efeito colateral REAL apareceu: **over-binding** — o binder determinístico é ganancioso e grava lixo no slot pendente (s2 T4 "Mostra mais opções" → `nome="Mostra Mais Opções"`; `possuiTroca=true` do nada). É o OPOSTO do RC1: liga demais.
- **RC-FIXAÇÃO (novo nº1) = o condutor/funnel-force ANEXA a MESMA pergunta de slot todo turno**, ignorando a fala do lead (s1 "Tem carro p/ troca?" 6×; s2 "Qual seu nome?" em toda msg mesmo após ofertar 5 carros; s3 "que tipo de carro?" 3→5× enquanto o lead dá troca/pagamento/entrada/visita). É o **RC5/Fase 1 (rebalanceamento)** provado com dado real: handler cospe texto fixo, não deixa o LLM compor seguindo o prompt.
- **RC2 (tipo-como-modelo) = CONFIRMADA e PRECISA:** só **palavra de TIPO** como `modelo` zera (`{modelo:"suv"|"sedan"|"hatch"|"picape"}`→0); **modelo real** funciona (`{modelo:"ONIX"}`→2, `{modelo:"hb20"}`→3). Invariante: termo de tipo nunca entra em `modelo`.
- **RC8 (alucinação) = CONFIRMADA:** s1 T9 "O SUV que você gostou é automático" sem NENHUMA oferta aterrada (T4 deu 0). Invariante: não afirmar detalhe de veículo sem oferta/foco aterrado.
- **RC3 (comercial→terminal_safe) = persiste** (s2 T4 "mostra mais opções"→`terminal_safe`).
- **RC6 (negação de foto→mídia):** neste rerun NÃO reincidiu como crítica; monitorar.

### Prioridade revisada
**RC-FIXAÇÃO + over-binding** (ambos = binder/condutor determinístico rígido) são o assassino nº1 agora — e são exatamente a **Fase 1 do rebalanceamento** (Brain/10): fatos vêm do handler, **composição/seleção de slot pelo LLM seguindo o prompt do portal**. RC2 e RC8 são guardas pontuais aterrados.

### NÃO IMPLEMENTADO / travas honradas
Correções **só no evaluador** (`eval/*` + 1 teste offline). **Nenhuma mudança de produção. Sem commit/push/deploy/SQL/reset.** `tsc` verde, `test:all` verde. **PARADO para nova auditoria do Codex** antes de tocar produção ou iniciar a Fase 1. As causas-raiz acima ainda são propostas por INVARIANTE, **não implementadas**.
