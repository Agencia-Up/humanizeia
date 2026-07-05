# feedback-ingestor (Cérebro de Feedback — Fase 1)

Monta o **thread unificado** de um lead para o cérebro (Fase 2). **Read-only, sem custo.**

## O que faz
`POST { lead_id, lead_source: 'pedro'|'marcos' }` → thread cronológico único combinando:
- **Pedro (IA)**: `wa_chat_history` por `remote_jid` exato (role `user`→cliente, `assistant`→ia).
- **Vendedor**: `wa_inbox` pelos **últimos 8 dígitos** do telefone (`ilike '%<8>'`) — robusto ao DDI 55 e ao 9º dígito; `direction` outgoing→vendedor, incoming→cliente.
- **Sinais estruturados** do lead (troca, entrada, cpf, idade, temperatura...) + metadados (`vendedor_id`, `campanha_id` = `ad_id`‖`campaign_id`).

Lógica real em `../_shared/feedback/ingestor.ts` (`buildLeadThread`) — reusada direto pelo `feedback-analista` (Fase 2), sem round-trip HTTP.

## Contrato de saída
`{ lead_id, lead_source, tenant_id, vendedor_id, campanha_id, ad_name, lead_nome, sinais_estruturados, thread: [{from:'cliente'|'vendedor'|'ia', texto, timestamp, canal:'pedro'|'marcos'}], total_mensagens }`

## Garantias
- Ordenado por `timestamp` (Pedro + Marcos num só fio).
- **Lead sem conversa de vendedor não quebra** (wa_inbox vazio → só o fio do Pedro).
- Lead inexistente → 404.

## Auth / segurança
Só `service_role` (checa o papel no JWT). Tenant = `user_id`. Não escreve nada.

## Testes
`test.ts` (Deno, client mockado — sem API real): ordena+combina; lead sem vendedor; inexistente→null.

## Chaves de junção (validadas em prod)
Pedro = `wa_chat_history.remote_jid` == `ai_crm_leads.remote_jid` (exato). Vendedor = `wa_inbox.phone` últimos 8 == telefone do lead. `crm_leads` (Marcos) tem `assigned_to`/`phone`; `ai_crm_leads` (Pedro) tem `assigned_to_id`/`remote_jid`.
