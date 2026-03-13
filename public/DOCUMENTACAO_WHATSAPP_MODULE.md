# 📱 Documentação Completa — Módulo WhatsApp HumanizeAI

> Última atualização: 13 de Março de 2026

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitetura do Módulo](#2-arquitetura-do-módulo)
3. [Banco de Dados — Tabelas](#3-banco-de-dados--tabelas)
4. [Edge Functions (Backend)](#4-edge-functions-backend)
5. [Páginas do Frontend](#5-páginas-do-frontend)
6. [Fluxos Operacionais](#6-fluxos-operacionais)
7. [Inteligência Artificial](#7-inteligência-artificial)
8. [Segurança e RLS](#8-segurança-e-rls)
9. [Integrações Externas](#9-integrações-externas)

---

## 1. Visão Geral

O módulo WhatsApp do HumanizeAI é um sistema completo de prospecção e marketing via WhatsApp, construído em 5 passos incrementais:

| Passo | Descrição | Status |
|-------|-----------|--------|
| **1** | Infraestrutura de instâncias (Evolution API) | ✅ Concluído |
| **2** | Captação de leads (Google Maps e Grupos WhatsApp) | ✅ Concluído |
| **3** | Configuração de campanhas com IA | ✅ Concluído |
| **4** | Motor de disparo assíncrono com resiliência | ✅ Concluído |
| **5** | Inbox unificado, automações e analytics | ✅ Concluído |

O módulo permite que o usuário:
- Conecte múltiplas instâncias WhatsApp via Evolution API
- Extraia contatos de grupos WhatsApp e Google Maps
- Crie campanhas de disparo em massa com personalização via IA
- Monitore conversas em um inbox unificado com qualificação automática
- Configure automações baseadas em eventos de resposta
- Analise performance com dashboards e gráficos

---

## 2. Arquitetura do Módulo

### Stack Tecnológica

| Camada | Tecnologia |
|--------|------------|
| Frontend | React 18 + TypeScript + Vite |
| UI | TailwindCSS + shadcn/ui |
| Backend | Supabase (via Lovable Cloud) |
| Edge Functions | Deno (Supabase Edge Functions) |
| Mensageria | Evolution API v2 |
| IA (Qualificação) | Google Gemini Flash Lite |
| IA (Personalização) | Google Gemini Flash Lite |
| Gráficos | Recharts |
| Agendamento | pg_cron + pg_net |

### Diagrama de Fluxo

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Frontend   │────▶│  Edge Functions   │────▶│  Evolution API  │
│  (React)    │◀────│  (Supabase)       │◀────│  (WhatsApp)     │
└─────────────┘     └──────────────────┘     └─────────────────┘
       │                     │
       │              ┌──────▼──────┐
       └─────────────▶│  Supabase   │
                      │  (Database) │
                      └─────────────┘
```

---

## 3. Banco de Dados — Tabelas

### 3.1 `wa_instances` — Instâncias WhatsApp

Armazena as conexões com a Evolution API. Cada instância representa um número de WhatsApp conectado.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `user_id` | uuid (FK) | Dono da instância |
| `organization_id` | uuid | Organização associada |
| `instance_name` | text | Nome técnico na Evolution API |
| `friendly_name` | text | Nome amigável exibido na UI |
| `api_url` | text | URL da Evolution API (ex: `https://api.evolution.com`) |
| `api_key_encrypted` | text | Chave de API da Evolution |
| `status` | text | Status atual: `open`, `close`, `connecting` |
| `is_active` | boolean | Se a instância está ativa para uso |
| `health_score` | integer | Score de saúde (0-100). Decrementado em falhas |
| `daily_message_count` | integer | Contador de mensagens enviadas no dia |
| `last_error` | text | Último erro registrado |
| `created_at` | timestamptz | Data de criação |

**Comportamento do `health_score`:**
- Inicia em 100
- Decrementado em 10 a cada falha de envio (via circuit breaker)
- Se `health_score < 20`, a instância é desativada automaticamente (`is_active = false`)
- Função SQL `decrement_instance_health(instance_id, amount)` gerencia a lógica

### 3.2 `wa_contact_lists` — Listas de Contatos

Organiza contatos em listas para segmentação de campanhas.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `user_id` | uuid (FK) | Dono da lista |
| `organization_id` | uuid | Organização |
| `name` | text | Nome da lista |
| `description` | text | Descrição da lista |
| `source` | text | Origem: `manual`, `google_maps`, `whatsapp_group`, `import` |
| `contact_count` | integer | Contador de contatos (atualizado automaticamente) |
| `tags` | text[] | Tags para categorização |
| `created_at` | timestamptz | Data de criação |

### 3.3 `wa_contacts` — Contatos

Armazena todos os leads capturados com seus metadados.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `user_id` | uuid (FK) | Dono do contato |
| `list_id` | uuid (FK) | Lista à qual pertence |
| `phone` | text | Número de telefone (normalizado, apenas dígitos) |
| `name` | text | Nome do contato |
| `group_name` | text | Nome do grupo de onde foi extraído |
| `source` | text | Origem: `google_maps`, `whatsapp_group`, `manual` |
| `tags` | text[] | Tags do contato |
| `is_valid` | boolean | Se o contato é válido (false = blacklist/opt-out) |
| `metadata` | jsonb | Dados extras para personalização IA (endereço, categoria, website, etc.) |
| `last_message_at` | timestamptz | Data da última mensagem enviada |
| `created_at` | timestamptz | Data de criação |

**Campos do `metadata` (exemplo para Google Maps):**
```json
{
  "address": "Rua das Flores, 123",
  "category": "Restaurante",
  "website": "https://exemplo.com",
  "rating": 4.5,
  "reviews_count": 150
}
```

### 3.4 `wa_campaigns` — Campanhas de Disparo

Configuração completa de campanhas de mensagem em massa.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `user_id` | uuid (FK) | Dono da campanha |
| `organization_id` | uuid | Organização |
| `instance_id` | uuid (FK) | Instância fixa (opcional, se não usar rodízio) |
| `name` | text | Nome da campanha |
| `message_template` | text | Template da mensagem base |
| `prompt_base` | text | Prompt para IA personalizar as mensagens |
| `media_url` | text | URL de mídia anexa (imagem, vídeo, documento) |
| `media_type` | text | Tipo da mídia: `image`, `video`, `audio`, `document` |
| `listas_alvo` | uuid[] | IDs das listas de contatos alvo |
| `list_ids` | uuid[] | IDs das listas (campo legado) |
| `status` | text | Status: `draft`, `running`, `paused`, `completed`, `cancelled` |
| `scheduled_at` | timestamptz | Data/hora agendada para início |
| `started_at` | timestamptz | Data/hora de início efetivo |
| `completed_at` | timestamptz | Data/hora de conclusão |
| `start_time` | timestamptz | Horário de início permitido (janela de envio) |
| `end_time` | timestamptz | Horário final permitido (janela de envio) |
| `total_contacts` | integer | Total de contatos na campanha |
| `sent_count` | integer | Total de mensagens enviadas |
| `delivered_count` | integer | Total de mensagens entregues |
| `failed_count` | integer | Total de falhas |
| `tags` | text[] | Tags da campanha |
| `regras_delay` | jsonb | Regras de delay entre mensagens |
| `regras_rodizio` | jsonb | Regras de rodízio de instâncias |
| `regras_aquecimento` | jsonb | Regras de aquecimento de novas instâncias |

**Estrutura `regras_delay`:**
```json
{
  "min": 35,
  "max": 89
}
```

**Estrutura `regras_rodizio`:**
```json
{
  "mensagens_por_instancia": 10,
  "pausa_entre_instancias": 300
}
```

**Estrutura `regras_aquecimento`:**
```json
{
  "enabled": true,
  "initial_messages": 20
}
```

### 3.5 `wa_queue` — Fila de Envio

Fila assíncrona que armazena cada mensagem a ser enviada com seu agendamento individual.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `user_id` | uuid (FK) | Dono |
| `campaign_id` | uuid (FK) | Campanha associada |
| `contact_id` | uuid (FK) | Contato destino |
| `instance_id` | uuid (FK) | Instância utilizada para envio |
| `phone` | text | Número de destino |
| `message` | text | Template da mensagem |
| `final_message` | text | Mensagem final após personalização pela IA |
| `media_url` | text | URL de mídia |
| `media_type` | text | Tipo de mídia |
| `status` | text | Status: `pending`, `processing`, `sent`, `delivered`, `failed`, `cancelled` |
| `scheduled_for` | timestamptz | Data/hora agendada para envio |
| `sent_at` | timestamptz | Data/hora do envio efetivo |
| `delivered_at` | timestamptz | Data/hora de confirmação de entrega |
| `read_at` | timestamptz | Data/hora de confirmação de leitura |
| `error_message` | text | Mensagem de erro (se falhou) |
| `retry_count` | integer | Número de tentativas |
| `message_hash` | text | Hash SHA-256 da mensagem final (anti-repetição) |
| `contact_metadata` | jsonb | Metadados do contato (copiados para personalização) |
| `contact_name` | text | Nome do contato |

**Constraint de deduplicação:** `UNIQUE(campaign_id, contact_id)` — evita envio duplicado para o mesmo contato na mesma campanha.

### 3.6 `wa_inbox` — Inbox de Mensagens

Armazena todas as mensagens trocadas (enviadas e recebidas) para o inbox unificado.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `user_id` | uuid (FK) | Dono |
| `instance_id` | uuid (FK) | Instância que enviou/recebeu |
| `phone` | text | Número do contato |
| `contact_name` | text | Nome do contato (se disponível) |
| `direction` | text | Direção: `incoming` ou `outgoing` |
| `message_type` | text | Tipo: `text`, `image`, `video`, `audio`, `document` |
| `content` | text | Conteúdo textual da mensagem |
| `media_url` | text | URL da mídia (se aplicável) |
| `ai_category` | text | Categoria atribuída pela IA |
| `ai_sentiment` | text | Sentimento detectado pela IA |
| `is_read` | boolean | Se a mensagem foi lida pelo usuário |
| `remote_message_id` | text | ID da mensagem na Evolution API |
| `created_at` | timestamptz | Data/hora da mensagem |

**Categorias de IA (`ai_category`):**
- `interested` — Lead demonstrou interesse
- `question` — Lead fez uma pergunta
- `not_interested` — Lead não tem interesse
- `opt_out` — Lead pediu para não ser mais contatado
- `spam` — Mensagem irrelevante
- `neutral` — Mensagem neutra/cumprimento

### 3.7 `wa_automations` — Automações Pós-Resposta

Regras automáticas acionadas por eventos de resposta dos leads.

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `user_id` | uuid (FK) | Dono |
| `name` | text | Nome da automação |
| `trigger_event` | text | Evento gatilho |
| `action_type` | text | Tipo de ação |
| `action_config` | jsonb | Configuração da ação |
| `is_active` | boolean | Se a automação está ativa |
| `trigger_count` | integer | Quantas vezes foi acionada |
| `last_triggered_at` | timestamptz | Última execução |

**Eventos de Trigger disponíveis:**

| Valor | Descrição |
|-------|-----------|
| `lead_interested` | Lead classificado como Interessado |
| `lead_question` | Lead fez pergunta |
| `lead_opt_out` | Lead pediu opt-out |
| `lead_responded` | Qualquer resposta recebida |
| `campaign_completed` | Campanha concluída |
| `instance_disconnected` | Instância perdeu conexão |

**Ações disponíveis:**

| Valor | Descrição | Config |
|-------|-----------|--------|
| `send_email` | Enviar e-mail para equipe | `{ "email": "vendas@empresa.com" }` |
| `add_tag` | Adicionar tag ao contato | `{ "tag": "qualificado" }` |
| `move_to_list` | Mover para outra lista | `{ "list_id": "uuid" }` |
| `notify_webhook` | Chamar webhook externo | `{ "webhook_url": "https://..." }` |

---

## 4. Edge Functions (Backend)

### 4.1 `create-evolution-instance`

Cria uma nova instância na Evolution API e salva no banco de dados.

**Endpoint:** `POST /functions/v1/create-evolution-instance`

**Payload:**
```json
{
  "instance_name": "minha-instancia",
  "api_url": "https://api.evolution.com",
  "api_key": "chave-da-api"
}
```

**Fluxo:**
1. Valida autenticação do usuário
2. Chama `POST {api_url}/instance/create/{instance_name}` na Evolution API
3. Insere registro em `wa_instances`
4. Retorna dados da instância criada

### 4.2 `test-evolution-connection`

Testa se a conexão com a Evolution API está funcionando.

**Endpoint:** `POST /functions/v1/test-evolution-connection`

**Payload:**
```json
{
  "api_url": "https://api.evolution.com",
  "api_key": "chave-da-api"
}
```

### 4.3 `get-evolution-qrcode`

Busca o QR Code para conectar o WhatsApp à instância.

**Endpoint:** `POST /functions/v1/get-evolution-qrcode`

**Payload:**
```json
{
  "instance_id": "uuid"
}
```

### 4.4 `extract-google-maps-leads`

Extrai leads do Google Maps baseado em termos de busca e localização.

**Endpoint:** `POST /functions/v1/extract-google-maps-leads`

**Payload:**
```json
{
  "search_term": "restaurantes",
  "location": "São Paulo, SP",
  "list_id": "uuid",
  "max_results": 50
}
```

**Fluxo:**
1. Autentica o usuário
2. Realiza busca no Google Maps
3. Extrai dados: nome, telefone, endereço, categoria, website, avaliação
4. Insere contatos em `wa_contacts` com `source: google_maps`
5. Atualiza `contact_count` da lista
6. Retorna quantidade de leads extraídos

### 4.5 `wa-extract-groups`

Extrai membros de grupos WhatsApp selecionados.

**Endpoint:** `POST /functions/v1/wa-extract-groups`

**Payload:**
```json
{
  "instance_id": "uuid",
  "group_ids": ["grupo1@g.us", "grupo2@g.us"],
  "list_id": "uuid"
}
```

**Fluxo:**
1. Autentica e valida instância
2. Para cada grupo, chama `GET {api_url}/group/participants/{instance_name}?groupJid={group_id}`
3. Extrai participantes com nome e telefone
4. Deduplica por número
5. Insere em `wa_contacts` com `source: whatsapp_group`

### 4.6 `sanitize-contacts`

Valida e sanitiza números de telefone da lista.

**Endpoint:** `POST /functions/v1/sanitize-contacts`

**Payload:**
```json
{
  "list_id": "uuid",
  "instance_id": "uuid"
}
```

**Fluxo:**
1. Busca contatos da lista
2. Para cada contato, chama a Evolution API para verificar se o número existe no WhatsApp
3. Atualiza `is_valid` para `false` nos números inválidos
4. Retorna relatório de validação

### 4.7 `enqueue-campaign`

Enfileira todos os contatos de uma campanha na `wa_queue` para processamento assíncrono.

**Endpoint:** `POST /functions/v1/enqueue-campaign`

**Payload:**
```json
{
  "campaign_id": "uuid"
}
```

**Fluxo detalhado:**
1. Autentica o usuário via `getUser()`
2. Busca a campanha e valida status (`draft` ou `paused`)
3. Busca listas alvo (`listas_alvo` ou `list_ids`)
4. Busca todos os contatos válidos (`is_valid = true`) das listas com `metadata`
5. Deduplica contatos por número de telefone
6. Calcula agendamento individual:
   - Base: `scheduled_at` da campanha ou `Date.now()`
   - Delay entre mensagens: `regras_delay.min` a `regras_delay.max` segundos
   - Cada contato recebe um `scheduled_for` incrementado
7. Insere na `wa_queue` em batches de 500 com `ON CONFLICT (campaign_id, contact_id) DO NOTHING`
8. Atualiza campanha: `status: running`, `total_contacts`, `started_at`

**Campos enriquecidos na fila:**
- `contact_metadata` — cópia dos metadados do contato para uso pela IA
- `contact_name` — nome do contato para personalização

### 4.8 `process-whatsapp-queue` ⭐ (Motor de Disparo)

Função principal que processa a fila de mensagens. Executada automaticamente a cada minuto via `pg_cron`.

**Endpoint:** `POST /functions/v1/process-whatsapp-queue`

**Fluxo detalhado:**

```
1. Buscar mensagens pendentes (status = 'pending', scheduled_for <= now())
   └── Limite: 20 mensagens por execução
   └── Ordenação: scheduled_for ASC

2. Para cada campanha na fila:
   └── Buscar instâncias ativas (is_active = true, health_score > 20)
   └── Ordenar por health_score DESC (melhor primeiro)
   └── Aplicar regras de rodízio (mensagens_por_instancia)
   └── Aplicar regras de aquecimento (limitar volume se instância é nova)

3. Para cada mensagem:
   a. Selecionar instância (rodízio round-robin)
   b. Se prompt_base existe:
      └── Chamar Gemini Flash Lite para personalizar mensagem
      └── Incluir nome do contato e metadados no prompt
      └── Gerar variação única (anti-bloqueio)
   c. Simular comportamento humano:
      └── Delay aleatório entre min e max (regras_delay)
      └── Simular "digitando..." via Evolution API
   d. Enviar via Evolution API:
      └── Texto: POST /message/sendText/{instance}
      └── Mídia: POST /message/{sendImage|sendVideo|sendAudio|sendDocument}/{instance}
   e. Em caso de sucesso:
      └── Atualizar wa_queue: status = 'sent', sent_at, final_message, message_hash
      └── Incrementar wa_campaigns.sent_count
      └── Atualizar wa_contacts.last_message_at
   f. Em caso de falha:
      └── Incrementar retry_count
      └── Aplicar backoff exponencial: delay = min(60000 × 3^retry, 3600000)
      └── Se retry_count >= 3: marcar como 'failed'
      └── Acionar circuit breaker: decrementar health_score da instância
```

**Backoff Exponencial:**
```
Tentativa 1: 1 minuto
Tentativa 2: 3 minutos
Tentativa 3: 9 minutos (falha definitiva)
```

**Circuit Breaker:**
- Cada falha decrementa `health_score` em 10
- Se `health_score < 20`: instância é desativada (`is_active = false`)
- Função SQL `decrement_instance_health(instance_id, amount)` executa a lógica

**Personalização com IA (Gemini Flash Lite):**
```
Prompt:
"Você é um redator especialista em mensagens de WhatsApp para prospecção B2B.
Reescreva a mensagem abaixo de forma natural e personalizada.

Mensagem base: {message_template}
Intenção/contexto: {prompt_base}
Nome do lead: {contact_name}
Dados do lead: {contact_metadata}

Regras:
- Mantenha a essência da mensagem original
- Use o nome do lead se disponível
- Adapte baseado nos dados extras (ex: se é restaurante, mencione o ramo)
- Varie a estrutura para evitar detecção de spam
- Máximo 500 caracteres
- Não use emojis em excesso
- Tom profissional mas amigável"
```

### 4.9 `wa-inbox-webhook`

Recebe webhooks da Evolution API para mensagens recebidas e atualizações de status de entrega.

**Endpoint:** `POST /functions/v1/wa-inbox-webhook`

**Eventos processados:**

#### Evento: `messages.upsert` (Nova mensagem recebida)

1. Extrai dados: remetente, conteúdo, tipo de mídia
2. Salva em `wa_inbox` com `direction: incoming`
3. **Qualificação com IA:**
   - Envia conteúdo para Gemini Flash Lite
   - Prompt de categorização:
   ```
   "Analise esta mensagem de WhatsApp recebida como resposta a uma prospecção comercial.
   Categorize como: interested, question, not_interested, opt_out, spam, neutral.
   Responda APENAS com o JSON: { 'category': '...', 'sentiment': '...' }"
   ```
4. Atualiza `wa_inbox` com `ai_category` e `ai_sentiment`
5. **Ações automáticas baseadas na categoria:**
   - `opt_out` → Atualiza `wa_contacts.is_valid = false` (blacklist)
   - `interested` ou `question` → Atualiza `wa_contacts.tags` adicionando "qualificado"

#### Evento: `messages.update` (Status de entrega)

1. Busca mensagem na `wa_queue` pelo `remote_message_id`
2. Atualiza status:
   - `DELIVERY_ACK` → `delivered_at = now()`
   - `READ` → `read_at = now()`
3. Incrementa `wa_campaigns.delivered_count`

### 4.10 `wa-send-reply`

Envia mensagens de resposta a partir do Inbox Unificado.

**Endpoint:** `POST /functions/v1/wa-send-reply`

**Payload:**
```json
{
  "instance_id": "uuid",
  "phone": "5511999999999",
  "content": "Olá! Como posso ajudar?",
  "media_url": "https://...",
  "media_type": "image"
}
```

**Fluxo:**
1. Autentica o usuário via `getUser()`
2. Valida propriedade da instância
3. Envia via Evolution API (texto ou mídia)
4. Salva em `wa_inbox` com `direction: outgoing`

---

## 5. Páginas do Frontend

### 5.1 Inbox Unificado (`/whatsapp/inbox`)

**Arquivo:** `src/pages/WhatsAppInbox.tsx` (500 linhas)

Interface de chat de dois painéis para gerenciamento de conversas:

**Painel Esquerdo — Lista de Conversas:**
- Lista todas as conversas agrupadas por número de telefone
- Exibe nome/telefone, última mensagem, e horário
- Indicador de mensagens não lidas (badge numérico)
- Tag colorida com a categoria de IA da última mensagem:
  - 🟢 Verde: `interested`
  - 🔵 Azul: `question`
  - 🔴 Vermelho: `opt_out`
  - 🟡 Amarelo: `not_interested`
  - ⚪ Cinza: `neutral`/`spam`
- Campo de busca para filtrar conversas
- Seletor de instância WhatsApp

**Painel Direito — Chat:**
- Histórico completo de mensagens com o contato
- Mensagens enviadas alinhadas à direita (bolha colorida)
- Mensagens recebidas alinhadas à esquerda (bolha neutra)
- Indicadores de status: ✓ enviado, ✓✓ entregue
- Campo de texto para envio de novas mensagens
- Integração com Supabase Realtime para atualização em tempo real

**Funcionalidades técnicas:**
- Supabase Realtime para receber novas mensagens instantaneamente
- Scroll automático para a última mensagem
- Marcação automática de mensagens como lidas ao abrir conversa
- Layout responsivo (mobile: lista ou chat, desktop: ambos)

### 5.2 Campanhas (`/whatsapp/campaigns`)

**Arquivo:** `src/pages/WhatsAppCampaigns.tsx` (441 linhas)

Gerenciamento completo de campanhas de disparo em massa.

**Funcionalidades:**
- Listagem de campanhas com status, progresso e métricas
- Criação via dialog com formulário avançado:
  - Nome, mensagem template, prompt base para IA
  - Seleção de listas de contatos alvo
  - Upload de mídia (imagem, vídeo, áudio, documento)
  - Configuração de regras de delay (min/max segundos)
  - Configuração de regras de rodízio de instâncias
  - Configuração de aquecimento de novas instâncias
  - Agendamento (data/hora)
  - Tags
- Barra de progresso visual com tooltip detalhado
- Ações: Iniciar, Pausar, Excluir
- Geração de mensagem via Claude AI (assistente de copy)

**Componente auxiliar:** `src/components/whatsapp/CampaignFormDialog.tsx`

### 5.3 Analytics (`/whatsapp/analytics`)

**Arquivo:** `src/pages/WhatsAppAnalytics.tsx`

Dashboard de performance com métricas e gráficos.

**KPIs exibidos:**
- Total de mensagens enviadas
- Taxa de entrega (delivered / sent × 100)
- Taxa de resposta (incoming messages / sent × 100)
- Taxa de qualificação (interested + question / total responses × 100)
- Total de opt-outs

**Gráficos (Recharts):**
- **Gráfico de Pizza:** Distribuição de respostas por `ai_category`
- **Gráfico de Linha:** Volume de mensagens enviadas vs recebidas ao longo do tempo
- **Tabela de Performance por Campanha:** envios, respostas, leads qualificados

**Saúde das Instâncias:**
- Score de saúde (`health_score`) de cada instância
- Status de conexão
- Contagem de mensagens diárias
- Indicador visual (verde > 70, amarelo > 40, vermelho ≤ 40)

### 5.4 Automações (`/whatsapp/automations`)

**Arquivo:** `src/pages/WhatsAppAutomations.tsx` (271 linhas)

Gerenciamento de regras automáticas baseadas em eventos.

**Funcionalidades:**
- Listagem de automações com status (ativo/inativo) e contagem de execuções
- Criação via dialog:
  - Nome da automação
  - Seleção de trigger (evento gatilho)
  - Seleção de ação
  - Configuração da ação (e-mail, tag, webhook URL)
- Toggle de ativação/desativação
- Exclusão de automações

### 5.5 Extrator de Grupos (`/whatsapp/groups`)

**Arquivo:** `src/pages/WhatsAppGroups.tsx` (384 linhas)

Extração de membros de grupos WhatsApp para listas de contatos.

**Funcionalidades:**
- Listagem de grupos do WhatsApp conectado
- Seleção múltipla de grupos
- Extração de participantes para uma lista de contatos
- Criação de nova lista ou seleção de existente
- Exibição de nome do grupo, quantidade de membros e dono

### 5.6 Extrator de Contatos (`/whatsapp/contacts`)

**Arquivo:** `src/pages/WhatsAppContacts.tsx` (765 linhas)

Gerenciamento completo de listas e contatos.

**Funcionalidades:**
- **Listas:** CRUD de listas, visualização de contagem, tags
- **Contatos:** Visualização, edição, exclusão individual e em massa
- **Importação manual:** Adicionar contatos um a um
- **Extração Google Maps:** Busca por termo e localização
- **Sanitização:** Validar números via Evolution API
- **Filtros:** Por lista, status (válido/inválido), busca por nome/telefone
- **Tags:** Adicionar e remover tags dos contatos
- **Metadados:** Visualizar dados extras (endereço, categoria, etc.)

### 5.7 Disparo em Massa (`/whatsapp/broadcast`)

**Arquivo:** `src/pages/WhatsAppBroadcast.tsx` (433 linhas)

Interface simplificada para criação rápida de campanhas de disparo.

**Funcionalidades:**
- Criação rápida de campanha
- Seleção de instância e listas
- Configuração de delay via slider
- Acompanhamento em tempo real do progresso
- Ações: Iniciar, Pausar, Cancelar

---

## 6. Fluxos Operacionais

### 6.1 Fluxo Completo de Prospecção

```
1. SETUP
   └── Usuário cria instância WhatsApp (Evolution API)
   └── Escaneia QR Code para conectar
   └── Instância fica com status "open"

2. CAPTAÇÃO DE LEADS
   ├── Opção A: Extrator Google Maps
   │   └── Busca por "restaurantes em São Paulo"
   │   └── Extrai: nome, telefone, endereço, categoria, rating
   │   └── Salva em lista de contatos
   │
   ├── Opção B: Extrator de Grupos WhatsApp
   │   └── Lista grupos do WhatsApp conectado
   │   └── Seleciona grupos alvo
   │   └── Extrai participantes
   │   └── Salva em lista de contatos
   │
   └── Opção C: Importação Manual
       └── Adiciona contatos um a um

3. SANITIZAÇÃO (Opcional)
   └── Valida números via Evolution API
   └── Marca inválidos como is_valid = false

4. CRIAÇÃO DA CAMPANHA
   └── Define mensagem template
   └── Define prompt_base para personalização IA
   └── Seleciona listas alvo
   └── Configura delay, rodízio e aquecimento
   └── Agenda data/hora (opcional)

5. DISPARO
   └── enqueue-campaign: popula wa_queue
   └── pg_cron: dispara process-whatsapp-queue a cada minuto
   └── Para cada mensagem:
       ├── Seleciona instância (rodízio + health_score)
       ├── Personaliza via Gemini Flash Lite
       ├── Simula digitação
       ├── Envia via Evolution API
       └── Atualiza métricas

6. RECEPÇÃO DE RESPOSTAS
   └── wa-inbox-webhook recebe mensagem
   └── Salva em wa_inbox
   └── IA classifica: interested, question, opt_out, etc.
   └── Atualiza status do contato (blacklist se opt_out)

7. INTERAÇÃO NO INBOX
   └── Usuário visualiza conversas no Inbox Unificado
   └── Identifica leads qualificados pela tag de IA
   └── Responde diretamente pelo chat
   └── Mensagens enviadas pelo wa-send-reply

8. AUTOMAÇÕES
   └── Regras configuradas disparam ações automáticas
   └── Ex: Lead "interested" → e-mail para vendedor

9. ANALYTICS
   └── Dashboard mostra métricas de performance
   └── Taxa de entrega, resposta e qualificação
   └── Saúde das instâncias
```

### 6.2 Fluxo de Circuit Breaker

```
Instância com health_score = 100
        │
    Envio OK ──────── Nenhuma mudança
        │
    Falha no envio
        │
    health_score -= 10 (agora 90)
        │
    ... mais falhas ...
        │
    health_score = 20
        │
    Próxima falha:
    health_score -= 10 (agora 10)
    is_active = false ← INSTÂNCIA DESATIVADA
        │
    Motor de disparo ignora esta instância
    Usa próxima instância disponível
```

---

## 7. Inteligência Artificial

### 7.1 Personalização de Mensagens

**Modelo:** Google Gemini Flash Lite (`google/gemini-2.5-flash-lite`)
**Uso:** Reescrita de mensagens para cada contato
**Contexto:** Nome do lead, metadados (endereço, categoria, website, rating)
**Objetivo:** Evitar detecção de spam e aumentar taxa de resposta

### 7.2 Qualificação de Respostas

**Modelo:** Google Gemini Flash Lite (`google/gemini-2.5-flash-lite`)
**Uso:** Classificação automática de respostas recebidas
**Categorias:** interested, question, not_interested, opt_out, spam, neutral
**Ações automáticas:** Blacklist em opt_out, tag "qualificado" em interested/question

### 7.3 Geração de Copy (Campanhas)

**Modelo:** Claude AI (via Edge Function `claude-chat`)
**Uso:** Assistente de redação para criação de mensagens de campanha
**Disponível na:** Tela de criação de campanha (botão "Sparkles")

---

## 8. Segurança e RLS

Todas as tabelas `wa_*` possuem Row-Level Security (RLS) ativado com políticas baseadas em `user_id`:

```sql
-- Padrão para todas as tabelas wa_*
CREATE POLICY "Users can manage own data"
  ON wa_table_name
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**Medidas de segurança implementadas:**
- Chaves de API da Evolution armazenadas em `api_key_encrypted`
- Autenticação via Bearer token em todas as Edge Functions
- Validação de propriedade de instância antes de qualquer operação
- Service Role Key usado apenas no backend (nunca exposta ao frontend)
- Constraint de deduplicação na fila para evitar envio duplicado

---

## 9. Integrações Externas

### 9.1 Evolution API

**Versão:** v2
**Protocolo:** REST API + Webhooks
**Endpoints utilizados:**

| Ação | Método | Endpoint |
|------|--------|----------|
| Criar instância | POST | `/instance/create/{name}` |
| Verificar conexão | GET | `/instance/connectionState/{name}` |
| Buscar QR Code | GET | `/instance/connect/{name}` |
| Enviar texto | POST | `/message/sendText/{name}` |
| Enviar imagem | POST | `/message/sendImage/{name}` |
| Enviar vídeo | POST | `/message/sendVideo/{name}` |
| Enviar áudio | POST | `/message/sendAudio/{name}` |
| Enviar documento | POST | `/message/sendDocument/{name}` |
| Simular digitação | POST | `/chat/presence/{name}` |
| Listar grupos | GET | `/group/fetchAllGroups/{name}` |
| Membros do grupo | GET | `/group/participants/{name}` |
| Verificar número | POST | `/chat/whatsappNumbers/{name}` |

**Webhooks recebidos:**
- `messages.upsert` — Nova mensagem
- `messages.update` — Atualização de status de entrega

### 9.2 pg_cron + pg_net

**Configuração:**
```sql
-- Executa process-whatsapp-queue a cada minuto
SELECT cron.schedule(
  'process-wa-queue',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://{project_id}.supabase.co/functions/v1/process-whatsapp-queue',
    headers := '{"Authorization": "Bearer {service_role_key}", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

---

## Navegação no Menu

O módulo WhatsApp está organizado na sidebar sob a seção **💬 WhatsApp**:

| Item | Rota | Ícone |
|------|------|-------|
| Inbox | `/whatsapp/inbox` | 📥 Inbox |
| Campanhas | `/whatsapp/campaigns` | 📢 Megaphone |
| Analytics | `/whatsapp/analytics` | 📊 BarChart3 |
| Automações | `/whatsapp/automations` | ⚡ Zap |
| Extrator de Grupos | `/whatsapp/groups` | 👥 Users |
| Extrator de Contatos | `/whatsapp/contacts` | 📇 Contact |
| Disparo em Massa | `/whatsapp/broadcast` | 📤 Send |

---

## Resumo de Arquivos

### Frontend
| Arquivo | Linhas | Descrição |
|---------|--------|-----------|
| `src/pages/WhatsAppInbox.tsx` | 500 | Inbox unificado com chat |
| `src/pages/WhatsAppCampaigns.tsx` | 441 | Gerenciamento de campanhas |
| `src/pages/WhatsAppAnalytics.tsx` | ~300 | Dashboard de analytics |
| `src/pages/WhatsAppAutomations.tsx` | 271 | Automações pós-resposta |
| `src/pages/WhatsAppGroups.tsx` | 384 | Extrator de grupos |
| `src/pages/WhatsAppContacts.tsx` | 765 | Gestão de contatos |
| `src/pages/WhatsAppBroadcast.tsx` | 433 | Disparo em massa |
| `src/components/whatsapp/CampaignFormDialog.tsx` | ~200 | Dialog de criação de campanha |

### Backend (Edge Functions)
| Arquivo | Descrição |
|---------|-----------|
| `supabase/functions/create-evolution-instance/` | Criação de instância |
| `supabase/functions/test-evolution-connection/` | Teste de conexão |
| `supabase/functions/get-evolution-qrcode/` | QR Code |
| `supabase/functions/extract-google-maps-leads/` | Extração Google Maps |
| `supabase/functions/wa-extract-groups/` | Extração de grupos |
| `supabase/functions/sanitize-contacts/` | Sanitização de contatos |
| `supabase/functions/enqueue-campaign/` | Enfileiramento de campanha |
| `supabase/functions/process-whatsapp-queue/` | Motor de disparo |
| `supabase/functions/wa-inbox-webhook/` | Webhook de recebimento |
| `supabase/functions/wa-send-reply/` | Envio de resposta do inbox |

### Banco de Dados (7 tabelas)
`wa_instances`, `wa_contact_lists`, `wa_contacts`, `wa_campaigns`, `wa_queue`, `wa_inbox`, `wa_automations`

---

*Documento gerado em 13/03/2026 — HumanizeAI TF*
