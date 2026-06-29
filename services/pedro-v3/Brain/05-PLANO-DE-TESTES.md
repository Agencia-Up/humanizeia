# 05 - Plano de Testes do Pedro v3

> Status: Fase 0 — proposta para auditoria do Codex.
> Autor: Claude. Data: 2026-06-26.
> Base: contexto-mestre §16/§17; catálogo `04`; contratos `02` (já com correções Codex).
> Princípio: **o v3 não entra em produção só porque o unitário passou.** Cada camada é gate.

## 1. Camadas obrigatórias (do mais barato ao mais caro)

| # | Camada | O que prova | Custo | Gate |
|---|---|---|---|---|
| L1 | **Unit dos contratos/políticas** | tipos, reducer (`StateReducer`), `PolicyEngine.evaluate`, funções puras migradas do v2 | $0 offline | sempre verde |
| L2 | **Contrato de cada QueryTool** (fake) | entrada/saída/erros tipados; "sem base = no-op"; feed fixo | $0 | por tool |
| L3 | **Contrato de cada EffectIntent/outbox** | idempotência, ordem (`order`/`depends_on`), receipt, retry, `skipped` em shadow | $0 (fake) | por efeito |
| L4 | **Multiturno com estado realista** | continuidade (não perder trilho), foco, "mais opções", funil | $0 (FakeLlm) | bloqueia |
| L5 | **Concorrência / burst / idempotência** | lock, CAS, `INSERT ON CONFLICT`=dedupe, at-least-once + effectively-once **condicional ao provider** | $0 | bloqueia |
| L6 | **Property tests** dos invariantes de estoque/foto/handoff | POL-STOCK/PHOTO/HANDOFF/GROUND | $0 | bloqueia |
| L7 | **Replays anonimizados** de conversas que falharam no v2 | regressão dos casos reais | $0 (offline) | bloqueia |
| L8 | **Golden conversations** (resultado esperado por turno) | decisão/ação por turno | $0 a $ | bloqueia |
| L9 | **Shadow** comparando v2 × v3 | concordância de decisão + avaliação humana | $ (LLM real) | gate de canary |
| L10 | **Canary** no agente de teste `douglasaloan@gmail.com` | ponta-a-ponta com rollback testado | controlado | gate de expansão |

## 2. Casos mínimos obrigatórios (contexto-mestre §16) → política

| Caso mínimo | Política(s) | Camada |
|---|---|---|
| lead responde nome/troca/entrada/parcela sem perder trilho | POL-TRACK-001/002/003/DATA/010 | L4/L7 |
| typo de modelo resolve contra a oferta atual, não sequestra modelo novo | POL-STATE (resolver v218), POL-STOCK-002 | L4 |
| "mais opções" preserva filtros e não repete | POL-STOCK-002 | L4/L6 |
| foto enviada uma vez para o veículo correto | POL-PHOTO-001/002 | L6 |
| laudo/preço/km permanece no veículo em foco | POL-GROUND-PRICE/CLAIM, POL-PHOTO-001 | L6 |
| mensagens consecutivas viram um único turno coerente | POL-STATE-004 (burst) | L5 |
| mudança explícita de modelo vence memória antiga | POL-TRACK-010, POL-STOCK-003 | L4 |
| categoria e teto preservados | POL-STOCK-003 | L6 |
| lista sempre com formatação única | POL-STOCK-006 | L4 |
| handoff incompleto bloqueado antes de qualquer efeito externo | POL-HANDOFF-001/002, POL-TOOL-001 | L3/L6 |
| falha de transferência tratada e recuperável | POL-HANDOFF-003 | L3 |
| nenhum turno produz duas ações comerciais conflitantes | POL-STATE-001/003 | L4 |
| reação/emoji não vira ação | POL-PERSONA-002 | L4 |
| lead pausado/assumido → IA silencia | POL-OWN-002 | L4 |
| `fromMe` de vendedor não dispara IA | POL-OWN-001 | L4 |
| CPF/segredo nunca em evento/log | POL-PRIV-001/002 | L1 (property) |
| ordem de efeito: anúncio antes do handoff | POL-TOOL-001 | L3 |

## 3. Testes específicos das correções do Codex (rodadas 1 e 2)

**Rodada 1:**
- **#1 ingestão atômica:** dois eventos com mesmo `event_id` → 1 processa, 1 no_op (L5).
- **#2 query×effect:** QueryTool roda em shadow; efeito é `skipped` em shadow (L2/L3).
- **#3 outbox:** efeitos persistidos na mesma tx; dispatcher respeita `order`/`depends_on` (L3).
- **#4 loop de queries:** decisão final única após **≥2 passos** do `proposeNextQueryOrFinal`; respeita `maxSteps`/`totalTimeoutMs`; cada `QueryCall` autorizada por `authorizeQuery`; saída segura se estoura (L4).
- **#5 reducer:** `DecisionMutation` inválida é rejeitada; estado não corrompe (L1).
- **#6 finalizer:** `PolicyEngine` só devolve allow/deny/requirements/violations; só o `Finalizer` emite decisão (L1).
- **#8 sensível:** property "nenhum `v3_turn_events`/log casa CPF/token"; `Redacted<T>` exigido por tipo; CPF só `SensitiveValueRef` (L1).
- **#9 at-least-once:** reprocessar o mesmo turno não duplica envio/CRM/handoff (L5).

**Rodada 2 (cenários obrigatórios — Codex #10):**
- **R2-1 aceite com resposta perdida:** envio ACEITO pelo provider mas resposta perde → status `outcome_uncertain`; reconcilia por capability (não reenvia cego) (L3/L5).
- **R2-2 falha de envio não avança ledger:** `send_media` falha → `mark_photos_sent` NÃO aplica; `PhotoLedger` não avança (POL-STATE-007) (L3).
- **R2-3 pergunta não entregue:** `send_message` da pergunta falha → objetivo NÃO vira `asked/delivered`/PendingObjective ativo (POL-STATE-007) (L3).
- **R2-4 handoff aguarda anúncio:** `handoff` (order=2) só despacha após `send_message` do anúncio (order=1) = `succeeded` (POL-TOOL-001) (L3).
- **R2-5 query dependente de query:** o loop usa o resultado da query A para montar a query B (ex.: `ad_context`→`stock_search`) numa única decisão final (L4).
- **R2-6 pós-query bloqueia fora do teto:** veículo acima do teto proposto → `postQuery` dá `deny`; Finalizer troca por ação conforme (não oferece) (L6).
- **R2-7 validate falha → nada inválido:** `validateResponse` reprova (preço não-aterrado) → fallback validado OU aborta; **nenhum envio inválido materializado/persistido** (POL-STATE-008) (L1/L3).
- **R2-8 lease expira com worker antigo executando:** dois workers no mesmo claim → só um vence o CAS de versão; sem turno/efeito duplicado (L5).
- **R2-9 mensagem durante burst fechado:** msg chega após o `cutoff`/claim → fica `pending` p/ o PRÓXIMO turno; não entra no turno em andamento (L5).

**Rodada 3 (cenários obrigatórios — Codex #9):**
- **R3-1 pergunta planejada não aceita:** `send_message` da pergunta não confirma receipt → objetivo fica `PlannedObjective`, NÃO vira `currentObjective` ativo (POL-STATE-009) (L3).
- **R3-2 oferta não enviada:** `send_message`/`send_media` da oferta falha → `record_offer` NÃO aplica; `OfferMemory` não avança (POL-STATE-009) (L3).
- **R3-3 receipt ok + CAS do outcome falha → recupera:** efeito `succeeded`, mas o EffectOutcomeCommit colide no CAS → recarrega e reaplica; estado fica consistente (POL-STATE-010) (L5).
- **R3-4 outcome idempotente:** aplicar o MESMO `effectId` duas vezes → `outcome_applied_at` faz a 2ª ser no-op; estado não duplica (POL-STATE-010) (L1/L5).
- **R3-5 mídia parcial:** lote de 5 fotos com 3 `succeeded`/2 `failed` → `PhotoLedger` avança SÓ para os 3 photoIds confirmados (POL-STATE-009, r3 #5) (L3).
- **R3-6 query proibida nunca executa:** `authorizeQuery` dá `deny` para uma `QueryCall` → a tool não roda; o loop segue com `FORBIDDEN` (POL-STATE-011) (L1/L4).
- **R3-7 validação falha repetida sem loop/silêncio:** `validateResponse` reprova `maxAttempts` vezes → safe response + alerta + dead-letter; sem loop infinito nem silêncio (POL-STATE-012) (L1/L3).
- **R3-8 accepted ≠ delivered:** provider confirma só `accepted` → estado grava `delivery_level='accepted'`, nunca afirma `delivered` (POL-STATE-013) (L3).

## 4. Replays anonimizados (L7) — sementes do v2

Casos reais já provados no v2 (origem: changelog/commits/`offline.ts`) a migrar como replay por ID de política:

- Caso H financiamento (lead 98123-8305) → POL-TRACK-001.
- Objeção de troca (Francisco/Hilux) → POL-TRACK-002.
- Coleta de troca interrompida (99628-7178) → POL-TRACK-003.
- "mais opções" repetindo/fora de categoria (99647-8589) → POL-STOCK-002.
- Foto re-ofertada (dor nº1 do dono) → POL-PHOTO-002.
- Preço deflacionado p/ orçamento (R6) → POL-GROUND-PRICE.
- Garantia/laudo inventados (98861-9201) → POL-GROUND-CLAIM.
- Anúncio genérico → abordagem (98109-7851) → POL-STOCK/ROUTE.
- Reação 👍 transferiu (99146-6876) → POL-PERSONA-002.
- Drop sistêmico (Gilda 99175-5700) → POL-STATE-004 (inbox+lease).

**Anonimização:** importados de `wa_chat_history`/`pedro_v2_turn_logs` (LEITURA) com nomes/telefones/CPF substituídos por sintéticos estáveis (ADR-006), guardados já anonimizados em `Agent/tests/replays/`. Nunca conversa crua.

## 5. Métricas de shadow (L9) e sucesso (contexto-mestre §17)

`v3_shadow_comparisons`: `agreement` (v2_action == v3_action) + anotação humana de qualidade. Métricas comparativas: repetição de perguntas/listas/fotos; veículo/categoria/preço incorretos; buscas sem necessidade; handoffs prematuros/silenciosos; leads sem resposta; correções manuais; conclusão de slots; tempo até próxima ação útil; erro por tool; custo/latência por turno.

## 6. Critérios de saída por fase

- **Fase 1 (Kernel):** L1+L4 verdes com FakeLlm; "uma decisão por turno" provada; reducer/finalizer/policy isolados.
- **Fase 2 (Tools):** L2+L3 verdes; efeitos OFF por padrão.
- **Fase 3 (Shadow):** L5+L6+L7+L8 verdes; L9 com concordância medida e revisada.
- **Fase 4 (Canary):** L10 com rollback testado e métricas ≥ v2.

## 7. Pendências

- Definir o harness multiturno (formato dos golden/replays) no início da Fase 1.
- Mapear 1:1 cada caso do `offline.ts` do v2 → ID de política (tarefa de migração).
