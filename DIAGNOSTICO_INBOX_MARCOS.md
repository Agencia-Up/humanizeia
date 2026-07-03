# Diagnóstico e evolução — Inbox do Marcos → paridade com o Pedro

Objetivo: inbox do Marcos no nível do Pedro, mídia carregando, só leads da Logos,
seletor de vendedor claro na Master, layout ajustável. Decisão de arquitetura (dono):
**um inbox de vendedor UNIFICADO** (aba lateral "Conversas") que junta Pedro (tráfego)
e Marcos (manuais), reusando o componente bom do Pedro; a IA fica isolada dentro do Pedro.

## Causa raiz (FASE 0)
- **Dois inboxes SEPARADOS** (não compartilham código): Pedro = `src/components/pedro/AgentInboxTab.tsx` (IA-aware); Marcos = `src/pages/WhatsAppInbox.tsx` (genérico, embutido em `MarcosLeads.tsx:171`).
- **Marcos só lê `wa_inbox`** (`WhatsAppInbox.tsx:353`); o Pedro mescla `wa_inbox` + `wa_chat_history` → Marcos perde histórico da IA e mídia.
- **Mídia**: guardada como URL externa em `wa_chat_history.metadata.media[]` (CDN Facebook/WhatsApp **com expiração** `oe=`/`oh=`), não baixada. O `wa_inbox.media_url` (Meta) é base64. O `uazapi-webhook` (Evolution) não gravava o `wa_inbox`. → mídia antiga morre / Evolution sem inbox. (Parcialmente resolvido pelo commit `48d878f3` com a função `wa-resolve-media`, que re-resolve a mídia sob demanda.)
- **Contador do vendedor**: `CrmAoVivo.tsx:968-1006` conta leads transferidos (`ai_lead_transfers`, limpo); `SellerManagerTab.tsx:376-386` SOMA `ai_crm_leads` + `crm_leads` → **conta 2x** um lead que existe nas duas tabelas (inflação). Nenhum conta contatos aleatórios (`wa_contacts`).
- **Seletor Master**: Pedro filtra por `assigned_to_id` (vendedor); Marcos filtra por instância (`seller_member_id`) — critérios diferentes.

## Modelo de dados (referência)
- `ai_crm_leads.status_crm` = coluna do Kanban; `.status` = status do motor. Lead do Pedro = tráfego. Lead do Marcos = `crm_leads`, manual.
- Mensagens keyed por `remote_jid`/telefone (origem-agnóstico) → o inbox funciona igual pras duas origens.

## Blocos
| Bloco | Escopo | Status |
|---|---|---|
| 1 | Aba "Conversas" = inbox unificado (Pedro+Marcos) reusando `AgentInboxTab` em modo `unified` + filtro de origem | **FEITO** (commit 33eec015) |
| 2 | UX vendedor-first estilo WhatsApp (chips: origem/não-lidas/aguardando; busca; ordem por recente) + camada de seletor de vendedor pra Master | pendente |
| 3 | Mídia (aproveitar `wa-resolve-media` no unificado) | quase pronto (base do 48d878f3) |
| 4 | Contador limpo (dedupe Pedro+Marcos por telefone) + só leads da Logos | pendente |
| 5 | Layout ajustável (zoom/densidade), sidebar curta, foto de perfil | pendente |
| 6 | Isolar a IA no Pedro + aposentar `WhatsAppInbox` do Marcos | pendente (último, mais sensível) |

## Bloco 1 — arquivos tocados
- `src/components/pedro/AgentInboxTab.tsx`: prop `unified` (default false = Pedro inalterado); `Lead.origem`; `fetchLeads` junta `crm_leads` (origem marcos) deduplicando por telefone; chips Todos/Pedro/Marcos; não bloqueia sem agente IA.
- `src/pages/Conversas.tsx` (novo): renderiza `<AgentInboxTab unified>`.
- `src/App.tsx`: rota `/conversas`.
- `src/components/layout/AppSidebar.tsx`: item "Conversas" (sempre visível; gate RBAC fica pro bloco de refino).

**Aditivo / não-regressão:** o inbox do Pedro (PedroSDR) e do Marcos (WhatsAppInbox) atuais **não foram alterados** — o modo unificado só liga com o prop novo, usado apenas na aba Conversas. Frontend precisa de Rebuild no EasyPanel.

## A monitorar 48h
- Dedupe por telefone (formato de número: com/sem DDI/9º dígito) — conferir se não some conversa nem duplica.
- Volume: `crm_leads` (~4.5k) — a query do Marcos tem limit 2000; validar se cobre o vendedor.
