

## Plano: Melhorias na Página de Campanhas WhatsApp (Passo 3)

A página de campanhas (`WhatsAppCampaigns.tsx`) já existe com funcionalidades básicas: criar, listar, iniciar, pausar e excluir. O `enqueue-campaign` Edge Function também já funciona. Vou identificar o que falta do Passo 3 e implementar.

### O que já existe
- Criação de campanha com nome, listas, prompt IA, mensagem fixa, delay e rodízio
- Pré-visualização de variações IA via Claude
- Tabela de campanhas com status, contagem e ações (play/pause/delete)
- Edge Function `enqueue-campaign` que enfileira contatos na `wa_queue`

### O que falta implementar

**1. Edição de Campanhas**
- Adicionar botão "Editar" nas ações da tabela (apenas para campanhas em `draft` ou `paused`)
- Reutilizar o dialog de criação, pré-populando os campos com os dados da campanha
- Salvar via `update` ao invés de `insert`

**2. Agendamento de Campanhas**
- A tabela `wa_campaigns` já tem `scheduled_at` -- adicionar campo de data/hora no formulário para agendar início
- Exibir horário agendado na tabela de listagem

**3. Seleção de Instância WhatsApp**
- A tabela já tem `instance_id` -- adicionar seletor de instância no formulário
- Buscar instâncias disponíveis da tabela `wa_instances`
- Permitir "automático" (rodízio entre todas) ou selecionar uma específica

**4. Anexo de Mídia**
- A tabela já tem `media_url` e `media_type` -- adicionar campo de URL de mídia no formulário
- Seletor de tipo (imagem, vídeo, documento, áudio)

**5. Tags de Campanha**
- A tabela já tem `tags` -- adicionar campo de tags no formulário

**6. Métricas e Progresso**
- Adicionar barra de progresso visual (sent_count / total_contacts) na tabela
- Mostrar `delivered_count` e `failed_count` em tooltip ou expandindo a linha

### Arquivos a modificar

| Arquivo | Mudança |
|---|---|
| `src/pages/WhatsAppCampaigns.tsx` | Adicionar edição, agendamento, seleção de instância, mídia, tags, progresso |

Nenhuma migração de banco necessária -- todos os campos já existem na tabela `wa_campaigns`.

