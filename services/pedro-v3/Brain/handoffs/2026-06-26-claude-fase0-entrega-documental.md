# Handoff — 2026-06-26 — Claude → Codex (auditoria) — Fase 0 entrega documental

## 1. Objetivo da etapa

Iniciar a **Fase 0** do Pedro v3 (descoberta e contratos), trabalhando **apenas no `Brain`**, com auditoria **read-only** do Pedro v2. Sem código em `Agent/`, sem deploy, sem escrita no banco.

## 2. Arquivos criados (todos em `Refatorar - Pedro v3\Brain`)

- `01-STATUS-ATUAL.md` — status, decisões do dono incorporadas, próximo passo, dúvidas abertas.
- `03-INVENTARIO-PEDRO-V2.md` — inventário grounded: 45 itens, cada um com arquivo VIVO do v2 + comportamento preservado + destino (tool/política/heurística/estilo/reescrever/descartar) + teste.
- `04-CATALOGO-DE-INVARIANTES.md` — ~40 políticas com IDs estáveis (`POL-TRACK/STOCK/PHOTO/GROUND/HANDOFF/FUNNEL/SCHED/PERSONA/STYLE/STATE/TOOL/PRIV-*`), origem no v2 e teste.
- `02-ARQUITETURA-E-CONTRATOS.md` — contratos TS conceituais (ConversationState versionado, PendingObjective, FunnelSlot, TurnDecision, Tool/ToolRegistry, TurnEvent), ciclo atômico de turno, schema `v3_*`, CoordinationStore, EffectGate, LlmAdapter provider-agnostic.
- `decisions/ADR-001..006` — estado versionado, atomicidade+CAS, CoordinationStore, shadow mode (com comparação tee × inbox × replay), isolamento do v2, redaction de CPF/segredos.

Nenhum arquivo do v2 (`humanizeia`) foi alterado. Nenhuma tabela tocada (auditoria por leitura: imports, exports de `decisionLogic.ts`/`preSendVerify.ts`, `.from(` do orquestrador, MANUAL §3/§5/§11).

## 3. Contratos afetados

Primeira proposta de TODOS os contratos centrais (estado/decisão/evento/tool). Ainda **propostos**, não aprovados.

## 4. Razão arquitetural

Substituir o pipeline de autoridades concorrentes do v2 por **uma decisão tipada por turno** sobre **estado versionado**, com tools de contrato e políticas com ID — eliminando a disputa entre camadas que gera os sintomas (repete lista/foto, perde foco, funil vira busca, handoff silencioso). O `conversationState.ts` do v2 é reconhecido como **proto-kernel** e será reescrito como núcleo, não como override tardio.

## 5. Testes executados

Nenhum (etapa documental, sem código). Os testes **necessários** estão especificados por item no `03` e por política no `04`; serão implementados a partir da Fase 1 com fakes.

## 6. Riscos e limitações

- Inventário pode ter capacidade faltante do v2 — **pedido explícito de auditoria** ao Codex (`03` §6, `04` "Mapa de cobertura").
- Atomicidade/CAS e inbox durável precisam de prova na Fase 1/2 (ADR-002).
- Shadow offline não cobre concorrência/timing — coberto por testes sintéticos antes do canary (ADR-004).
- Schema `v3_*` é proposta; precisa de revisão antes de virar migração SQL (entregue ao dono, nunca `db push`).

## 7. Deploy/ambiente

Nenhum. v2 intacto em produção (`seyljsqmhlopkcauhlor`).

## 8. Commit

Nenhum (o `Refatorar - Pedro v3` não está sob git nesta análise; se o dono quiser versionar o `Brain`, é uma decisão à parte).

## 9. Próximo passo exato

1. **Codex audita** esta entrega: procurar capacidade/invariante faltante, autoridade duplicada nos contratos, e se o desenho aproxima da arquitetura-alvo.
2. Claude incorpora correções, produz `05-PLANO-DE-TESTES.md` + `06-ERROS-E-LICOES.md`.
3. Só com contratos aprovados: iniciar Kernel puro (Fase 1) em `Agent/`, sem I/O.

## 10. Dúvidas abertas

Ver `01-STATUS-ATUAL.md` §"Dúvidas abertas" (projeto Supabase único vs separado; governança de execução Codex×Claude; chave de encriptação CPF; tenants que exigem CPF; método de anonimização dos replays).

---

**Para o próximo executor:** leia `00` → `01` → `02` → `03` → `04` → `decisions/*` em ordem antes de qualquer coisa. Confirme no `01-STATUS-ATUAL.md` que ninguém está editando a mesma área. Não escreva código antes da aprovação dos contratos.
