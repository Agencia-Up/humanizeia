# Handoff: Fase 2.2 / 2.2.1 — OutboxDispatcher e EffectOutcomeCommit (In-Memory)
Data: 2026-06-27
Autor: Antigravity

Este documento resume a implementação da Fase 2.2 / 2.2.1 e serve como base técnica para a Fase 2.3.

## Resumo Técnico

Concluímos com sucesso o motor de processamento assíncrono de outbox e aplicação atômica de outcomes do Pedro v3 de forma 100% in-memory.

### Componentes Entregues
1. **OutboxDispatcher** (`Agent/src/engine/outbox-dispatcher.ts`):
   - Varre registros `"pending"` do outbox e gerencia dependências e ordens.
   - Respeita o `order` e `dependsOn` (resolvido por `planId` no escopo do mesmo `turnId`).
   - Propaga `"skipped"` em cascata no mesmo turno caso dependências prioritárias falhem ou sejam puladas.
   - Atualiza o status para `"processing"` antes do despacho.
   - Trata falhas de UnitOfWork nos commits internos lançando exceções controladas.

2. **EffectOutcomeCommit** (`Agent/src/engine/effect-outcome-commit.ts`):
   - Aplica os resultados de despacho no estado da conversa sob **CAS** de versão.
   - **accepted vs delivered**:
     - `"accepted"` coloca o outbox record em `"succeeded"`, mas não roda o reducer conversacional e mantém `outcomeAppliedAt = null`.
     - `"delivered"` roda o reducer, avança o estado conversacional via `applyEffectOutcome` e preenche `outcomeAppliedAt`.
     - `"failed"` terminal preenche `outcomeAppliedAt`.
     - `"outcome_uncertain"` mantém `outcomeAppliedAt = null`.
   - **Validações rígidas de ID**:
     - `result.effectId === effectId`
     - `result.effectId === record.effectId`
     - Para `"succeeded"`, `result.receipt.effectId === result.effectId`
     - Qualquer incompatibilidade aborta a transação.

3. **Garantias de Persistência** (`Agent/src/adapters/persistence/in-memory-store.ts`):
   - A `UnitOfWork` agora valida a imutabilidade dos campos `effectId`, `idempotencyKey`, `conversationId`, `turnId`, `planId` e `kind` no `commit()`.
   - Lança erros se for tentado o update de registros inexistentes no outbox.

---

## Resultados dos Gates Finais

### 1. Testes Automatizados
- **Testes Rodados**: `npm run test:all`
- **Resultado**: **132 testes verdes** (67 do Kernel + 65 de Fase 2).
- Cobre: dependências, linearidade, skipped em cascata, fluxo accepted -> delivered, idempotência, CAS concorrência real e rejeição de updates de campos imutáveis do outbox.

### 2. Compilação TypeScript
- **Testes Rodados**: `npx tsc --noEmit`
- **Resultado**: **Compilação 100% limpa**, sem erros de tipagem estrita.

### 3. Busca por I/O de rede e banco real
- **Comando**: `Get-ChildItem -Recurse -Filter *.ts src | Select-String -Pattern 'fetch|http|postgres|pg|supabase|createClient|uazapi'`
- **Resultado**: Apenas comentários em `ports.ts` documentando o isolamento. Nenhuma linha de código realiza I/O real.

### 4. Busca por parsers simplistas
- **Comando**: `Get-ChildItem -Recurse -Filter *.ts src/engine, src/domain -ErrorAction SilentlyContinue | Select-String -Pattern 'msg\.includes|rawMessage\.includes'`
- **Resultado**: 0 matches. A interpretação de turnos comerciais é estritamente delegada à entrada pré-processada do `TurnContext.interpretation`.

---

## Notas de Design Pendentes (Para a Fase 2.3)

> [!WARNING]
> Atualmente, o `OutboxDispatcher` desbloqueia efeitos dependentes do mesmo turno quando um efeito prioritário atinge o status `"succeeded"` (o que ocorre sob receipt `"accepted"`, embora o estado da conversa não seja promovido).
> 
> Antes de avançarmos para handoffs comerciais complexos ou integrações reais (como Handoff para CRM ou envio de mídia via Uazapi), a Fase 2.3 precisará estabelecer quais tipos de efeito exigem rigorosamente receipt `"delivered"` (`outcomeAppliedAt != null`) para liberar dependentes, a fim de evitar transferências silenciosas ou avanços de memória conversacional prematuros.
