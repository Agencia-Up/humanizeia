# BACKLOG — Evolução do Agente Pedro SDR

> Lista viva de melhorias planejadas no agente Pedro SDR (WhatsApp / revenda de
> veículos). Cada item entra atrás de feature flag (veja
> `supabase/functions/_shared/config/features.ts`). Origem: Plano de
> Implementação 17/05/2026 (Fases 1–4) + DIAGNOSTICO.md.

---

## Pré-requisitos (sprint 0)

- [x] **PR-1** — Infra de feature flags (`PEDRO_FF_*` via env var)
- [x] **PR-2** — `BACKLOG.md` + `CHANGELOG.md` no root
- [ ] **PR-3** — Validar runner de testes (vitest) + smoke test
- [ ] **PR-4** — Seed de 20 conversas sintéticas pra benchmark
- [ ] **PR-5** — Executar suite atual, reportar status

---

## Fase 1 — Humanização (próxima)

- [x] **IT-1.1** — Split de respostas longas em N mensagens curtas
  - Flag: `PEDRO_FF_MESSAGE_SPLITTING`
  - Heurística: quebrar em pontuação forte (`.`, `!`, `?`, `\n`)
  - Limite: 3 mensagens por turno, mín 1 frase cada
  - Implementado: `_shared/humanization/messageSplit.ts` (canônico, 15 testes)
    + inline no `uazapi-webhook` com fallback no comportamento atual
- [x] **IT-1.2** — Simulação de digitação (presence + delay)
  - Flag: `PEDRO_FF_TYPING_SIMULATION`
  - Delay proporcional ao tamanho da mensagem (~18-28 cps com jitter,
    clamp 800ms–4s)
  - Presence "composing"/"paused" best-effort (tenta `/message/presence`
    e `/chat/presence` em sequência; falha silenciosamente se nenhum
    aceitar — delay continua funcionando)
  - Implementado: `_shared/humanization/typingSimulator.ts` (canônico,
    12 testes) + inline no `uazapi-webhook`
- [x] **IT-1.3** — Persona + few-shots consolidados
  - Flag: `PEDRO_FF_PERSONA_FEW_SHOTS`
  - 5 few-shots inline cobrindo: saudação, qualificação, objeção,
    fechamento, despedida
  - Apenda bloco no FINAL do system prompt (recency bias do GPT-4o)
  - Implementado: `_shared/prompt/personaFewShots.ts` (canônico, 14 testes)
    + inline no `uazapi-webhook`

## Fase 2 — Qualificação

- [x] **IT-2.1** — Schema BANT (Budget/Authority/Need/Timeline)
  - Flag: `PEDRO_FF_BANT_QUALIFICATION`
  - **Sem migration nova** — DERIVA BANT dos campos JÁ existentes do
    `pedro_conversation_state` (negociacao, lead, interesse, etc.)
  - Apenda bloco "## QUALIFICAÇÃO BANT" no system prompt mostrando status
    de cada dimensão + estágio geral + próxima ação sugerida
  - Estágios: `cold` → `discovery` → `qualifying` → `qualified` → `ready_to_handoff`
  - Implementado: `_shared/qualification/bantSchema.ts` (canônico, 16 testes)
    + inline no `uazapi-webhook`
- [x] **IT-2.2** — Lead scoring V2 com critérios explícitos
  - Flag: `PEDRO_FF_LEAD_SCORING`
  - `calcLeadScoreV2(state)` retorna `{score, tier, breakdown, raw...}`
  - 10 critérios (9 positivos + 1 penalidade) com `key/label/weight/passed/reason`
  - Tiers: `cold` (0-19) / `warm` (20-49) / `hot` (50-79) / `qualified` (80+)
  - V1 mantida (compat); wrapper `getQualificationScore` escolhe V1/V2 pela flag
  - Apenda bloco "## LEAD SCORE" com breakdown (pontos coletados +
    penalidades + faltam coletar) no system prompt quando flag ON
  - Implementado: `_shared/qualification/leadScoring.ts` (canônico, 16 testes)
    + inline no `uazapi-webhook` (3 call sites do score migrados pro wrapper)
- [ ] **IT-2.3** — Fallback BNDV: oferecer similares quando 0 resultados
  - Flag: `PEDRO_FF_BNDV_SIMILAR_VEHICLES`
  - Causa raiz de "Pedro nega estoque" relatado pelo cliente
  - Diff de referência: `DIAGNOSTICO.md` seção QW1
- [ ] **IT-2.4** — Tool `transferir_para_vendedor` V2 (motivo + score + briefing JSON)
  - Flag: `PEDRO_FF_HANDOFF_TOOL_V2`

## Fase 3 — Memória

- [ ] **IT-3.1** — Perfis persistentes cross-conversa (cliente já conhecido)
  - Flag: `PEDRO_FF_PERSISTENT_PROFILES`
  - Lookup por phone normalizado, traz histórico de outras conversas
- [ ] **IT-3.2** — Sumarização hierárquica de histórico longo
  - Flag: `PEDRO_FF_HIERARCHICAL_SUMMARIZATION`
  - Resolve "Pedro esquece" em conversas >10 turnos
- [ ] **IT-3.3** — Playbooks de objeção
  - Flag: `PEDRO_FF_OBJECTION_PLAYBOOKS`
  - Tabela `pedro_objection_playbooks` (objeção → resposta-padrão)

## Fase 4 — Confiabilidade

- [ ] **IT-4.1** — Retry + fallback de modelo na chamada LLM principal
  - Flag: `PEDRO_FF_LLM_RETRY_FALLBACK`
  - Cascade: OpenAI gpt-4o → Anthropic Haiku → mensagem de cortesia
- [ ] **IT-4.2** — Guardrails de saída
  - Flag: `PEDRO_FF_GUARDRAILS`
  - Bloquear: prometer preço fora do BNDV, prometer entrega fora do estoque,
    sair do escopo (assunto não-veículo)
- [ ] **IT-4.3** — Logs estruturados JSON com `trace_id` por turno
  - Flag: `PEDRO_FF_STRUCTURED_LOGGING`
  - Captura: model, tokens, latência, custo, tools chamadas, output

---

## Itens fora-de-escopo / paused

- Marcos CRM (`crm_leads`) — campo origem replicado (Prompt 1.1.1 — adiado)
- Cidade do lead (Prompt 1.2 — adiado)
- Badge visual origem no detalhe do lead (Prompt 5.1 — adiado)
- Filtro/coluna por origem no CRM (Prompt 1.3 — adiado)
- Bug "tela trava ao salvar" — investigação parada (sem repro consistente)

---

*Última atualização: 17/05/2026 — branch `chore/pre-requisitos-fase-1`*
