# ADR-003 - CoordinationStore: abstração de lock/cache/dedupe (Postgres agora, Valkey depois)

- Status: **Proposto** (Fase 0). Decisão do dono já fixada: **Redis NÃO será instalado agora**.
- Data: 2026-06-26. Autor: Claude.
- Relacionado: contexto-mestre §9; `02` §5; decisão do dono Fase 0 item 1.

## Contexto

O modelo n8n/contexto-mestre prevê Redis para lock por conversa, agrupamento de burst, idempotência, dedupe e cache de estado quente. Porém o dono decidiu **não provisionar Redis/Valkey nesta fase**; Valkey entra **depois**, e somente se métricas (latência, contention, volume de burst) justificarem uma camada externa. Precisamos não acoplar o engine a Redis.

## Decisão

1. Definir a interface **`CoordinationStore`** (ver `02` §5): `dedupe`, `acquireLease/renewLease/releaseLease`, `getHotState/setHotState` (opcionais).
2. **Implementação atual: `PostgresCoordinationStore`.**
   - Lease: linha em `v3_leases` (`conversation_id` PK, `owner`, `expires_at`); aquisição = `INSERT ... ON CONFLICT DO UPDATE WHERE expires_at < now()`.
   - Dedupe: `v3_inbox.event_id` UNIQUE + checagem; TTL lógico por `received_at`.
   - Cache quente: **não usado agora** (o estado é lido do Postgres por turno). Métodos opcionais retornam `null`/no-op.
3. **Implementação futura: `ValkeyCoordinationStore`** com a MESMA interface, ativada por config (`COORDINATION_BACKEND=postgres|valkey`). Nenhuma mudança no `ConversationEngine`.
4. O gatilho para migrar a Valkey é **dados** (ADR de métricas futuro), não impressão: p95 de latência de lock, taxa de conflito CAS, tamanho/frequência de burst.

## Consequências

- (+) Sem dependência de infra nova agora; engine desacoplado.
- (+) Caminho claro e barato para Valkey quando (e se) necessário.
- (−) Lease/dedupe em Postgres tem custo de I/O por turno (aceitável no volume atual; medível).
- (−) Cache quente ausente = sempre lê estado do banco (ok; otimização futura).

## Alternativas consideradas

- **Instalar Redis/Valkey já:** rejeitado pelo dono (infra/custo prematuro).
- **Sem abstração (acoplar ao Postgres direto):** rejeitado — violaria o caminho de evolução para Valkey.
