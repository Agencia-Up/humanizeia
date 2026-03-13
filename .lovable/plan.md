

# Plano: Passo 4 - Motor de Disparo WhatsApp (Backend)

## Estado Atual

A infraestrutura base já existe e funciona:
- **`enqueue-campaign`**: Popula `wa_queue` a partir dos contatos das listas alvo
- **`process-whatsapp-queue`**: Processa fila com rodízio de instâncias, geração de mensagens via IA (Gemini Flash), simulação de digitação e envio via Evolution API
- **`wa-inbox-webhook`**: Recebe mensagens via webhook da Evolution API
- **Tabelas**: `wa_campaigns`, `wa_queue`, `wa_instances`, `wa_contacts` com RLS

## O Que Falta Implementar

### 1. Melhorar `enqueue-campaign`
- Buscar `dados_extras` (metadata) dos contatos e armazená-los na fila para personalização pela IA
- Respeitar `scheduled_at` da campanha como base de tempo (em vez de `Date.now()`)
- Adicionar constraint de deduplicação (`campaign_id` + `contact_id`) via `ON CONFLICT DO NOTHING`
- Corrigir autenticação: substituir `getClaims` (não existe no SDK) por `getUser`

### 2. Melhorar `process-whatsapp-queue`
- **Personalização com dados do contato**: Buscar `wa_contacts.metadata` e incluir nome/dados extras no prompt da IA
- **Usar `regras_rodizio` JSONB**: Ler `mensagens_por_instancia` e `pausa_entre_instancias` do campo JSONB da campanha
- **Usar `regras_aquecimento`**: Limitar volume nos primeiros dias de uma instância
- **Backoff exponencial**: Em vez de retry fixo em 1 min, usar delays crescentes (1min, 5min, 15min)
- **Circuit breaker**: Após 5 falhas consecutivas numa instância, desativar temporariamente (reduzir `health_score`, marcar `is_active = false`)
- **Atualizar `wa_contacts.last_message_at`** após envio bem-sucedido
- **Gerar `message_hash`** para garantir zero repetição

### 3. Configurar `pg_cron` 
- Ativar extensões `pg_cron` e `pg_net`
- Criar job para invocar `process-whatsapp-queue` a cada minuto via `net.http_post`

### 4. Melhorar `wa-inbox-webhook`
- Tratar evento `message.update` da Evolution API para capturar status de entrega (enviado, entregue, lido)
- Atualizar `wa_queue.status` e `wa_queue.delivered_at` com base no status recebido
- Incrementar `wa_campaigns.delivered_count` quando status = entregue

### 5. Criar DB function `decrement_instance_health`
- Função SQL para decrementar `health_score` de uma instância e desativá-la se score < 20

## Arquivos Afetados

| Arquivo | Ação |
|---|---|
| `supabase/functions/enqueue-campaign/index.ts` | Editar - auth fix, dados_extras, scheduled_at, dedup |
| `supabase/functions/process-whatsapp-queue/index.ts` | Editar - backoff, circuit breaker, personalização, aquecimento |
| `supabase/functions/wa-inbox-webhook/index.ts` | Editar - delivery status tracking |
| Migration SQL | Criar - extensões pg_cron/pg_net, function `decrement_instance_health` |
| SQL Insert | Criar - pg_cron job schedule |

## Detalhes Técnicos

**Backoff exponencial**: `retry_delay = Math.min(60000 * Math.pow(3, retry_count), 3600000)` (1min → 3min → 9min → 27min → cap 1h)

**Circuit breaker**: Tracker in-memory por instância. Após 5 erros consecutivos:
```
health_score -= 30
if health_score < 20: is_active = false
```

**Personalização IA**: O prompt inclui `dados_extras` do contato:
```
Intenção: ${promptBase}
Dados do lead: Nome: ${name}, ${JSON.stringify(metadata)}
Gere uma variação personalizada.
```

**pg_cron**: Invoca a edge function via HTTP POST a cada minuto usando `net.http_post`.

