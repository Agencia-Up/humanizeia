# Feedback diario: validar leads reais

Este runbook fecha o bug em que o relatorio diario mostrava apenas leads ja
analisados pelo feedback, em vez do total real de leads recebidos no CRM.

## Causa raiz

A versao antiga de `feedback_relatorio_diario_dados` contava a partir de
`feedback_conversas` com `status = 'concluido'`. Assim, se chegaram 18 leads,
mas apenas 7 tinham analise concluida, o relatorio mostrava 7.

## Correcoes versionadas

- `supabase/migrations/20260713103000_feedback_relatorio_diario_leads_reais.sql`
  - Conta leads reais em `ai_crm_leads` e `crm_leads`.
  - Separa `chegaram`, `analisados` e `pendentes_analise`.
- `supabase/migrations/20260713114500_feedback_relatorios_backfill_leads_reais.sql`
  - Recalcula o resumo salvo em `feedback_relatorios` para historicos antigos.
- `supabase/checks/feedback_relatorio_leads_reais.sql`
  - Check que compara a RPC contra a contagem direta do CRM real.

## Aplicar no Supabase

Rode pelo ambiente/conta que tenha permissao no projeto `seyljsqmhlopkcauhlor`.

```bash
npx supabase db push --project-ref seyljsqmhlopkcauhlor
npx supabase functions deploy feedback-relatorio-enviar --project-ref seyljsqmhlopkcauhlor --no-verify-jwt
npx supabase functions deploy feedback-relatorio-diario-pdf --project-ref seyljsqmhlopkcauhlor --no-verify-jwt
```

## Validar o caso do relatorio de ontem

No SQL Editor do Supabase, defina a conta master e a data real que o relatorio
deveria analisar:

```sql
set app.feedback_check_tenant = '<uuid da conta master>';
set app.feedback_check_ref_date = '2026-07-12';
```

Depois rode o conteudo de:

```text
supabase/checks/feedback_relatorio_leads_reais.sql
```

Resultado esperado:

```text
OK feedback_relatorio_leads_reais tenant=... ref=... ontem=18 ...
```

Se a RPC voltar a contar somente analisados, o check gera `EXCEPTION`.
