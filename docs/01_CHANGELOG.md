# Histórico de Alterações e Melhorias (Changelog)

Este documento centraliza todas as atualizações, correções e novas funcionalidades implementadas com sucesso no ecossistema HumanizeAI.

---

## 📅 Versão 1.1.0 - Módulo CRM e Automações (Março 2026)

### ✨ Novas Funcionalidades (Features)
- **Integração de Webhooks no CRM:** O painel de `FluxCRM` agora comunica-se diretamente com sistemas externos (como n8n). Ao criar um novo Lead, um payload JSON é disparado em tempo real.
- **Novas Opções de Gatilho (Triggers):** Adicionado o evento `"Novo lead criado no FluxCRM"` na aba de Automações de WhatsApp.
- **Campos de Mapeamento de Vendas (UTM):** O modal de criação/edição de Leads (`LeadFormDialog.tsx`) agora suporta campos críticos para rastreamento de anúncios: `utm_source` e `utm_campaign`.
- **Previsão de Retorno (Follow-up):** Adicionado o campo `Data de Follow-up` diretamente no cartão do Lead, preparando o terreno para agendamentos futuros automatizados.

### 🔧 Correções de Bugs (Bugfixes)
- **Loop Infinito no Login (Pisca-pisca):** Corrigido o erro severo de roteamento onde a página piscava infinitamente entre `/auth`, `/dashboard` e `/onboarding`. 
  - *Causa resolvida:* A limpeza de tokens antigos de sessão deletava a sessão válida por um erro de ID do projeto codificado de forma estática;
  - *Causa resolvida:* O redirecionamento de telas não aguardava o tempo de *loading* do servidor para checar a existência do usuário adequadamente, disparando redirecionamentos vazios.

### 🗄️ Banco de Dados (Database)
- **Schema `crm_leads` atualizado:** Aplicada migração SQL criando os campos estruturais `follow_up_date`, `utm_source` e `utm_campaign`.
- **Tabela `wa_instances` criada:** Fundação construída para o futuro roteador (Round Robin) das instâncias de WhatsApp.
