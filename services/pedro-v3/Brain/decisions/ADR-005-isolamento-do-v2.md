# ADR-005 - Isolamento total do Pedro v2 (read-only nesta fase)

- Status: **Proposto** (Fase 0). Decisão do dono já fixada (Fase 0 item 2).
- Data: 2026-06-26. Autor: Claude.
- Relacionado: contexto-mestre §2, §3, §19; `03` §5; decisão do dono Fase 0 item 2.

## Contexto

O Pedro v2 atende clientes reais em `E:\Projetos - Antigravity\HUMANIZEIA\humanizeia` (projeto Supabase `seyljsqmhlopkcauhlor`). O v3 é construído em paralelo em `Refatorar - Pedro v3\Agent`. O risco é o v3 alterar, por efeito colateral, tabela/estado/roteamento do v2 e quebrar produção.

## Decisão

1. **v2 é SOMENTE LEITURA** nesta fase. O v3 pode **ler** (via adaptadores read-only): config (`wa_ai_agents`, `agent_funnel_config`, `platform_integrations`, `wa_instances`), estoque (BNDV/RevendaMais) e histórico (`wa_chat_history`, `pedro_v2_turn_logs`) — **apenas** para inventário, replay e fakes.
2. **Nenhuma tabela/estado/roteamento do v2 é alterado.** Proibido alterar `pedro_conversation_state`, `pedro_v2_turn_logs`, `ai_crm_leads`, `wa_*`, crons ou o webhook do v2.
3. **O v3 escreve apenas em tabelas `v3_*` próprias** (ver `02` §4). Migrações `v3_*` são entregues como **SQL para o DONO aplicar** (MCP read-only; nunca `db push`).
4. **Sem código compartilhado mutável:** capacidades do v2 são reutilizadas **só por adaptadores** que importam funções puras (ex.: `decisionLogic.ts`, `photoLogic.ts`, `stockSearch_*`) **sem** arrastar o orquestrador. Cada reuso passa pelas 4 perguntas do contexto-mestre §12.
5. **Repositório/worktree separado:** `Agent/` é independente; não editar arquivos do `humanizeia` (exceto leitura). Respeitar "um executor por área" (§21) — conferir `01-STATUS-ATUAL.md` antes de começar.
6. **Roteamento:** o v3 nunca assume o tráfego de um agente sem autorização explícita do dono (Fase 4+). O agente de teste `douglasaloan@gmail.com` só recebe v3 após shadow validado.

## Esclarecimento por fase (CORREÇÃO Codex rodada 2 #9)

O isolamento NÃO significa "v3 nunca escreve em lugar nenhum" — significa "v3 nunca toca o **estado interno** do v2". Por fase:

- **F0–F3 (descoberta, kernel, tools, shadow):** **zero efeito externo.** `EffectGate.enabled=false`. v2 100% read-only. v3 escreve só em `v3_*`. Shadow nunca envia WhatsApp, CRM, agenda ou handoff.
- **F4 (canary autorizado, só o agente de teste):** com autorização explícita do dono, os **adapters do v3** PODEM produzir os efeitos REAIS necessários ao teste — escrever no **CRM**, criar **handoff** e enviar **WhatsApp** do agente de teste. Mas:
  - o v3 continua usando o **seu próprio** `ConversationState` (`v3_*`); **nunca lê/escreve/reaproveita o estado interno do v2** (`pedro_conversation_state`, `pedro_v2_turn_logs`, memória/centro do v2);
  - escritas em recursos COMPARTILHADOS (CRM `ai_crm_leads`, WhatsApp via uazapi) são as do atendimento real daquele agente de teste — idempotentes, auditadas, e só para `douglasaloan@gmail.com`;
  - rollback = desrotear o agente de teste de volta ao v2; o estado do v2 nunca foi tocado, então é imediato.
- **F5+ (canary por cliente / migração):** expande sob os mesmos princípios, com critérios objetivos (ver `05`).

## Consequências

- (+) Produção protegida; rollback trivial (basta não rotear para o v3).
- (+) Reuso de capacidade sem herdar a arquitetura ruim.
- (−) Alguma duplicação inicial de leitura de config/estoque (adaptadores) — aceitável pelo isolamento.
- (−) Disciplina de SQL entregue ao dono (sem auto-aplicar) — mais lento, porém seguro.

## Alternativas consideradas

- **Compartilhar tabelas do v2 (ex.: reusar `pedro_conversation_state`):** rejeitado — acoplaria estados e arriscaria produção.
- **Mesmo projeto Supabase com tabelas `v3_*`:** **aceito** (decisão do dono: Postgres/Supabase como fonte durável; tabelas exclusivas do v3). Projeto separado é alternativa futura se necessário, sem impacto no design.
