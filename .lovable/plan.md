

## Por que o Claude não aparece na lista de modelos

O array `MODEL_OPTIONS` na linha 86-92 de `AgentFormDialog.tsx` lista apenas modelos do Lovable AI Gateway (Gemini e GPT-5). O Claude (Anthropic) não está incluído porque o Gateway não oferece modelos Anthropic diretamente.

No entanto, o projeto já possui a `ANTHROPIC_API_KEY` configurada e o edge function `claude-chat` já faz chamadas diretas à API da Anthropic. O agente de WhatsApp usa um edge function separado (`wa-inbox-webhook` ou similar) que pode ou não usar essa lógica.

## Plano

### 1. Adicionar Claude como opção no formulário do agente
Adicionar ao array `MODEL_OPTIONS` em `AgentFormDialog.tsx`:
```
{ value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (Premium)' }
```

### 2. Garantir que o backend do agente WhatsApp suporte o modelo Claude
Verificar o edge function que processa respostas do agente (`wa-inbox-webhook` ou equivalente) e garantir que, quando `model` começar com `anthropic/`, a chamada seja feita diretamente à API da Anthropic usando a `ANTHROPIC_API_KEY` já configurada — ao invés de enviar para o Lovable AI Gateway que não suporta modelos Anthropic.

### Arquivos afetados
- `src/components/whatsapp/AgentFormDialog.tsx` — adicionar opção Claude ao select
- Edge function do agente WhatsApp — adicionar roteamento para Anthropic quando o modelo selecionado for Claude

