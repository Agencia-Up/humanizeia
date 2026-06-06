# GUIA COMPLETO — Pedro v2, Supabase, Easypanel e Brain
### Para QUALQUER IA (Antigravity, Claude, etc.) mexer no projeto SEM bugar o agente

> **Leia este guia INTEIRO antes de tocar em qualquer coisa do Pedro v2.**
> Ele existe porque já tivemos incidentes de IA revertendo/deletando trabalho do agente
> em produção. Se você seguir as REGRAS DURAS abaixo, não quebra nada.

---

## 0) RED LINES — as 10 regras que NUNCA se quebram

1. **O agente vivo de WhatsApp é a função `pedro-webhook-v2`** + a cadeia de libs do
   `orchestrator_20260525_photo_flow.ts` (lista exata na seção 2). **Só esses arquivos
   mudam o comportamento do agente.** Não edite as variantes antigas achando que mexe no agente.
2. **`git push` NÃO faz deploy.** Edge Function só vai pro ar com `functions deploy`
   (seção 4). E **deploy é SEMPRE a partir do `main`** (nunca de `staging`/`dev`).
3. **Antes de deployar o Pedro**: (a) `esbuild` de sintaxe, (b) **dry-run contra dados
   REAIS** (seção 7), (c) **bumpar a constante `PEDRO_V2_BUILD`** (seção 3).
4. **Diagnostique por LOG/DADO REAL, nunca por suposição.** Tabela `pedro_v2_turn_logs`
   e `wa_chat_history` são a fonte da verdade. Se "acha" que é um bug, prove no log antes.
5. **Personalidade/script de vendas vem do PORTAL** (`wa_ai_agents.system_prompt`), NÃO do
   código. Nunca hardcode personalidade no código (seção 5).
6. **Nunca delete a feature de follow-up de REATIVAÇÃO** no `src/pages/PedroSDR.tsx`
   (badge `♻️`, `reactivation_status`, query `pedro_followup_reactivation`, botão
   `pedro-auto-followup`). Depois de QUALQUER merge:
   `grep -c "pedro-auto-followup\|reactivation_status\|♻️" src/pages/PedroSDR.tsx` tem que dar > 0.
7. **Nunca commite segredos** (`.env`, `secrets.txt`, tokens, JWTs, chaves Asaas/OpenAI).
   Para testar use a chave do ambiente/dashboard — nunca cole a chave num arquivo versionado.
8. **Mudança no Pedro = mínima e isolada.** Não refatore o agente "de passagem". Cada
   alteração preserva a inteligência existente (imagem/áudio/anúncio/BNDV/fotos/status/follow-up).
9. **Migrations (DDL) precisam da SENHA do banco** (`supabase db push`) ou do dashboard.
   O MCP de DDL está bloqueado. Aplique migrations EM ORDEM de timestamp e confira o que já foi aplicado.
10. **Coordene antes de mexer em arquivo do Pedro em paralelo.** Dois branches editando os
    mesmos arquivos do agente = clobber silencioso na promoção (já aconteceu 2x). Veja a seção 9.

---

## 1) Visão geral — o que é o Pedro v2

**Pedro v2** é um agente SDR (pré-vendedor) de concessionária que atende no WhatsApp:
identifica o veículo que o lead quer (mesmo com erro de digitação / vindo de anúncio do
Facebook/Instagram, por texto ou imagem), busca no **estoque real (BNDV)**, manda fotos,
qualifica o lead (nome, troca, entrada, financiamento, agendamento) e **transfere para um
vendedor humano** com um briefing — classificando o lead em 3 categorias (💤 Inativo /
🧊 Pouco Qualificado / 🎯 Qualificado). Tem ainda **follow-up de reativação** (recutuca
leads inativos há +24h) e respeita travas de cobrança/limite.

- **Backend (cérebro):** Supabase Edge Functions (Deno/TypeScript).
- **Frontend (portal):** React/Vite, em `src/` — sobe via **Easypanel** (build separado).
- **Banco:** Supabase Postgres (prod `seyljsqmhlopkcauhlor`).

---

## 2) MAPA DE ARQUIVOS — o que é VIVO e o que é MORTO

> A pasta `supabase/functions/_shared/pedro-v2/` tem MUITAS variantes datadas
> (`_20260524`, `_sales`, `_photo_variety`, etc.). **A maioria é versão antiga/morta.**
> Editar a errada = você "conserta" e nada muda no agente.

### 2.1 — Caminho VIVO do agente (edite SÓ estes para mudar o Pedro)

**Entrada:** `supabase/functions/pedro-webhook-v2/index.ts`
→ importa `processPedroV2Turn` de **`_shared/pedro-v2/orchestrator_20260525_photo_flow.ts`** (o ORQUESTRADOR vivo)

O orquestrador vivo usa (todos em `supabase/functions/_shared/`):
| Arquivo | Papel |
|---|---|
| `pedro-v2/orchestrator_20260525_photo_flow.ts` | **Orquestra o turno** (cérebro central). Aqui mora: hold pós-transferência 24h, fase C de reativação, derivação de status SDR, briefing vendedor/gerente, persistência. |
| `pedro-v2/pedroBrainPlanner_20260525.ts` | **Planner** (decide a AÇÃO: stock_search / reply_only / photo_request / handoff). Modelo: **gpt-4o-mini**. |
| `pedro-v2/pedroBrainReply_20260525.ts` | **Reply** (escreve a resposta ao cliente = "atendimento"). Modelo: **gpt-4o** (via `sanitizeModel(agent.model)`). |
| `pedro-v2/replyGenerator_20260525_photo_flow.ts` | Respostas determinísticas (fallback/handoff). Importado pelo reply acima. |
| `pedro-v2/stockSearch_20260525_photo_flow.ts` | **Busca de estoque** (BNDV GraphQL `vehiclesBy`) + ranking client-side (modelo, carroceria, preço, R$0). |
| `pedro-v2/vehicleResolver_20260525_brain.ts` | Resolve o veículo do lead (texto/anúncio/mídia/memória). |
| `pedro-v2/adContext_20260525.ts` | Contexto de anúncio (Facebook/Instagram) — texto + visão da imagem. |
| `pedro-v2/mediaContext_20260524.ts` | Contexto de mídia recebida. |
| `pedro-v2/intentRouter_20260525_sales.ts` | Roteador de intenção (regex/heurístico). |
| `pedro-v2/transferRouter.ts` | Transferência ao vendedor (escolha do vendedor, briefing, re-aviso, `preferred_seller_id` para reativação). |
| `pedro-v2/leadMemory.ts` | Memória do lead (`ai_crm_leads` + `pedro_conversation_state`). |
| `pedro-v2/uazapiSender_20260524.ts` | Envio via UazAPI (texto/mídia) + resolve instância. |
| `pedro-v2/contactIdentity.ts`, `phone.ts`, `server.ts`, `types.ts`, `tokenMeter.ts` | Identidade, telefone, flags, tipos, cobrança. |
| `transfer/leadSdrCategory.ts` | **As 3 categorias** (inativo/pouco_qualificado/qualificado) + labels + classificação. FONTE ÚNICA. |
| `transfer/leadStatus.ts`, `transfer/managers.ts`, `transfer/interestVehicle.ts` | Status legado, telefones de gerente, veículo de interesse. |
| `automation/rules.ts` | Regras de automação (follow-up/transferência) configuráveis por agente. |
| `observability/structuredLog.ts` | Log estruturado do turno. |

### 2.2 — Arquivos MORTOS (0 imports — NUNCA edite achando que muda o agente)
`orchestrator.ts`, `orchestrator_20260524.ts`, `orchestrator_20260524_media.ts`,
`orchestrator_20260525_sales.ts`, `orchestrator_20260525_photo_variety.ts`,
`replyGenerator.ts`, `replyGenerator_20260524.ts`, `replyGenerator_20260525.ts`,
`replyGenerator_20260525_sales.ts`, `adContext.ts`, `adContext_20260524.ts`,
`intentRouter.ts`, `stockSearch_20260525_sales.ts`, `uazapiSender.ts`.
> Confirme sempre antes de assumir: `grep -rl "nome_do_arquivo.ts" supabase/functions --include=*.ts`.

### 2.3 — ATENÇÃO: blast radius das libs compartilhadas
Algumas libs (ex.: `stockSearch.ts`, `adContext_20260525.ts`, `replyGenerator_20260525_photo_flow.ts`)
são importadas por **VÁRIAS** functions (o `pedro-webhook-v2` E funções standalone `pedro-*`
como `pedro-stock-search`, `pedro-sales-reply`). Mudar uma lib compartilhada afeta TODOS os
consumidores. Antes de editar uma lib, rode `grep -rl "from.*<lib>" supabase/functions --include=*.ts`
e teste cada consumidor.

### 2.4 — As funções `pedro-*` standalone
Existem várias functions `pedro-identify-contact`, `pedro-stock-search`, `pedro-sales-reply`,
`pedro-transfer-router`, etc. São de uma arquitetura **mais antiga / auxiliar** (NÃO são o
caminho vivo do WhatsApp, que é o `pedro-webhook-v2`). Não confunda: para mudar o agente que
responde no WhatsApp, mexa no `pedro-webhook-v2` + a cadeia 2.1.

---

## 3) Como um turno funciona (e a constante de build)

1. UazAPI manda o webhook → `pedro-webhook-v2/index.ts`.
2. Guards de entrada (instância, allowlist, debounce de mensagens quebradas).
3. `processPedroV2Turn` (orquestrador): identifica contato/lead → carrega memória →
   **hold 24h pós-transferência** → **detecção de reativação (fase C)** → resolve veículo /
   contexto de anúncio → **planner (gpt-4o-mini)** decide a ação → se preciso, **busca estoque** →
   **reply (gpt-4o)** escreve a resposta → envia via UazAPI → persiste memória/turn-log →
   se qualificado/desinteressado/pediu humano, **transfere** (briefing + status SDR).
4. **Toda resposta do webhook tem o campo `build`** = constante `PEDRO_V2_BUILD` em
   `pedro-webhook-v2/index.ts` (hoje `2026-06-04-silent-transfer-on-disinterest-v66`).
   **Regra: a cada deploy do Pedro, bumpe essa string** (ex.: `...-v67-<o-que-mudou>`).
   É como você confirma, no dry-run/log, que o código novo subiu mesmo.

---

## 4) SUPABASE — projetos, deploy, migrations, secrets

### 4.1 — Dois projetos
| Ambiente | Ref | Nome |
|---|---|---|
| **Produção** (base principal) | `seyljsqmhlopkcauhlor` | LogosIA-Produção (o `supabase/config.toml` aponta pra ele) |
| **Staging** (base teste) | `ezoltigtqgbmftmiwjxh` | LogosIA-baseTeste |

### 4.2 — Wrappers de deploy (em `scripts/`)
Eles injetam o token certo (NUNCA `supabase login` manual; NUNCA gere token novo — já estão persistidos):
- **`scripts/supabase-logosia.cmd`** → produção (lê `supabase/.env.local`).
- **`scripts/supabase-logosia-staging.cmd`** → staging (lê `supabase/.env.staging.local`).
- **`scripts/git-logosia.cmd`** → push no GitHub (bypass do Credential Manager do Windows).

### 4.3 — Deploar UMA função (produção)
```
scripts/supabase-logosia.cmd functions deploy <nome-da-funcao> --project-ref seyljsqmhlopkcauhlor
```
- O aviso `WARNING: Docker is not running` é **normal** (faz upload do bundle, não usa Docker local).
- Confirme no fim: `Deployed Functions on project ... : <nome>`.
- **Deploye SEMPRE do `main`** (faça o merge/checkout pro main antes).

### 4.4 — Checagem de sintaxe ANTES do deploy (rápida, local)
```
node_modules/.bin/esbuild "<caminho/arquivo.ts>" --bundle=false --loader:.ts=ts --log-level=warning
```
Rode em TODOS os arquivos que você tocou (e no `pedro-webhook-v2/index.ts`).

### 4.5 — Migrations (DDL) — CUIDADO
- Arquivos em `supabase/migrations/AAAAMMDDHHMMSS_*.sql`. São aplicados **em ordem de timestamp**.
- **O MCP de DDL está bloqueado** e o `supabase db push`/`migration list` **exigem a SENHA do
  Postgres de produção** (`-p <senha>` ou `--linked -p`). Sem a senha, você NÃO aplica migration.
- Para aplicar: `supabase db push` (com a senha, do `main`) OU cole o SQL no **SQL Editor** do
  dashboard, **na ordem do timestamp**. **Confira antes** quais já foram aplicadas (uma migration
  re-rodada pode dar erro ou efeito duplicado).
- Migration aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`) é a regra.

### 4.6 — Secrets (Edge Functions)
```
scripts/supabase-logosia.cmd secrets set NOME=valor --project-ref seyljsqmhlopkcauhlor
```
Secrets importantes em uso: `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (auto-injetada),
`PEDRO_FF_AUTO_REACTIVATION` (liga/desliga o motor de reativação), `CHECKOUT_ASAAS_WEBHOOK_TOKEN`,
Resend (e-mail). **Nunca** imprima/commite o valor de um secret.

### 4.7 — Tabelas-chave (glossário)
| Tabela | O que é |
|---|---|
| `ai_crm_leads` | O LEAD. Campos: `status` (workflow), **`status_crm`** (categoria SDR: inativo/pouco_qualificado/qualificado + estágios do vendedor), `vehicle_interest`, `payment_method`, `trade_in_vehicle`, `down_payment`, `cpf`, `client_city`, `temperature`, `assigned_to_id`, `last_interaction_at`, etc. |
| `pedro_conversation_state` | Memória estruturada do Pedro v2 por lead (JSONB `state`: interesse, negociação, atendimento, veiculos_apresentados, flags de hold/reativação). |
| `wa_chat_history` | Histórico de mensagens (role user/assistant). Follow-ups gravam com prefixo `[Follow-up IA]` / `[Follow-up manual]`. |
| `pedro_v2_turn_logs` | **Log de cada turno** (payload: text, brain_plan, stock_filters; result: reply_source, needs_handoff, handoff, etc.). **Use para diagnosticar.** |
| `ai_lead_transfers` | Transferências (to_member_id, transfer_reason, transfer_status, is_confirmed). |
| `ai_team_members` | Vendedores/gerentes (whatsapp_number, is_active, agent_id). |
| `wa_instances` | Instâncias de WhatsApp (api_url, api_key_encrypted, instance_name, status, seller_member_id, purpose). |
| `wa_ai_agents` | O AGENTE: **`system_prompt`** (personalidade do portal), `model`, `gerente_phone`, `automation_rules`, `instance_ids`. |
| `followup_ia_config` | Config do follow-up de reativação (horário, teto/dia, intervalo, `mensagem_base`, `is_active`). |
| `pedro_followup_reactivation` | Estado da fila de reativação por lead (status pending/sent/responded/transferred). |

---

## 5) Código vs PORTAL — o que NÃO mexer

- A **personalidade e o passo-a-passo de vendas** vêm do PORTAL: `wa_ai_agents.system_prompt`
  (editado na aba "Geral" OU gerado pela aba "Funil do Agente", que sobrescreve com backup).
  **NÃO mova isso pro código nem hardcode personalidade.**
- Ficam no CÓDIGO (não mover pro portal): o "bloco de comportamento obrigatório fixo" (rede de
  segurança), o contrato técnico (JSON/anti-alucinação), as tools (BNDV/fotos/transferência) e o planner.
- **Modelos:** o **reply (atendimento) é gpt-4o**; o **planner é gpt-4o-mini** (custo); a visão de
  anúncio é gpt-4o-mini **de propósito** (gpt-4o já quebrou ali). Não troque modelos sem medir.

---

## 6) EASYPANEL — frontend (portal)

- O `src/` (React/Vite) **NÃO** sobe por `supabase functions deploy`. Sobe no **Easypanel**
  (build do frontend) quando você clica **"Forçar Reconstrução"** no serviço do portal.
- `git push` no `main` só atualiza o código; o portal **só muda depois do rebuild no Easypanel**.
- O ⚠️ que às vezes aparece é **cache do build do frontend**, separado do agente. Solução: forçar
  reconstrução. (O agente/Edge Function é independente disso.)
- **Tela "Algo deu errado" / só volta com CTRL+F5** = chunk velho pós-deploy (já tratado em
  `App.tsx` com reload anti-stale). Se voltar, é build novo + aba antiga: recarregar resolve.
- **Ordem segura de release coordenado:** aplicar migrations → deploy das Edge Functions →
  **rebuild do frontend POR ÚLTIMO** (senão a tela nova chama um backend que ainda não existe).

---

## 7) TESTAR antes de deployar — o dry-run (obrigatório no Pedro)

O `pedro-webhook-v2` aceita `dry_run: true`: roda o pipeline INTEIRO (planner, busca, reply)
mas **NÃO envia no WhatsApp nem persiste** (tudo gated por `!dryRun`). Use para validar com
**dados reais** antes do deploy.

**Como chamar** (use a service-role key do AMBIENTE/dashboard — NUNCA hardcode/commit):
```
POST https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/pedro-webhook-v2
Headers: Authorization: Bearer <SERVICE_ROLE_KEY>, apikey: <SERVICE_ROLE_KEY>, Content-Type: application/json
Body:
{
  "dry_run": true,
  "instanceName": "<instance_name do agente>",
  "instance": "<instance_name do agente>",
  "messages": [{
    "key": { "remoteJid": "<numero>@s.whatsapp.net", "fromMe": false, "id": "TESTE1" },
    "message": { "conversation": "tem polo sedan?" },
    "pushName": "Teste",
    "messageType": "conversation"
  }]
}
```
- Para simular ANÚNCIO: troque `message` por
  `{"extendedTextMessage":{"text":"...","contextInfo":{"externalAdReply":{"title":"...","body":"...","sourceUrl":"...","mediaType":1}}}}`.
- **A resposta traz:** `build`, `brain_plan` (ação/intenção), `vehicle_resolution`, `stock_result`,
  `reply` (texto + flags como `transferir_silencioso`/`pronto_para_transferir`/`temperatura`), `next_action`.
- **Dry-run usando o JID de um lead REAL** carrega a memória dele (bom para testar continuação de conversa).
- **Limitação:** o que é gated por `!dryRun` (envio, persistência, transferência) NÃO roda no dry-run.
  Para validar transferência/persistência de verdade, observe um lead real ou um teste controlado.

**Diagnóstico por log:** leia `pedro_v2_turn_logs` (por `agent_id`/`remote_jid`, ordene por
`created_at`). Campos úteis: `brain_plan.action`, `result.needs_handoff`, `result.handoff`,
`result.reply_source`. Se `handoff=null`, o agente nem tentou transferir.

---

## 8) BRAIN — `.codex-brain/` (memória do projeto)

- **`.codex-brain/historico.md`** — log cronológico de TODA mudança/deploy (o que mudou, por quê,
  validação, commit, build). **Atualize a cada deploy**, prepend no topo, na seção do dia (`## AAAA-MM-DD`).
- **`.codex-brain/pendencias.md`** — itens pendentes/TODO.
- Formato de uma entrada de histórico: o que mudou + diagnóstico (com prova de log) + arquivos +
  validação (esbuild/dry-run) + commit + build deployado. Seja específico (ex.: "FIX vXX: ...").
- **Sempre registre** quando ligar/desligar flags, aplicar migration, ou mexer no agente.

---

## 9) FLUXO DE TRABALHO SEGURO (passo a passo para uma mudança no Pedro)

1. **Esteja no `main` e limpo** (`git status`). Se for mudança grande, crie branch.
2. **Diagnostique pelo log real** (não suponha). Confirme o bug em `pedro_v2_turn_logs`/`wa_chat_history`.
3. **Edite o arquivo VIVO certo** (seção 2.1). Mudança mínima, comentários em português.
4. **esbuild** de sintaxe nos arquivos tocados (seção 4.4).
5. **Bumpe `PEDRO_V2_BUILD`** (`...-v67-...`).
6. **Deploy do `main`**: `scripts/supabase-logosia.cmd functions deploy pedro-webhook-v2 --project-ref seyljsqmhlopkcauhlor`.
7. **Dry-run** pós-deploy: confirme o `build` novo + o comportamento esperado com dado real.
8. **Atualize `.codex-brain/historico.md`**.
9. **Commit + push** (procedimento abaixo).

**Procedimento de commit/push (produção):**
```
git add <arquivos>            # NUNCA add . cego; nunca inclua segredos/scratch
git commit -m "..."           # mensagem em PT; termine com o trailer de co-autoria padrão
git checkout -- supabase/.temp/cli-latest   # descarta artefato do CLI (se aparecer)
git fetch origin -q
git rebase origin/main        # integra o que o sócio empurrou (anti-clobber!)
git push origin main
```
> **Anti-clobber:** o sócio às vezes commita direto no `main` em paralelo. SEMPRE `fetch`+`rebase`
> antes do push, e **depois de qualquer merge confira a reativação no PedroSDR** (regra 6) e que
> o build do Pedro continua na versão certa (`grep PEDRO_V2_BUILD`).

---

## 10) FOLLOW-UP / REATIVAÇÃO (não quebrar)

- **Motor:** `pedro-auto-followup` (cron 5/5min) dispara reativação na coluna `status_crm='inativo'`,
  respeitando `followup_ia_config` (horário/teto/intervalo/pausa) **e a trava de 24h**
  (só lead sem atendimento há +24h). Só envia se o secret `PEDRO_FF_AUTO_REACTIVATION='on'`.
- **Fila/escala:** `pedro-trigger-followup` (agendamentos manuais), `cron-lead-followup`
  (follow-up de inatividade 5/8/12min + transferência), `process-followup-queue`.
- **Frontend:** botão "Follow-up IA" + modal (`FollowupIAConfigModal`) + `FollowupDashboard` +
  o **badge ♻️** e o campo `reactivation_status` no `PedroSDR.tsx`. **NÃO deletar** (regra 6).
- **Estado da recuperação:** tabela `pedro_followup_reactivation` (pending→sent→responded→transferred).
  Quando o lead reativado responde e é transferido, vai pro **mesmo vendedor** do 1º atendimento
  com o selo "♻️ RECUPERADO PELO FOLLOW-UP" (lógica no orquestrador + transferRouter).

---

## 11) Checklist final antes de qualquer deploy do Pedro
- [ ] Editei o arquivo VIVO certo (seção 2.1), não uma variante morta.
- [ ] Diagnostiquei por log real, não suposição.
- [ ] `esbuild` passou em tudo que toquei.
- [ ] Bumpei `PEDRO_V2_BUILD`.
- [ ] Deploy a partir do `main`.
- [ ] Dry-run confirmou o `build` novo + o comportamento.
- [ ] Reativação no PedroSDR intacta (grep > 0).
- [ ] Atualizei o `.codex-brain/historico.md`.
- [ ] `fetch`+`rebase` antes do push; sem segredos no commit.

---
_Dúvida sobre qual arquivo é o vivo? Rode: `grep -E "^import" supabase/functions/pedro-webhook-v2/index.ts` e siga a cadeia do `orchestrator_20260525_photo_flow.ts`._
