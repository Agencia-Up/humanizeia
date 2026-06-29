# ADR-001 - Modelo de estado versionado como fonte única do turno

- Status: **Proposto** (Fase 0, aguardando auditoria Codex + aprovação do dono).
- Data: 2026-06-26. Autor: Claude.
- Relacionado: contexto-mestre §8, §9; `02-ARQUITETURA-E-CONTRATOS.md` §2.1, §4; `04` POL-STATE-*.

## Contexto

No Pedro v2 o estado da conversa está **fragmentado** em campos concorrentes dentro de `pedro_conversation_state.state` (`veiculos_apresentados`, `ultima_foto`, `fotos_por_veiculo`, `veiculo_em_foco`, `last_stock_offer`, `pending_question`, `conversation_center`, `recent_turns`, `rejeitados`...), gravados em **várias etapas do mesmo turno** (`savePresentedVehicles`, `savePhotoReference`, persist de `pending_question`/`conversation_center`), **sem controle de versão**. Isso produz estado inconsistente e dificulta replay (anti-padrão §22).

## Decisão

1. O v3 terá **um `ConversationState` versionado** (`version: number`) como **única** fonte operacional do turno (POL-STATE-001/004).
2. O estado é **carregado uma vez** por turno e **persistido uma vez**, via `DecisionMutation[]` aplicadas por um **reducer determinístico** no commit atômico (ADR-002). Resultados de efeito entram só por `EffectOutcomeMutation` após receipt (Codex r2 #1).
3. Campos do v2 são **consolidados** em sub-estruturas com contrato: `slots` (FunnelSlot com proveniência), `preferences`, `vehicleContext`, `offers`, `photoLedger`, `rejected`, `handoff`, `scheduling`, `currentObjective` (PendingObjective estruturado, não string).
4. Tabela exclusiva `v3_conversation_state` + `v3_state_history` (replay/rollback). Nenhuma reutilização da tabela do v2 (ADR-005).
5. `schemaVersion` permite evolução do formato sem quebrar leitura.

## Consequências

- (+) Acaba a disputa entre campos; uma verdade por turno; replay e auditoria viáveis.
- (+) `PendingObjective`/`FunnelSlot` resolvem "respondi e perguntei de novo" e "dado sem proveniência".
- (−) Exige migração disciplinada do estado v2 (mapeada no inventário §4 item 39) e CAS robusto (ADR-002).
- (−) Custo de manter `v3_state_history` (mitigável por retenção/compactação).

## Alternativas consideradas

- **Manter campos espalhados (v2):** rejeitado — é a raiz dos sintomas.
- **Event sourcing puro (reconstruir estado só de eventos):** adiado — mais complexo; usaremos snapshot versionado + eventos para replay (híbrido), suficiente para Fase 0–4.
