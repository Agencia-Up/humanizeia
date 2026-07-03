# R12-A — Frame governa os caminhos conversacionais comerciais (Claude executor) — 2026-07-02

> Encomenda do Codex após aprovar o diagnóstico do R11 (achado #2: o frame só governava `conductDecision`/
> compose; handlers determinísticos saíam pelo legado `applySdrConduction`). NÃO commitado/deployado. Sem SQL.
> Regras honradas: sem if-por-frase; sem remover grounding/policy; sem tocar Pedro v2/bridge/webhook/CRM/handoff;
> sem deixar handler comercial responder texto robótico que deveria passar pelo compose; sem duplicar condução.

## O que foi feito
**Migração de `continuity_conduct` (que cobre soft-buy "gostei"/"bonito ele") do caminho LEGADO (menu robótico
via `applySdrConduction`) para o MODERNO (`needsCompose=true` → conductDecision(frame) → composeAndVerify → policy).**

- `src/engine/continuity-fallback.ts`:
  - NOVO `resolveContinuityFacts({state, runQuery})`: se há veículo SELECIONADO, busca `vehicle_details(selectedKey)`
    → os fatos aterram nome/preço/atributos do veículo em jogo (**grounding-safe**: o compose pode citar "o CRV" sem
    virar terminal-safe). Sem seleção → facts=[] e o frame conduz o funil sem citar veículo específico.
  - `buildContinuityTurnOutput` agora retorna `needsCompose=true` + `fallbackText` (o `buildContextualSdrReply` só
    entra em falha de compose/policy) + guidance BASE curta (o frame injeta a condução real). reasonCode intacto.
- `src/engine/conversation-engine.ts`: a branch de continuidade resolve os fatos e chama o build migrado. Como agora
  é `needsCompose`, entra na rota do frame e **nunca** cai no `applySdrConduction` (sem dupla condução).
- `more_options`/`explicit_offer` JÁ eram `needsCompose` (confirmado). `photo`/`ranking`/`invalidOrdinal` seguem
  técnicos/pronto (Codex permite; não flagrados no eval).

## Testes
- NOVO `tests/run-f2-10-conduction-routing.ts` — **30 OK / 0 FALHA**. Os 6 casos E2E do Codex, pelo engine REAL com
  `sdrPolicy` + compose overrides (FakeLlm só estrutura): (1) "gostei"→compose, avança 1 slot; (2) "bonito ele"→sem
  foto de novo, sem menu, sem slot known; (3) "mais opções"→mantém tipo/teto/exclui-mostrado + compose; (4) "ok" com
  objetivo pendente→conduz sem reperguntar; (5) buy-strong→acelera (pede essencial), sem handoff silencioso;
  (6) invariantes: 2-perguntas→terminal-safe, slot-known→terminal-safe, slot-faltante→objetivo reconciliado.
- `tests/run-f2-7-11-continuity-fallback.ts`: atualizada a asserção e2e1 (checava LITERALMENTE o menu robótico
  `/fotos|filtre|valor/` que o R12-A REMOVE) → agora prova o roteamento (`terminalSafe===false`).

## Gates offline (VERDES)
- `tsc --noEmit` → **EXIT 0**. `npm run test:all` → **EXIT 0**, 0 FALHA (F2.10=30, F2.9=34, F2.8=166, F2.7.11 atualizado).

## Eval real (gpt-4.1-mini, temp 0.7, efeitos OFF, prompt integral SHA 009edd16; 201 chamadas 2xx; s1,s2,s3,r2,r3 × 2)
| cenário | judge (r1/r2) | críticas | vs R11 |
|---|---|---|---|
| s1 descoberta/estoque/fotos | 69/80 | 1/1 | crit 3→2, judge↑ — **alvo do R12-A** |
| s2 direção/referências | 69/52 | 3/3 | regressão ESTOCÁSTICA (ver abaixo) |
| s3 anti-handoff | 83/89 | 1/1 | estável-bom |
| r2 foto-ordinal (novo) | 78/70 | 0/0 | **LIMPO** |
| r3 incidente-v2 | 57/57 | 0/0 | estável (juiz alucina nome) |

terminal-safe 6/76; **continuity_conduct = 6 turnos, TODOS send_message[accepted] (0 terminal-safe)**.

## PROVA do R12-A (transcrição real s1)
- **T6 "Gostei do segundo"** — ANTES (R11): *"Quer ver as fotos de algum desses, ou prefere que eu filtre por
  valor, câmbio ou ano?"* (menu robótico, ignora a escolha). **AGORA:** *"Que bom que gostou do segundo! Posso ajudar
  a enviar fotos e mais detalhes desse **Honda CRV**... Você tem algum carro para dar de troca?"* — nomeia o CRV
  (aterrado via `vehicle_details`), reconhece a escolha, avança o funil.
- **T8 "Bonito ele"** — **AGORA:** *"Legal que gostou do **Honda CRV**! Ele tem câmbio automático e está com essa
  quilometragem que você viu nas fotos... Você tem algum carro para dar de troca?"* — cita atributos REAIS do CRV,
  sem menu, sem reenviar foto. **O achado #2 do R11 está fechado.**

## Por que o gate ainda dá FAIL (tabela honesta por turno)
Nenhuma das falhas é causada pelo R12-A. **s2 NÃO TEM nenhum turno `continuity_conduct`** → executa código idêntico
ao R11; a queda 70→60,5 é 100% variância de temp 0.7 + fixação de nome pré-existente.

| cenário | turno | lead | reason_code | causa raiz | arquivo provável | correção / escopo |
|---|---|---|---|---|---|---|
| s1 | T9 (r1,r2) | "Ele é automático?" | terminal_safe POL-ATTR-VALUE | LLM afirma COR divergente num turno de detalhe (perguntaram câmbio) | policy-engine.ts (rede OK) / compose de detalhe | reforçar guidance "responda SÓ o atributo perguntado" — **GROUNDING (Codex), fora do R12-A** |
| s2 | T3 (r1,r2) | "Tem Onix ou HB20?" | terminal_safe POL-GROUND-STOCK | LLM escreve "ONIX" em texto livre (0 no estoque); fallback honesto já diz "não encontrei ONIX" | explicit-search.ts (guidance explicit_not_found) | guidance p/ não nomear modelo ausente — **GROUNDING/BUSCA (Codex)** |
| s2 | T9,T10 (r1,r2) | "algo mais barato?"/"volta no HB20" | offer_more_affordable/explicit_offer | lead NUNCA dá o nome; anti-fixação não troca através de turnos de handler intercalados | sdr-conductor.ts adjustDraftSafeguards / frame nextQuestion | após N asks de nome sem resposta, parar de pedir e conduzir — **FOLLOW-UP R12-B** |
| s3 | T4/T6 (r1,r2) | "Sou de Taubaté…"/"Quero financiar" | terminal_safe POL-QUESTION-OBJECTIVE | LLM empilha 2 perguntas apesar do [UMA PERGUNTA]; POL determinística PEGA | compose (advisory) | reforço de retry-guidance de uma-pergunta — advisory, rede já protege (=R11) |

## Recomendação
**R12-A ATINGIU o objetivo escopado (migrar a condução comercial p/ o frame) e está PROVADO no eval (s1 T6/T8),
com gates offline verdes e ZERO terminal-safe novo. PODE ir para auditoria Codex.** Mas — conforme a regra do Codex
"se o gate não passar, não declarar concluído" — **NÃO declaro o gate geral aprovado**: sobram falhas PRÉ-EXISTENTES
e FORA do escopo do R12-A (grounding cor/ONIX = área Codex; fixação de nome = R12-B; 2-perguntas = advisory já contido).
**NÃO deployar.**

## Próximas rodadas sugeridas
- **R12-B (fixação de nome):** quando o lead ignora o pedido de nome por N turnos, parar de reperguntar e conduzir
  (o funil não pode travar num slot que o lead se recusa a dar). Toca sdr-conductor/frame — decisão do Codex.
- **R12-C (Codex, grounding):** cor no turno de detalhe (s1 T9) + "ONIX" em texto livre (s2 T3).
- Migrar `economy`/`ranking` p/ compose só se o Codex quiser (não flagrados; grounded hoje).
