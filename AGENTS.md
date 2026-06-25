# AGENTS.md — LEIA ANTES DE QUALQUER COISA

Este repositório roda um **agente de WhatsApp de venda de carros (Pedro v2)** em produção, atendendo clientes reais (Icom Motors, Avant Motors, ...). Quebrar = leads reais sem resposta = prejuízo do cliente.

## ⛔ PARE. Se você vai mexer no AGENTE (Pedro v2), leia ISTO primeiro:

➡️ **`docs/MANUAL_AGENTE_PEDRO_V2.md`** — o manual técnico COMPLETO de como mexer, testar, deployar e diagnosticar o agente sem quebrar produção. **É OBRIGATÓRIO ler inteiro antes de editar qualquer arquivo de `supabase/functions/pedro-webhook-v2/` ou `supabase/functions/_shared/pedro-v2/`.**

## As 7 regras inegociáveis (o resto está no manual)

1. **Soluções, não remendos.** Conserte o invariante GERAL. NUNCA um `if` por frase específica.
2. **Edite o arquivo VIVO.** Há muitos arquivos versionados MORTOS (`*_20260524`, `*_sales`, `replyGenerator*`, `orchestrator.ts`...). O vivo é `orchestrator_20260525_photo_flow.ts` e cia — confirme pelos imports de `pedro-webhook-v2/index.ts`. Editar arquivo morto = "corrigi e nada mudou".
3. **Teste offline antes de deployar:** `npx tsx scripts/regression/offline.ts` tem que ficar VERDE. Toda correção ganha um teste.
4. **Bumpe o `PEDRO_V2_BUILD`** (em `pedro-webhook-v2/index.ts`) a cada deploy. É como você sabe qual versão está no ar.
5. **Deploy:** `cmd //c "scripts\supabase-logosia.cmd functions deploy pedro-webhook-v2 --project-ref seyljsqmhlopkcauhlor"`.
6. **Commit/push:** dança do stash — stash `webhookRouting.ts`, `meta-webhook/index.ts`, `wa-inbox-webhook/index.ts` (WIP do sócio) antes de pull/push; commit local com mensagem DETALHADA (caso real + raiz + fix). Detalhes no manual §9.
7. **Banco é SOMENTE LEITURA via MCP.** INSERT/UPDATE/migração/cron = entregue o SQL pronto pro dono rodar. NUNCA `supabase db push`.

## Diagnóstico em 1 linha
"Agente não respondeu" → cruze `wa_chat_history` (chegou) × `pedro_v2_turn_logs` (processou). Sem turno = drop ou conexão. Tudo no manual §10.

## Memória / "brain"
O conhecimento do PORQUÊ de cada hack vive em: (1) `docs/MANUAL_AGENTE_PEDRO_V2.md`, (2) as mensagens de commit do git (detalhadas de propósito), (3) os comentários no código (cada guard cita o lead/print real que o originou). **Mantenha o manual vivo** — atualize o CHANGELOG dele a cada mudança.

> Diretório de trabalho correto: `E:\Projetos - Antigravity\HUMANIZEIA\humanizeia` (NÃO o `SOCIALE SHARE HUB`).
