# Handoff — Fase 1.5 Grounding, Money, Validations (Pedro v3)
**Data**: 2026-06-27  
**Autor**: Antigravity  
**Status**: CONCLUÍDO E TOTALMENTE TESTADO

---

## 1. Escopo Resolvido (Fase 1.5)

Esta fase implementou de forma rigorosa as defesas de grounding, a tipagem monetária estruturada e o isolamento de interpretadores periféricos no Kernel Puro Pedro v3, conforme especificado no [Brain/02](file:///E:/Projetos - Antigravity/HUMANIZEIA/Refatorar - Pedro v3/Brain/02-ARQUITETURA-E-CONTRATOS.md).

### Principais Entregas:

1. **Grounding estrito do Texto Livre (`TextPart`)**:
   - Respostas comerciais (`search_stock`, `send_photos`, `answer_vehicle_question`) não podem citar veículos de marcas/modelos em texto livre.
   - Qualquer citação detectada pelo `ClaimExtractor` em `TextPart` constitui uma violação (`POL-GROUND-STOCK`), disparando o modo seguro de falha fechada (`terminalSafe`).

2. **Detecção Dinâmica com `ClaimExtractor`**:
   - O `ClaimExtractor` foi injetado na assinatura de `TurnContext`. Ele é o responsável oficial por rastrear alegações de veículos em texto bruto.
   - Removido qualquer parsing de intenções baseado em `msg.includes` ou `rawMessage.includes` no motor interno.

3. **Adequação do `TenantCatalog`**:
   - A tipagem do `TenantCatalog` no domain `decision.ts` foi reestruturada para suportar catálogo dinâmico via `entries: CatalogEntry[]` (contendo aliases e vehicleKey).
   - O `PolicyEngine` e os adaptadores de interpretação agora utilizam puramente esta estrutura.

4. **Isolamento de Interpretadores (Adapters)**:
   - O arquivo `turn-interpreter.ts` (contendo `CatalogEntityExtractor` e `interpretTurn`) foi migrado de `src/engine/` para `src/adapters/` para separar as ferramentas de parsing de strings do motor centralizado puro.
   - `decision-engine.ts` não possui qualquer importação ou dependência direta de `turn-interpreter.ts`.

5. **MoneyRole × MoneySource**:
   - A matriz rígida de relacionamentos monetários foi validada. Apenas fontes do tipo `vehicle_fact` alimentam `vehicle_price`.
   - Papéis como `installment`, `down_payment` e `budget` estão estritamente amarrados às suas respectivas fontes em `slot_value` (`entrada`, `parcelaDesejada`, `faixaPreco`). Qualquer violação falha fechado.

6. **Validação do Reducer**:
   - O método `applyDecision` no `state-reducer.ts` agora exige `expectedTurnId` e `expectedNow` em sua assinatura.
   - Mutações que possuem `sourceTurnId` divergente ou cujo valor de slots é inválido (como faixaPreco inválido) são atomicamente rejeitadas pelo reducer.

---

## 2. Testes de Validação

Todos os 54 testes do Kernel (`npx tsx tests/run.ts`) foram executados e passaram com sucesso (0 falhas). Os testes abrangem:
- Reducer estruturado e rejeição atômica de mutações ilegais.
- Grounding estruturado e rejeição de alegações de marcas e modelos desconhecidos.
- Testes adversariais com marcas sintéticas (`Zeekr`, `Tesla`, `Volvo`, `Roma`).
- Matriz Money e MoneySource.
- Testes multiturno completos (4 turnos consecutivos simulados com sucesso).

---

## 3. Próximos Passos
O Kernel Pedro v3 está 100% alinhado com o [Brain/02](file:///E:/Projetos - Antigravity/HUMANIZEIA/Refatorar - Pedro v3/Brain/02-ARQUITETURA-E-CONTRATOS.md). A próxima fase (Fase 1.6 ou a transição para integração com adapters externos de I/O) pode ser iniciada com total segurança.
