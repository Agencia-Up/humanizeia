# feedback-analista (Cérebro de Feedback — Fase 2)

O **especialista**: lê a conversa de um lead com o Claude e persiste a análise. **Aqui começa o custo de IA** (protegido pelo cost gate da Fase 0).

## Modos
- `POST { lead_id, lead_source:'pedro'|'marcos', versao_thread? }` → analisa 1 lead.
- `POST { batch:true, limit? }` → lote: `feedback_leads_pendentes` (leads concluídos e não analisados de tenants com a flag `analise` ON) → analisa cada um. Para no cap. É o que o **cron** chama.

## Fluxo (por lead) — `_shared/feedback/analista.ts` → `analisarLead()`
1. `buildLeadThread` (Fase 1) → thread + tenant + sinais + metadados.
2. `feedback_config` do nicho (tenant sobrepõe o default global).
3. `feedback_cost_gate(tenant)` — **se bloqueado, encerra sem chamar IA**.
4. Claude via `callAiGateway` (BYOK/fallback, `ref_tipo='feedback'`) → contrato JSON (competências+evidência, sinais, tempo de resposta, perfil de idade, coaching...).
5. **`feedback_classificar_qualidade(sinais)`** → qualidade 1–4 **pela CONFIG**, não pelo LLM.
6. `decidirVeredito(qualidade, score, houve_venda, descartou)` — tabela de atribuição (rotulagem_incorreta quando bom lead foi descartado).
7. `feedback_cost_record(tokens, custo)` + upsert idempotente em `feedback_conversas` (`onConflict lead_source,lead_id,versao_thread`).

## Contrato de saída
Ver `resultado` em `feedback_conversas` — `versao`, `sinais`, `competencias`, `perfil_idade`, `veredito`, `qualidade_lead`, `score_atendimento`, `frase_coaching`, `custo_usd`, `tokens`.

## Garantias / segurança
- Só `service_role`. Custo **sempre** passa pelo gate (sem cap, não roda). Idempotente (reprocessar = upsert).
- Qualidade 1–4 vem 100% da config (motor de regras). Score = média das competências ponderada pelos pesos da config.
- LLM injetado (`LlmCall`) → testável sem API real. `ref_tipo='feedback'` no ledger do gateway.

## Testes (`test.ts`, Deno, mockado)
Veredito (7 casos); "vendedor descartou lead bom → rotulagem_incorreta" (persiste certo); "cap batido → pula sem chamar o LLM".

## Ligar (rollout seguro)
`UPDATE feedback_config SET feature_flags = feature_flags || '{"analise":true}' WHERE tenant_id = '<Icom>'` + agendar o cron chamando `{batch:true}`. Começa numa conta só, observa `feedback_uso_custo`, depois expande.
