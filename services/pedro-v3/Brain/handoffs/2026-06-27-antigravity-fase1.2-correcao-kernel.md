# Handoff — 2026-06-27 — Antigravity → Codex (Auditoria da Fase 1.2)

## 1. Objetivo

Realizar a **Fase 1.2 — Correção Final do Kernel** do Pedro v3 (sem I/O real). Esta etapa refinou o interpretador de turnos para tratar a priorização de trilhos sem condicionais textuais de string, robustece o grounding de ofertas monetárias e de marca/modelo contra alucinações (sem confiar no LLM), tornou o `effectId` inviolável eliminando o operador `endsWith`, adicionou validação estrutural e cíclica antecipada nos planos de efeito e centralizou a totalidade das decisões de turno (incluindo timeouts globais) no Finalizer com fallbacks seguros sem promessas assíncronas infundadas.

## 2. Mudanças e Correções Detalhadas

### A. TurnInterpreter Prioritário (`Agent/src/engine/turn-interpreter.ts`)
- Implementado extrator de entidades `extractEntities` para separar intenções estruturadas (tipo de carroceria, marca/modelo específico, dados de troca como km/ano, e dados de pagamento).
- Regra de Priorização: Se houver objetivo ativo (`state.currentObjective?.status === "pending"`), ele consome as respostas por padrão:
  - Se for troca pendente e houver detalhes de troca (ex: *"ano 2021, 85 mil km"*), a relação é `answers_pending`.
  - Se for pagamento pendente e houver menções a pagamento, a relação é `answers_pending`.
  - O objetivo ativo só é vencido em caso de mudança explícita de direção (ex: *"agora quero um sedan"* ou frase contendo mudança intencional), retornando `direction_change`.
- No [policy-engine.ts](file:///E:/Projetos%20-%20Antigravity/HUMANIZEIA/Refatorar%20-%20Pedro%20v3/Agent/src/engine/policy-engine.ts), a regra `POL-TRACK-001` foi ajustada para bloquear a busca de estoque somente se `relation === "answers_pending"`. Mudanças de direção (`direction_change`) como o interesse em outro veículo não sofrem mais bloqueio.

### B. Grounding Monetário com Roles (`Agent/src/engine/policy-engine.ts`)
- A função `parseMoneyMentions` extrai menções a valores no formato `MoneyMention` com quatro possíveis papéis (`role`): `vehicle_price`, `installment` (parcela), `down_payment` (entrada) ou `unknown`.
- Trata e condensa strings complexas de valores em português (ex: *"R$ 80 mil"* converte-se em um único valor `80000`).
- Na validação de resposta (`validateResponse`), somente menções com `role === "vehicle_price"` são validadas contra o preço factual dos veículos no estoque. Parcelas e entradas (como *"parcelas de R$ 1.500"*) são isoladas e não causam mais falsos-positivos na checagem de preço.

### C. Grounding de Marcas e Modelos no Texto (`Agent/src/engine/policy-engine.ts`)
- A validação de resposta agora resolve deterministicamente marcas/modelos citados no texto (`composed.text`) contra os fatos (`QueryResults`), o veículo focado no turno e as ofertas ativas.
- Caso o agente mencione termos automotivos comuns (ex: *"Audi"*, *"Q5"*) que não tenham registro de consulta ou oferta válida no turno, a resposta é rejeitada por grounding (`POL-GROUND-STOCK`), mesmo se o LLM declarar `mentionsVehicleKeys = []`.

### D. Identificadores de Efeito (`effectId`) Infalsificáveis
- Atualizei `ProposedDecision` em [decision.ts](file:///E:/Projetos%20-%20Antigravity/HUMANIZEIA/Refatorar%20-%20Pedro%20v3/Agent/src/domain/decision.ts) para usar `ProposedEffectPlan[]` (onde `effectId` é opcional/omitido na saída do LLM).
- O Finalizer em [finalizer.ts](file:///E:/Projetos%20-%20Antigravity/HUMANIZEIA/Refatorar%20-%20Pedro%20v3/Agent/src/engine/finalizer.ts) materializa os planos e injeta o `effectId` exato `${turnId}:${planId}` no plano e em cada mutação sob `onSuccess`.
- O reducer em [state-reducer.ts](file:///E:/Projetos%20-%20Antigravity/HUMANIZEIA/Refatorar%20-%20Pedro%20v3/Agent/src/engine/state-reducer.ts) exige igualdade estrita: `result.effectId === effectPlan.effectId`, `result.effectId === receipt.effectId` e `mutation.effectId === effectPlan.effectId`. O uso de `endsWith` foi removido.

### E. Validação Pré-Dispatch de Planos (`Agent/src/engine/finalizer.ts`)
- Criado o validador `validateEffectPlans` que analisa o array de planos antes da saída.
- Verifica e rejeita de forma atômica:
  - PlanIds duplicados.
  - Dependências (`dependsOn`) apontando para planos inexistentes.
  - Presença de ciclos na malha de planos (via algoritmo de ordenação/busca DFS).
  - Operações de `onSuccess` não autorizadas para o respectivo `EffectKind`.
  - Incoerência de dados (ex: `mark_photos_sent` citando chaves ou fotos divergentes das declaradas no plano de mídia).
- Planos inválidos são neutralizados e substituídos por `terminal-safe` no Finalizer.

### F. Centralização de Decisões e Fallbacks do Finalizer
- Removida a montagem manual de `TurnDecision` no catch do motor de decisão. Erros globais e timeouts são traduzidos em `TurnDecision` por meio da função `emitErrorTerminalSafe` do Finalizer.
- Atualizei as strings de falha para remover promessas de retorno humano assíncrono sem infraestrutura de fila dedicada. O fallback agora utiliza: *"Desculpe a lentidão temporária. Como posso te ajudar a escolher seu veículo hoje?"*.

### G. Arquivos Locais Isolados (`Agent/.gitignore`)
- Adicionado arquivo `.gitignore` omitindo `node_modules/`, `dist/` e arquivos de log.

## 3. Resultados da Suíte de Testes

- `npm test` finaliza com sucesso: **49 OK | 0 FALHA**.
- `npx tsc --noEmit` compila de forma limpa: **0 Erros**.
- Adicionados os 9 testes exigidos cobrindo:
  - Priorização do interpretador em troca e pagamento.
  - Extração de valores grandes com e sem o sufixo "mil".
  - Diferenciação de papel do valor (parcela vs preço do carro).
  - Bloqueio de alucinação de modelo ("Audi Q5") ausente nos fatos com vetor de menções vazio.
  - Bloqueio de tentativa de forja de `effectId` com mesmo sufixo em outro turno.
  - Validador acusando dependência cíclica, duplicidade de planId e dependência inexistente.
  - Erro global e timeout passando pelo Finalizer e gerando metadados de auditoria (`POL-TIMEOUT-GUARD`).
  - Fallback livre de promessas de retorno assíncrono.

## 4. Próximo Passo Recomendado

O Kernel puro do Pedro v3 está inteiramente concluído, endurecido e tipado.

Aguardando a auditoria técnica do **Codex** para autorização da **Fase 2 (Tools & Persistência)**:
- Implementar o `CoordinationStore` do Postgres/Supabase.
- Construir a tabela de outbox transacional para dispatch.
- Adaptadores de ferramentas reais para busca e detalhes de veículos.
