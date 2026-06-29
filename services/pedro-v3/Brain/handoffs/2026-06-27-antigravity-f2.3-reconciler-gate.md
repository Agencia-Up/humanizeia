# Handoff: Fase 2.3 / 2.3.1 — Reconciler e EffectGate (In-Memory)
Data: 2026-06-27
Autor: Antigravity

Este documento resume a implementação da Fase 2.3 / 2.3.1 e serve como base técnica e comprovação para a auditoria do Codex.

## Resumo Técnico

Concluímos com sucesso a camada de reconciliação de outbox, as políticas em código de exigência de receipt por tipo de efeito, e as travas operacionais do Shadow Mode (EffectGate) de forma 100% in-memory.

### Componentes Entregues
1. **ReceiptPolicy** (`Agent/src/engine/receipt-policy.ts`):
   - Avalia se um efeito é crítico para o funil conversacional (`isCriticalForConversationState`). Handoff, CRM write, agendamentos, seller notifications, mídias ou mensagens contendo mutações em `onSuccess` são catalogados como críticos.
   - Determina se o receipt exigido é `"delivered"` ou `"accepted"` (`requiredReceiptFor`).
   - Define se a dependência do efeito foi devidamente satisfeita (`isEffectSatisfiedForDependency`). Efeitos críticos dependem de `"delivered"` AND `outcomeAppliedAt !== null`.

2. **EffectGate** (`Agent/src/engine/effect-gate.ts`):
   - Controla o estado in-memory da conversa (Active vs Shadow Mode) por meio da classe `InMemoryEffectGate`.

3. **OutboxReconciler** (`Agent/src/engine/reconciler.ts`):
   - Varre registros com problemas de consistência ou pendentes na outbox.
   - Trata incertezas (`outcome_uncertain`) e stale records presos em `"processing"` aplicando retentativas sob o limite `maxAttempts` (para `idempotent`), consultas de status (para `queryable`), ou dead-letter terminal (para `none` ou estouro de retentativas).
   - **Timeout de accepted seletivo (Correção F2.3.1)**: Trata timeouts de `"accepted"` que nunca viraram `"delivered"` **apenas para efeitos críticos** (como handoff ou crm_write). Efeitos não-críticos (como `send_message` comum sem `onSuccess`) exigem apenas `"accepted"` e são preservados no status `"succeeded"` com `receiptLevel="accepted"` e `outcomeAppliedAt=null` sem serem movidos para dead-letter.
   - **Garantia Conversacional (Ressalva do Codex)**: Em nenhuma transição para dead-letter/failed terminal o reconcilador executa mutações do `onSuccess` ou altera o estado conversacional, mantendo a integridade do funil intacta.

4. **OutboxDispatcher** (`Agent/src/engine/outbox-dispatcher.ts`):
   - Atualizado para injetar `EffectGate`.
   - Em Shadow Mode, os records viram `"skipped"` com `lastError = "shadow_mode_gate_active"` e `outcomeAppliedAt = clock.now()` (marcando a resolução operacional terminal, sem alterar a conversa real).
   - Valida dependências explícitas e implícitas consultando estritamente `isEffectSatisfiedForDependency` da política em código.

---

## Resultados dos Gates Finais de Verificação

### 1. Testes Automatizados
- **Testes Rodados**: `npm run test:all`
- **Resultado**: **150 testes verdes** (67 do Kernel + 83 de Fase 2).
- Cobre especificamente:
  - **Teste 18**: `outcome_uncertain` + `idempotent` -> retry até limite de tentativas, depois dead-letter terminal.
  - **Teste 19**: `outcome_uncertain` + `queryable` -> reconcile resolve para delivered e aplica outcome.
  - **Teste 20**: `outcome_uncertain` + `none` -> failed/dead-letter terminal instantâneo sem avançar versão conversacional.
  - **Teste 21**: `processing` preso stale + `queryable` -> tenta reconcile antes de re-pendenciar.
  - **Teste 22**: `accepted` preso em efeito crítico -> bloqueia dependente (permanece pending) e após timeout vira dead-letter.
  - **Teste 23**: `accepted` em `send_message` não-crítico -> satisfaz e libera dependentes.
  - **Teste 24**: Shadow mode suprime dispatch real, marca skipped, bloqueia mutações e preserva payloads originais para auditoria.
  - **Teste 25 (F2.3.1)**: `accepted` preso antigo em efeito não-crítico não vira dead-letter após timeout de entrega.

### 2. Compilação TypeScript
- **Testes Rodados**: `npx tsc --noEmit`
- **Resultado**: **Compilação 100% limpa**, sem erros de tipagem estrita no outbox-dispatcher ou nos mocks de teste.

### 3. Busca por I/O de rede e banco real
- **Comando**: `Get-ChildItem -Recurse -Filter *.ts src | Select-String -Pattern 'fetch|http|postgres|pg|supabase|createClient|uazapi'`
- **Resultado**: Apenas comentários documentais em `domain/ports.ts`. Nenhum I/O real vazado.

### 4. Busca por parsers e classificadores de strings no motor
- **Comando**: `Get-ChildItem -Recurse -Filter *.ts src/engine, src/domain -ErrorAction SilentlyContinue | Select-String -Pattern 'msg\.includes|rawMessage\.includes'`
- **Resultado**: 0 matches.
