
# Plano de Implementação: Evolução do Módulo WhatsApp

## Análise do Estado Atual

O sistema **já possui** uma base sólida:
- **Multi-Integração**: Evolution API + Meta API já implementados (`EvolutionConnectDialog.tsx` com seleção de provider, `process-whatsapp-queue` com `sendToMetaAPI`/`sendToEvolutionAPI`)
- **Smart Switcher**: Algoritmo `selectSmartInstance` já funciona com health_score, circuit breaker, warmup, rodízio
- **Polimorfismo IA**: `generateAIMessage` já usa Lovable AI (Gemini 2.5 Flash) com 3 níveis de variação
- **Broadcast**: Frontend completo com CSVUpload, NewCampaignDialog, CampaignCard

## O que FALTA implementar

### Fase 1: Failover Inteligente (Redundância Ativa)
**Prioridade alta** - Protege operação contra banimentos

1. **Migração DB**:
   - Adicionar `failover_status` (text) em `wa_instances`
   - Adicionar `current_instance_id` (uuid) em `wa_contacts`
   - Criar tabela `wa_audit_logs` (id, user_id, event_type, instance_id, contact_id, details jsonb, created_at)

2. **Edge Function `handle-instance-ban`**:
   - Trigger: chamada quando `health_score < 20` e `is_active = false`
   - Identifica contatos "aquecidos" (last_message_at nos últimos 7 dias)
   - Seleciona nova instância saudável via Smart Switcher
   - Gera mensagem de continuidade via IA (Gemini)
   - Enfileira mensagens na `wa_queue` para a nova instância
   - Atualiza `current_instance_id` nos contatos afetados
   - Registra evento em `wa_audit_logs`

3. **Integração no `process-whatsapp-queue`**:
   - Após circuit breaker desativar instância, chamar `handle-instance-ban`

### Fase 2: CRM com Etiquetas (Tags)
**Prioridade média** - Organização visual de contatos

1. **Migração DB**:
   - Criar tabela `wa_tags` (id, organization_id, user_id, name, color, created_at) com RLS
   
2. **Frontend - Componentes**:
   - `TagManager.tsx`: CRUD de tags com cores (popover/dialog)
   - `TagBadge.tsx`: Badge visual colorido reutilizável
   - `TagSelector.tsx`: Seletor multi-tag com busca e criação inline

3. **Frontend - Integração**:
   - `WhatsAppInbox.tsx`: Adicionar tags ao lado do nome do contato, filtro por tags na lista de conversas
   - `WhatsAppContacts.tsx`: Coluna de tags na tabela, ação em lote "Adicionar tag", filtro por tag
   - Aplicar/remover tags diretamente via update no `wa_contacts.tags[]`

### Fase 3: Melhorias no Polimorfismo
**Prioridade média** - Já funciona, mas pode ser aprimorado

1. **Migração DB**:
   - Adicionar `variation_level` em `wa_campaigns` (já existe!)
   
2. **Aprimorar prompt em `process-whatsapp-queue`**:
   - Incluir `conversation_history_summary` para leads quentes (buscar últimas 5 msgs do `wa_inbox`)
   - Incluir dados do negócio/ramo do contato dos metadados
   - Melhorar prompt com contexto de histórico

### Fase 4: Melhorias no Smart Switcher
**Prioridade baixa** - Já funcional, refinamentos

1. **Migração DB**:
   - Adicionar `last_used_at` em `wa_instances` (já existe no código!)

2. **Aprimorar `selectSmartInstance`**:
   - Balanceamento de carga ponderado por health_score (não apenas ordenação)
   - Log de decisões de roteamento em `wa_audit_logs`

---

## Ordem de Implementação

Dado que Multi-Integração, Smart Switcher e Polimorfismo **já estão implementados**, o trabalho real é:

1. **Failover Inteligente** - 1 migração + 1 edge function + integração
2. **CRM Tags** - 1 migração + 3 componentes + integração em 2 páginas
3. **Polimorfismo aprimorado** - Edição no edge function existente
4. **Smart Switcher refinado** - Edição no edge function existente

## Detalhes Técnicos

- Todas as novas tabelas terão RLS com `user_id = auth.uid()`
- Edge functions usam `verify_jwt = false` + validação manual via `getClaims()`
- IA usa Lovable AI gateway (`ai.gateway.lovable.dev`) com `google/gemini-2.5-flash`
- Audit logs são write-only para usuários (INSERT + SELECT, sem UPDATE/DELETE)

## Extrator Google Maps

Conforme combinado, **adiado para implementação futura**. A infraestrutura já existe parcialmente em `extract-google-maps-leads`.
