# 01 - Status Atual do Pedro v3

## 2026-07-05 - FONTE ÚNICA (TurnUnderstanding): elimina fallbacks por conflito cérebro×regex×memória×alvo

- Missão P0 (evidência Codex, tenant ecb26258): 3 incidentes reais — (1) foto do Kicks saiu como Onix (executor preferia
  selected antigo ao fato do turno); (2) "E o kiks, tem?" (typo) virou foto + technical_fallback (regex de intenção +
  memória velha); (3) "Me mande fotos" caiu em technical_fallback (`isPhotoRequestBlock` não pegava "mande").
- Correção ARQUITETURAL (não if-por-frase): o cérebro emite `TurnUnderstanding` no MESMO ciclo (primaryIntent/
  capabilities/subject/evidence/isTopicChange); o engine VALIDA que cada evidência ⊂ bloco e usa ESSE entendimento como
  AUTORIDADE ÚNICA de foto/busca/alvo/recuperação. Regex vira só FALLBACK robusto (stems) quando o cérebro não emite.
  Novo módulo `engine/turn-understanding.ts` (validate/authorizesPhotoSend/resolveTurnTarget/deriveFallback/fingerprint).
  Precedência de alvo (turno>ordinal>fato do turno>selected antigo) corrige Inc1; foto por semântica corrige Inc2/Inc3;
  recuperação contextual substitui o texto genérico ("não consegui confirmar" REMOVIDO do central_active).
- Gates: `test:f223` **12 OK** (A-I, os 3 incidentes + guardas), `test:scan-fallback` **5 OK**, `test:all` EXIT 0, `tsc`
  EXIT 0 (sem regressão). Real 5 turnos (`eval:understanding`, gpt-4.1-mini, compose=0, US$0,038): **PASS** — T3 foto do
  3º selecionado, T4 "E o Onix, tem?" lista sem mídia (falso-envio proativo corrigido), T5 negação acolhe sem degradar.
- ⭐**2ª AUDITORIA CODEX (2 P0 + 2 P1) CORRIGIDA (2026-07-05):** P0-1 foto VINCULADA ao assunto por modelo
  (`candidateVehicleKeys` + `targetAcceptsKey`; foto do carro errado REJEITADA, nunca "1 photo fact vence"); P0-2
  understanding do CÉREBRO obrigatório p/ ação comercial em llmFirst (`REQUIRED_TURN_UNDERSTANDING`+retry; fallback nunca
  autoriza mídia/tool/foco); P1 evidência por capability + trava do assunto (`reconcileUnderstanding`); P1 recuperação de
  busca diferencia executada-vazia/falha/não-executada; `deterministic_recovery` (contextual) distinto de
  `technical_fallback` (genérico). `run-f2-23` **18 OK** (+ adversariais), test:all+tsc EXIT 0, `git diff --check` limpo.
  Real 6 turnos (`eval:understanding`, US$0,058): **PASS** — T4 "gostei das fotos" 0 mídia, T6 "fotos do Onix" (2 variantes)
  pergunta qual sem carro errado.
- ⭐**3ª AUDITORIA CODEX (2 P0 estreitos + 1 P1) CORRIGIDA (2026-07-05):** P0-1 subjectValue corresponde ao claim ESCRITO
  (precedência do texto; conflito->kind `conflict` inválido, zero mídia; inferência só vira candidato se confirmada por
  stock_search/catálogo; photo fact nunca confirma modelo). P0-2 autorização TIPADA por tool (`toolCapabilityAuthorized`:
  cap própria+evidência própria; exceção sistêmica `systemDetailKeys` p/ grounding; filtro de select_vehicle_focus sem cap
  select; `deriveFallbackUnderstanding` multi-capability). P1 recuperação trata qualquer falha real de stock_search (não só
  UPSTREAM). `run-f2-23` **25 OK** (+ W/X/Y/Z/AA/P4/P6), test:all+tsc EXIT 0, git diff --check limpo.
- **NÃO commitado** — sobre `d0c35981`, aguardando NOVA auditoria Codex. Detalhe: `Brain/2026-07-05-claude-turn-understanding-fonte-unica.md` §6-7.
- Follow-ups: v3_query_log é do bridge (gap documentado); cérebro às vezes omite understanding (gate barra ação comercial e recupera contextual).

## 2026-07-04 - Completude do turno (prompt-first): fecha o gap "respondeu endereco no lugar do horario"

- Dono reportou: correcao de dominio passou tecnicamente, mas o agente respondia ENDERECO quando o lead pedia HORARIO.
- Correcao LLM-first + prompt-first (SEM policy pesada, SEM handler, SEM executor comercial):
  1. **Prompt-first** no BRAIN_PROTOCOL: dados da empresa (horario/endereco/site/contato/faixa de preco/diferenciais)
     sao do PROMPT (fonte primaria); `tenant_business_info` so confirma/organiza; RESPONDA O TOPICO PEDIDO (horario ->
     horario, nao endereco); pediu varias coisas -> atende TODAS.
  2. **Guarda de completude** (`turnCompletenessFeedback` no central-engine): validacao LEVE que nao decide a conversa,
     so impede resposta que IGNORA pedido explicito -> deny + feedback ao MESMO cerebro (retry). Institucional
     (address/hours/unit) + foto (send_media ou ausencia honesta; CEDE a objetivo pendente/POL-TRACK-001). km/estoque
     ja cobertos por B2/POL-ATTR-VALUE/required-tool. `brainMaxSteps` 4->6 no piloto+eval (folga p/ o retry).
- Gates: `test:f222` **21 OK** (16 + M/N/O/P de completude), `test:f215` **18 OK** (regressao [16] corrigida via
  carve-out de objetivo pendente), `test:all` EXIT 0, `tsc --noEmit` limpo (0 regressao).
- Real 5 turnos (`eval:institutional`, gpt-4.1-mini, compose=0, US$0,038): **PASS**. T4 endereco + km real (80.000 via
  vehicle_details); **T5 "qual horario e me manda foto dele?" -> "funciona das 9h as 19h" + send_media** (GAP FECHADO);
  0 technical_fallback, 0 pedido ignorado.
- **NAO commitado** — segue na mesma leva do roteamento por dominio, sobre `8c05f251`, aguardando auditoria Codex.
- Detalhe: `Brain/2026-07-04-claude-roteamento-por-dominio.md` (secao COMPLETUDE DO TURNO).

## 2026-07-04 - F2.19 Taxonomia de mercado + recuperacao de turnos

- Corrigida a identidade comercial de variantes: `C3 Aircross` permanece SUV e e exibido como Aircross; `C3` comum permanece hatch.
- `carro popular` agora e um filtro tipado de segmento brasileiro, baseado na planilha factual de categorias, e nao sinonimo de qualquer carro barato.
- O cerebro central injeta `popular:true` na busca quando o lead pede popular, preservando teto, cambio e exclusoes.
- Corrigido o silencio apos crash/restart: claims com lease expirada deixam de ficar eternamente em `claimed` e voltam ao poller sem redispatch externo.
- Prova no estoque real do piloto: populares ate R$ 50 mil retornam Sandero, 208 e HB20; C3 Aircross/CR-V ficam excluidos.
- Gates: `test:f219` 12 OK, `test:sql` 84 OK, `test:f2715` 25 OK, `test:all` EXIT 0 e `tsc --noEmit` limpo.

> Atualize ao fim de cada etapa relevante. E o primeiro arquivo que qualquer executor le.
> Ultima atualizacao: 2026-06-30 - por Codex. **F2.7.13 R1 APROVADA E ENDURECIDA: prioridade do turno atual vence memoria antiga.** Corrigido o fix parcial do Claude: busca explicita agora usa TenantCatalog dinamico + interpretacao somente quando o termo literal aparece na fala do lead; sem marcas hardcoded; filtros combinados (marca/modelo/tipo + teto); multi-modelo/multi-marca consultam todos; `slots.interesse` deixa de acumular historico/lixo e passa a representar a intencao comercial atual; `deriveModelContext` remove interesse velho quando o turno atual traz intencao nova. Testes: `tsc --noEmit` limpo; `test:f276` 27 OK; `test:f277` 21 OK; `test:f2713` 35 OK; vizinhas f274/f278/f2712 verdes; `test:all` EXIT=0. Scan engine sem `BRANDS`, listas hardcoded ou `msg.includes`. Aguardando commit/push controlado.

## Fase atual

**F2.5.3 concluida por Codex.** O Pedro v3 agora possui adapters de leitura do v2 por contrato de banco injetavel: `V2DatabaseReadGateway` e `V2DatabaseCredentialProvider`. Eles nao importam SDK Supabase, nao abrem rede e nao fazem escrita; apenas definem o contrato seguro que um wrapper real devera cumprir.

**Gates locais:** 67 Kernel + 96 Fase 2 + 34 SQL + 21 Adapter Postgres + 127 Read-side = **345 OK | 0 FALHA**; `tsc --noEmit` limpo.

**Garantias F2.5.3 aplicadas:** leituras sempre filtradas por tenant+agent quando aplicavel; metadata de estoque nao seleciona `api_key_encrypted`; CRM nao seleciona `cpf`/`birth_date`; CredentialProvider resolve segredo somente no ponto de uso e falha fechado em provider/cross-tenant; erro de banco vira `READ_SOURCE_FAILURE` sanitizado; sem WhatsApp, sem CRM-write, sem handoff, sem agenda e sem Supabase real.

**Pendencia operacional mantida:** a chave Supabase `service_role` exposta no scratch antigo ainda precisa ser rotacionada/revogada antes de qualquer canary/producao real. Mantida por decisao do dono para nao travar as fases offline.

**Proxima etapa sugerida:** F2.5.4 - wrapper real do client Supabase read-only + decryptor seguro ou canary shadow controlado, somente depois da rotacao/credencial segura e com EffectGate OFF.
## Melhorias e Garantias Aplicadas (Fase 1.5)

1. **Grounding estrito do Texto Livre (`TextPart`)**:
   - Respostas comerciais (`search_stock`, `send_photos`, `answer_vehicle_question`) nÃƒÂ£o podem citar veÃƒÂ­culos de marcas/modelos em texto livre.
   - Qualquer citaÃƒÂ§ÃƒÂ£o detectada pelo `ClaimExtractor` em `TextPart` constitui uma violaÃƒÂ§ÃƒÂ£o (`POL-GROUND-STOCK`), disparando o modo seguro de falha fechada (`terminalSafe`).

2. **DetecÃƒÂ§ÃƒÂ£o DinÃƒÂ¢mica com `ClaimExtractor`**:
   - O `ClaimExtractor` foi injetado na assinatura de `TurnContext`. Ele ÃƒÂ© o responsÃƒÂ¡vel oficial por rastrear alegaÃƒÂ§ÃƒÂµes de veÃƒÂ­culos em texto bruto.
   - Removido qualquer parsing de intenÃƒÂ§ÃƒÂµes baseado em `msg.includes` ou `rawMessage.includes` no motor interno.

3. **AdequaÃƒÂ§ÃƒÂ£o do `TenantCatalog`**:
   - A tipagem do `TenantCatalog` no domain `decision.ts` foi reestruturada para suportar catÃƒÂ¡logo dinÃƒÂ¢mico via `entries: CatalogEntry[]` (contendo aliases e vehicleKey).
   - O `PolicyEngine` e os adaptadores de interpretaÃƒÂ§ÃƒÂ£o agora utilizam puramente esta estrutura.

4. **Isolamento de Interpretadores (Adapters)**:
   - O arquivo `turn-interpreter.ts` (contendo `CatalogEntityExtractor` e `interpretTurn`) foi migrado de `src/engine/` para `src/adapters/turn-interpreter.ts` para separar as ferramentas de parsing de strings do motor centralizado puro.
   - `decision-engine.ts` nÃƒÂ£o possui qualquer importaÃƒÂ§ÃƒÂ£o ou dependÃƒÂªncia direta de `turn-interpreter.ts`.

5. **MoneyRole Ãƒâ€” MoneySource**:
   - A matriz rÃƒÂ­gida de relacionamentos monetÃƒÂ¡rios foi validada. Apenas fontes do tipo `vehicle_fact` alimentam `vehicle_price`.
   - PapÃƒÂ©is como `installment`, `down_payment` e `budget` estÃƒÂ£o estritamente amarrados ÃƒÂ s suas respectivas fontes em `slot_value` (`entrada`, `parcelaDesejada`, `faixaPreco`). Qualquer violaÃƒÂ§ÃƒÂ£o falha fechado.

6. **ValidaÃƒÂ§ÃƒÂ£o do Reducer**:
   - O mÃƒÂ©todo `applyDecision` no `state-reducer.ts` agora exige `expectedTurnId` e `expectedNow` em sua assinatura.
   - MutaÃƒÂ§ÃƒÂµes que possuem `sourceTurnId` divergente ou cujo valor de slots ÃƒÂ© invÃƒÂ¡lido (como faixaPreco invÃƒÂ¡lido) sÃƒÂ£o atomicamente rejeitadas pelo reducer.

## Kernel implementado (`Agent/`) Ã¢â‚¬â€ sem I/O

```
Agent/
  package.json, package-lock.json, tsconfig.json, .gitignore
  src/domain/   types.ts Ã‚Â· context.ts Ã‚Â· llm.ts Ã‚Â· conversation-state.ts Ã‚Â· decision.ts
  src/engine/   state-reducer.ts Ã‚Â· policy-engine.ts Ã‚Â· decision-engine.ts Ã‚Â· finalizer.ts Ã‚Â· catalog-utils.ts
  src/adapters/ llm/fake-llm.ts Ã‚Â· turn-interpreter.ts
  tests/run.ts
```

## Testes (L1 + L4) Ã¢â‚¬â€ verdes

- `npm test` (`npx tsx tests/run.ts`) -> **67 OK | 0 FALHA** (corrigido na F2.0.1; valor anterior 54 estava desatualizado).
- `npx tsc --noEmit` Ã¢â€ â€™ **0 Erros de CompilaÃƒÂ§ÃƒÂ£o**.
- Cobrem: 
  - Reducer bÃƒÂ¡sico, durÃƒÂ¡vel e com igualdade exata de `effectId`.
  - RejeiÃƒÂ§ÃƒÂ£o de efeito forjado com mesmo sufixo mas turnId divergente.
  - Interpretador semÃƒÂ¢ntico diferenciando respostas de objetivos pendentes (troca/pagamento) de mudanÃƒÂ§as explÃƒÂ­citas de direÃƒÂ§ÃƒÂ£o (mudar para sedan).
  - ValidaÃƒÂ§ÃƒÂ£o de ciclos, dependÃƒÂªncias fantasmas e planIds duplicados nos planos.
  - Grounding com extraÃƒÂ§ÃƒÂ£o monetÃƒÂ¡ria isolando parcelas de preÃƒÂ§os do veÃƒÂ­culo e bloqueio de alucinaÃƒÂ§ÃƒÂµes de marcas ("Audi Q5") nÃƒÂ£o consultadas.
  - Testes adversariais com marcas sintÃƒÂ©ticas (`Zeekr`, `Tesla`, `Volvo`, `Roma`).
  - Erros e timeouts de todas as etapas e globais capturados e retornando TurnDecisions consistentes emitidas pelo Finalizer.
  - 4 turnos encadeados multiturno integrados sem quebras de estado.

## Bloqueios / aguardando

- Nenhum. Pronto para prÃƒÂ³ximas diretivas de integraÃƒÂ§ÃƒÂ£o de I/O ou deploy.

## Regras ativas

- `Agent/` tem cÃƒÂ³digo funcional simulado. Sem I/O real (banco, Postgres `v3_*`, CRM ou Uazapi real).
- O v2 permanece intacto e em execuÃƒÂ§ÃƒÂ£o (somente leitura para o v3).

---

## AtualizaÃ§Ã£o Codex â€” Fase 1.5.1 â€” 2026-06-27

Codex assumiu a execuÃ§Ã£o apÃ³s tÃ©rmino dos crÃ©ditos do Antigravity e fechou as lacunas apontadas na auditoria da Fase 1.5.

CorreÃ§Ãµes aplicadas:
- `catalog-utils.ts`: normalizaÃ§Ã£o canÃ´nica de catÃ¡logo agora remove acentos, transforma hÃ­fen/pontuaÃ§Ã£o em separadores, compacta espaÃ§os e preserva `+` como `plus` para evitar que `C++` vire apenas `c`.
- `turn-interpreter.ts` em `adapters`: detecÃ§Ã£o de marca/modelo passou a usar termos completos normalizados do `TenantCatalog`, suportando aliases, modelos multi-palavra e hifenizados.
- `tests/run.ts`: suÃ­te ampliada de 54 para 67 testes, cobrindo lacunas que a auditoria encontrou.

Novos cenÃ¡rios provados:
- `confidence > 1`, `sourceTurnId` errado, `faixaPreco.max` negativo, `min > max` e `veiculoTroca` vazio sÃ£o rejeitados atomicamente.
- `vehicle_ref` com `field: "preco"` falha fechado.
- `money_ref` com `installment` vindo de `vehicle_fact` falha fechado.
- `Zeekr X` em texto livre usando preÃ§o real de outro carro gera `deny`.
- CatÃ¡logo aceita chave hifenizada contra marca/modelo multi-palavra (`Land Rover` / `Range Rover Evoque`).
- CatÃ¡logo aceita uppercase/lowercase canÃ´nico (`FIAT` / `fiat`).
- NormalizaÃ§Ã£o preserva `C++` como `c plus plus`.
- Extractor reconhece `Range Rover Evoque` multi-palavra e `C++` sem quebrar por metacaractere.

ValidaÃ§Ã£o executada:
- `npm.cmd test` -> `67 OK | 0 FALHA`.
- `npm.cmd exec -- tsc --noEmit` -> sem erros.
- `rg` no `src/engine` e `src/domain` para `msg.includes`, `rawMessage.includes`, `priceClaims`, `mentionsVehicleKeys` -> sem achados.
- `rg` para `field: "preco"`/`field: 'preco'` em `src` -> sem achados.

Status: Fase 1.5.1 aprovada para auditoria final. PrÃ³ximo passo recomendado: Claude nÃ£o deve mexer no kernel sem motivo; deve partir para planejamento da Fase 2 (I/O/adapters/outbox) com autorizaÃ§Ã£o explÃ­cita e mantendo todos os testes verdes.

---

## AtualizaÃ§Ã£o Claude â€” Plano da Fase 2 entregue â€” 2026-06-27

Claude retomou (crÃ©ditos do Antigravity acabaram). Baseline reconfirmado no ambiente: `npx tsx tests/run.ts` -> **67 OK | 0 FALHA**; `tsc --noEmit` limpo. **Kernel NÃƒO foi tocado.**

Entregue: **`Brain/07-PLANO-FASE-2.md`** â€” plano curto da Fase 2 (camada N8N-like real) respondendo aos 6 pontos do Codex: (1) arquivos a criar (ports/effect-intent/conversation-engine/effect-materializer/outbox-dispatcher/effect-outcome-commit/reconciler/in-memory-store/fake-dispatchers/run-phase2) sem tocar o kernel; (2) tabelas `v3_*` (jÃ¡ em `02 Â§4`), entregues como SQL PROPOSTA p/ o dono rodar; (3) tudo fake/in-memory primeiro (ports + InMemoryStore + fake dispatchers, EffectGate OFF); (4) hexagonal, sem driver/rede, adapters reais sÃ³ em sub-fase autorizada; (5) testes R2-1..R2-9/R3-1..R3-8 end-to-end no engine in-memory; (6) aditivo â€” 67 verdes preservados + `tsc` limpo a cada handoff. **Sem mudanÃ§a breaking de contrato do kernel** (tipos novos sÃ£o aditivos em `domain/effect-intent.ts`).

**Status: aguardando auditoria do Codex do plano + autorizaÃ§Ã£o do dono p/ iniciar a F2.0** (nenhum I/O/banco/deploy nesta etapa).

---

## AtualizaÃ§Ã£o Claude â€” F2.0 (persistÃªncia in-memory) IMPLEMENTADA â€” 2026-06-27

Autorizada e concluÃ­da a **F2.0** (escopo estrito). **Sem ConversationEngine, dispatcher, reconciler, SQL, provider, banco, deploy. Kernel intocado.**

**Arquivos criados/alterados (sÃ³ os do escopo):**
- `Agent/src/domain/effect-intent.ts` â€” tipos de persistÃªncia aditivos: `EffectStatus`, `ProviderCapability`, `EffectIntent`, `OutboxRecord`, `InboxRecord`, `TurnEventRecord`, helper `redact`.
- `Agent/src/domain/ports.ts` â€” interfaces de I/O puras: `Clock`, `IdGen`, `LeaseStore`, `InboxStore`, `StateStore`, `OutboxStore`, `UnitOfWork`, `Persistence`. Nenhuma implementaÃ§Ã£o.
- `Agent/src/adapters/persistence/in-memory-store.ts` â€” `InMemoryPersistence` (Maps + UnitOfWork atÃ´mico + CAS), `FakeClock`, `FakeIdGen`. SEM rede/driver.
- `Agent/tests/run-phase2.ts` â€” 19 testes provando os 8 pontos.
- `Agent/package.json` â€” scripts `test:phase2` e `test:all`.

**8 pontos provados (19 testes):** (1) inbox dedupe atÃ´mico = o prÃ³prio insert; (2) claim/lease â€” 2 workers, sÃ³ um vence + claim marca o evento; (3) cutoff â€” msg nova fica p/ prÃ³ximo turno; (4) lease release no sucesso E no erro/finally; (5) CAS â€” commit com versÃ£o antiga falha; (6) UnitOfWork tudo-ou-nada â€” parte falha â†’ nada persiste; (7) outbox store bÃ¡sico â€” records `pending` com effectId/idempotencyKey/order/dependsOn + idempotencyKey UNIQUE, sem dispatch; (8) determinismo â€” FakeClock/FakeIdGen reproduzÃ­veis.

**Gates (todos verdes):** `npm test` â†’ **67 OK** (kernel preservado) Â· `npm run test:phase2` â†’ **19 OK** Â· `tsc --noEmit` â†’ limpo Â· `rg fetch|http|postgres|pg|supabase src` â†’ sÃ³ 1 comentÃ¡rio no `ports.ts` (nenhum I/O real) Â· `rg msg.includes|rawMessage.includes src/engine src/domain` â†’ **0 achados** (os existentes ficam sÃ³ no parser `adapters/turn-interpreter.ts`).

**PrÃ³ximo:** F2.1 (effect-materializer + conversation-engine + commit do ciclo) â€” sÃ³ apÃ³s auditoria do Codex.

---

## AtualizaÃ§Ã£o Claude â€” F2.0.1 (correÃ§Ãµes pÃ³s-auditoria) â€” 2026-06-27

Auditoria da F2.0 aprovou os gates, mas pediu 3 correÃ§Ãµes pequenas antes da F2.1 (sem iniciar ConversationEngine). Feitas:

1. **`withLease` assÃ­ncrono** â€” contrato em `ports.ts` agora `fn: (lease) => T | Promise<T>): Promise<T>`; `InMemoryPersistence.withLease` usa `await fn` dentro do try/finally. Testes: o lease **NÃƒO** Ã© liberado enquanto a Promise estÃ¡ pendente; libera no **resolve** E no **reject**.
2. **RecuperaÃ§Ã£o de inbox `claimed`** (menor soluÃ§Ã£o coerente com `02 Â§9`): novo `InboxStore.releaseClaim(eventIds, claimedBy, turnId)` devolve o claim p/ `pending` (turno falhou antes do commit), e sÃ³ libera o claim do worker/turno correto. AlÃ©m disso, `UnitOfWork.markInboxDone(eventIds, claimedBy, turnId)` agora **valida**: sÃ³ marca `done` evento que estÃ¡ `claimed` pelo MESMO worker/turno (commit rejeita se divergir). Testes: claimâ†’releaseClaim volta p/ pending + re-claimÃ¡vel; releaseClaim com owner/turno errado nÃ£o libera; markInboxDone com turno errado Ã© rejeitado, com o correto vira `done`.
3. **Brain/01 corrigido** â€” o trecho stale "54 OK" virou **67 OK** (linha de validaÃ§Ã£o da seÃ§Ã£o Codex).

**Gates F2.0.1 (todos verdes):** `npm test` â†’ **67 OK** (kernel preservado) Â· `npm run test:phase2` â†’ **27 OK** (era 19; +3 lease async, +5 recuperaÃ§Ã£o) Â· `npm run test:all` â†’ ambos Â· `tsc --noEmit` â†’ limpo Â· `rg fetch|http|postgres|pg|supabase src` â†’ sÃ³ o comentÃ¡rio do `ports.ts` Â· `rg msg.includes|rawMessage.includes src/engine src/domain` â†’ **0**.

**Escopo respeitado:** sem ConversationEngine/dispatcher/reconciler/SQL/provider/banco/deploy; v2 intocado; kernel intocado. **Parado para auditoria da F2.0.1.** PrÃ³ximo (se aprovado): F2.1.


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
- `Agent/src/engine/outbox-dispatcher.ts` [NEW] - Realiza a varredura e despacho de efeitos, respeitando dependÃªncias explÃ­citas (`dependsOn`) e linearidade implÃ­cita (`order`). Se uma dependÃªncia falhar ou for pulada, os dependentes sÃ£o marcados como `"skipped"` em cascata.
- `Agent/src/engine/effect-outcome-commit.ts` [NEW] - Aplica os resultados de efeitos de forma transacional (CAS) e idempotente. Diferencia `"accepted"` (nÃ£o altera o estado conversacional, `outcomeAppliedAt` continua `null`) de `"delivered"` (atualiza estado via `applyEffectOutcome` e define `outcomeAppliedAt`).
- `Agent/src/domain/ports.ts` [MODIFY] - Adicionado o mÃ©todo `updateOutbox` na interface `UnitOfWork`.
- `Agent/src/adapters/persistence/in-memory-store.ts` [MODIFY] - Implementada a gravaÃ§Ã£o de updates de outbox record na `UnitOfWork` do `InMemoryPersistence`, validando a imutabilidade dos campos estruturais (`effectId`, `idempotencyKey`, `conversationId`, `turnId`, `planId`, `kind`) no `commit()`.
- `Agent/tests/run-phase2.ts` [MODIFY] - Adicionada a suÃ­te de testes F2.2 (Testes 11 a 14) e F2.2.1 (Testes 15 a 17).

Garantias provadas na F2.2 / F2.2.1:
- **dependsOn e order**: Respeito Ã  ordem de execuÃ§Ã£o e dependÃªncias explÃ­citas e implÃ­citas.
- **Skipped em cascata**: PropagaÃ§Ã£o de `"skipped"` se a dependÃªncia falhar.
- **DiferenciaÃ§Ã£o de receipts**: `"accepted"` nÃ£o muda estado conversacional e mantÃ©m `outcomeAppliedAt = null`. `"delivered"` aplica reducer conversacional e preenche `outcomeAppliedAt`.
- **ValidaÃ§Ãµes rÃ­gidas no commit**: Mismatch de IDs no `commitEffectOutcome` aborta o commit; updates de outbox inexistentes ou modificando chaves imutÃ¡veis no UoW sÃ£o rejeitados no `commit()`.
- **CAS real concorrente**: SimulaÃ§Ã£o de CAS real atravÃ©s de interceptaÃ§Ã£o prova que atualizaÃ§Ãµes de estados concorrentes sÃ£o barradas, sem aplicaÃ§Ã£o parcial.

Gates finais executados e verdes:
- `npm.cmd run test:all` -> **KERNEL 67 OK | 0 FALHA** + **F2.0/F2.1/F2.2/F2.2.1 65 OK | 0 FALHA** (132 testes verdes totais).
- `npm.cmd exec -- tsc --noEmit` -> sem erros de compilaÃ§Ã£o.
- `rg "fetch|http|postgres|pg|supabase|createClient|uazapi" src` -> somente comentÃ¡rio explicativo em `domain/ports.ts`.
- `rg "msg\.includes|rawMessage\.includes" src/engine src/domain` -> 0 achados.

Proximo passo recomendado: **F2.3 - Reconciler / Job Queue in-memory** (Concluido).

---

## Atualizacao Antigravity - F2.3 / F2.3.1 (Reconciler e EffectGate in-memory) - 2026-06-27

Antigravity assumiu a execucao da **F2.3 / F2.3.1** mantendo o escopo estrito da Fase 2: tudo fake/in-memory, sem I/O real.

Arquivos criados/alterados:
- `Agent/src/engine/receipt-policy.ts` [NEW] - Define em cÃ³digo se o efeito Ã© crÃ­tico conversacionalmente (`isCriticalForConversationState`), se exige `"delivered"` ou `"accepted"` (`requiredReceiptFor`) e avalia se dependÃªncias prioritÃ¡rias foram de fato satisfeitas (`isEffectSatisfiedForDependency`).
- `Agent/src/engine/effect-gate.ts` [NEW] - Proporciona o controle em memÃ³ria para alternar entre Active e Shadow Mode.
- `Agent/src/engine/reconciler.ts` [NEW] - Realiza a varredura e conciliaÃ§Ã£o de registros presos em `"processing"`, incertos em `"outcome_uncertain"` e timeouts de `"accepted"`. Limita retentativas (`maxAttempts`) movendo registros excedentes para dead-letter terminal (sem mutar estado conversacional).
  - **F2.3.1**: O reconcilador foi ajustado para aplicar a polÃ­tica e **nÃ£o** lanÃ§ar timeout de entrega (dead-letter) em efeitos nÃ£o-crÃ­ticos (como `send_message` sem `onSuccess`), pois estes exigem apenas receipt nÃ­vel `"accepted"`.
- `Agent/src/engine/outbox-dispatcher.ts` [MODIFY] - Injetado o `EffectGate` e a verificaÃ§Ã£o do Shadow Mode (onde os records viram `"skipped"` com `lastError = "shadow_mode_gate_active"`, significando consumido operacionalmente pelo gate). As dependÃªncias passaram a ser validadas estritamente pela polÃ­tica do `receipt-policy.ts`.
- `Agent/tests/run-phase2.ts` [MODIFY] - Adicionados os testes 18 a 24 da Fase 2.3/2.3.1, cobrindo reconciliaÃ§Ã£o por capability, retentativas mÃ¡ximas (dead-letter), timeouts de accepted apenas para efeitos crÃ­ticos, liberaÃ§Ã£o normal de accepted nÃ£o-crÃ­ticos antigos e o funcionamento auditÃ¡vel do Shadow Mode.

Garantias provadas na F2.3 / F2.3.1:
- **Matriz de receipts em cÃ³digo**: Efeitos crÃ­ticos (com onSuccess, crm_write, handoff, etc.) exigem estritamente `"delivered"` para desbloquear dependentes. Efeitos informais exigem apenas `"accepted"`.
- **Timeout de accepted seletivo**: O timeout e transiÃ§Ã£o para falha/dead-letter em `"accepted"` preso aplica-se apenas a efeitos crÃ­ticos que dependem de `"delivered"`.
- **ReconciliaÃ§Ã£o segura**: Records `idempotent` sofrem retry seguro sob limite de `maxAttempts`. Records `queryable` consultam status (`reconcile`) antes de qualquer decisÃ£o. Records `none` entram diretamente em dead-letter terminal sem avanÃ§ar o estado conversacional.
- **Shadow Mode auditÃ¡vel**: Bloqueia chamadas de dispatch real. MantÃ©m decision/outbox intactos e legÃ­veis para comparaÃ§Ãµes.

Gates finais executados e verdes:
- `npm.cmd run test:all` -> **KERNEL 67 OK | 0 FALHA** + **F2.0/F2.1/F2.2/F2.2.1/F2.3/F2.3.1 83 OK | 0 FALHA** (150 testes verdes totais).
- `npm.cmd exec -- tsc --noEmit` -> sem erros de compilaÃ§Ã£o.
- `rg "fetch|http|postgres|pg|supabase|createClient|uazapi" src` -> somente comentÃ¡rio explicativo em `domain/ports.ts`.
- `rg "msg\.includes|rawMessage\.includes" src/engine src/domain` -> 0 achados.

Proximo passo recomendado: **F2.4 - Schema SQL (v3_schema.sql) + ADR de mapeamento**. Mapeamento lÃ³gico de tabelas e ports do Pedro v3 para o banco Supabase, preparando a infraestrutura para a futura transiÃ§Ã£o de adapters reais.

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

## AtualizaÃ§Ã£o Claude â€” Auditoria read-side + Plano F2.5.2 entregue â€” 2026-06-28

Claude retomou como executor. Baseline reconfirmado: `npm run test:all` â†’ **214 OK | 0 FALHA**; `tsc --noEmit` limpo. **Nada alterado em Agent/, v2 ou banco** (auditoria read-only via cÃ³digo vivo + Supabase MCP sÃ³-leitura).

Entregue: **`Brain/08-PLANO-F2.5.2-READ-SIDE.md`** (16 pontos) com o inventÃ¡rio FACTUAL das fontes vivas.

**Fontes vivas confirmadas (por import/query/runtime):** config+prompt = `wa_ai_agents`(+`agent_funnel_config`, `selectActiveAgent`); estoque = **API EXTERNA** por tenant via `platform_integrations` (`searchPedroStock`: RevendaMais feed > BNDV GraphQL); fotos = campo `pictureJs` do item de estoque (nÃ£o Ã© tabela); CRM = `ai_crm_leads`; KB = `agent_knowledge_bases`/`knowledge_chunks`.

**Binding do `douglasaloan@gmail.com` (SQL):** tenant `user_id=ecb26258-ffe6-4fe2-9efc-8ab2fc3a61b0`; agente **"Aloan"** `agent_id=d4fd5c38-dd37-4da5-a971-5a7b7dfb9185` (ativo).

**DivergÃªncias vs inventÃ¡rio anterior (cÃ³digo venceu):** (a) agente Ã© **"Aloan"**, nÃ£o "Sara"; (b) **`instance_id=NULL`** (sem WhatsApp ligado â€” bloqueio sÃ³ da fase ativa); (c) **BNDV e RevendaMais ambos ativos** â†’ RevendaMais vence pela precedÃªncia viva; (d) `use_funnel_config=false` â†’ prompt = `system_prompt` cru; `company_name=""`; (e) **estoque/fotos sÃ£o HTTP externo**, entÃ£o o read-side precisa de fetch read-only (distinto dos EffectDispatchers, que seguem OFF).

**Status: aguardando auditoria do Codex do plano `08` + decisÃµes do dono (Â§16)** antes de implementar a F2.5.2. Nenhum I/O de implementaÃ§Ã£o foi feito.

---

## AtualizaÃ§Ã£o Claude â€” Plano F2.5.2 revisado (R1) â€” 2026-06-28

DireÃ§Ã£o da F2.5.2 aprovada pelo Codex; **implementaÃ§Ã£o NÃƒO**. Apliquei as 12 correÃ§Ãµes obrigatÃ³rias em `Brain/08` (seÃ§Ã£o **REVISÃƒO R1**), com investigaÃ§Ã£o read-only adicional do v2. **Agent/ intocado; nada implementado.**

InvestigaÃ§Ã£o que fundamentou a R1: RevendaMais raw Ã© `Record<string,any>` e **descarta id externo**; `category` do feed = AUTOMOVEL/MOTO (nÃ£o carroceria); BNDV GraphQL vivo **nÃ£o pede id nem carroceria**; carroceria hoje = regex de listas manuais (`getVehicleSubcategory`, a NÃƒO copiar); fotos = `[{Link,Principal}]` com URL possivelmente assinada.

CorreÃ§Ãµes no `08` (R1-1..R1-12): identidade `source+externalVehicleId` (fingerprint de atributos nÃ£o-volÃ¡teis se faltar; colisÃ£oâ†’`ambiguous`, sem foto auto); contrato de `photoId` (hash do path estÃ¡vel, resolÃºvel pÃ³s-restart/re-assinatura); preÃ§o/ano ausentes fail-closed (mini-ADR se mudar `VehicleFact`); `VehicleType` com confianÃ§a+proveniÃªncia (`unknown` nunca vira SUV; `broad` nÃ£o relaxa rÃ­gido); seguranÃ§a do fetch (HTTPS/allowlist/anti-SSRF/limite/timeout/retry-sÃ³-GET/sem-credencial-em-log); `CredentialProvider`/`SecretRef` (api_key_encrypted nunca em config/estado/log); CRM sem cpf/birth_date + `leadId`=UUID + exige tenant+agent+lead; tenant/agente explÃ­citos (sem "primeiro agente ativo"); KnowledgeSource removida do escopo (sem `knowledge_search` no contrato); prompt carregado/validado mas sem integraÃ§Ã£o efetiva atÃ© LLM; cache LRU+single-flight+Clock injetÃ¡vel (nÃ£o depender de `last_sync_at`); testes adversariais. **Slices F2.5.2Aâ€“D.** **DecisÃµes do dono aplicadas** (fetch read-only OK c/ controles; nÃ£o conectar instÃ¢ncia; RevendaMais principal; **sem fallback silencioso p/ BNDV**; prompt cru; nÃ£o importar v2).

**Status: revisÃ£o R1 aprovada pelo Codex.**

---

## AtualizaÃ§Ã£o Claude â€” F2.5.2A IMPLEMENTADA â€” 2026-06-28

R1 aprovada; **F2.5.2A implementada** (contratos read-only + carregamento seguro de config + `CredentialProvider`/`SecretRef` + fakes). **Sem HTTP/CRM/QueryRunner/LLM/rede; Kernel/v2/banco intocados.**

Criados em `Agent/`: `src/domain/read-ports.ts`, `src/domain/credential-provider.ts`, `src/adapters/read/v2-read-gateway.ts`, `src/adapters/read/tenant-config-source.ts`, `src/adapters/read/fakes/{fake-v2-read-gateway,fake-credential-provider}.ts`, `tests/run-read-side.ts`; `package.json` (`test:read` + `test:all`).

Garantias: tenant+agente explÃ­citos (sem "primeiro ativo"); gateway com mÃ©todos especÃ­ficos validando propriedade; `TenantRuntimeConfig` readonly **sem credencial** (sÃ³ `SecretRef` opaco de 4 campos); prompt sem fallback e sem vazar conteÃºdo em erro; RevendaMais>BNDV sem fallback silencioso; `CredentialProvider` nÃ£o chamado no load (provado por spy); erros tipados fail-closed.

Gates: **`test:all` = 242 OK | 0 FALHA** (214 + 28); `tsc` limpo; `rg` sem fetch/http/Uazapi/EffectDispatcher/CRM/import-v2/@supabase nas fontes da fatia (canÃ¡rios sÃ³ no teste). `08` consolidado (R1 autoritativa, trechos antigos marcados DEPRECATED).

**Status: F2.5.2A auditada â€” gerou F2.5.2A.1 (endurecimento).**

---

## AtualizaÃ§Ã£o Claude â€” F2.5.2A.1 (endurecimento contratual) â€” 2026-06-28

Codex auditou a A e pediu 9 endurecimentos contratuais (sem iniciar B). Implementados nos arquivos da fatia:

1. **2 camadas de propriedade** â€” `TenantConfigSource` revalida `id`/`tenantId` do agente, funil e cada integraÃ§Ã£o (nÃ£o confia sÃ³ no gateway); divergÃªncia â†’ `SOURCE_OWNERSHIP_MISMATCH`.
2. **Erros do gateway** â€” `tryGateway` captura exceÃ§Ã£o de cada chamada â†’ `READ_SOURCE_FAILURE` fail-closed; **nunca propaga `error.message`** (teste com canÃ¡rio token/prompt nÃ£o vaza).
3. **Imutabilidade real** â€” arrays clonados + `Object.freeze` recursivo (config/arrays/SecretRef frozen; mutar seed pÃ³s-load nÃ£o altera config).
4. **versionStamp composto** â€” agente + funil(quando usado) + provider + integrationId + integration.updatedAt (sem prompt/segredo).
5. **SecretRef tipado** â€” `provider` uniÃ£o fechada; `makeSecretRef` valida contra **allowlists reais** + ids nÃ£o-vazios, rejeitando **sem ecoar o valor**.
6. **CredentialProvider fail-closed** â€” `resolve` discriminado (`SECRET_NOT_FOUND`/`OWNERSHIP_MISMATCH`/`PROVIDER_MISMATCH`); fake nÃ£o devolve material "default".
7. **ValidaÃ§Ã£o de metadata** â€” rejeita id vazio/tenant divergente/provider desconhecido/duplicado/timestamp invÃ¡lido (sem normalizar silenciosamente).
8. **Testes adversariais** â€” gateway mentiroso (agente/funil/integraÃ§Ã£o de outro tenant), erro com segredo, imutabilidade, versionStamp, makeSecretRef, resolve fail-closed, metadata invÃ¡lida.
9. **`Brain/08` consolidado** â€” reescrito como **especificaÃ§Ã£o ÃšNICA**; trechos obsoletos (`marca|modelo|ano`/Ã­ndice, KnowledgeSource, CPF, `last_sync_at` base, listas do v2) **removidos**, nÃ£o sÃ³ marcados.

Gates: **`test:all` = 268 OK | 0 FALHA** (214 + **54** read-side); `tsc` limpo; `rg` sem fetch/http/Uazapi/EffectDispatcher/CRM/import-v2/@supabase nas fontes (canÃ¡rios sÃ³ no teste).

**Status: aguardando auditoria do Codex da F2.5.2A.1. NÃƒO iniciar B/C/D.**
---

## Atualizacao Codex - auditoria final F2.5.2A/A.1 - 2026-06-28

Codex retomou apos o limite de creditos do Claude, leu integralmente os contratos, adapters, fakes, 54 checks read-side, Brain/08 e handoff. A regressao foi executada novamente:

- `cmd /c npm.cmd run test:all` -> **268 OK | 0 FALHA**.
- `npm.cmd exec -- tsc --noEmit` -> limpo.
- Gate estatico -> nenhum `fetch`, Uazapi, EffectDispatcher, escrita CRM, Supabase/Postgres real ou import do v2 nas fontes A/A.1.

Invariantes confirmados: propriedade revalidada em duas camadas; erros do gateway sanitizados; config e arrays frozen; `versionStamp` inclui fontes efetivas; `SecretRef` usa allowlists e nao carrega segredo; CredentialProvider falha fechado; metadata invalida/cross-tenant e rejeitada; Brain/08 possui especificacao unica consolidada.

**Resultado: F2.5.2A/A.1 APROVADAS. F2.5.2B liberada sob os gates do Brain/08.**

---

## AtualizaÃ§Ã£o Claude â€” F2.5.4A (wiring Supabase read-only + canary shadow) â€” 2026-06-28

Claude retomou como executor. Baseline reconfirmado: `npm run test:all` â†’ **345 OK | 0 FALHA**; `tsc` limpo (bate com o esperado). Implementada **somente a F2.5.4A** (infra segura; **sem canary remoto, sem EffectGate ativo, sem provider real**).

**Auditoria read-only do v2 (crÃ­tico):** `api_key_encrypted` do `platform_integrations` Ã© **PLAINTEXT** (provado: `parseCredentials`=`JSON.parse`/raw; `mediaContext`/`metaSender` usam o valor direto como token). Logo **nÃ£o hÃ¡ formato criptogrÃ¡fico a comprovar e nÃ£o se inventou decryptor** â†’ ver **`Brain/decisions/ADR-008`**. Risco registrado: segredos em repouso sÃ£o plaintext + `service_role` exposta pendente de rotaÃ§Ã£o (prÃ©-requisito do canary remoto).

**Implementado:**
- `Agent/src/adapters/read/supabase-read-database.ts` â€” `SupabaseReadConfig` (HTTPS+host allowlist+chave em `#privado`, nÃ£o serializÃ¡vel) + `SupabaseReadOnlyDatabase implements V2ReadDatabase` (PostgREST GET-only via `HttpTransport` injetÃ¡vel; allowlist de tabela/coluna; filtro de tenant obrigatÃ³rio; redirect recusado; timeout; content-type JSON; erros `SUPABASE_READ_FAILURE` sanitizados; **escrita impossÃ­vel pelo contrato**).
- `Agent/src/adapters/read/v2-api-key-reader.ts` â€” `V2PlaintextApiKeyReader implements SecretDecryptor` (leitor de plaintext provado, fail-closed, sem log de segredo).
- `Agent/src/engine/canary-shadow-root.ts` â€” `CanaryShadowRoot` (tenant/agente explÃ­citos; `mode="shadow"` obrigatÃ³rio; aborta com gate ativo; monta stack read-only real + QueryRunner; roda via `runShadowHarnessTurn` com EffectGate OFF e sem dispatcher externo; defesa final contra dispatch).
- `Brain/decisions/ADR-008` Â· `Agent/tests/run-canary-wiring.ts` (33 checks) Â· `package.json` (`test:canary`).

**Gates:** `test:all` â†’ **378 OK | 0 FALHA** (67+96+34+21+127+**33**); `tsc` limpo; `rg` â†’ `service_role` sÃ³ em comentÃ¡rio (sem JWT hardcoded); `fetch(` sÃ³ no `http-client`/`transport.fetch` (adapter); nenhum write (`.delete` = Map/Set); sem Uazapi/WhatsApp/CRM-write/EffectDispatcher/`msg.includes`/`cpf`/`birth_date`/log de segredo nos arquivos novos.

**Bloqueado:** canary remoto, EffectGate ativo, providers reais â€” atÃ© rotaÃ§Ã£o da `service_role`. **Parado para auditoria do Codex (F2.5.4A). NÃƒO iniciar F2.5.4B/canary remoto sem autorizaÃ§Ã£o.**

---

## AtualizaÃ§Ã£o Claude â€” F2.5.4A.1 (correÃ§Ãµes da auditoria) â€” 2026-06-28

Codex **reprovou** a F2.5.4A (bloqueadores P1/P2/P3). Implementada **sÃ³ a F2.5.4A.1**. Baseline reconfirmado (378 OK, tsc limpo) antes de alterar.

**P1 â€” segredo:** allowlist global trocada por **MATRIZ ESTRITA** por `(tabela, operaÃ§Ã£o, colunas, filtros)` em `SupabaseReadOnlyDatabase`. `api_key_encrypted` sÃ³ em `platform_integrations`/**selectOne** com `id+user_id+is_active=true` (projeÃ§Ã£o do CredentialProvider); **proibido** em `selectMany`, outra tabela ou misturado a colunas comerciais â†’ fail-closed.
**P1 â€” canary vinculado ao agente:** `CanaryShadowRoot.create` agora **async** e carrega/valida `V2TenantConfigSource` antes de expor `runQuery`/`runTurn` (agente existe/ativo/dono/prompt vÃ¡lido/provider vÃ¡lido; senÃ£o `CanaryConfigError`). Guarda `TenantRuntimeConfig` **frozen** (`tenantConfig`); prompt como fonte autoritativa (`authoritativePromptText`), **`promptBoundToLlm=false`** (ligaÃ§Ã£o promptâ†’LLM Ã© fase posterior; nÃ£o alegada).
**P2 â€” corpo/projeÃ§Ã£o:** limite de bytes (content-length + stream real), rejeiÃ§Ã£o atÃ´mica de linha malformada, **projeÃ§Ã£o local** sÃ³ das colunas pedidas (descarta extras). **P2 â€” chave:** removido `authHeaders()` pÃºblico; chave em `#apiKey` privado (nÃ£o recuperÃ¡vel por API pÃºblica/`JSON.stringify`). **P3:** testes renomeados para "transporte PostgREST fake"/"wrapper concreto" (sem alegar "Supabase real").

**Testes:** `run-canary-wiring.ts` 33â†’**52 checks** (18 adversariais exigidos + extras). **`test:all` = 397 OK | 0 FALHA** (345 nÃ£o-canary intactos + 52 canary); `tsc` limpo; `rg` sem JWT/fetch-fora-de-adapter/write/EffectDispatcher/Uazapi/CRM-write/`msg.includes`(novos)/`cpf`/`birth_date`/log de segredo.

**Bloqueado:** canary remoto, promptâ†’LLM, providers â€” atÃ© rotaÃ§Ã£o da `service_role`. **Parado para nova auditoria do Codex (F2.5.4A.1). NÃƒO avanÃ§ar para F2.5.4B.**

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
---

## Atualizacao Claude - F2.6H (receipt callback messages_update) - 2026-06-28

Claude auditou e finalizou a F2.6H (estava no working tree, nao commitada). Fecha o bloqueador do F2.6G:
Uazapi devolve `accepted`, a memoria so avanca com `delivered`; agora o callback `messages_update` promove
o outbox por `providerMessageId` de forma idempotente, sem reenviar. **Piloto continua OFF.**

Verificado nos 6 requisitos (handoff `handoffs/2026-06-28-claude-f2.6h-receipt-callback.md`):
- Endpoint `POST /v1/pilot/receipt` (`pilot-http-app.ts`): bearer igual ao turno (`timingSafeEqual`), escopo
  piloto exato (403), so `delivered`/`read` (400), erros sanitizados, runner real wirado no `server.ts`.
- SQL manual `Brain/sql/v3_f2_6h_receipt_patch.sql`: RPC tenant-scoped `v3_find_outbox_by_provider_message_id`,
  ambiguidade falha fechado (`limit 2` + adapter `!==1`), `revoke public`/`grant service_role`.
- Persistencia: `findOutboxByProviderMessageId` via RPC allowlist; `accepted` nao avanca, `delivered`/`read`
  avanca idempotente (`provider-delivery-receipt.ts` com guarda `duplicate`; `commitEffectOutcome` CAS).
- Uazapi sender: captura `messageid` + `track_id/track_source`; nao reenvia em duplicado.
- Bridge v2: `messages_update` interceptado antes do `fromMe`; identidade hardcoded do piloto; nao inicia
  conversa nova; nao-piloto ignorado; `callPedroV3ReceiptBridge` com timeout/anti-SSRF/sem token no retorno.
  Correcao defensiva: guarda seller Ã— message_update (nao polui inbox do vendedor).
- Build webhook `v220` -> `2026-06-28-pedro-v3-delivery-receipt-v221`.

Gates reais: v3 `test:all` EXIT=0; `tsc --noEmit` limpo; v2 offline **417 OK | 0 FALHA** (3 testes
`v3-bridge` novos); bundle webhook esbuild EXIT=0; scan de segredos/dispatch limpo.

Pendente p/ dono (pre-ativacao, fora desta rodada): rodar o SQL patch; ao conectar a instancia do Aloan,
garantir `messages_update` no webhook (path moderno ja inclui; nao re-sync via `sync-uazapi-webhook`); ENV
`PEDRO_V3_SERVICE_URL`/`PEDRO_V3_BRIDGE_SECRET`; rotacao da `service_role`. `PEDRO_V3_PILOT_MODE` segue OFF.

Resultado: **F2.6H entregue para auditoria do Codex.** Sem deploy, sem `db push`, sem CRM/handoff/agenda.
---

## Atualizacao Claude - F2.6I (prep de ativacao controlada) - 2026-06-28

**F2.6H APROVADA pelo Codex** (commit `c1f216b7`; SQL `v3_f2_6h_receipt_patch.sql` rodado pelo dono:
`index_ok=true`, `function_ok=true`; gates re-rodados verdes). F2.6I = **so documentacao/auditoria da
ativacao**. Nenhuma alteracao de codigo, banco, deploy ou ativacao. `PEDRO_V3_PILOT_MODE` continua OFF.

Entregas (handoff `handoffs/2026-06-28-claude-f2.6i-prep-ativacao.md` + `README.md` operacional):
- **ENVs autoritativas (lidas do `server.ts`)**: servico EasyPanel = `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `OPENAI_API_KEY`, `PEDRO_V3_ALLOWED_UAZAPI_HOSTS` (CSV, obrigatoria), `PEDRO_V3_BRIDGE_SECRET` (>=32),
  `PEDRO_V3_OPENAI_MODEL`/`PORT` (opcionais). Webhook = `PEDRO_V3_PILOT_MODE`, `PEDRO_V3_SERVICE_URL`,
  `PEDRO_V3_BRIDGE_SECRET` (identico). **Correcoes vs missao**: e `PEDRO_V3_BRIDGE_SECRET` (nao `_SERVICE_SECRET`);
  `PEDRO_V3_ALLOWED_UAZAPI_HOSTS` faltava; `PEDRO_V3_PILOT_MODE` e do webhook, nao do EasyPanel.
- **instance_id (BLOQUEIO factual)**: o v3 le `instance_id` singular (`pilot-active-root.ts:140`);
  Aloan tem `instance_id=NULL` -> falha fechado. `instance_ids` aponta p/ `fdd6cbe1` que **nao existe** (orfa).
  Instancia REAL = **`6476a393`** (nome aloan, uazapi, connected, dona=piloto, phone 558597895634). Remediacao =
  o DONO seta `instance_id=6476a393` apos confirmar a linha (SQL no handoff). Nao inventei instancia.
- **messages_update**: validar via `GET /webhook/find/aloan`; sync pontual so da instancia piloto preparado
  (nao executado, sem script runnable commitado); nao usar `sync-uazapi-webhook` (removeria o evento).
- **Checklist ativacao** (off->shadow->active) + **rollback** (PILOT_MODE=off volta 100% ao v2) documentados.

Gates: nenhum codigo alterado nesta fatia (so docs) -> gates da F2.6H seguem validos; `git status` limpo
fora de docs. Build webhook segue `v221`.

Resultado: **F2.6I entregue para auditoria do Codex.** Bloqueios p/ ativar: setar `instance_id`,
`messages_update` na instancia, ENVs/deploy. `PEDRO_V3_PILOT_MODE` OFF; sem deploy/db push/rotacao.
---

## Atualizacao Claude - F2.6J (chave OpenAI BYOK por tenant) - 2026-06-28

Codex achou bloqueador pre-ativacao: `server.ts` exigia `OPENAI_API_KEY` global. O produto e BYOK â€”
a chave vem do perfil do tenant, como o v2 (`_shared/aiKeys.ts` -> RPC `get_client_ai_key`). Corrigido.

- **Removida** a env global `OPENAI_API_KEY` do servico (campo `#openAiKey` + `requiredEnv` fora).
- **Novo** `Agent/src/adapters/read/tenant-openai-key.ts` -> `resolveTenantOpenAiSecret({gateway, tenantId})`
  chama a mesma RPC service-role do v2 `get_client_ai_key(p_user_id, p_provider="openai")` (adicionada ao
  allowlist do gateway). Resolvida POR TENANT no `run()`, sem fallback global/plataforma.
- **Fail-closed + sanitizado**: sem chave do tenant -> `OPENAI_KEY_NOT_FOUND` -> `PILOT_BOOTSTRAP_FAILED`
  (ingested=false, sem dispatch/dupla); erro de leitura -> `OPENAI_KEY_LOOKUP_FAILED` (nao vaza corpo/segredo).
- **Sem vazamento**: chave volta so embrulhada em `OpenAiRuntimeSecret` (opaca; `toJSON` nao expoe;
  liberada so via `materialize` no header). `PEDRO_V3_OPENAI_MODEL` segue como NOME do modelo, nao credencial.
- **Docs**: README sem `OPENAI_API_KEY` nas obrigatorias + nota BYOK; handoff F2.6I corrigido.

Gates: `test:all` EXIT=0 (+ `TENANT OPENAI KEY: 18 OK` adversariais); `tsc` limpo; offline v2 **417 OK**;
bundle N/A (nao toquei webhook/bridge); scan: `OPENAI_API_KEY` fora das fontes v3, sem log de segredo.

Pre-requisito pre-ativacao: o tenant piloto precisa ter chave OpenAI cadastrada no perfil (Vault) â€”
`get_client_ai_key(ecb26258,'openai')` nao-vazio. Handoff `handoffs/2026-06-28-claude-f2.6j-byok-openai-por-tenant.md`.

Resultado: **F2.6J entregue para auditoria do Codex.** `PEDRO_V3_PILOT_MODE` OFF; sem deploy/db push/rotacao.
---

## Atualizacao Claude - F2.6K (grandfather BYOK + chave da plataforma) - 2026-06-29

Bloqueador (dono/Codex): a conta piloto NAO tem chave OpenAI propria â€” usa a da PLATAFORMA (grandfathered),
como Bruno/Wander. A F2.6J deixou o v3 so com `get_client_ai_key` -> quebraria contas grandfathered.

Correcao: mesmo 3-tier do v2 (`_shared/aiKeys.ts`) no resolver `tenant-openai-key.ts`:
1. client key propria (`get_client_ai_key`); 2. GRANDFATHERED sem propria -> chave da PLATAFORMA; 3. nova
sem propria -> fail-closed. `BYOK_GRANDFATHER_CUTOFF=2026-06-16T03:00:00Z` (mesma do v2); grandfather le
`profiles.created_at` com **fail-open** (igual `isAccountGrandfathered`).

Caminho backend SEGURO da chave da plataforma (sem env no EasyPanel): nova RPC service-role
`get_platform_ai_key(p_provider)` lendo do **Vault** (`vault.decrypted_secrets`) â€” SQL MANUAL em
`Brain/sql/v3_f2_6k_platform_ai_key.sql` (nao executado). Gateway: allowlist + RPC `get_platform_ai_key`
e tabela `profiles` (so `created_at`). Chave nunca em env/log/estado/outbox/erro/JSON (so via `materialize`).

Gates: `test:all` EXIT=0 (+ `TENANT OPENAI KEY: 26 OK` adversariais, incl. fail-open de profile, cross-tenant,
boundary do cutoff, no-leak client+platform); `tsc` limpo; offline v2 **417 OK**; bundle N/A; scan limpo.

PASSO MANUAL DO DONO (pre-ativacao): rodar `v3_f2_6k_platform_ai_key.sql` + cadastrar o secret
`platform_openai_api_key` no Vault (a mesma chave do `OPENAI_API_KEY` do v2). Sem isso, conta grandfathered
cai em fail-closed (degrada pro v2). Handoff `handoffs/2026-06-29-claude-f2.6k-grandfather-platform-key.md`.

Resultado: **F2.6K entregue para auditoria do Codex.** `PEDRO_V3_PILOT_MODE` OFF; sem deploy/db push/rotacao.
---

## Atualizacao Claude - F2.6L (observabilidade da falha de turno) - 2026-06-29

Dono reportou: print mostra o v2 respondendo na conta Aloan (v3 nao pegou). Diagnostico read-only:
- AGORA o webhook NAO roteia pro v3 (teste real na instancia aloan: sem `routed:pedro_v3`, 0 evento novo no
  v3_inbox, v2 respondeu) -> `PEDRO_V3_PILOT_MODE` nao esta `active`.
- Quando ESTEVE active: 5 eventos no v3_inbox `pending`/`attempts=5`/sem claim/sem last_error/outbox=0 -> o
  turno falha DEPOIS do ingest, antes de produzir saida, e cai no v2.
- Pre-reqs OK (instance_id, secret no Vault, RPC, grandfathered). **Chave OpenAI DESCARTADA**: testei a chave
  da plataforma (Vault) contra a OpenAI -> GET /models 200 + chat gpt-4.1-mini 200 (valida). A falha e runtime.

F2.6L: tornar a falha diagnosticavel pelo BANCO (o erro hoje so existe no log do EasyPanel).
- `sanitize-error.ts` (sanitizeTurnError: name:code:msg truncado, redige sk-/JWT/Bearer) +
  `server.ts` grava o motivo sanitizado em `v3_inbox.last_error` no catch do turno (best-effort, so ingerido) +
  RPC manual `v3_record_inbox_error` (Brain/sql/v3_f2_6l_inbox_error.sql, tenant-scoped, service-role) +
  allowlist no gateway + `run-sanitize-error.ts` (7 testes).
Gates: test:all EXIT=0 (+ SANITIZE ERROR 7, TENANT OPENAI 26); tsc limpo; offline v2 418 OK; scan limpo.

PASSOS DO DONO p/ revelar a raiz: (1) rodar `v3_f2_6l_inbox_error.sql`; (2) redeploy do servico v3 no
EasyPanel; (3) `PEDRO_V3_PILOT_MODE=active`; (4) avisar -> eu disparo 1 turno e LEIO `v3_inbox.last_error` ->
raiz -> corrijo. (Alternativa: colar o log do servico v3 no EasyPanel.) Handoff
`handoffs/2026-06-29-claude-f2.6l-observabilidade-falha-turno.md`.

Resultado: **F2.6L entregue para auditoria do Codex.** `PEDRO_V3_PILOT_MODE` OFF; sem deploy/db push/rotacao.
---

## Atualizacao Claude - F2.6M (surfacar commit_failed do engine) - 2026-06-29

Diagnostico avancou: log do servico v3 (EasyPanel) mostrava SO `pedro_v3_service_started` (3 deploys),
sem turno e sem erro; `v3_inbox.last_error` vazio mesmo apos o F2.6L. **Raiz da invisibilidade**: o
`conversation-engine.ts` (catch ~214) **falha GRACIOSAMENTE** â€” libera o claim e RETORNA
`{status:"commit_failed", reason:<msg do erro>}` SEM lancar e SEM logar. Logo o `catch` do server.ts (F2.6L)
nunca dispara, e o `reason` so vivia no retorno.

Fix F2.6M (server.ts, fora do engine puro): apos `root.runTurn`, se `result.status==="commit_failed"`,
**loga** `pedro_v3_turn_commit_failed` (console.error -> EasyPanel) + **grava** o reason sanitizado em
`v3_inbox.last_error` (RPC F2.6L). Agora a falha aparece NO LOG e NO BANCO. Sanitizado; best-effort no banco.

Gates: test:all EXIT=0; tsc limpo; offline v2 418 OK. EasyPanel faz auto-deploy no push.
Proximo: dono manda 1 "tem onix" apos o auto-deploy -> leio `v3_inbox.last_error` (ou o log) -> corrijo a raiz real.

Resultado: **F2.6M no ar pelo auto-deploy.** `PEDRO_V3_PILOT_MODE` segue active (piloto); sem db push/rotacao.
---

## Atualizacao Claude - F2.6N (ROOT CAUSE: double-encoding no filtro PostgREST) - 2026-06-29

O F2.6M revelou o `last_error` real: **`Error: claimed inbox record missing`** (`conversation-engine.ts:128`).
Investiguei: `claimBurst` claima N eventos mas `get(eventId)` devolve null -> mismatch -> falha todo turno.

**Raiz**: DOUBLE-ENCODING no `SupabaseServiceGateway.encodeFilter`. O `event_id` real e `uazapi:<hash>`
(com `:`). `encodeFilter` fazia `encodeURIComponent` -> `%3A`, e o `URLSearchParams.toString()` re-encodava
o `%` -> `%253A`. O PostgREST entao procurava `event_id="uazapi%3A<hash>"` literal -> nao casava ids com `:`
-> `get()=null` -> "claimed inbox record missing" -> turno falha sempre -> sem resposta -> fallback v2.
Passou despercebido pq RPCs mandam args no body JSON (sem esse encoding) e os testes usavam ids sem `:`.

**Fix**: `encodeFilter` retorna `eq.${String(value)}` (cru); o `URLSearchParams` encoda UMA vez. Teste novo
`run-gateway-filter.ts` (5 checks) prova single-encoding p/ `:`-ids. Gates: test:all EXIT=0 (+ GATEWAY FILTER 5),
tsc limpo, offline v2 418 OK.

Proximo: auto-deploy -> dono manda "tem onix" -> verifico `v3_inbox.status=done` + `v3_effect_outbox` com a
resposta + WhatsApp recebe do v3. Backlog de 6 eventos do conversation `wa:8ed1...` auto-cura no 1o turno.
Handoff `handoffs/2026-06-29-claude-f2.6n-fix-double-encoding-claim.md`.

Resultado: **F2.6N no ar pelo auto-deploy â€” provavel destravamento do piloto.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.6O (enriquecer HTTP_FAILURE do gateway) - 2026-06-29

Pos-F2.6N: o "claimed inbox record missing" SUMIU (fix do encoding pegou), mas o turno agora avanca e
falha em `Error: HTTP_FAILURE` (uma chamada ao gateway Supabase retornou nao-2xx â€” provavel `load`
de v3_conversation_state OU o `commit` v3_commit_turn, que NUNCA eram exercitados antes pq o get() quebrava).
Os logs da API (get_logs) sao dominados por v2/portal/crons e nao isolam a chamada do servico v3.

Fix F2.6O: `SupabaseServiceGatewayError` ganha `detail` e o throw de `!response.ok` agora inclui
**metodo + rota + status** (ex.: "HTTP_FAILURE POST /rest/v1/rpc/v3_commit_turn 400") â€” sem query/segredo.
Assim o `v3_inbox.last_error` (via F2.6M) vai dizer EXATAMENTE qual chamada falhou e o status.
Teste `run-gateway-filter.ts` (+2 checks: inclui status/rota/metodo; nao vaza service-role-key). Gates:
test:all EXIT=0, tsc limpo, offline v2 418.

Proximo: auto-deploy -> dono manda "tem onix" -> leio o `last_error` enriquecido -> corrijo a chamada exata.

Resultado: **F2.6O no ar pelo auto-deploy.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.6P (2a ROOT CAUSE: falso-positivo de CPF barra o commit) - 2026-06-29

F2.6O revelou o ponto exato: **`HTTP_FAILURE POST /rest/v1/rpc/v3_commit_turn 400`**. Log do Postgres:
**`v3_turn_events_payload_ck` violado**. Provado no banco: o payload do evento `turn_claimed` inclui os
`event_ids` do uazapi (hash hex 64 chars); um hash com **11 digitos seguidos** (`77842555836`) batia no
heuristico de CPF de `v3_payload_is_redacted` -> check rejeita -> 23514 -> PostgREST 400 -> turno falha sempre.
As bordas `[^0-9]` tratavam letras hex como delimitador. Nunca rodou contra Postgres real (get() quebrava antes).

**Fix**: `v3_payload_is_redacted` usa **word-boundary `\y`** no regex de CPF. Hash (grudado em alfanumerico)
nao casa; CPF real (formatado OU cru, cercado por borda) continua barrado. `v3_schema.sql` atualizado +
migration `sql/v3_f2_6p_redaction_cpf_boundary.sql` (DONO roda no SQL Editor â€” fix e no BANCO). Teste
run-sql-schema.ts +3. Gates: test:all EXIT=0, SQL 41 OK, tsc limpo, offline v2 418.

âš ï¸ Risco residual (PRE-EXISTENTE, fora do escopo): o check ainda barra telefone BR (11 digitos)/protocolo que
o agente escreva no texto, e e FATAL. Revisitar com Codex (so CPF formatado? nao-fatal?). Handoff
`handoffs/2026-06-29-claude-f2.6p-fix-cpf-false-positive.md`.

Proximo: dono roda a migration + manda "tem onix" -> commit suceder -> v3 RESPONDE (status=done + outbox + msg).

Resultado: **F2.6P pronto â€” codigo commitado; AGUARDA o dono rodar a migration SQL.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.6Q (3a ROOT CAUSE: envio uazapi + observabilidade do dispatch) - 2026-06-29

Dono rodou o SQL do F2.6P + testou: **commit PASSOU** (`v3_inbox` 11 eventos `done`, backlog auto-curado) e o
v3 gerou um `send_message`. MAS ficou `outcome_uncertain` com receipt `sender_text_exception` -> o ENVIO
estourou. Investiguei: `INSTANCE_SECRET_COLUMNS` (credential provider) selecionava **`api_key`**, coluna que
**NAO existe** em `wa_instances` (so `api_key_encrypted`, confirmado no information_schema) -> `select=...,api_key`
-> PostgREST 400 -> gateway de leitura lanca -> o `catch {}` VAZIO do dispatcher devolvia so "sender_text_exception".

**Fix**: (1) remover `api_key` de INSTANCE_SECRET_COLUMNS (token mora em `api_key_encrypted`); (2) observabilidade:
`safeErrLabel` poe um rotulo SEGURO no reason (name+code do erro, NUNCA a mensagem -> sem vazar token) + console.error.
Testes +2 (run-active-effects 53 OK). Gates: test:all EXIT=0, tsc limpo, offline 418. **Fix PURO de codigo (sem SQL)**.

Proximo: auto-deploy -> dono manda "tem onix" -> `resolve()` pega o token -> `sendText` POSTa -> outbox
`succeeded`/`accepted` + **mensagem chega no WhatsApp** (resposta REAL, backlog ja limpo).
Pendencias p/ revisitar: resolve-throw deveria ser failed+retryable (nao uncertain); risco CPF/telefone do F2.6P.
Handoff `handoffs/2026-06-29-claude-f2.6q-fix-uazapi-send.md`.

Resultado: **F2.6Q no ar pelo auto-deploy â€” provavel ultimo tijolo do envio.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.6R (alinhar prompt ao contrato de decisao â€” fim do loop) - 2026-06-29

â­ **MARCO: o Pedro v3 responde de PONTA A PONTA no WhatsApp do Aloan** (recebe->decide->commita->envia->chega).
As 3 travas de infra cairam (F2.6N encoding, F2.6P CPF, F2.6Q coluna do token). Mas respondia sempre a MESMA
frase de fallback ("Desculpe a lentidao temporaria...") = loop. Causa: `v3_decisions` mostrava
`MODEL_DECISION_INVALID` no `propose`.

Raiz: `operationInstructions("propose")` (openai-chat-model.ts) dizia "return JSON matching DecisionStep/
ProposedDecision" mas **NUNCA descrevia o envelope** -> o modelo nao tinha como produzir -> rejeitado ->
`emitErrorTerminalSafe` (finalizer:309) -> safe-terminal. (Os testes usam modelo FAKE com envelope ja certo.)
Achado: no finalizer, `effectPlan = proposal.proposedEffects` â€” sem auto-send_message; o modelo PRECISA emitir
o efeito send_message para responder.

Fix: reescrevi `operationInstructions` dos 3 passos (interpret/propose/compose) com o envelope EXATO + exemplos +
a regra do send_message; conservador (`facts:[]`, sem mutacoes de estado neste corte â€” slot/objetivo e a proxima
iteracao). Observabilidade: `ModelOutputError` ganha `detail` (campo que falhou, ex.: `MODEL_DECISION_INVALID:
proposedEffects`) -> aparece em `v3_decisions.reason_summary`. Teste +1 (run-model-adapter 27 OK). Gates: test:all
EXIT=0, tsc limpo, offline 418, secret scan limpo. **Fix de prompt â€” validacao real e AO VIVO** (sem SQL).

Proximo: auto-deploy -> dono manda "tem onix" -> leio `v3_decisions`: `action` real (nao error/terminal_safe) +
resposta REAL no WhatsApp. Se falhar, o reason_summary aponta o campo -> itero (pode levar 1-2 rodadas).
Pendencias: facts ricos (slots/objetivos); CPF/telefone (F2.6P); resolve-throw=>uncertain (F2.6Q); avaliar json_schema.
Handoff `handoffs/2026-06-29-claude-f2.6r-decision-envelope-prompt.md`.

Resultado: **F2.6R no ar pelo auto-deploy â€” deve dar respostas REAIS (fim do loop).** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.7.1 (anti-filler + responder a pergunta real) - 2026-06-29

âœ… F2.6R confirmado AO VIVO: o Aloan respondeu de verdade (apresentou-se, pegou cidade/nome, seguiu funil).
Inicio da **FASE F2.7 (naturalidade/paridade UX com v2)**, ordem do dono: 1) anti-filler+responder-pergunta;
2) testes adversariais; 3) DESENHO do debounce no Brain (parar p/ Codex); 4) digitando depois.

F2.7.1 (etapa 1): regras NO CEREBRO (instrucoes do adapter, sem if por frase, sem if p/ "onix"):
- **propose**: responsePlan.guidance = "responder PRIMEIRO o que o lead perguntou (so facts/state reais), DEPOIS 1
  pergunta de funil se faltar qualificacao" + RULES "ANSWER FIRST" (nunca ignorar pergunta pra empurrar funil; se
  faltar dado, query antes) e "NO EMPTY CONTENT".
- **compose**: "ANSWER FIRST, then qualify" + proibe abrir com afirmacao vazia ("Que otimo"/"Perfeito"/...).
Gates offline: test:all EXIT=0, tsc limpo (âš ï¸offline usa modelo FAKE -> nao valida comportamento do LLM).

Suite adversarial (autoro+julgo, rodada no piloto ao vivo â€” dono envia, eu leio v3_effect_outbox+v3_decisions):
A "tem Onix?" no meio da qualificacao; B nome depois pergunta estoque; C "ok/sim/gostei"; D valor/foto/modelo
especifico; E nenhuma resposta abre com filler; F info util + 1 pergunta de funil quando qualificando. So "verde"
quando A-F passam consistente; se falhar, fortaleco a instrucao (1-2 rodadas).
Handoff `handoffs/2026-06-29-claude-f2.7.1-anti-filler-answer-first.md`.

Resultado: **F2.7.1 no ar pelo auto-deploy; aguardando rodada adversarial ao vivo.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.7.2 (desbloquear estoque: feed http->https) - 2026-06-29

Teste adversarial da F2.7.1 mostrou: anti-filler OK (respostas limpas, sem filler), MAS o agente nao confirmava
estoque (`unable_to_confirm_stock`). Raiz (banco): o feed RevendaMais do Aloan esta cadastrado como
**`http://app.revendamais.com.br`** (dado legado v2); o `SafeHttpClient` rejeitava http (HTTPS_REQUIRED, decisao
de seguranca deliberada) -> estoque 100% bloqueado (sem fallback BNDV).

Fix (aprovado pelo dono): `SafeHttpClient.validateUrl` NORMALIZA http->https (mais seguro que rejeitar; allowlist
de host + anti-SSRF de IP seguem barrando host nao previsto) + `executeSingleFetch` agora baixa a URL JA
normalizada (corrige bug latente: validava uma, baixava a crua). âš ï¸REVERTE a decisao "rejeitar http" -> SINALIZADO
p/ re-auditoria do Codex (alternativa: corrigir o dado e manter v3 estrito; implementei o upgrade por ser
resiliente p/ feeds legados). Testes run-read-side 129 OK (+http-normaliza, +http-fora-allowlist-bloqueado,
+safeFetch-baixa-https); test:all EXIT=0, tsc limpo, offline 418.

Pendencias anotadas: fotos http descartadas (parseVehiclePhotos) -> afeta send_photos depois; timeout do propose
(1 ocorrencia, provavel latencia transitoria da OpenAI) -> MONITORAR.
Handoff `handoffs/2026-06-29-claude-f2.7.2-stock-feed-https-upgrade.md`.

Proximo: dono re-roda adversariais (com estoque acessivel) -> julgo A-F -> etapa 3 (DESENHO do debounce, parar p/ Codex).

Resultado: **F2.7.2 no ar pelo auto-deploy; aguardando re-teste com estoque acessivel.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.7.3 (observabilidade do deny de grounding no compose) - 2026-06-29

Re-teste do dono ("Ola/ConheÃ§o/tem onix?/AtÃ© 80k?") -> "mesma coisa". Diagnostico em v3_decisions: greeting+
qualify_name OK; o burst AGREGOU "tem onix?"+"AtÃ© 80k?" num turno (âœ…), MAS deu `terminal_safe: "ValidaÃ§Ã£o de
resposta falhou repetidamente"` â€” o `compose` produziu draft estruturalmente valido, porem a **validacao de
grounding** (`PolicyEngine.validateResponse`, decision-engine:131/141) **negou repetidamente** -> terminal-safe.
Provavel: fatos de estoque nao chegaram (F2.7.2 talvez nao deployado no teste, ou feed vazio) OU o modelo citou
algo fora dos fatos. O motivo (gv.violations) era engolido na mensagem generica.

Fix F2.7.3 (so observabilidade, nao muda logica): captura `lastDenyDetail` (JSON dos verdicts deny, bounded 220)
no loop de compose e inclui no reason do `emitTerminalSafe` -> aparece em `v3_decisions.reason_summary`. Assim 1
teste revela QUAL policy/violation negou (stock-vazio? render-ref? overreach?). Gates: test:all EXIT=0, tsc limpo,
offline 418. Handoff: nota aqui (tweak pequeno, padrao F2.6M/O).

âš ï¸Padrao observado: o cerebro e FAIL-CLOSED (recusa em vez de alucinar) â€” cada gate (decisao, grounding) e afinado
1x1. Ja passamos decisao(F2.6R)+anti-filler(F2.7.1)+estoque-http(F2.7.2); agora o grounding do compose.
Proximo: confirmar deploy F2.7.2+F2.7.3 -> dono manda 1 "tem onix?" -> leio o motivo exato do deny -> corrijo a raiz
(stock facts e/ou afinar o grounding) -> dai etapa 3 (debounce). Possivel: debounce sobe de prioridade (rajada
fragmenta).

Resultado: **F2.7.3 no ar pelo auto-deploy; aguardando 1 teste p/ ler o motivo do deny.** `PEDRO_V3_PILOT_MODE` active.
---

## Atualizacao Claude - F2.7.4-A (memoria accepted-safe: motor + contrato SQL) - 2026-06-29

âš ï¸ **ENTREGA FECHADA, SEM ATIVAR NADA**: sem deploy, sem push, sem rodar SQL no banco, `PEDRO_V3_PILOT_MODE` INALTERADO.
Aguarda auditoria do Codex -> dono roda a migration -> so entao push/deploy.

Auditoria (read-only) confirmou **E (combinacao)**: A sem debounce; B fala nao persistida (`recentTurns` VAZIO com
version=16, `on_success=[]`); C delivered nunca aplica (outboxes presos em `accepted`); D grounding. Esta rodada ataca
B+C com o contrato **accepted-safe**.

Contrato (aprovado): `append_assistant_turn` em **accepted** = memoria do que o agente ENVIOU (â‰  lead recebeu);
`delivered/read` = confirmacao externa; acoes comerciais (oferta/foco/fotos/objetivo/CRM/handoff/schedule/
mark_message_delivered) seguem exigindo **delivered**. FONTE UNICA: `v3_required_receipt_level(kind,on_success)`.

Motor (rodada A, ja aprovada pelo Codex): effect-policy (ACCEPTED_SAFE_OUTCOME_OPS), effect-materializer (injeta
append_assistant_turn deterministico, fonte unica sem duplicar), conversation-engine (injeta append_lead_turn
deterministico, sem duplicar), effect-outcome-commit + in-memory-store (aplica no nivel exigido; grava receipt antes
de pular outcome ja aplicado -> delivered posterior sobe accepted->delivered sem reaplicar). Testes: run-active-effects
55 OK, run-active-root 17 OK.

Contrato SQL (esta rodada): `v3_schema.sql` + `sql/v3_f2_7_4_accepted_safe_memory_patch.sql` (migration manual
idempotente p/ o dono) â€” helper + coluna gerada via helper + check (`outcome_applied_at` em accepted so accepted-safe)
+ `v3_commit_effect_outcome` (valida nivel real; delivered posterior idempotente). `v3_record_outbox_result` CONFIRMADO
compativel (transicao accepted->delivered ja valida; ja ramifica em required_receipt_level). Verificador read-only
(JSON ok=true) comentado no fim do patch. Testes pglite REAIS (run-sql-schema) cobrem os 9 casos do Codex.

Gates: test:all EXIT=0; tsc limpo; SQL 64 OK; offline v2 418 OK; scan dos arquivos da rodada LIMPO (sem provider/
dispatch/uazapi/fetch/segredo). Handoff `handoffs/2026-06-29-claude-f2.7.4-a-accepted-safe-memory.md`.

Risco restante: C (callback delivered nao chega no webhook) segue PENDENTE â€” a memoria nao depende mais disso, mas o
rastreio de ENTREGA + outcomes que exigem delivered seguem parados ate resolver o C (proxima fase). Debounce/grounding/
bloco (resto da F2.7.4) PENDENTES.

Resultado: **F2.7.4-A pronto e gateado, NAO deployado â€” entregue p/ auditoria do Codex + migration p/ o dono rodar.** `PEDRO_V3_PILOT_MODE` INALTERADO.
## 2026-06-30 - F2.7.14: conducao SDR minima (Codex)

Implementado controlador de qualificacao baseado no estado central. A resposta ao pedido atual continua prioritaria; depois dela o agente faz no maximo uma pergunta pendente. Slots conhecidos nao sao repetidos. O gate minimo cobre nome, interesse, faixa de preco, pagamento, troca e visita, com condicionais para entrada/parcela, dados do veiculo de troca e dia/horario.

Perguntas configuradas no portal sao mapeadas para slots tipados quando reconheciveis. O Finalizer acopla cada pergunta a um PlannedObjective 1:1 e o objetivo ativa em receipt accepted; efeitos comerciais e entrega seguem delivered.

Gates: F2.7.14 = 39 OK; SQL = 75 OK; Phase2 = 96 OK; test:all exit 0; tsc limpo.

SQL manual pre-deploy: Brain/sql/v3_f2_7_14_sdr_objective_accepted.sql.

Backlog registrado: (1) garantir cambio/cor do feed ate VehicleFact; (2) primeiro envio limitado a cinco fotos representativas; (3) apos validacao real, integrar CRM, briefing, handoff e follow-up usando readyForHandoff.

## 2026-07-01 - F2.7.14.1: prompt do portal + pickup RevendaMais

Teste real comprovou tres causas: o condutor substituia a pergunta valida do prompt, o feed classificava Strada/Toro como `utilitario` e o decoder derrubava decisao valida sem metadado diagnostico. Corrigido por invariantes: pergunta do portal preservada com objetivo tipado, apresentacao garantida no primeiro turno, perguntas numeradas extraidas do prompt cru, taxonomia `utilitario -> pickup` escopada ao RevendaMais e defaults seguros para reasonCode/reasonSummary.

Gates: read-side 132/0; F2.7.14 45/0; model adapter 28/0; test:all verde; tsc limpo. Sem SQL. Handoff: `handoffs/2026-07-01-codex-f2.7.14.1-prompt-pickup.md`.
## 2026-07-01 - F2.7.15: taxonomia automotiva canonica via planilha

A base `carros_brasil_categorias.xlsx` foi incorporada como taxonomia deterministica do Pedro v3: 132 modelos (hatch/sedan/SUV/picape). O classificador de estoque agora tenta marca/modelo/versao pela taxonomia antes de confiar no `category/bodyType` da API. Isso corrige a raiz de `picape`/`SUV` nao aparecerem quando a API manda `utilitario`, `Outros` ou classificacao ruim.

Garantias novas: Strada/Toro/Hilux/Frontier => pickup; Renegade/Fastback/Pulse/Peugeot 2008 => SUV; HB20S/Onix Plus/C3 Aircross vencem os modelos parecidos mais curtos. Sem SQL, sem v2/bridge/webhook. Gates: F2.7.15 22/0; `npx.cmd tsc --noEmit` limpo; `npm run test:all` verde. Handoff: `handoffs/2026-07-01-codex-f2.7.15-vehicle-taxonomy.md`.

## 2026-07-01 - F2.7.15.1: fallback de taxonomia para busca por tipo

Teste real ainda mostrou `nao tenho picape` mesmo apos a taxonomia. Raiz: classificar melhor o veiculo retornado nao basta quando a consulta primaria `stock_search({ tipo: "pickup" })` vem vazia por feed/API mal classificado. O handler de busca explicita agora, quando o filtro por tipo retorna vazio, expande pelo catalogo canonico da planilha e consulta modelos reais daquele tipo (ex.: Strada/Toro/Hilux/Frontier para picape), mantendo precoMax quando existir.

Invariante: o agente nao inventa estoque nem oferece modelo da planilha sozinho; ele so mostra o que voltar das buscas reais por modelo. Isso fecha o buraco de `picape`/`SUV` por tipo sem depender cegamente da categoria do provedor. Sem SQL, sem v2/bridge/webhook. Gates: F2.7.13 37/0; F2.7.15 22/0; `npx.cmd tsc --noEmit` limpo; `npm run test:all` EXIT=0. Handoff: `handoffs/2026-07-01-codex-f2.7.15.1-taxonomy-type-fallback.md`.

## 2026-07-01 - F2.7.16: SDR condicional, detalhes de oferta e debounce ampliado

Teste real mostrou tres falhas combinadas: o objetivo antigo de `veiculoTroca` continuava vivo apos o lead dizer que nao tinha carro para troca; o estoque carregava cor/cambio no normalizador mas nao levava esses campos ate `VehicleFact`; e a janela padrao de debounce de 6s ainda era curta para o bloco real do WhatsApp.

Correcoes: `extractLeadSlots` agora trata negacao de troca com precedencia sobre "tenho" e supersede objetivo pendente de `veiculoTroca`; `deriveSdrQualification` ignora objetivos/slots condicionais que nao se aplicam ao estado atual (troca=false, pagamento!=financiamento, visita=false); o read-side mapeia `color/cor` e `gear/transmission/cambio` ate `VehicleFact`, e o renderer passa a exibir km + cambio + cor quando existirem; defaults de debounce mudaram para 10s de silencio e 20s de max-wait.

Sem SQL, sem v2/bridge/webhook. Gates: F2.7.14 49/0; F2.7.5 24/0; F2.7.6 27/0; read-side 134/0; `npx.cmd tsc --noEmit` limpo; `npm.cmd run test:all` EXIT=0. Handoff: `handoffs/2026-07-01-codex-f2.7.16-sdr-state-offer-details-debounce.md`.

---

## Atualização Claude — Suíte de avaliação conversacional REAL (Fases A–E) — 2026-07-01

Entregue `Agent/eval/` — CLI `PEDRO_V3_REAL_EVAL=1 npm run eval:conversation:real` (gated, **FORA do test:all**). Roda a MATRIZ (3 cenários sintéticos + 3 replays v2, cada 2×) com **OpenAI REAL gpt-4.1-mini + prompt/config/estoque REAIS**, `InMemoryPersistence`, **efeitos OFF** (nunca cria dispatcher), asserções determinísticas + judge (temp 0), relatórios JSON+MD sanitizados. Reusa a fiação viva de `runtime/server.ts`+`pilot-active-root.ts`. **PROVA:** 205 chamadas 2xx à OpenAI, `gpt-4.1-mini-2025-04-14`, **prompt do portal presente em TODAS**. **GATE FAIL (esperado — a suíte existe p/ ACHAR erro):** judge 20–57 em todos os cenários. **Causas-raiz** (detalhe no handoff `Brain/2026-07-01-claude-eval-conversacional-real.md` §Fase E): **RC1** laço "Qual é seu nome?" (o `nome` nunca é vinculado à pergunta pendente — assassino nº1, em TODO cenário); **RC2** termo de TIPO vaza como `modelo` (busca SUV/picape zera com estoque real); **RC3** comercial→`terminal_safe`; **RC4** condutor spamma slot faltante; **RC5** handler bypass (=Fase 1 do rebalance/Brain 10); **RC6** negação de foto→`send_media` (CRÍTICA); **RC7** "mais opções" perde teto/exclude; **RC8** alucinação de veículo não-ofertado. Propostas por INVARIANTE, **NÃO implementadas**. `tsc` verde; `test:all` inalterado (eval fora dele); nada commitado. **PARADO p/ auditoria do Codex** antes de produção/Fase 1.

### CORREÇÃO DA AUDITORIA CODEX (2ª rodada, 2026-07-01) — baseline refeito
O Codex reprovou o baseline acima: **P0 = o harness não simulava o receipt `accepted`** → **amnésia artificial** (`append_assistant_turn`/`activate_objective` nunca aplicavam). **RC1 (laço do nome) era ARTEFATO do harness, não bug do agente.** Corrigido (9 itens; detalhe no handoff §"AUDITORIA CODEX"): ciclo `claimOutbox`+`commitEffectOutcome` REAIS com `accepted` sintético (sem despachar; `commitEffectOutcome` **exige** claim antes); modos `pilot-realistic`/`ideal-delivered`; **teste offline `tests/run-f2-7-18-eval-receipt-cycle.ts` (14/14, DENTRO do `test:all`)** prova o ciclo; grounding por turno (sem `allReturnedKeys` global); RC1 exige resposta COMPATÍVEL+interrogativa; novos `SLOT_FIXATION`/`HALLUCINATED_VEHICLE`; judge com prompt real em memória; **prova de prompt por SHA-256 integral**; `replay_v2`→`synthetic_v2_incident`. **Rerun final: 206 chamadas (204 2xx), prompt integral em todas (SHA `009edd16…`), `dispatchExterno=false`, commit-errors=0, `recentTurnsMax=26`(era 0), `nomeKnown=true`.** Judge subiu (s1 33→65, s3 37→54, r3 46→60). **Causas-raiz FIÉIS:** ~~RC1~~ refutada → **over-binding** (binder ganancioso: `nome="Mostra Mais Opções"`); **RC-FIXAÇÃO (nº1)** condutor anexa a mesma pergunta de slot todo turno (=Fase 1 rebalance); **RC2** confirmada/precisa (só TIPO como `modelo` zera); **RC8** alucinação confirmada. **Só o evaluador mudou; nenhuma mudança de produção; `tsc`+`test:all` verdes; sem commit/push/deploy. PARADO p/ NOVA auditoria do Codex.**

## 2026-07-02 - Codex: correcao de rumo obrigatoria R13

Auditoria da conversa real do telefone `85988323679` reprovou a premissa de que o runtime atual ja era uma maquina
conversacional central. A memoria textual estava persistida, mas nao havia memoria operacional suficiente para
recordar o Kicks; handlers de foto sequestraram perguntas de memoria e da loja; `Quero saber da loja` poluiu
`possuiTroca`; houve `terminal_safe` consecutivo e texto com U+FFFD.

Decisao: **R12-B nao deve ser deployada isoladamente.** Seus testes de deferimento ficam preservados como melhoria
local, mas nao constituem aceite do agente. O plano `10` foi marcado como historico para governanca do turno.

Nova fonte autoritativa: `11-PLANO-AGENTE-CENTRAL-MEMORIA-FERRAMENTAS.md`. A proxima fase e R13: WorkingMemory
semantica, AgentBrain como unica autoridade comercial, ferramentas subordinadas, policies somente como guardrails e
replay da conversa real com `gpt-4.1-mini` + prompt/estoque reais + efeitos OFF. CRM/handoff ativo fica bloqueado ate
o gate conversacional R13-D.

Sem mudanca de runtime, commit, push, deploy, SQL ou reset de conversa nesta atualizacao documental.
---

## Atualizacao Claude - R13-S1 fundacao (contratos AgentBrain + WorkingMemory) revisada pos-auditoria - 2026-07-03

Increment 1 da fatia central em SHADOW: contratos tipados + reducer da WorkingMemory. Aditivo, default OFF, sem
tocar o caminho ativo do piloto. A 1a versao foi REPROVADA pelo Codex (4 P0 + 2 P1); esta linha ja e a REVISAO.

Arquivos (novos/reescritos): `src/domain/agent-brain.ts`, `src/engine/working-memory.ts`,
`tests/run-f2-12-working-memory.ts`. Handoff: `Brain/2026-07-03-claude-r13s1-agente-central-shadow.md`.

Correcoes: P0-1 autoridade temporal (DecisionWorkingMemoryMutation no commit x EffectOutcomeWorkingMemoryMutation
so em receipt; mark_photo_action_accepted so na 2a uniao, accepted-safe idempotente por effectId, failed/uncertain
nao atualizam, mismatch rejeita); P0-2 proposedEffects=ProposedEffectPlan[] (Finalizer materializa effectId);
P0-3 ToolTelemetry sanitizada x AgentToolObservation (fatos por QueryOutputMap; sem PII em telemetria/memoria);
P0-4 funnel/selectedVehicle/lastOffer = VIEW derivada read-only do ConversationState (removidos update_funnel/
set_selected_vehicle/set_last_offer); P0-5 validacao runtime + loader fail-closed + turnId autorizado + rejeicao
atomica; P1-6 IDs estaveis (resolve/update por id).

MATRIZ DE PROPRIEDADE CANONICA (autoridade gravavel UNICA):
- ConversationState (canonico): funnel(slots+currentObjective), selectedVehicle(vehicleContext.selected),
  lastOffer(lastRenderedOfferContext), photoLedger(delivered/read). Entram na WM como VIEW derivada read-only.
- WorkingMemory (canonica, no state JSONB, mesmo CAS do turno): activeTopic, currentLeadIntent,
  unansweredLeadQuestions, lastToolResults, commitments, conversationSummary, lastAgentAction,
  lastAnsweredLeadQuestion (via DecisionWorkingMemoryMutation no commit) + lastPhotoAction accepted-safe (via
  EffectOutcomeWorkingMemoryMutation no EffectOutcomeCommit, CAS+idempotente). Nunca duas autoridades gravaveis.

Gates reais: `npm run test:f212` -> 40 OK | 0 FALHA; `npm run test:all` -> EXIT 0, 0 FALHA; `npx tsc --noEmit` -> EXIT 0.
R12-B e anteriores preservados. NAO e a fase concluida: o gate segue sendo o replay P0 real (increment 2, NAO iniciado:
central-engine flag-gated + tenant_business_info + suite offline 8.1 + eval:central:real). Sem commit/push/deploy/SQL.
Parado para nova auditoria do Codex.

---

## Atualizacao Claude - R13 Incremento 2 Parte A (pendencias da memoria) - 2026-07-03

Fundacao aprovada condicionalmente; Codex encomendou o Inc2 "incorporando primeiro as pendencias" (Parte A).
Entregue a Parte A provada offline (`run-f2-12` 38 OK; test:all EXIT 0; tsc EXIT 0). Handoff:
`Brain/2026-07-03-claude-r13-inc2-parte-a-memoria.md`.

- A.1 PhotoAction: mutacao carrega PhotoActionDraft (sem acceptedAt); acceptedAt = result.receipt.at; triple-check
  effectId (draft==result==receipt); newer-wins (A->B->callback atrasado A mantem B); duplicado no-op; failed/
  outcome_uncertain nao alteram.
- A.2 tools: add_tool_result removido da LLM; SystemWorkingMemoryMutation (record_tool_result) aplicada so pelo
  engine com resultado executado; sanitizacao+limite antes de persistir.
- A.3 turnId em toda mutacao (inclui set_lead_intent); turno errado rejeita.
- A.4 schemaVersion futuro/desconhecido fail-closed; ausente/0 migra p/ V1.

PENDENTE (build do engine, o gate real, NAO iniciado): B persistencia da WorkingMemory no ConversationState JSONB
(mesmo CAS do turno; receipt em EffectOutcomeCommit CAS idempotente; cross-tenant isolado); C CentralConversationEngine
(flag PEDRO_V3_BRAIN_MODE=central_shadow, default OFF; TurnFrame->AgentBrain tool loop->1 decisao->compose/validate->
reducers WM->EffectGate OFF); D suite offline do engine; E eval:central:real + replay P0 do tel 85988323679 (assertivas
deterministicas sao o gate). `npm run eval:central:real` ainda NAO existe (Parte E). Sem commit/push/deploy/SQL.
Parado para auditoria Codex.

---

## Atualizacao Claude - R13 Inc2 (2a passada): correcoes de entrada + Parte B - 2026-07-03

Codex liberou B->E. Feitas as CORRECOES DE ENTRADA (1 recencia de PhotoAction por sourceTurnNumber; 2 ToolResultMemory
estruturado sanitizado pelo engine, sem summary livre/PII; 3 consistencia open/answered/fulfilled) + Parte B
(workingMemory no ConversationState JSONB, mesma tx CAS via structuredClone; init no createInitialState;
createInitialPersistedWorkingMemory movido ao dominio). run-f2-12 41 OK; test:all EXIT 0; tsc EXIT 0; zero regressao.

C (CentralConversationEngine) + D (suite engine) + E (eval:central:real replay P0 real) NAO feitos: build multi-arquivo
grande com depuracao de LLM real, sem orcamento de contexto nesta sessao para fazer com qualidade E validar o replay.
Declarado como limite de orcamento (nao bloqueio externo). Plano exato em Brain/2026-07-03-claude-r13-inc2-parte-a-memoria.md.
Sem commit/push/deploy/SQL. Parado.

---

## Atualizacao Claude - R13 Inc2 ENGINE CENTRAL + PERSISTENCIA REAL + REPLAY P0 REAL - 2026-07-03

**Entregue B->C->D->E + F (adapter OpenAI real) + G (replay real EXECUTADO). O ACHADO P0 do Codex esta RESOLVIDO**:
`buildWorkingMemory`/`applyDecisionWorkingMemoryMutations`/`applySystemWorkingMemoryMutations`/`toToolResultMemory`/
`applyEffectOutcomeToWorkingMemory` agora sao chamados no ciclo REAL do turno e do receipt pelo `central-engine.ts`.

**Novos arquivos:** `src/engine/central-engine.ts` (runCentralConversationTurn + applyAcceptedPhotoActionOutcome, flag
`PEDRO_V3_BRAIN_MODE=central_shadow` default OFF), `src/engine/turn-frame-builder.ts`, `src/engine/tenant-business-info.ts`,
`src/adapters/llm/fake-agent-brain.ts`, `src/adapters/llm/openai-agent-brain.ts`, `tests/run-f2-13-central-shadow.ts`,
`tests/run-f2-14-openai-agent-brain.ts`, `eval/central-real-harness.ts` + `central-scenarios.ts` + `central-assertions.ts`
+ `run-central-eval.ts`. **Aditivos:** `agent-brain.ts` (CentralQueryCall/tenant_business_info + stateMutations),
`conversation-state.ts` (appliedAcceptedEffectIds/pendingPhotoActions + RenderedOfferItem.preco), `in-memory-store.ts`
(backing durável injetável p/ restart), `offer-context.ts` (preco), `eval/real-harness.ts` (expõe openAiSecret).

**B persistencia:** state+WM+decisao+eventos+outbox na MESMA UnitOfWork CAS; two-phase accepted(lastPhotoAction, sem
ledger)/delivered(photoLedger) com idempotencia INDEPENDENTE (appliedAcceptedEffectIds != outcomeAppliedAt); isolamento
tenant/agent/conversation fail-closed no load E commit; cerebro propoe DecisionMutation[], reducer e a autoridade.

**C engine:** UM cerebro/turno; nenhum handler comercial antes; autorizacao por chamada; tool nao fala com o lead; UMA
decisao. Executores DETERMINISTICOS de invariante (Brain/11 §5): strip de send_media sem pedido; trimToOneQuestion;
recall determinístico nomeia o veiculo lembrado; auto-grounding de vehicle_details do carro nomeado; grounding de
MEMORIA (veiculos ja ofertados/selecionados/fotografados com preco real); `renderDeterministicResponse` (quando o
compose do LLM falha grounding, renderiza a decisao ja tomada aterrada -> **elimina terminal_safe** sem cancelar efeitos).

**D tools:** +tenant_business_info (fonte factual do config; honesto sem fonte; nunca inventa). AgentToolObservation
transitoria; ToolResultMemory sanitizada (zero PII/URL/token).

**Gates:** `test:f212` 41 OK · `test:f213` 37 OK · `test:f214` 13 OK · `test:all` EXIT 0 (0 FALHA) · `tsc --noEmit`
EXIT 0 · **`PEDRO_V3_REAL_EVAL=1 npm run eval:central:real` EXECUTADO** (replay P0 tel 85988323679 + 3 conversas 15+
turnos, 2x cada, gpt-4.1-mini real, efeitos OFF): **GATE PASS = 0 criticas / 0 terminal_safe em TODOS os 8 runs (112
turnos)**; possuiTroca nunca muda em pergunta de loja; recall nomeia o veiculo; sem reenvio de foto; <=1 pergunta;
efeitos OFF (delivered=0, nenhum dispatcher). Prova LLM real: prompt integral por SHA-256 em todas as chamadas do
BRAIN e do COMPOSE (transportes contadores separados). Detalhe completo: `Brain/2026-07-03-claude-r13-inc2-engine-central-gate.md`.

**NAO tocado:** Pedro v2/bridge/webhook; caminho ativo do piloto (flag OFF). Sem commit/push/deploy/SQL. Parado para
auditoria do Codex -> R13-D (comparacao lado-a-lado v3 atual x central shadow; ativar flag so apos aceite).

---

## Atualizacao Claude - R13-D ENGINE CENTRAL NO PILOTO (baixo custo) - 2026-07-03

**Ligado o cerebro central ao RUNTIME do piloto Douglas, custo baixo, tudo provado offline + UM smoke real.**
Detalhe completo: `Brain/2026-07-03-claude-r13d-piloto-central.md`. Flag default OFF; NADA ativado; sem commit/push/
deploy; SQL manual NAO executado; Pedro v2 intocado.

- **1 Persistencia real:** RPC dedicada `v3_commit_working_memory_outcome` (CAS accepted-safe da WorkingMemory,
  tenant-scoped, ligada a send_media real; conflito->applied=false; nunca toca photoLedger) + porta
  `WorkingMemoryOutcomeStore` (InMemory+Postgres) + `applyAcceptedPhotoActionOutcome` usa a RPC + `OutboxDispatcher`
  promove no receipt do send_media. SQL manual `Brain/sql/v3_r13d_wm_outcome_patch.sql` (aditivo, NAO executado).
  Provado PGlite (accepted/round-trip WM no JSONB/conflito/kind-guard/cross-tenant) + adapter + InMemory.
- **2 Shadow verdadeiro** (`central-shadow-runner.ts`): engine central em store ISOLADO, ZERO escrita canonica, ZERO
  dispatch (provado com OutboxDispatcher REAL + gate shadow -> skipped), comparacao sanitizada. `test:shadow` 10 OK.
- **3 Fatos do prompt:** `TenantBusinessFacts` (provenance portal_prompt|config|absent), extracao conservadora
  (so rotulo de alta confianca; ausente->null, nunca inventa) -> `tenant_business_info`.
- **4 Runtime:** `PEDRO_V3_BRAIN_MODE = off|central_shadow|central_active` no `pilot-active-root`+`server`;
  central_active SO Douglas (tenant-scoped por construcao), NENHUM handler antes do cerebro, rollback imediato = off.
- **6 Smoke real** (`smoke:central`, teto de chamadas + probe de quota, SEM judge): **c1 15 turnos, 1 execucao ->
  SMOKE PASS: 0 criticas, 0 terminal_safe, BRAIN 18 (2xx=18)+COMPOSE 17 (2xx=17)=35 chamadas REAIS 100% 2xx, prompt
  integral, efeitos OFF.** Gates: test:all EXIT 0, tsc EXIT 0, test:sql (PGlite WM RPC) OK, test:shadow 10 OK.

**Proximo:** auditoria Codex -> rodar o SQL manual -> `central_shadow` (comparacao controlada) -> `central_active`
(Douglas testa no WhatsApp). Checklist ativacao/rollback no handoff.

---

## Atualizacao Claude - R13-D.1 CORRECOES DA AUDITORIA CODEX - 2026-07-03

Auditoria endureceu a RPC de WM + dispatcher + trocou o "gate" do smoke pago por um GATE OFFLINE deterministico.
Tudo corrigido, so testes GRATIS. Detalhe: `Brain/2026-07-03-claude-r13d-audit-correcoes.md`. Sem OpenAI/SQL/deploy/push.

- **1 Allowlist:** `v3_commit_working_memory_outcome` no allowlist do gateway + teste estrutural que FALHA sem a entrada.
- **2 RPC redesenhada:** recebe SO a WorkingMemory (nao o state completo); carrega o estado atual e atualiza SO
  workingMemory/appliedAcceptedEffectIds/version/updatedAt (PRESERVA byte-a-byte o resto); idempotente (duplicado=NO-OP);
  exige send_media succeeded + receipt accepted|delivered. Patch + `v3_schema.sql` canonico. Provado PGlite (byte-preserve,
  duplicado, nao-aceito, kind-guard, cross-tenant).
- **3 Adapter:** porta/InMemory/Postgres enviam SO a WorkingMemory; resposta da RPC validada fail-closed.
- **4 Dispatcher:** NAO ignora o resultado da promocao; nunca reenvia midia por falha de memoria; `reconcileAcceptedPhotoOutcomes`
  (rastro durAvel = send_media succeeded sem appliedAcceptedEffectIds) retoma idempotente SEM redispatch. Provado (f213 [E6]:
  falha transitoria -> restart -> reconcile promove sem 2o dispatch).
- **5 GATE OFFLINE (a-f, sem OpenAI, `test:gate-offline` 7 OK):** (a) SUV<=90 respondido com oferta antes do funil;
  (b) "o primeiro" resolve o 1o item (novo: `resolveSelectedVehicle` deterministico no engine, sem inferencia booleana,
  nao reintroduz bug de possuiTroca); (c) "gostei" != "voce gostou?"; (d) nome conhecido nao reperguntado; (e) visita+sabado
  avanca agendamento; (f) sem fixacao de slot. **O smoke pago NAO e o gate; este offline e.**
- **6 Gates gratis:** tsc EXIT 0, test:all EXIT 0 (0 RED): KERNEL 68, POSTGRES 27, GATEWAY 11, F2.13 40, SHADOW 10,
  GATE OFFLINE 7, SQL SCHEMA/PGlite. Parado para nova auditoria Codex.

---

## Atualizacao Claude - P0 AUTORIA UNICA DO AGENTE CENTRAL (fim da dupla autoria) - 2026-07-03

Corrige a falha de PRODUCAO do `central_active`: o AgentBrain decidia "132.623 km" (poll-11) mas o OUTBOX enviava
"0 km"; no poll-12 enviava menu generico. Causa = DUPLA AUTORIA (brain so dava guidance, `DecisionLlm.compose` era 2o
autor) + fabricacao de VehicleFact (km=0/preco=-1) que a policy aceitava como aterrado. **Sem commit/push/deploy/SQL/
OpenAI.** Detalhe: `Brain/2026-07-03-claude-autoria-unica-central.md`.

- **Desenho:** UM AgentBrain autora um `ResponseDraft.parts`; o engine RENDERIZA aterrado (SEM 2o compose), valida
  contra fatos REAIS; deny/fato-ausente volta ao MESMO cerebro (retry); esgotou = fallback tecnico honesto (nunca
  lista/menu/funil). Atras da flag `singleAuthor` (central_active liga; caminho legado/compose INTOCADO).
- **Causas eliminadas:** (1) `labelToFact`/oferta km=undefined, cor/cambio null, preco sentinela — nunca fabrica
  atributo; (2) sem auto-grounding no single-author (o cerebro consulta; render fail-closed forca); (3) `OpenAiAgentBrain`
  emite draft.parts (protocolo reescrito) + `#decodeDraft`; (4) `renderDeterministicResponse` (muda assunto) NAO roda no
  single-author; (5) novo gate assere em `outbox.payload.text`.
- **Grounding honesto:** renderer ja falhava fechado em km==null/cor/cambio; +guard `money_ref` preco<=0. km/cor/cambio/
  preco/ano so de fato REAL do MESMO vehicleKey. "0 km" so se a tool retornar 0. Ausente -> "vou confirmar".
- **Observabilidade:** `responseSource` (brain_final|brain_retry|technical_fallback|legacy_compose) + `brainReason` (≠
  texto enviado) + tools/selectedVehicleKey/policyFeedback no `decision_final`; texto no `response_composed`.
- **Arquivos:** `response-renderer.ts` (money guard), `central-engine.ts` (labelToFact + autoria unica + observabilidade),
  `openai-agent-brain.ts` (draft), `pilot-active-root.ts` (singleAuthor:true), `run-f2-15-central-authorship.ts` (NOVO),
  `package.json`.
- **Gates:** tsc EXIT 0; test:all EXIT 0 (0 RED) — F2.14 13, F2.13 46, SHADOW 10, GATE OFFLINE 7, F2.8 166, e
  **F2.15 AUTORIA UNICA 15 OK** (prova zero-2o-compose por ComposeSpyLlm; km/cor/cambio/ano/preco da key certa no outbox;
  ausente=defere; 0km so factual; deny->retry; esgotou->fallback sem menu; U+FFFD 0; pergunta simples sem tool; <=1
  pergunta; prompt integral no unico brain).
- **Risco restante:** NAO testado com OpenAI real (quota) — a qualidade das decisoes do cerebro REAL sera validada no
  WhatsApp pelo dono apos deploy auditado; a rede fail-closed->retry->fallback impede envio errado. `central_active` OFF.
- **Parado para auditoria Codex.**

### 2a rodada — 7 BLOQUEADORES da auditoria Codex CORRIGIDOS (2026-07-03)
Codex REPROVOU o deploy da F2.15. Todos corrigidos (sem OpenAI/SQL/commit). Detalhe no MESMO handoff acima.
1. Fallback = DEGRADACAO observavel: terminalSafe=true + `degraded` (result+eventos); texto sem promessa de retorno;
   gate FALHA se cenario-alvo cair em fallback. Novo responseSource `deterministic_recall` (recall != degradado).
2. `vehicle_details` OBRIGATORIO: asks_vehicle_detail+selecionado exige detail bem-sucedido do MESMO key antes do
   final (senao forca a consulta; esgotou->degradado); detalhe de outro key nao vale; sem selecionado->esclarece.
3. postQuery deny NUNCA envia o draft original (checa hasDeny(post) antes de renderizar) -> feedback -> fallback;
   nenhum efeito comercial original sobrevive.
4. Decoder: part invalida invalida o DRAFT INTEIRO (rejeicao integral); money_ref role/source ESTRITO sem `as never`
   nem correcao silenciosa. F2.14 agora cobre responsePlan.draft.
5. Removido VehicleFact artificial (ano=0/preco=-1): novo tipo `RememberedVehicleIdentity` (so NOMEIA); atributo so
   de fato REAL do mesmo vehicleKey.
6. Shadow roda `singleAuthor=true` (espelha o ativo; zero compose).
7. Gates: tsc EXIT 0; test:all EXIT 0 (0 RED) — F2.14 17, F2.15 18, SHADOW 11, F2.13 46, GATE OFFLINE 7, legado sem
   regressao.

### 3a rodada — SMOKE REAL rodado 1x: NAO PASSOU (3 violacoes; NAO re-rodado; NAO aprovado) — 2026-07-04
Codex aprovou estruturalmente; smoke real (`smoke:audit`, gpt-4.1-mini, prompt/estoque reais, singleAuthor, efeitos OFF,
sem judge). 29 chamadas OpenAI (BRAIN 29 2xx / COMPOSE 0), prompt integral SHA=true, 11/11 turnos, ~US$0,06. Detalhe no
handoff `2026-07-03-claude-autoria-unica-central.md` (secao SMOKE).
- **9/11 turnos PASS:** T2 pede qual carro sem tool arbitrario; T3 filtros certos; T4 seleciona o 2o; T5 vehicle_details
  do MESMO key + km/cor REAIS; T6 fotos sem despacho; T7 recall nomeia; T10 nome+possuiTroca=false; T11 visita+sabado.
  compose=0, terminal_safe=0 (exceto T8).
- **T8 (real): degradado.** Harness usava `RuntimeConfigBusinessInfoSource` (address/hours SEMPRE null) != producao
  (`PromptTenantBusinessInfoSource`). tenant_business_info deu NOT_CONFIGURED e a LLM FIXOU re-consultando address 4x
  sem deferir -> esgotou -> fallback DEGRADADO (engine correto: nao inventou). Causas: (a) fidelidade do harness
  CORRIGIDA (fonte de producao); (b) aberto p/ Codex: aderencia da LLM (deferir em NOT_CONFIGURED em vez de loop).
- **T9 (falso-positivo da assertiva):** agente excluiu ofertados + disse "nao temos mais" (correto); minha assertiva
  leu offer obsoleto. CORRIGIDA (offerFresh).
- Correcoes do smoke aplicadas (fidelidade+medicao), tsc verde, **NAO re-rodado, NAO aprovado**. **Parado para Codex**
  decidir o item aberto e autorizar (ou nao) novo smoke.

### 5a rodada — 5 CAUSAS do smoke #2 corrigidas POR INVARIANTES + REPLAY DETERMINISTICO — 2026-07-04
Codex do smoke #2: NAO rodar outro smoke pago; corrigir as 5 causas reais por invariantes (autoria unica preservada: o
brain decide/redige, o engine valida/enriquece, nunca substitui a conversa por handlers). FEITO, so testes gratis.
- **P0-1** `extractTenantBusinessFacts` por LINHA ROTULADA (exige separador ":"/"-"; itera candidatos; pula regra de
  saudacao "Se o horario for..."; remove markdown) -> extrai o Bloco 9, nunca a saudacao.
- **P0-2** NUNCA expor vehicleKey: `canonicalVehicleLabel` (nome real ou null, jamais a key); canonicaliza toda
  select_vehicle_focus (label="MARCA MODELO ANO", nunca ==key); pendingPhotoAction so com nome humano; GUARD generico
  rejeita qualquer vehicleKey conhecida no texto -> feedback ao mesmo brain.
- **P0-3** busca com ITENS exige `vehicle_offer_list` no draft (ou send_media); "quer que eu mostre?" -> deny+feedback;
  sem itens -> resposta livre; sem texto hardcoded.
- **P0-4** mentionsMoreOptions -> engine ENRIQUECE `stock_search.input.excludeKeys` com a uniao das keys da ultima
  oferta na chamada EXECUTADA (preserva tipo/cambio/teto); nao depende da LLM.
- **P0-5** `extractLeadSlots` reconhece VISITA (stem "visit"/agendar/conhecer presencialmente) -> interesseVisita=true +
  diaHorario (sabado) no MESMO turno sem objetivo pendente; negativos ("nao quero visitar","talvez depois","quero
  fotos","quero o terceiro") nao viram visita.
- **REPLAY** `run-f2-17-smoke-replay.ts` (offline, singleAuthor, brain SCRIPTADO reproduz os erros do smoke #2): 14 OK —
  zero vehicleKey no texto; T3 lista; T4 seleciona 2o=Honda CRV 2010 (label humano); T5 km/cor reais; T6 foto+WM label
  humano; T7 recall "Honda CRV 2010" nunca a chave; T8 endereco+horario reais; T9 stock_search EXECUTADO com excludeKeys;
  T10 nome+troca=false; T11 visita+sabado; P0-1 fixture; P0-5 negativos. **tsc EXIT 0; test:all EXIT 0** (F2.17 14, F2.16
  5, F2.15 18, F2.14 17, SHADOW 11, GATE OFFLINE 7, F2.13 46, sem regressao). Observabilidade nova: `institutionalResolved`
  + `policyFeedback` no result/evento. **NAO rodei OpenAI. Sem commit/push/deploy/SQL. Parado para auditoria Codex.**

### 4a rodada — fix INSTITUCIONAL + SMOKE #2: NAO PASSOU (7 violacoes; NAO re-rodado) — 2026-07-04
Codex aprovou estruturalmente + pediu 1 fix institucional + re-rodar 1x. FEITO: deteccao geral de topicos + resolucao
TERMINAL por topico (`resolveInstitutional`, cache 1x/topico, NOT_CONFIGURED terminal sem loop/fallback), protocolo do
brain reforcado, `institutionalResolved` observavel, F2.16 5 OK, T8 endurecida. test:all+tsc verdes. Smoke #2 (23 chamadas,
compose=0): **T8 melhorou de verdade** (honesto sobre endereco ausente + deu o horario, sem loop/degradado — o laco de 4x
morreu). Mas 7 violacoes: 2 BUGS DE ENGINE (extractTenantBusinessFacts(hours) casa regra de saudacao; label do veiculo
lembrado = CHAVE CRUA quando a oferta nao e renderizada -> T7 recall mandou a chave), 3 VARIACAO DA LLM (T3 nao listou, T9
sem excludeKeys, T11 sem visita/sabado — single-author=LLM conduz), 2 FALSO-POSITIVO da assertiva T8. ACHADO CENTRAL:
grounding solido, CONDUCAO LLM-dependente e variou entre runs. **NAO re-rodei, NAO apliquei fix, NAO aprovei. Parado para
Codex** decidir (conduções deterministicas x aceitar variancia + 2 bugs de engine). Detalhe no handoff secao SMOKE #2.

### 6a rodada — 2 HARDENINGS da auditoria (H1 seleção canônica + H2 visita 3 estados) — 2026-07-04
Codex aprovou as 5 correções por invariantes e encomendou 2 hardenings gratuitos (sem OpenAI/commit). FEITOS:
- **H1** `canonicalizeSelectMutations` (central-engine) NÃO aceita mais o label da LLM como fallback: label só de fonte
  CANÔNICA (VehicleFact/RememberedVehicleIdentity/lastRenderedOfferContext); sem label canônico -> DESCARTA a seleção
  (key -> `droppedSelectKeys` observável), nunca persiste vazio/da LLM. `state-reducer` (defesa 2ª) REJEITA
  select_vehicle_focus com label vazio ou == key.
- **H2** VISITA em 3 estados (lead-extraction): recusa "não quero visitar"->false; intenção "quero visitar sábado"->true
  +sábado; adiamento "talvez depois"/"agora não"/"mais tarde" (sozinho)->NÃO grava; "quero visitar mais tarde"->true SEM
  diaHorario (`extractDayPeriod` limpa "mais tarde"/"mais cedo"). Não quebra "quero fotos"/"quero o terceiro".
- **Teste** `run-f2-18-canonical-select-visit.ts` (NOVO, offline) 20 OK; **test:f217 14 OK; tsc EXIT 0; test:all EXIT 0**
  (F2.18 20, F2.17 14, F2.16 5, F2.15 18, F2.8 166, sem regressão). **NÃO rodei OpenAI. Sem commit/push/deploy/SQL. Parado
  para auditoria Codex.**

### P0 TRAVA DE CONTEXTO (foto resolvida virava fallback + memória velha de foto conduzia busca) — 2026-07-04
Codex achou no banco (central_active, Douglas): "me manda foto do 2" resolvido (photos+details OK) virava technical_fallback
SEM send_media; turno seguinte "você tem SUV?" respondia FOTO (activeTopic/currentLeadIntent ainda em photo_request).
Corrigido por 4 camadas determinísticas (autoria única preservada):
- **P0-A** `currentTurnIntent` (só do bloco atual) nos signals + `clearStalePhotoIntent` zera foto stale do FRAME quando é
  busca (memória persistida intacta); regra nova no protocolo do brain.
- **P0-B** guard: turno que não pede foto -> deny de send_media/reasonCode/texto de foto + feedback ao cérebro.
- **P0-C** `buildDeterministicPhotoResponse`: pedido de foto resolvido -> materializa send_media (nunca fallback); sem lista
  -> pede qual veículo (sem query arbitrária). `responseSource=deterministic_photo`.
- NÃO forcei stock_search em toda busca (quebraria "acolher+perguntar nome" do SDR / F2.13 [3c]); a trava vem de P0-A+P0-B.
- **Teste** `run-f2-20-context-lock-photo.ts` (nº 19 já era market-taxonomy de outra sessão) 21 OK (UNIT + E1..E4).
  **tsc EXIT 0; test:all EXIT 0** (F2.13 46 recuperado, F2.20 21, F2.19 market OK, F2.17 14, F2.18 20, sem regressão).
- **NÃO rodei OpenAI. Sem commit/push/deploy.** Working tree sobre `main` 73b3ccab. Parado para auditoria Codex.
  Detalhe: handoff `Brain/2026-07-04-claude-p0-trava-contexto-foto.md`.

### MISSÃO LLM-first central_active (cérebro decide, engine só valida) — 2026-07-04 (NÃO commitado, aguarda Codex)
Diagnóstico→Brain (o único sequestro no central_active era reconcileObjectiveWithQuestion criando objetivo de funil).
FEITO: flag `llmFirst` (central_active passa singleAuthor+llmFirst); em llmFirst o engine NÃO gerencia objetivo de funil
(strip em vez de reconcile) — funil vira contexto read-only, a LLM conduz; prompt LLM-first; captura de negação de
entrada/troca; CPF virou dado de FECHAMENTO (só ao agendar visita, não por financiamento). Offline `run-f2-21-llm-first-sdr.ts`
**20 OK** (prova-chave: llm-first não cria objetivo, legado cria) + test:all/tsc verdes (F2.8 CPF atualizado, F2.13 46
intacto). **2 conversas reais gpt-4.1-mini** (efeitos OFF, compose=0, ~US$0,09 cada): 1ª rodada reprovou (CPF cedo,
degradação seleção/popular, repetição troca); **corrigi 1x + re-rodei**: CPF/popular/troca/encoding FIXADOS, financiamento
sem entrada natural. AINDA falha (brain-behavior): "gostei do segundo" degrada (technical_fallback — precisa EXECUTOR
DETERMINÍSTICO de seleção, espelho do P0-C), "tem Onix?" repetiu loja sem buscar. **1 rodada de correção feita, PARO para
Codex.** Detalhe: `Brain/2026-07-04-claude-diagnostico-llm-first-central.md` + `-llm-first-impl-e-eval.md`.

### DIAG conv2 + 3 correções de guarda over-aggressive (T4/T10) = PASS — 2026-07-04 (NÃO commitado)
Run diagnóstico `diag:conv2` (observabilidade pura) revelou que T4/T10 NÃO eram não-compliância do modelo — eram MINHAS
GUARDAS bloqueando drafts bons. Dono autorizou 3 correções pontuais (só guardas): (1) `reasonCodeIsPhotoSend` = match
EXATO (não substring "photo" — desbloqueia "respect_photo_decline"); (2) `textPromisesPhoto` = só envio ATIVO (não oferta
"quer que eu te envie as fotos?"); (3) POL-GROUND-YEAR = ano do NOME de veículo aterrado passa ("Honda CR-V 2010"), ano
inventado bloqueia ("Honda CR-V 2020"/"ele é 2020"). Offline `run-f2-21` 35 OK (dg1..dg8), test:all+tsc verdes. **Re-eval
conv 2 (US$0,058): PASS, 0 degradados — T4 e T10 respondem naturalmente.** NÃO commitado. Parado para Codex. Detalhe:
`Brain/2026-07-04-claude-diag-conv2-causa-raiz.md`.

### ROTEAMENTO POR DOMÍNIO — institucional não travado por policy de veículo/funil — 2026-07-04 (NÃO commitado)
Bug real (Douglas): "aonde fica a loja?" com estado íntegro + tenant_business_info ok caía em technical_fallback (validação
domain-blind: POL-QUESTION-OBJECTIVE reperguntando slot conhecido + policy de atributo de veículo). Correção: novo
`turn-domain.ts` (isInstitutionalTurn/institutionalTopicsRequested), `validateResponse` ABSTÉM POL-GROUND-STOCK/DETAIL/
ATTR-VALUE + reperguntar-slot-conhecido em turno institucional (guardrails de dano real ficam: ≤1 pergunta, CPF, preço/ano);
`buildInstitutionalResponse` (resposta institucional DETERMINÍSTICA dos fatos da tool → institucional resolvido NUNCA vira
technical_fallback) + fix "aonde". Offline `run-f2-22` 14 OK (A-I); test:all+tsc verdes (sem regressão). Real (8 turnos,
US$0,05): T8 "aonde fica a loja e qual horário?" respondeu endereço+horário via SÓ tenant_business_info, 0 technical_fallback,
policy de veículo NÃO aplicada. Resta T3 "gostei do segundo" degradar (não-compliância de SELEÇÃO do modelo, domínio/escopo
diferente). NÃO commitado (aguarda autorização). Detalhe: `Brain/2026-07-04-claude-roteamento-por-dominio.md`.

### AUDITORIA CODEX (roteamento por domínio) — P0 do bypass global CORRIGIDO — 2026-07-04 (NÃO commitado)
Codex vetou o push: `isInstitutionalTurn(ctx.leadMessage)` era bypass GLOBAL por MENSAGEM (msg mista "onde fica a loja e
esse Onix é automático?" desligava grounding de veículo do turno inteiro). Corrigido: `validateResponse` gateia pelo
DOMÍNIO DA RESPOSTA — DETAIL/ATTR-VALUE/GROUND-STOCK SEMPRE ligados (claim-scoped); funil abstém só em resposta
institucional-pura (`isInstitutionalOnlyResponse` + lead institucional); GROUNDING DE MEMÓRIA aterra o nome do carro
lembrado (inventar continua barrado, atributo exige vehicle_details); `buildInstitutionalResponse` nunca null (todos
NOT_CONFIGURED = honesto; contato honesto). `run-f2-22` reescrito **16 OK** (mistos A-G + regressão L); test:all+tsc verdes.
Real 5 turnos (US$0,033, 0 technical_fallback): T4 "aonde fica a loja e quantos km ele tem?" chamou tenant_business_info
E vehicle_details (km 80.000 real — policy de veículo NÃO desligada); T5 foto via send_media. ⚠️T5 respondeu endereço em
vez de horário (conteúdo do cérebro, não policy). NÃO commitado — aguarda Codex passar. Detalhe:
`Brain/2026-07-04-claude-roteamento-por-dominio.md`.
