# 01 - Status Atual do Pedro v3

> Atualize ao fim de cada etapa relevante. E o primeiro arquivo que qualquer executor le.
> Ultima atualizacao: 2026-06-28 - por Claude. **F2.5.4A.1 implementada (aguardando auditoria do Codex): correcoes dos bloqueadores P1/P2/P3 — matriz estrita de leitura (segredo so em platform_integrations/selectOne), canary com config-load real do agente, corpo limitado + projecao local, chave 100% privada. 397 OK | 0 FALHA.** (F2.5.4A reprovada por: allowlist ampla de segredo, canary sem vinculo ao agente, corpo ilimitado, header de chave publico.)

## Fase atual

**F2.5.3 concluida por Codex.** O Pedro v3 agora possui adapters de leitura do v2 por contrato de banco injetavel: `V2DatabaseReadGateway` e `V2DatabaseCredentialProvider`. Eles nao importam SDK Supabase, nao abrem rede e nao fazem escrita; apenas definem o contrato seguro que um wrapper real devera cumprir.

**Gates locais:** 67 Kernel + 96 Fase 2 + 34 SQL + 21 Adapter Postgres + 127 Read-side = **345 OK | 0 FALHA**; `tsc --noEmit` limpo.

**Garantias F2.5.3 aplicadas:** leituras sempre filtradas por tenant+agent quando aplicavel; metadata de estoque nao seleciona `api_key_encrypted`; CRM nao seleciona `cpf`/`birth_date`; CredentialProvider resolve segredo somente no ponto de uso e falha fechado em provider/cross-tenant; erro de banco vira `READ_SOURCE_FAILURE` sanitizado; sem WhatsApp, sem CRM-write, sem handoff, sem agenda e sem Supabase real.

**Pendencia operacional mantida:** a chave Supabase `service_role` exposta no scratch antigo ainda precisa ser rotacionada/revogada antes de qualquer canary/producao real. Mantida por decisao do dono para nao travar as fases offline.

**Proxima etapa sugerida:** F2.5.4 - wrapper real do client Supabase read-only + decryptor seguro ou canary shadow controlado, somente depois da rotacao/credencial segura e com EffectGate OFF.
## Melhorias e Garantias Aplicadas (Fase 1.5)

1. **Grounding estrito do Texto Livre (`TextPart`)**:
   - Respostas comerciais (`search_stock`, `send_photos`, `answer_vehicle_question`) nÃ£o podem citar veÃ­culos de marcas/modelos em texto livre.
   - Qualquer citaÃ§Ã£o detectada pelo `ClaimExtractor` em `TextPart` constitui uma violaÃ§Ã£o (`POL-GROUND-STOCK`), disparando o modo seguro de falha fechada (`terminalSafe`).

2. **DetecÃ§Ã£o DinÃ¢mica com `ClaimExtractor`**:
   - O `ClaimExtractor` foi injetado na assinatura de `TurnContext`. Ele Ã© o responsÃ¡vel oficial por rastrear alegaÃ§Ãµes de veÃ­culos em texto bruto.
   - Removido qualquer parsing de intenÃ§Ãµes baseado em `msg.includes` ou `rawMessage.includes` no motor interno.

3. **AdequaÃ§Ã£o do `TenantCatalog`**:
   - A tipagem do `TenantCatalog` no domain `decision.ts` foi reestruturada para suportar catÃ¡logo dinÃ¢mico via `entries: CatalogEntry[]` (contendo aliases e vehicleKey).
   - O `PolicyEngine` e os adaptadores de interpretaÃ§Ã£o agora utilizam puramente esta estrutura.

4. **Isolamento de Interpretadores (Adapters)**:
   - O arquivo `turn-interpreter.ts` (contendo `CatalogEntityExtractor` e `interpretTurn`) foi migrado de `src/engine/` para `src/adapters/turn-interpreter.ts` para separar as ferramentas de parsing de strings do motor centralizado puro.
   - `decision-engine.ts` nÃ£o possui qualquer importaÃ§Ã£o ou dependÃªncia direta de `turn-interpreter.ts`.

5. **MoneyRole Ã— MoneySource**:
   - A matriz rÃ­gida de relacionamentos monetÃ¡rios foi validada. Apenas fontes do tipo `vehicle_fact` alimentam `vehicle_price`.
   - PapÃ©is como `installment`, `down_payment` e `budget` estÃ£o estritamente amarrados Ã s suas respectivas fontes em `slot_value` (`entrada`, `parcelaDesejada`, `faixaPreco`). Qualquer violaÃ§Ã£o falha fechado.

6. **ValidaÃ§Ã£o do Reducer**:
   - O mÃ©todo `applyDecision` no `state-reducer.ts` agora exige `expectedTurnId` e `expectedNow` em sua assinatura.
   - MutaÃ§Ãµes que possuem `sourceTurnId` divergente ou cujo valor de slots Ã© invÃ¡lido (como faixaPreco invÃ¡lido) sÃ£o atomicamente rejeitadas pelo reducer.

## Kernel implementado (`Agent/`) â€” sem I/O

```
Agent/
  package.json, package-lock.json, tsconfig.json, .gitignore
  src/domain/   types.ts Â· context.ts Â· llm.ts Â· conversation-state.ts Â· decision.ts
  src/engine/   state-reducer.ts Â· policy-engine.ts Â· decision-engine.ts Â· finalizer.ts Â· catalog-utils.ts
  src/adapters/ llm/fake-llm.ts Â· turn-interpreter.ts
  tests/run.ts
```

## Testes (L1 + L4) â€” verdes

- `npm test` (`npx tsx tests/run.ts`) -> **67 OK | 0 FALHA** (corrigido na F2.0.1; valor anterior 54 estava desatualizado).
- `npx tsc --noEmit` â†’ **0 Erros de CompilaÃ§Ã£o**.
- Cobrem: 
  - Reducer bÃ¡sico, durÃ¡vel e com igualdade exata de `effectId`.
  - RejeiÃ§Ã£o de efeito forjado com mesmo sufixo mas turnId divergente.
  - Interpretador semÃ¢ntico diferenciando respostas de objetivos pendentes (troca/pagamento) de mudanÃ§as explÃ­citas de direÃ§Ã£o (mudar para sedan).
  - ValidaÃ§Ã£o de ciclos, dependÃªncias fantasmas e planIds duplicados nos planos.
  - Grounding com extraÃ§Ã£o monetÃ¡ria isolando parcelas de preÃ§os do veÃ­culo e bloqueio de alucinaÃ§Ãµes de marcas ("Audi Q5") nÃ£o consultadas.
  - Testes adversariais com marcas sintÃ©ticas (`Zeekr`, `Tesla`, `Volvo`, `Roma`).
  - Erros e timeouts de todas as etapas e globais capturados e retornando TurnDecisions consistentes emitidas pelo Finalizer.
  - 4 turnos encadeados multiturno integrados sem quebras de estado.

## Bloqueios / aguardando

- Nenhum. Pronto para prÃ³ximas diretivas de integraÃ§Ã£o de I/O ou deploy.

## Regras ativas

- `Agent/` tem cÃ³digo funcional simulado. Sem I/O real (banco, Postgres `v3_*`, CRM ou Uazapi real).
- O v2 permanece intacto e em execuÃ§Ã£o (somente leitura para o v3).

---

## Atualização Codex — Fase 1.5.1 — 2026-06-27

Codex assumiu a execução após término dos créditos do Antigravity e fechou as lacunas apontadas na auditoria da Fase 1.5.

Correções aplicadas:
- `catalog-utils.ts`: normalização canônica de catálogo agora remove acentos, transforma hífen/pontuação em separadores, compacta espaços e preserva `+` como `plus` para evitar que `C++` vire apenas `c`.
- `turn-interpreter.ts` em `adapters`: detecção de marca/modelo passou a usar termos completos normalizados do `TenantCatalog`, suportando aliases, modelos multi-palavra e hifenizados.
- `tests/run.ts`: suíte ampliada de 54 para 67 testes, cobrindo lacunas que a auditoria encontrou.

Novos cenários provados:
- `confidence > 1`, `sourceTurnId` errado, `faixaPreco.max` negativo, `min > max` e `veiculoTroca` vazio são rejeitados atomicamente.
- `vehicle_ref` com `field: "preco"` falha fechado.
- `money_ref` com `installment` vindo de `vehicle_fact` falha fechado.
- `Zeekr X` em texto livre usando preço real de outro carro gera `deny`.
- Catálogo aceita chave hifenizada contra marca/modelo multi-palavra (`Land Rover` / `Range Rover Evoque`).
- Catálogo aceita uppercase/lowercase canônico (`FIAT` / `fiat`).
- Normalização preserva `C++` como `c plus plus`.
- Extractor reconhece `Range Rover Evoque` multi-palavra e `C++` sem quebrar por metacaractere.

Validação executada:
- `npm.cmd test` -> `67 OK | 0 FALHA`.
- `npm.cmd exec -- tsc --noEmit` -> sem erros.
- `rg` no `src/engine` e `src/domain` para `msg.includes`, `rawMessage.includes`, `priceClaims`, `mentionsVehicleKeys` -> sem achados.
- `rg` para `field: "preco"`/`field: 'preco'` em `src` -> sem achados.

Status: Fase 1.5.1 aprovada para auditoria final. Próximo passo recomendado: Claude não deve mexer no kernel sem motivo; deve partir para planejamento da Fase 2 (I/O/adapters/outbox) com autorização explícita e mantendo todos os testes verdes.

---

## Atualização Claude — Plano da Fase 2 entregue — 2026-06-27

Claude retomou (créditos do Antigravity acabaram). Baseline reconfirmado no ambiente: `npx tsx tests/run.ts` -> **67 OK | 0 FALHA**; `tsc --noEmit` limpo. **Kernel NÃO foi tocado.**

Entregue: **`Brain/07-PLANO-FASE-2.md`** — plano curto da Fase 2 (camada N8N-like real) respondendo aos 6 pontos do Codex: (1) arquivos a criar (ports/effect-intent/conversation-engine/effect-materializer/outbox-dispatcher/effect-outcome-commit/reconciler/in-memory-store/fake-dispatchers/run-phase2) sem tocar o kernel; (2) tabelas `v3_*` (já em `02 §4`), entregues como SQL PROPOSTA p/ o dono rodar; (3) tudo fake/in-memory primeiro (ports + InMemoryStore + fake dispatchers, EffectGate OFF); (4) hexagonal, sem driver/rede, adapters reais só em sub-fase autorizada; (5) testes R2-1..R2-9/R3-1..R3-8 end-to-end no engine in-memory; (6) aditivo — 67 verdes preservados + `tsc` limpo a cada handoff. **Sem mudança breaking de contrato do kernel** (tipos novos são aditivos em `domain/effect-intent.ts`).

**Status: aguardando auditoria do Codex do plano + autorização do dono p/ iniciar a F2.0** (nenhum I/O/banco/deploy nesta etapa).

---

## Atualização Claude — F2.0 (persistência in-memory) IMPLEMENTADA — 2026-06-27

Autorizada e concluída a **F2.0** (escopo estrito). **Sem ConversationEngine, dispatcher, reconciler, SQL, provider, banco, deploy. Kernel intocado.**

**Arquivos criados/alterados (só os do escopo):**
- `Agent/src/domain/effect-intent.ts` — tipos de persistência aditivos: `EffectStatus`, `ProviderCapability`, `EffectIntent`, `OutboxRecord`, `InboxRecord`, `TurnEventRecord`, helper `redact`.
- `Agent/src/domain/ports.ts` — interfaces de I/O puras: `Clock`, `IdGen`, `LeaseStore`, `InboxStore`, `StateStore`, `OutboxStore`, `UnitOfWork`, `Persistence`. Nenhuma implementação.
- `Agent/src/adapters/persistence/in-memory-store.ts` — `InMemoryPersistence` (Maps + UnitOfWork atômico + CAS), `FakeClock`, `FakeIdGen`. SEM rede/driver.
- `Agent/tests/run-phase2.ts` — 19 testes provando os 8 pontos.
- `Agent/package.json` — scripts `test:phase2` e `test:all`.

**8 pontos provados (19 testes):** (1) inbox dedupe atômico = o próprio insert; (2) claim/lease — 2 workers, só um vence + claim marca o evento; (3) cutoff — msg nova fica p/ próximo turno; (4) lease release no sucesso E no erro/finally; (5) CAS — commit com versão antiga falha; (6) UnitOfWork tudo-ou-nada — parte falha → nada persiste; (7) outbox store básico — records `pending` com effectId/idempotencyKey/order/dependsOn + idempotencyKey UNIQUE, sem dispatch; (8) determinismo — FakeClock/FakeIdGen reproduzíveis.

**Gates (todos verdes):** `npm test` → **67 OK** (kernel preservado) · `npm run test:phase2` → **19 OK** · `tsc --noEmit` → limpo · `rg fetch|http|postgres|pg|supabase src` → só 1 comentário no `ports.ts` (nenhum I/O real) · `rg msg.includes|rawMessage.includes src/engine src/domain` → **0 achados** (os existentes ficam só no parser `adapters/turn-interpreter.ts`).

**Próximo:** F2.1 (effect-materializer + conversation-engine + commit do ciclo) — só após auditoria do Codex.

---

## Atualização Claude — F2.0.1 (correções pós-auditoria) — 2026-06-27

Auditoria da F2.0 aprovou os gates, mas pediu 3 correções pequenas antes da F2.1 (sem iniciar ConversationEngine). Feitas:

1. **`withLease` assíncrono** — contrato em `ports.ts` agora `fn: (lease) => T | Promise<T>): Promise<T>`; `InMemoryPersistence.withLease` usa `await fn` dentro do try/finally. Testes: o lease **NÃO** é liberado enquanto a Promise está pendente; libera no **resolve** E no **reject**.
2. **Recuperação de inbox `claimed`** (menor solução coerente com `02 §9`): novo `InboxStore.releaseClaim(eventIds, claimedBy, turnId)` devolve o claim p/ `pending` (turno falhou antes do commit), e só libera o claim do worker/turno correto. Além disso, `UnitOfWork.markInboxDone(eventIds, claimedBy, turnId)` agora **valida**: só marca `done` evento que está `claimed` pelo MESMO worker/turno (commit rejeita se divergir). Testes: claim→releaseClaim volta p/ pending + re-claimável; releaseClaim com owner/turno errado não libera; markInboxDone com turno errado é rejeitado, com o correto vira `done`.
3. **Brain/01 corrigido** — o trecho stale "54 OK" virou **67 OK** (linha de validação da seção Codex).

**Gates F2.0.1 (todos verdes):** `npm test` → **67 OK** (kernel preservado) · `npm run test:phase2` → **27 OK** (era 19; +3 lease async, +5 recuperação) · `npm run test:all` → ambos · `tsc --noEmit` → limpo · `rg fetch|http|postgres|pg|supabase src` → só o comentário do `ports.ts` · `rg msg.includes|rawMessage.includes src/engine src/domain` → **0**.

**Escopo respeitado:** sem ConversationEngine/dispatcher/reconciler/SQL/provider/banco/deploy; v2 intocado; kernel intocado. **Parado para auditoria da F2.0.1.** Próximo (se aprovado): F2.1.


---

## Atualizacao Codex - F2.1 (ConversationEngine in-memory) - 2026-06-27

Codex assumiu a execucao apos termino dos creditos do Claude/Antigravity e concluiu a **F2.1** mantendo o escopo estrito da Fase 2: tudo fake/in-memory, sem I/O real.

Arquivos criados/alterados:
- `Agent/src/engine/effect-materializer.ts` - converte `TurnDecision.effectPlan` + `RenderedResponse` em `OutboxRecord[]` com `status=pending`, `idempotencyKey=effectId`, payload redacted e sem dispatch.
- `Agent/src/engine/conversation-engine.ts` - orquestra um turno atomico: lease -> cutoff -> claimBurst -> load/create state -> `runTurn` -> `applyDecision` -> materializa outbox -> UnitOfWork CAS -> eventos/decisao/outbox/inbox done.
- `Agent/tests/run-phase2.ts` - F2.1 adicionada aos testes da Fase 2.

Garantias provadas na F2.1:
- Sem inbox claimavel retorna `no_op`.
- Ciclo completo commita estado, decisao, eventos, outbox e marca inbox `done` somente no commit.
- Outbox nasce `pending`, sem receipt, sem dispatch e com `effectId/idempotencyKey` deterministico.
- Payload do efeito nasce `redacted` e usa o texto renderizado pelo `ResponseRenderer`.
- Falha antes do commit libera o claim para `pending` e nao persiste decision/outbox.
- Conflito CAS falha, libera claim e nao vaza decision/outbox do turno.
- Dedupe de inbox impede segundo processamento do mesmo eventId.
- Cutoff do engine deixa mensagem futura pendente para o proximo turno.

Gates executados:
- `npm.cmd run test:all` -> **KERNEL 67 OK | 0 FALHA** + **F2.0/F2.1 41 OK | 0 FALHA**.
- `npm.cmd exec -- tsc --noEmit` -> sem erros.
- `rg "fetch|http|postgres|pg|supabase|createClient|uazapi" src` -> somente comentario em `domain/ports.ts`; nenhum I/O real.
- `rg "msg\.includes|rawMessage\.includes" src/engine src/domain` -> 0 achados.

Escopo respeitado:
- Sem dispatcher, reconciler, SQL, provider real, banco, migration ou deploy.
- Kernel preservado; F2.1 consome contratos existentes.
- v2 intocado.

Proximo passo recomendado: **F2.2 - OutboxDispatcher fake + EffectOutcomeCommit in-memory** (Concluido na F2.2.1).

---

## Atualizacao Antigravity - F2.2 / F2.2.1 (OutboxDispatcher e EffectOutcomeCommit in-memory) - 2026-06-27

Antigravity assumiu a execucao da **F2.2 / F2.2.1** mantendo o escopo estrito da Fase 2: tudo fake/in-memory, sem I/O real.

Arquivos criados/alterados:
- `Agent/src/engine/outbox-dispatcher.ts` [NEW] - Realiza a varredura e despacho de efeitos, respeitando dependências explícitas (`dependsOn`) e linearidade implícita (`order`). Se uma dependência falhar ou for pulada, os dependentes são marcados como `"skipped"` em cascata.
- `Agent/src/engine/effect-outcome-commit.ts` [NEW] - Aplica os resultados de efeitos de forma transacional (CAS) e idempotente. Diferencia `"accepted"` (não altera o estado conversacional, `outcomeAppliedAt` continua `null`) de `"delivered"` (atualiza estado via `applyEffectOutcome` e define `outcomeAppliedAt`).
- `Agent/src/domain/ports.ts` [MODIFY] - Adicionado o método `updateOutbox` na interface `UnitOfWork`.
- `Agent/src/adapters/persistence/in-memory-store.ts` [MODIFY] - Implementada a gravação de updates de outbox record na `UnitOfWork` do `InMemoryPersistence`, validando a imutabilidade dos campos estruturais (`effectId`, `idempotencyKey`, `conversationId`, `turnId`, `planId`, `kind`) no `commit()`.
- `Agent/tests/run-phase2.ts` [MODIFY] - Adicionada a suíte de testes F2.2 (Testes 11 a 14) e F2.2.1 (Testes 15 a 17).

Garantias provadas na F2.2 / F2.2.1:
- **dependsOn e order**: Respeito à ordem de execução e dependências explícitas e implícitas.
- **Skipped em cascata**: Propagação de `"skipped"` se a dependência falhar.
- **Diferenciação de receipts**: `"accepted"` não muda estado conversacional e mantém `outcomeAppliedAt = null`. `"delivered"` aplica reducer conversacional e preenche `outcomeAppliedAt`.
- **Validações rígidas no commit**: Mismatch de IDs no `commitEffectOutcome` aborta o commit; updates de outbox inexistentes ou modificando chaves imutáveis no UoW são rejeitados no `commit()`.
- **CAS real concorrente**: Simulação de CAS real através de interceptação prova que atualizações de estados concorrentes são barradas, sem aplicação parcial.

Gates finais executados e verdes:
- `npm.cmd run test:all` -> **KERNEL 67 OK | 0 FALHA** + **F2.0/F2.1/F2.2/F2.2.1 65 OK | 0 FALHA** (132 testes verdes totais).
- `npm.cmd exec -- tsc --noEmit` -> sem erros de compilação.
- `rg "fetch|http|postgres|pg|supabase|createClient|uazapi" src` -> somente comentário explicativo em `domain/ports.ts`.
- `rg "msg\.includes|rawMessage\.includes" src/engine src/domain` -> 0 achados.

Proximo passo recomendado: **F2.3 - Reconciler / Job Queue in-memory** (Concluido).

---

## Atualizacao Antigravity - F2.3 / F2.3.1 (Reconciler e EffectGate in-memory) - 2026-06-27

Antigravity assumiu a execucao da **F2.3 / F2.3.1** mantendo o escopo estrito da Fase 2: tudo fake/in-memory, sem I/O real.

Arquivos criados/alterados:
- `Agent/src/engine/receipt-policy.ts` [NEW] - Define em código se o efeito é crítico conversacionalmente (`isCriticalForConversationState`), se exige `"delivered"` ou `"accepted"` (`requiredReceiptFor`) e avalia se dependências prioritárias foram de fato satisfeitas (`isEffectSatisfiedForDependency`).
- `Agent/src/engine/effect-gate.ts` [NEW] - Proporciona o controle em memória para alternar entre Active e Shadow Mode.
- `Agent/src/engine/reconciler.ts` [NEW] - Realiza a varredura e conciliação de registros presos em `"processing"`, incertos em `"outcome_uncertain"` e timeouts de `"accepted"`. Limita retentativas (`maxAttempts`) movendo registros excedentes para dead-letter terminal (sem mutar estado conversacional).
  - **F2.3.1**: O reconcilador foi ajustado para aplicar a política e **não** lançar timeout de entrega (dead-letter) em efeitos não-críticos (como `send_message` sem `onSuccess`), pois estes exigem apenas receipt nível `"accepted"`.
- `Agent/src/engine/outbox-dispatcher.ts` [MODIFY] - Injetado o `EffectGate` e a verificação do Shadow Mode (onde os records viram `"skipped"` com `lastError = "shadow_mode_gate_active"`, significando consumido operacionalmente pelo gate). As dependências passaram a ser validadas estritamente pela política do `receipt-policy.ts`.
- `Agent/tests/run-phase2.ts` [MODIFY] - Adicionados os testes 18 a 24 da Fase 2.3/2.3.1, cobrindo reconciliação por capability, retentativas máximas (dead-letter), timeouts de accepted apenas para efeitos críticos, liberação normal de accepted não-críticos antigos e o funcionamento auditável do Shadow Mode.

Garantias provadas na F2.3 / F2.3.1:
- **Matriz de receipts em código**: Efeitos críticos (com onSuccess, crm_write, handoff, etc.) exigem estritamente `"delivered"` para desbloquear dependentes. Efeitos informais exigem apenas `"accepted"`.
- **Timeout de accepted seletivo**: O timeout e transição para falha/dead-letter em `"accepted"` preso aplica-se apenas a efeitos críticos que dependem de `"delivered"`.
- **Reconciliação segura**: Records `idempotent` sofrem retry seguro sob limite de `maxAttempts`. Records `queryable` consultam status (`reconcile`) antes de qualquer decisão. Records `none` entram diretamente em dead-letter terminal sem avançar o estado conversacional.
- **Shadow Mode auditável**: Bloqueia chamadas de dispatch real. Mantém decision/outbox intactos e legíveis para comparações.

Gates finais executados e verdes:
- `npm.cmd run test:all` -> **KERNEL 67 OK | 0 FALHA** + **F2.0/F2.1/F2.2/F2.2.1/F2.3/F2.3.1 83 OK | 0 FALHA** (150 testes verdes totais).
- `npm.cmd exec -- tsc --noEmit` -> sem erros de compilação.
- `rg "fetch|http|postgres|pg|supabase|createClient|uazapi" src` -> somente comentário explicativo em `domain/ports.ts`.
- `rg "msg\.includes|rawMessage\.includes" src/engine src/domain` -> 0 achados.

Proximo passo recomendado: **F2.4 - Schema SQL (v3_schema.sql) + ADR de mapeamento**. Mapeamento lógico de tabelas e ports do Pedro v3 para o banco Supabase, preparando a infraestrutura para a futura transição de adapters reais.

---

## Atualizacao Codex - F2.4 (Schema PostgreSQL/Supabase) - 2026-06-27

Codex concluiu o schema duravel do Pedro v3 sem executar nada no Supabase e sem tocar o v2.

Entregas:
- `Brain/sql/v3_schema.sql`: 12 tabelas `v3_*`, indices, RLS, triggers de integridade e RPCs atomicas.
- `Brain/sql/v3_verify_after_install.sql`: verificacao somente leitura para o dono rodar apos instalar.
- `Brain/decisions/ADR-007-mapeamento-postgres-v3.md`: contrato port -> tabela/RPC.
- `Agent/tests/run-sql-schema.ts`: teste de integracao em PostgreSQL embutido.

Validacao local:
- `npm.cmd run test:sql` -> **25 OK | 0 FALHA**.
- O teste executa o DDL real e prova dedupe, redaction, lease, claim, CAS, commit atomico, outbox, accepted/delivered, EffectOutcomeCommit idempotente, rollback, imutabilidade e RLS do cofre.

Status: **F2.4 pronta para instalacao pelo dono**. Proximo gate: executar `v3_schema.sql` no SQL Editor, depois `v3_verify_after_install.sql`, e enviar o resultado ao Codex. F2.5 permanece bloqueada ate essa verificacao.


---

## Atualizacao Codex - F2.4 instalada no Supabase - 2026-06-27

O dono executou o schema e o verificador no Supabase. Resultado remoto: **44 checks, 44 ok=true, 0 falhas**.

Confirmado: 12 tabelas, 12 RPCs, RLS habilitado e forcado, colunas criticas do outbox, permissao de commit para service_role, cofre sem SELECT para authenticated e isolamento integral do Pedro v2.

Status: **F2.4 instalada e aprovada**. A F2.5 (adapter Postgres real atras dos ports) esta liberada para implementacao controlada. Providers reais e modo ativo continuam bloqueados.


---

## Atualizacao Codex - F2.5.0 Adapter Postgres de turnos - 2026-06-27

Concluida a primeira fatia do adapter real. Ports aceitam I/O assincrono, engines aguardam persistencia e o novo `PostgresPersistence` mapeia inbox, lease, estado, leitura de outbox e commit atomico do turno para o Supabase.

Seguranca: mutacao de outbox no adapter real continua bloqueada por `postgres_outbox_update_not_enabled_f2_5_0`; nenhum provider, WhatsApp, CRM ou deploy foi ligado.

Gates: 67 Kernel + 83 Fase 2 + 25 SQL + 13 adapter = **188 OK | 0 FALHA**; TypeScript limpo.

Proximo: F2.5.1, com ports especificos para claim/result/retry/skip/outcome do outbox e alinhamento de `terminalAt` no fake.
---

## Atualizacao Codex - F2.5.1 (Outbox Postgres seguro) - 2026-06-27

Entregue claim atomico por conversa, persistencia de result/receipt, retry/requeue, skip/fail protegidos, EffectOutcomeCommit e reconciliacao sobre o adapter Postgres. Toda operacao administrativa compara status, receipt e processing token esperados; snapshot stale falha fechado.

Invariantes novos:
- `delivered` sobrevive a conflito CAS e nunca volta para `pending`.
- Reconciler aplica memoria pendente sem repetir o efeito externo.
- Excecao desconhecida de dispatch vira `outcome_uncertain`, nao uma alegacao falsa de falha.
- Falha conhecida retryable recebe janela e volta a fila somente quando devida.
- `failed`/`skipped` usam `terminalAt`; nao falsificam `outcomeAppliedAt`.
- Callback `accepted` atrasado nao rebaixa `delivered`.
- Writer stale e token forjado nao sobrescrevem estado mais novo.
- Efeito terminal nao pode ser reaberto.

SQL:
- `Brain/sql/v3_f2_5_1_outbox_patch.sql` e o patch incremental para o Supabase existente.
- `Brain/sql/v3_schema.sql` incorpora a F2.5.1 para instalacoes novas.
- RPCs globais/sem guarda antigas perdem `EXECUTE` para `service_role`.
- `Brain/sql/v3_verify_after_install.sql` verifica as novas RPCs e privilegios.

Validacao: `cmd /c npm.cmd run test:all` -> **214 OK | 0 FALHA**; `npm.cmd exec -- tsc --noEmit` -> limpo. Nenhum provider, webhook, CRM, Uazapi, deploy ou escrita remota foi executado.
---

## Atualizacao Codex - F2.5.1 verificada no Supabase - 2026-06-28

O dono executou o patch incremental e o verificador read-only no Supabase. Resultado remoto: **48 checks, 48 ok=true, 0 falhas**.

Confirmado remotamente:
- novas RPCs de claim por conversa e writers guarded;
- `service_role` com acesso apenas as rotas protegidas;
- RPCs globais/sem guarda antigas revogadas;
- 12 tabelas com RLS habilitado e forcado;
- cofre sem SELECT para authenticated;
- isolamento integral do Pedro v2.

Status: **F2.5.1 aprovada e encerrada. F2.5.2 liberada**, ainda obrigatoriamente em shadow e sem envio WhatsApp/CRM/handoff/agenda.

---

## Atualização Claude — Auditoria read-side + Plano F2.5.2 entregue — 2026-06-28

Claude retomou como executor. Baseline reconfirmado: `npm run test:all` → **214 OK | 0 FALHA**; `tsc --noEmit` limpo. **Nada alterado em Agent/, v2 ou banco** (auditoria read-only via código vivo + Supabase MCP só-leitura).

Entregue: **`Brain/08-PLANO-F2.5.2-READ-SIDE.md`** (16 pontos) com o inventário FACTUAL das fontes vivas.

**Fontes vivas confirmadas (por import/query/runtime):** config+prompt = `wa_ai_agents`(+`agent_funnel_config`, `selectActiveAgent`); estoque = **API EXTERNA** por tenant via `platform_integrations` (`searchPedroStock`: RevendaMais feed > BNDV GraphQL); fotos = campo `pictureJs` do item de estoque (não é tabela); CRM = `ai_crm_leads`; KB = `agent_knowledge_bases`/`knowledge_chunks`.

**Binding do `douglasaloan@gmail.com` (SQL):** tenant `user_id=ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0`; agente **"Aloan"** `agent_id=d4fd5c38-dd37-4da5-a971-5a7b7dfb9185` (ativo).

**Divergências vs inventário anterior (código venceu):** (a) agente é **"Aloan"**, não "Sara"; (b) **`instance_id=NULL`** (sem WhatsApp ligado — bloqueio só da fase ativa); (c) **BNDV e RevendaMais ambos ativos** → RevendaMais vence pela precedência viva; (d) `use_funnel_config=false` → prompt = `system_prompt` cru; `company_name=""`; (e) **estoque/fotos são HTTP externo**, então o read-side precisa de fetch read-only (distinto dos EffectDispatchers, que seguem OFF).

**Status: aguardando auditoria do Codex do plano `08` + decisões do dono (§16)** antes de implementar a F2.5.2. Nenhum I/O de implementação foi feito.

---

## Atualização Claude — Plano F2.5.2 revisado (R1) — 2026-06-28

Direção da F2.5.2 aprovada pelo Codex; **implementação NÃO**. Apliquei as 12 correções obrigatórias em `Brain/08` (seção **REVISÃO R1**), com investigação read-only adicional do v2. **Agent/ intocado; nada implementado.**

Investigação que fundamentou a R1: RevendaMais raw é `Record<string,any>` e **descarta id externo**; `category` do feed = AUTOMOVEL/MOTO (não carroceria); BNDV GraphQL vivo **não pede id nem carroceria**; carroceria hoje = regex de listas manuais (`getVehicleSubcategory`, a NÃO copiar); fotos = `[{Link,Principal}]` com URL possivelmente assinada.

Correções no `08` (R1-1..R1-12): identidade `source+externalVehicleId` (fingerprint de atributos não-voláteis se faltar; colisão→`ambiguous`, sem foto auto); contrato de `photoId` (hash do path estável, resolúvel pós-restart/re-assinatura); preço/ano ausentes fail-closed (mini-ADR se mudar `VehicleFact`); `VehicleType` com confiança+proveniência (`unknown` nunca vira SUV; `broad` não relaxa rígido); segurança do fetch (HTTPS/allowlist/anti-SSRF/limite/timeout/retry-só-GET/sem-credencial-em-log); `CredentialProvider`/`SecretRef` (api_key_encrypted nunca em config/estado/log); CRM sem cpf/birth_date + `leadId`=UUID + exige tenant+agent+lead; tenant/agente explícitos (sem "primeiro agente ativo"); KnowledgeSource removida do escopo (sem `knowledge_search` no contrato); prompt carregado/validado mas sem integração efetiva até LLM; cache LRU+single-flight+Clock injetável (não depender de `last_sync_at`); testes adversariais. **Slices F2.5.2A–D.** **Decisões do dono aplicadas** (fetch read-only OK c/ controles; não conectar instância; RevendaMais principal; **sem fallback silencioso p/ BNDV**; prompt cru; não importar v2).

**Status: revisão R1 aprovada pelo Codex.**

---

## Atualização Claude — F2.5.2A IMPLEMENTADA — 2026-06-28

R1 aprovada; **F2.5.2A implementada** (contratos read-only + carregamento seguro de config + `CredentialProvider`/`SecretRef` + fakes). **Sem HTTP/CRM/QueryRunner/LLM/rede; Kernel/v2/banco intocados.**

Criados em `Agent/`: `src/domain/read-ports.ts`, `src/domain/credential-provider.ts`, `src/adapters/read/v2-read-gateway.ts`, `src/adapters/read/tenant-config-source.ts`, `src/adapters/read/fakes/{fake-v2-read-gateway,fake-credential-provider}.ts`, `tests/run-read-side.ts`; `package.json` (`test:read` + `test:all`).

Garantias: tenant+agente explícitos (sem "primeiro ativo"); gateway com métodos específicos validando propriedade; `TenantRuntimeConfig` readonly **sem credencial** (só `SecretRef` opaco de 4 campos); prompt sem fallback e sem vazar conteúdo em erro; RevendaMais>BNDV sem fallback silencioso; `CredentialProvider` não chamado no load (provado por spy); erros tipados fail-closed.

Gates: **`test:all` = 242 OK | 0 FALHA** (214 + 28); `tsc` limpo; `rg` sem fetch/http/Uazapi/EffectDispatcher/CRM/import-v2/@supabase nas fontes da fatia (canários só no teste). `08` consolidado (R1 autoritativa, trechos antigos marcados DEPRECATED).

**Status: F2.5.2A auditada — gerou F2.5.2A.1 (endurecimento).**

---

## Atualização Claude — F2.5.2A.1 (endurecimento contratual) — 2026-06-28

Codex auditou a A e pediu 9 endurecimentos contratuais (sem iniciar B). Implementados nos arquivos da fatia:

1. **2 camadas de propriedade** — `TenantConfigSource` revalida `id`/`tenantId` do agente, funil e cada integração (não confia só no gateway); divergência → `SOURCE_OWNERSHIP_MISMATCH`.
2. **Erros do gateway** — `tryGateway` captura exceção de cada chamada → `READ_SOURCE_FAILURE` fail-closed; **nunca propaga `error.message`** (teste com canário token/prompt não vaza).
3. **Imutabilidade real** — arrays clonados + `Object.freeze` recursivo (config/arrays/SecretRef frozen; mutar seed pós-load não altera config).
4. **versionStamp composto** — agente + funil(quando usado) + provider + integrationId + integration.updatedAt (sem prompt/segredo).
5. **SecretRef tipado** — `provider` união fechada; `makeSecretRef` valida contra **allowlists reais** + ids não-vazios, rejeitando **sem ecoar o valor**.
6. **CredentialProvider fail-closed** — `resolve` discriminado (`SECRET_NOT_FOUND`/`OWNERSHIP_MISMATCH`/`PROVIDER_MISMATCH`); fake não devolve material "default".
7. **Validação de metadata** — rejeita id vazio/tenant divergente/provider desconhecido/duplicado/timestamp inválido (sem normalizar silenciosamente).
8. **Testes adversariais** — gateway mentiroso (agente/funil/integração de outro tenant), erro com segredo, imutabilidade, versionStamp, makeSecretRef, resolve fail-closed, metadata inválida.
9. **`Brain/08` consolidado** — reescrito como **especificação ÚNICA**; trechos obsoletos (`marca|modelo|ano`/índice, KnowledgeSource, CPF, `last_sync_at` base, listas do v2) **removidos**, não só marcados.

Gates: **`test:all` = 268 OK | 0 FALHA** (214 + **54** read-side); `tsc` limpo; `rg` sem fetch/http/Uazapi/EffectDispatcher/CRM/import-v2/@supabase nas fontes (canários só no teste).

**Status: aguardando auditoria do Codex da F2.5.2A.1. NÃO iniciar B/C/D.**
---

## Atualizacao Codex - auditoria final F2.5.2A/A.1 - 2026-06-28

Codex retomou apos o limite de creditos do Claude, leu integralmente os contratos, adapters, fakes, 54 checks read-side, Brain/08 e handoff. A regressao foi executada novamente:

- `cmd /c npm.cmd run test:all` -> **268 OK | 0 FALHA**.
- `npm.cmd exec -- tsc --noEmit` -> limpo.
- Gate estatico -> nenhum `fetch`, Uazapi, EffectDispatcher, escrita CRM, Supabase/Postgres real ou import do v2 nas fontes A/A.1.

Invariantes confirmados: propriedade revalidada em duas camadas; erros do gateway sanitizados; config e arrays frozen; `versionStamp` inclui fontes efetivas; `SecretRef` usa allowlists e nao carrega segredo; CredentialProvider falha fechado; metadata invalida/cross-tenant e rejeitada; Brain/08 possui especificacao unica consolidada.

**Resultado: F2.5.2A/A.1 APROVADAS. F2.5.2B liberada sob os gates do Brain/08.**

---

## Atualização Claude — F2.5.4A (wiring Supabase read-only + canary shadow) — 2026-06-28

Claude retomou como executor. Baseline reconfirmado: `npm run test:all` → **345 OK | 0 FALHA**; `tsc` limpo (bate com o esperado). Implementada **somente a F2.5.4A** (infra segura; **sem canary remoto, sem EffectGate ativo, sem provider real**).

**Auditoria read-only do v2 (crítico):** `api_key_encrypted` do `platform_integrations` é **PLAINTEXT** (provado: `parseCredentials`=`JSON.parse`/raw; `mediaContext`/`metaSender` usam o valor direto como token). Logo **não há formato criptográfico a comprovar e não se inventou decryptor** → ver **`Brain/decisions/ADR-008`**. Risco registrado: segredos em repouso são plaintext + `service_role` exposta pendente de rotação (pré-requisito do canary remoto).

**Implementado:**
- `Agent/src/adapters/read/supabase-read-database.ts` — `SupabaseReadConfig` (HTTPS+host allowlist+chave em `#privado`, não serializável) + `SupabaseReadOnlyDatabase implements V2ReadDatabase` (PostgREST GET-only via `HttpTransport` injetável; allowlist de tabela/coluna; filtro de tenant obrigatório; redirect recusado; timeout; content-type JSON; erros `SUPABASE_READ_FAILURE` sanitizados; **escrita impossível pelo contrato**).
- `Agent/src/adapters/read/v2-api-key-reader.ts` — `V2PlaintextApiKeyReader implements SecretDecryptor` (leitor de plaintext provado, fail-closed, sem log de segredo).
- `Agent/src/engine/canary-shadow-root.ts` — `CanaryShadowRoot` (tenant/agente explícitos; `mode="shadow"` obrigatório; aborta com gate ativo; monta stack read-only real + QueryRunner; roda via `runShadowHarnessTurn` com EffectGate OFF e sem dispatcher externo; defesa final contra dispatch).
- `Brain/decisions/ADR-008` · `Agent/tests/run-canary-wiring.ts` (33 checks) · `package.json` (`test:canary`).

**Gates:** `test:all` → **378 OK | 0 FALHA** (67+96+34+21+127+**33**); `tsc` limpo; `rg` → `service_role` só em comentário (sem JWT hardcoded); `fetch(` só no `http-client`/`transport.fetch` (adapter); nenhum write (`.delete` = Map/Set); sem Uazapi/WhatsApp/CRM-write/EffectDispatcher/`msg.includes`/`cpf`/`birth_date`/log de segredo nos arquivos novos.

**Bloqueado:** canary remoto, EffectGate ativo, providers reais — até rotação da `service_role`. **Parado para auditoria do Codex (F2.5.4A). NÃO iniciar F2.5.4B/canary remoto sem autorização.**

---

## Atualização Claude — F2.5.4A.1 (correções da auditoria) — 2026-06-28

Codex **reprovou** a F2.5.4A (bloqueadores P1/P2/P3). Implementada **só a F2.5.4A.1**. Baseline reconfirmado (378 OK, tsc limpo) antes de alterar.

**P1 — segredo:** allowlist global trocada por **MATRIZ ESTRITA** por `(tabela, operação, colunas, filtros)` em `SupabaseReadOnlyDatabase`. `api_key_encrypted` só em `platform_integrations`/**selectOne** com `id+user_id+is_active=true` (projeção do CredentialProvider); **proibido** em `selectMany`, outra tabela ou misturado a colunas comerciais → fail-closed.
**P1 — canary vinculado ao agente:** `CanaryShadowRoot.create` agora **async** e carrega/valida `V2TenantConfigSource` antes de expor `runQuery`/`runTurn` (agente existe/ativo/dono/prompt válido/provider válido; senão `CanaryConfigError`). Guarda `TenantRuntimeConfig` **frozen** (`tenantConfig`); prompt como fonte autoritativa (`authoritativePromptText`), **`promptBoundToLlm=false`** (ligação prompt→LLM é fase posterior; não alegada).
**P2 — corpo/projeção:** limite de bytes (content-length + stream real), rejeição atômica de linha malformada, **projeção local** só das colunas pedidas (descarta extras). **P2 — chave:** removido `authHeaders()` público; chave em `#apiKey` privado (não recuperável por API pública/`JSON.stringify`). **P3:** testes renomeados para "transporte PostgREST fake"/"wrapper concreto" (sem alegar "Supabase real").

**Testes:** `run-canary-wiring.ts` 33→**52 checks** (18 adversariais exigidos + extras). **`test:all` = 397 OK | 0 FALHA** (345 não-canary intactos + 52 canary); `tsc` limpo; `rg` sem JWT/fetch-fora-de-adapter/write/EffectDispatcher/Uazapi/CRM-write/`msg.includes`(novos)/`cpf`/`birth_date`/log de segredo.

**Bloqueado:** canary remoto, prompt→LLM, providers — até rotação da `service_role`. **Parado para nova auditoria do Codex (F2.5.4A.1). NÃO avançar para F2.5.4B.**

---

## Atualizacao Codex - F2.5.4A.2 (timeout end-to-end) - 2026-06-28

Codex fechou o ultimo bloqueador da auditoria do wiring Supabase: o mesmo deadline agora cobre fetch, headers e leitura completa do corpo. Stream travado e `cancel()` que nunca resolve falham dentro do prazo com `SUPABASE_READ_FAILURE`, sem deixar o turno pendurado.

Gates: `test:canary` = **54 OK | 0 FALHA**; `test:all` = **399 OK | 0 FALHA**; TypeScript limpo; nenhum I/O remoto ou efeito externo.

**Resultado: F2.5.4A/A.1/A.2 APROVADAS LOCALMENTE.** Proxima fatia: F2.5.4B offline (prompt -> LLM e composicao conversacional real do canary). Canary remoto segue bloqueado ate a rotacao da service_role.
---

## Atualizacao Codex - F2.5.4B (composicao conversacional) - 2026-06-28

F2.5.4B concluida e aprovada localmente. O `CanaryShadowRoot` agora vincula o prompt validado do portal a interpret/propose/compose, prepara interpretacao/catalogo/claims dentro do lease apos carregar o estado e nao aceita mais contexto conversacional inventado pelo chamador.

Provas principais: tool loop real (modelo pede `crm_read` e recebe o fato antes da decisao), uma decisao final, memoria central visivel no turno seguinte, decoder runtime de mutacoes/outcomes/resposta, erros do provider sanitizados e terminal-safe sem silencio.

Gates: `test:canary` = **69 OK | 0 FALHA**; `test:all` = **414 OK | 0 FALHA**; TypeScript limpo; zero provider/rede/efeito real.

**Resultado: F2.5.4B APROVADA LOCALMENTE.** Proximo: F2.5.5 adapter real de modelo + extracao semantica independente, ainda gated; depois rotacao da service_role e canary remoto read-only/shadow.
---

## Atualizacao Codex - F2.5.5 (adapter de modelo estruturado + claims independentes) - 2026-06-28

F2.5.5 concluida localmente. Foi criado um adapter provider-agnostic para modelo estruturado com transporte HTTP injetavel (`StructuredJsonConversationModel`) e uma camada de claims automotivos independente (`LexiconAutomotiveClaimExtractor` + `CompositeClaimExtractor`). Nada chama rede por conta propria: nao existe `fetch` real no adapter novo, e o transporte de testes e fake.

Garantias principais: endpoint HTTPS + host allowlist + apiKey obrigatoria; segredo fica em campo privado e nao aparece em `JSON.stringify`; timeout independente do transporte cooperar; content-type/tamanho/JSON/shape validados; URL com credencial/query e limites numericos invalidos falham fechado; erro de provider vira erro tipado sanitizado; payload do provider segue como `unknown` e ainda passa pelo decoder autoritativo do `PromptBoundConversationAdapter`.

O `ConversationTurnContextPreparer` agora pode combinar o catalogo vivo do tenant com um extrator semantico independente. Isso fecha a brecha em que um veiculo inventado fora do estoque/catalogo nao era detectado pelo extractor baseado somente no catalogo.

Gates finais apos autoauditoria: `test:model` = 26 OK | 0 FALHA; `test:all` = 440 OK | 0 FALHA; `tsc --noEmit` limpo; auditoria estatica sem rede real, Supabase, Uazapi, WhatsApp, EffectDispatcher, service_role ou api_key_encrypted nas fontes novas. Achados de `handoff`/`crm_write` continuam apenas como enums/validacao de contrato no decoder.

Resultado: F2.5.5 APROVADA LOCALMENTE. Proximo passo: F2.5.6, adapter HTTP especifico do provedor LLM real do piloto, ainda offline/fake-first. Depois: rotacao/revogacao da service_role exposta e canary remoto read-only/shadow com credencial nova. EffectGate ativo, WhatsApp, CRM-write, handoff e agenda continuam bloqueados.
---

## Atualizacao Codex - F2.5.6 (OpenAI Chat Completions adapter) - 2026-06-28

F2.5.6 concluida localmente. Foi criado o adapter especifico OpenAI Chat Completions (`Agent/src/adapters/llm/openai-chat-model.ts`) para usar o modelo default do piloto `gpt-4.1-mini`, normalizando `openai/gpt-4.1-mini` e falhando fechado para modelos de outro provider. O adapter fala com o contrato OpenAI `/v1/chat/completions` via transporte injetavel, sem `fetch` real embutido, sem ler `OPENAI_API_KEY` do ambiente e sem fallback automatico para Anthropic/DeepSeek.

Garantias principais: endpoint HTTPS + host allowlist + path fixo `/v1/chat/completions`; rejeita query/hash/credencial embutida; segredo fica em `#apiKey` e nao aparece no body nem em `JSON.stringify`; `response_format` exige JSON; prompt do portal entra no `system`; payload estruturado entra no `user`; timeout aborta transporte travado; erro de provider e sanitizado; resposta invalida/shape estranho falha fechado; decoder autoritativo continua sendo o `PromptBoundConversationAdapter`.

Gates finais: `test:openai` = **32 OK | 0 FALHA**; `test:all` = **472 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica nas fontes novas sem rede real, Supabase, Uazapi, WhatsApp, EffectDispatcher, CRM-write, handoff, agenda, `service_role` ou `api_key_encrypted`.

Resultado: F2.5.6 APROVADA LOCALMENTE. Proximo passo: F2.5.7 wiring controlado do adapter OpenAI no canary/bootstrap real, ainda shadow, com chave OpenAI injetada de forma segura. Antes de qualquer canary remoto: rotacionar/revogar a `service_role` exposta e usar credencial nova. EffectGate ativo, WhatsApp, CRM-write, handoff e agenda continuam bloqueados.
---

## Atualizacao Codex - F2.5.7 (OpenAI canary root wiring) - 2026-06-28

F2.5.7 concluida localmente. O CanaryShadowRoot agora aceita modelFactory(runtimeConfig), permitindo carregar o agente, o prompt e o modelo do tenant antes de materializar o adapter OpenAI. Foi criado Agent/src/engine/openai-canary-root.ts com OpenAiRuntimeSecret, createOpenAiModelFactory e createOpenAiCanaryShadowRoot.

Garantias principais: chave OpenAI encapsulada em campo privado e redigida em JSON.stringify; modelo vem do tenant/agente e openai/gpt-4.1-mini e normalizado para gpt-4.1-mini; model=null cai no default gpt-4.1-mini; modelo de outro provider falha fechado, sem fallback silencioso; prompt do portal chega ao system; turno shadow completo roda interpret/propose/compose via adapter OpenAI fake; nenhum EffectOutcome e aplicado e nenhum dispatch real acontece.

Gates finais: test:openai-root = 15 OK | 0 FALHA; test:all = 487 OK | 0 FALHA; tsc --noEmit limpo; package.json validado; auditoria estatica nas fontes novas/alteradas sem fetch real, OPENAI_API_KEY, Deno.env, process.env, Supabase secret, Uazapi, WhatsApp, EffectDispatcher, CRM-write, handoff, agenda ou parsing simplista.

Resultado: F2.5.7 APROVADA LOCALMENTE. Proximo passo: F2.5.8 canary remoto shadow-only, mas isso exige antes rotacionar/revogar a service_role exposta e usar credencial nova. Ate la, chamada remota real para OpenAI/Supabase, WhatsApp, CRM-write, handoff e agenda seguem bloqueados.
---

## Atualizacao Codex - F2.6A (pilot isolation gate) - 2026-06-28

Criado o primeiro alicerce de ativacao real: um gate deterministico de piloto, duplicado nos contratos do Pedro v3 e no webhook vivo do Pedro v2, que so autoriza o par exato `tenant_id=ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0` + `agent_id=d4fd5c38-dd37-4da5-a971-5a7b7dfb9185`. Email, nome do agente, instancia, fallback de agente e primeiro ativo nao autorizam.

No webhook vivo (`humanizeia`), `PEDRO_V3_PILOT_MODE` aceita `off|shadow|active`, default `off`. Mesmo em `active`, esta fase ainda nao liga o handler ativo do v3; o webhook registra o match e cai para o Pedro v2 para nao deixar lead sem resposta ate os dispatchers reais ficarem prontos. Build v2 bumpado para `2026-06-28-pedro-v3-pilot-gate-v219`.

Gates finais: v2 `offline.ts v3-gate` = 6 OK; v2 `offline.ts` = **405 OK | 0 FALHA**; v3 `test:pilot` = 8 OK; v3 `test:all` = **495 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem rede/segredo/effect dispatcher/CRM-write/handoff/Uazapi nos arquivos novos do gate.

Resultado: F2.6A aprovada localmente. Proxima fase: F2.6B, active runtime/dispatchers reais do piloto, usando este gate como pre-condicao obrigatoria.
---

## Atualizacao Codex - F2.6B (WhatsApp active effects isolado) - 2026-06-28

F2.6B concluida localmente como adapter ativo isolado de WhatsApp. Foi criado `Agent/src/adapters/effects/whatsapp-dispatcher.ts`, que implementa `EffectDispatcher` para `send_message` e `send_media` usando `WhatsAppSendPort` injetado, sem rede embutida, sem Uazapi importada diretamente e sem segredo no adapter.

Garantias: texto invalido falha fechado sem chamar sender; mensagem critica com receipt apenas `accepted` nao atualiza memoria; `delivered` aplica outcome; fotos sao resolvidas no momento do envio via `VehiclePhotoSource`; foto ambigua/ausente falha fechado; idempotency key de midia e escopada por `photoId`; excecoes do sender viram `outcome_uncertain` sanitizado.

Gates finais: `test:active-effects` = **20 OK | 0 FALHA**; `test:all` = **515 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem fetch/Uazapi/segredo/CRM/handoff ativo nos arquivos novos da fatia.

Resultado: F2.6B APROVADA LOCALMENTE. Importante: isso ainda NAO liga o Pedro v3 no WhatsApp real. Proxima fase: F2.6C, sender Uazapi real + politica honesta de receipt (`accepted` vs `delivered`) + depois CRM/handoff/briefing.
---

## Atualizacao Codex - F2.6C (Uazapi sender isolado) - 2026-06-28

F2.6C concluida localmente. Foi criado `Agent/src/adapters/effects/uazapi-whatsapp-sender.ts`, um `WhatsAppSendPort` para Uazapi com transporte HTTP injetado, sem `fetch` direto, sem import do sender v2 e sem segredo no estado/config/outbox.

O contrato de credenciais foi ampliado para `provider="uazapi"` e `purpose="whatsapp_instance"`, mantendo o segredo como `SecretRef` opaco e resolvido somente no ponto de envio. O fake de credenciais foi ajustado para o provider novo.

Garantias: base URL HTTPS + host allowlist; telefone normalizado; texto usa endpoints compativeis com v2; midia exige HTTPS; corpo de erro remoto nao e propagado; token nao aparece em JSON do sender; Uazapi HTTP OK vira receipt `accepted`, nao `delivered`.

Gates finais: `test:active-effects` = **38 OK | 0 FALHA**; `test:all` = **533 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem fetch/Uazapi-v2/segredo/CPF/service_role/env nas fontes de effects.

Resultado: F2.6C APROVADA LOCALMENTE. Proxima fase: F2.6D, wiring do runtime ativo do piloto com leitura segura de `wa_instances` e factory do dispatcher, ainda sem liberar handoff/CRM-write antes dos adapters proprios.
---

## Atualizacao Codex - F2.6D (Pilot WhatsApp runtime factory local) - 2026-06-28

F2.6D local concluida. Foi criado `Agent/src/adapters/effects/pilot-whatsapp-runtime.ts`, que monta o dispatcher ativo do piloto a partir de `TenantConfigSource`, `WhatsAppInstanceSource`, `CredentialProvider`, `UazapiWhatsAppSender`, `VehiclePhotoSource` e `Clock`.

Garantias: agente sem `instanceId` bloqueia; instancia inexistente bloqueia; ownership tenant/instance e revalidada; provider diferente de Uazapi bloqueia; instancia Uazapi propria cria dispatcher e envia via sender fake retornando `accepted`.

Gates finais: `test:active-effects` = **43 OK | 0 FALHA**; `test:all` = **538 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem fetch/Uazapi-v2/segredo/CPF/service_role/env nas fontes de effects.

Resultado: F2.6D APROVADA LOCALMENTE. Proxima fase: F2.6E, leitura real e segura de `wa_instances`/token da instancia do v2 para permitir o primeiro active pilot controlado.
---

## Atualizacao Codex - F2.6E (wa_instances read-side seguro para piloto) - 2026-06-28

F2.6E concluida localmente. A ponte ativa do WhatsApp agora tem leitura segura e tipada da instancia do v2: `wa_instances` entrou na matriz read-only do `SupabaseReadOnlyDatabase`, com metadata separada de segredo, token permitido somente em `selectOne` por `id + user_id`, e bloqueio explicito para leitura em lote ou sem escopo de tenant.

Foram criados `V2WhatsAppInstanceSource` e `V2WhatsAppInstanceCredentialProvider`. A instancia valida ownership por tenant, trata provider ausente como `uazapi` por compatibilidade com o v2, marca providers nao suportados como `unsupported` sem casts forjados, e resolve token apenas via `SecretRef(provider="uazapi", purpose="whatsapp_instance")` no ponto de uso.

Garantias: metadata de instancia nunca seleciona `api_key`/`api_key_encrypted`; credential read exige `id+tenant`; cross-tenant retorna null; provider Meta/unsupported nao resolve token Uazapi; comentario/matriz do Supabase alinhados; runtime ativo continua bloqueando agente sem `instanceId`.

Gates finais: `test:canary` = **74 OK | 0 FALHA**; `test:active-effects` = **50 OK | 0 FALHA**; `test:all` = **550 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem sender v2, service_role, CPF/birth_date, env, console log ou segredo materializado em estado/config/outbox. `fetch` segue encapsulado somente no adapter PostgREST read-only.

Resultado: F2.6E APROVADA LOCALMENTE. Proxima fase: F2.6F, plugar o runtime ativo do piloto ao webhook/entrypoint com `PEDRO_V3_PILOT_MODE=active`, mantendo fallback seguro se o agente Aloan ainda estiver sem `instance_id` conectado. CRM-write, handoff, briefing e agenda continuam bloqueados ate adapters proprios e testes equivalentes.
---

## Atualizacao Codex - F2.6F (active pilot root local) - 2026-06-28

F2.6F concluida localmente. Foi criado `Agent/src/engine/pilot-active-root.ts`, o composition root ativo do piloto: ele valida o escopo exato do Pedro v3 (`tenant_id=ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0` + `agent_id=d4fd5c38-dd37-4da5-a971-5a7b7dfb9185`), carrega config/prompt/estoque/CRM read-only, prepara contexto conversacional, ingere o inbound no `v3_inbox`, roda `ConversationEngine`, materializa outbox e despacha somente WhatsApp via Uazapi quando o gate da conversa esta ativo.

Garantias novas: agente fora do piloto nao cria root; agente sem `instance_id` falha fechado; webhook duplicado (`eventId` repetido) nao reprocessa nem reenvia; prompt do portal chega ao modelo; receipt Uazapi `accepted` nao inventa entrega nem aplica memoria de resposta; `handoff`/CRM/agenda continuam sem provider ativo e caem em resposta segura, sem transferencia silenciosa.

Foi criada a suite `Agent/tests/run-active-root.ts` e o script `test:active-root`, agora incluido em `test:all`.

Gates finais: `test:active-root` = **10 OK | 0 FALHA**; `test:all` = **560 OK | 0 FALHA**; `tsc --noEmit` limpo; auditoria estatica sem `fetch`, env, `service_role`, CPF/data nascimento, segredo em fonte nova ou fallback por email/primeiro agente.

Resultado: F2.6F APROVADA LOCALMENTE. Ainda NAO esta plugado no webhook vivo do Supabase. Proxima fase: F2.6G, criar o entrypoint/bridge Deno seguro para o `pedro-webhook-v2` chamar o Pedro v3 somente no piloto, mantendo fallback para v2 se bootstrap/commit falhar antes do envio. Depois disso vem deploy controlado com `PEDRO_V3_PILOT_MODE=active` apenas para o agente Aloan.
---

## Atualizacao Codex - F2.6G (servico HTTP + bridge + EasyPanel) - 2026-06-28

F2.6G concluida e aprovada para publicacao com o piloto ainda OFF. O servico Node real, o bridge Deno do webhook v220, dedupe/retry de inbox, contrato anti-resposta-dupla e pacote Docker/EasyPanel foram implementados. O codigo do Pedro v3 foi sincronizado para `humanizeia/services/pedro-v3` para build pelo GitHub/EasyPanel.

Gates: Pedro v3 **579 OK | 0 FALHA**; Pedro v2 offline **414 OK | 0 FALHA**; TypeScript limpo; bundle webhook OK; health local 200; dependencia de runtime atualizada e instalacao final com 0 vulnerabilidades.

Auditoria encontrou bloqueador antes do active: Uazapi send retorna `accepted`, enquanto a memoria autoritativa so avanca com `delivered`. A especificacao oficial oferece `messages_update`, mas o callback ainda nao esta ligado. Para nao recriar repeticao de perguntas, `PEDRO_V3_PILOT_MODE` permanece `off` ate a F2.6H (receipt callback idempotente por providerMessageId). Audio sem texto, CRM-write, handoff, briefing e agenda tambem ainda nao entram no v3 ativo.

Resultado: F2.6G APROVADA PARA PUSH/BUILD, NAO PARA ATIVACAO. Proxima fase obrigatoria: F2.6H.