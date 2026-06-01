# Auditoria da Seção de Integrações — Logos IA Platform

> Documento interno de engenharia. Gerado em 2026-06-01.
> Escopo: página `/integrations` (`src/pages/Integrations.tsx`) e suas 3 abas:
> **Conexões** (`ConnectionsTab`), **Outras Integrações** (`IntegrationsTab`) e
> **Captura de Leads** (`LeadCaptureTab`).

## Legenda de classificação

| Símbolo | Significado |
|---|---|
| ✅ **Real / Funcional** | Backend real, valida e/ou persiste credenciais; há consumidor dos dados. |
| 🟡 **Parcial / Em desenvolvimento** | Código real existe, mas depende de secret/infra ainda não configurada, ou tem bug de configuração (ex.: redirect URI). Pode ainda não funcionar de ponta a ponta. |
| ❌ **Falsa / Só a casca** | Card existe na UI mas o backend não suporta a plataforma (retorna "não suportado") ou não há backend nenhum. |
| 🕒 **Em breve (honesto)** | Placeholder claramente rotulado "Em breve", sem botão de ação ativo. Não é "quebrado" — é roadmap. |

---

## ETAPA 1 — Auditoria das integrações existentes

### Aba "Conexões" (`src/components/settings/ConnectionsTab.tsx`)

Plataformas de anúncios via OAuth. Status de conexão lido das tabelas
`ad_accounts` e `connected_accounts`.

| Integração | id | Classificação | Evidência / Motivo |
|---|---|---|---|
| Meta Ads | `meta` | 🟡 Parcial | Edge fn `meta-oauth` implementada (authorize/callback/troca de token; usa `META_APP_ID`/`META_APP_SECRET`). **Bug:** `useMetaConnection.startOAuth()` e `handleCallback()` fixam o `redirect_uri` em `https://humanizeia.lovable.app` (domínio Lovable abandonado) → o botão "Conectar" cai num app morto. O caminho de token manual (`connectWithToken`) ainda pode funcionar. Depende dos secrets Meta estarem setados. |
| Instagram Business | `instagram_publisher` | 🟡 Parcial | Edge fn `instagram-publish-oauth` implementada (OAuth Facebook Graph, usa credenciais do app Meta). Rota `/integrations/instagram`. Depende dos secrets do app Meta. Código real, pendente de infra. |
| Google Ads | `google_ads` | 🟡 Parcial | Edge fn `google-ads-oauth` implementada; `redirect_uri` usa `window.location.origin` (correto). Retorna `not_configured` quando os secrets do Google não existem, e o hook mostra "Google Ads ainda não disponível". Hoje travada por secret ausente. |
| Google Analytics | `google_analytics` | 🕒 Em breve | `status: 'coming_soon'`. Sem handler de conexão, botão desabilitado. Rótulo honesto. |
| Tag Manager | `google_gtm` | 🕒 Em breve | `status: 'coming_soon'`. Placeholder honesto. |
| TikTok Ads | `tiktok` | 🟡 Parcial | Edge fn `tiktok-oauth` implementada (usa `TIKTOK_APP_ID`/`TIKTOK_APP_SECRET`; `get_auth_url`). Front trata "TikTok App ID não configurado". Secrets não constam na lista configurada → provavelmente ainda não funcional. Código real, pendente de infra. |
| LinkedIn Ads | `linkedin` | ✅ Real | Edge fn `linkedin-ads-oauth` implementada (fluxo popup + postMessage); usa `LINKEDIN_CLIENT_ID`/`LINKEDIN_CLIENT_SECRET` que **estão configurados** (CLAUDE.md §8). `redirect_uri` correto. Persiste em `connected_accounts`. É a conexão mais completa. |
| Pinterest / Twitter-X / Snapchat / Microsoft | — | 🕒 Em breve | Array estático `COMING_SOON_PLATFORMS`. Sem backend, apenas teasers visuais rotulados "Em breve". Honesto. |

### Aba "Outras Integrações" (`src/components/settings/IntegrationsTab.tsx`)

Integrações por chave de API. **Todas** passam pela mesma edge fn
`test-integration` (ações: teste padrão, `save`, `disconnect`), persistindo em
`platform_integrations`.

> **Achado-chave:** o `switch (platform)` da `test-integration` tem casos apenas
> para `ga4`, `hotmart`, `zapier`, `webhook`, `google_sheets` e `bndv`. Os ids
> `apify` e `resend` **caem no `default` → "Plataforma não suportada"**. Os cards
> existem, mas o teste sempre falha e não há consumidor real.

| Integração | id | Classificação | Evidência / Motivo |
|---|---|---|---|
| BNDV Estoque | `bndv` | ✅ Real | `testBndv()` faz query GraphQL real em `api-estoque.azurewebsites.net`, valida o token e retorna contagem de veículos. `save` persiste. Consumido pelo Pedro para estoque. **Liberada no Básico.** |
| Google Analytics 4 | `ga4` | ✅ Real | `testGA4()` faz POST no Measurement Protocol do GA4 e valida 200/204. |
| Google Sheets | `google_sheets` | ✅ Real | `testGoogleSheets()` chama a Sheets API v4 e retorna o título da planilha. |
| Hotmart | `hotmart` | ✅ Real | `testHotmart()` chama a API de resumo de vendas da Hotmart com Bearer token. |
| Zapier | `zapier` | ✅ Real | `testWebhook()` faz POST na URL do hook do Zapier. |
| Webhook Personalizado | `webhook` | ✅ Real | `testWebhook()` faz POST no endpoint com header de secret opcional. **Liberada no Básico.** |
| Apify | `apify` | ❌ Só a casca | Sem `case` na `test-integration` → "Plataforma não suportada". Botão de teste sempre falha; sem consumidor. **Marcada como "Em breve".** |
| Resend (Email) | `resend` | ❌ Só a casca | Mesma situação: sem `case` → "Plataforma não suportada". **Marcada como "Em breve".** |

### Aba "Captura de Leads" (`src/components/settings/LeadCaptureTab.tsx`)

| Integração | Classificação | Evidência / Motivo |
|---|---|---|
| Webhook de Captura (`crm-capture`) | ✅ Real | Mostra o endpoint POST `…/functions/v1/crm-capture` + `user_id` + exemplo de payload. `crm-capture` é edge fn real e deployada (CLAUDE.md §6, Marcos) que insere leads no CRM. Funcional. (Obs.: a URL fixa o ref de produção — ok, é endpoint público de ingestão.) |

### Resumo da classificação

- ✅ **Real (8):** BNDV, GA4, Google Sheets, Hotmart, Zapier, Webhook, LinkedIn, crm-capture.
- 🟡 **Parcial (4):** Meta, Instagram, Google Ads, TikTok (código real, pendente de secret/infra ou com bug de redirect).
- 🕒 **Em breve honesto (2 + teasers):** Google Analytics, Tag Manager (+ Pinterest/Twitter/Snapchat/Microsoft decorativos).
- ❌ **Só a casca (2):** Apify, Resend → tratados (vide ETAPA 2).

---

## ETAPA 2 — Restrição de acesso por plano

Regra de produto implementada:

- **Plano Básico** → apenas **BNDV** + **Webhook** ativos/clicáveis. Todas as
  demais integrações ficam **bloqueadas** (card visível, cadeado, badge
  "Plano Pro", botão desabilitado e modal de upgrade ao clicar).
- **Plano Pro / Pro Max (enterprise)** → **todas** as integrações liberadas.
- Integrações ❌ "só a casca" (Apify, Resend) **não ficam quebradas**: foram
  marcadas como **"Em breve"** (desabilitadas, para todos os planos).

### O que NÃO é bloqueado por plano

- **Captura de Leads** (`crm-capture`): permanece aberta a todos os planos — é o
  webhook essencial de entrada de leads, núcleo do produto.
- Cards já "Em breve" (coming soon) continuam como estavam (não viram "Plano Pro").

### Componente compartilhado

`src/components/settings/integrationAccess.tsx`:

- `BASICO_ALLOWED_INTEGRATIONS = { 'bndv', 'webhook' }`.
- `useIntegrationAccess()` → `{ planId, loading, isBasico, isLocked(id) }`. Lê o
  plano via `useSubscription()` (`user_subscriptions.plan_id`). Enquanto carrega,
  **não** trava (evita "piscar" cadeado).
- `PlanProBadge` — badge dourado "Plano Pro".
- `ProLockOverlay` — overlay de cadeado (cobre o card e dispara o modal).
- `UpgradeProDialog` — modal com a mensagem exata:
  *"Esta integração está disponível no Plano Pro. Faça upgrade para acessar."* +
  CTA "Fazer upgrade" → `/meu-plano`.

### Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/components/settings/integrationAccess.tsx` | **Novo.** Hook + componentes de gating (badge, overlay, modal). |
| `src/components/settings/IntegrationsTab.tsx` | Gating por plano; `apify`/`resend` marcados `comingSoon` → "Em breve"; modal de upgrade. |
| `src/components/settings/ConnectionsTab.tsx` | Gating por plano em todas as conexões; overlay + modal de upgrade. |
| `src/pages/Integrations.tsx` | Banner "Você está no Plano Básico" com CTA de upgrade (só no Básico). |

---

## Recomendações (follow-up, fora do escopo desta entrega)

1. **Meta/Instagram OAuth:** trocar o `redirect_uri` fixo `humanizeia.lovable.app`
   por `window.location.origin` (como já faz o Google Ads) para o botão
   "Conectar" voltar a funcionar no domínio de produção.
2. **TikTok/Google Ads:** configurar os secrets (`TIKTOK_APP_ID/SECRET`,
   credenciais Google Ads) ou rotular como "Em breve" enquanto não houver infra.
3. **Apify/Resend:** implementar os `case` na `test-integration` (e o consumidor
   real) antes de reativar, OU remover de vez se não houver roadmap.
