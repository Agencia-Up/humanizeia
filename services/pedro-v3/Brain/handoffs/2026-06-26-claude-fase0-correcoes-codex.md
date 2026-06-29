# Handoff — 2026-06-26 — Claude → Codex (auditoria rodada 2) — Fase 0 correções

## 1. Objetivo da etapa

Incorporar as **9 correções** da auditoria do Codex (rodada 1), que **aprovou a direção** da Fase 0 mas não autorizou código no `Agent/`. Trabalho 100% no `Brain`.

## 2. Correções aplicadas (todas)

| # | Correção | Onde |
|---|---|---|
| 1 | Dedupe = ingestão atômica `INSERT ... ON CONFLICT` no `v3_inbox` | `02` §3/§4/§5; ADR-002 |
| 2 | QueryTool (read-only) × EffectIntent (efeitos) | `02` §2.5 |
| 3 | Transactional outbox (`v3_effect_outbox`): mesma tx CAS + dispatcher idempotente/ordenado/receipt/retry | `02` §3/§4; ADR-002 |
| 4 | "uma decisão" = 1 final + plano LIMITADO de QueryTools | `02` §2.4; `04` POL-STATE-001 |
| 5 | `StateMutation[]` tipado + reducer determinístico | `02` §2.6; `04` POL-STATE-006 |
| 6 | PolicyEngine não decide (allow/deny/requirements/violations); Finalizer central emite | `02` §2.7; `04` POL-STATE-003 |
| 7 | Inventário: webhookRouting VIVO, sender `uazapiSender_20260524.ts`, v218/399, +§4.1 (identidade/fromMe/ai_paused/ownership/silêncio pós-handoff/notificações/roteamento/resolver v218) | `03` |
| 8 | CPF → `SensitiveValueRef`/status + cofre criptografado; eventos tipados+versionados; redaction por construção | `02` §2.3.1; ADR-006; `04` POL-PRIV-001/002 |
| 9 | "exactly once" → at-least-once + efeitos idempotentes (effectively-once) | ADR-002; `04` POL-STATE-004/TOOL-001 |

## 3. Documentos novos

- `05-PLANO-DE-TESTES.md` — 10 camadas (L1–L10), casos mínimos → política, testes das 9 correções, replays anonimizados (sementes v2), métricas de shadow, critérios de saída por fase.
- `06-ERROS-E-LICOES.md` — incidentes-raiz reais do v2 (perder-trilho, estoque, foto, handoff, drop, alucinação) → **prevenção estrutural** (qual política/contrato torna o erro impossível). Meta-lição: nunca trocar política por `if` de frase.

## 4. Verificação read-only do v2 (item 7)

Confirmado contra o código (não por impressão): build `2026-06-26-contextual-vehicle-focus-v218`; `webhookRouting.ts` importado pelo webhook (`selectActiveAgent`); sender vivo `uazapiSender_20260524.ts`; `contactIdentity.ts` importado (`identifyPedroContact`); resolver `vehicleResolver_20260525_brain.ts`. Meu inventário inicial estava desatualizado (baseado no MANUAL pré-v218) — corrigido. **Sem divergência aberta.**

## 5. Contratos afetados

Todos os contratos centrais revisados (decisão/estado/tool/evento/outbox/sensível). Continuam **propostos**, aguardando rodada 2.

## 6. Testes executados

Nenhum (etapa documental). Testes especificados em `05` por camada e por correção.

## 7/8. Deploy / commit

Nenhum. v2 intacto (`seyljsqmhlopkcauhlor`). Sem migrations, sem escrita no banco, sem deploy.

## 9. Próximo passo exato

1. **Codex audita rodada 2** (os 9 pontos + `05`/`06`).
2. Aprovado → Fase 1 (Kernel puro em `Agent/`, sem I/O, FakeLlm, L1+L4) a partir dos contratos APROVADOS.

## 10. Dúvidas abertas

Ver `01-STATUS-ATUAL.md` §"Dúvidas abertas": projeto Supabase único vs separado; governança Codex×Claude (um executor por área); cofre+chave de CPF; tenants que exigem CPF; método de anonimização dos replays.

---

**Parado para auditoria.** Para o próximo executor: ler `00`→`01`→`02`→`03`→`04`→`05`→`06`→`decisions/*` em ordem; conferir no `01` que ninguém edita a mesma área; não escrever código antes da aprovação dos contratos.
