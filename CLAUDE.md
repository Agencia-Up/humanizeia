# CLAUDE.md — Logos IA Platform
> Arquivo de referência para o assistente Claude Code.
> Leia este arquivo inteiro antes de qualquer modificação no projeto.

---

## 🛑 0. REGRA INVIOLÁVEL DE DEPLOY (ler ANTES de qualquer coisa)

**Toda alteração técnica segue OBRIGATORIAMENTE este fluxo:**

1. **Implementar em STAGING** — projeto Supabase `ezoltigtqgbmftmiwjxh`, branch git `staging`. Migrations via `scripts/supabase-logosia-staging.cmd`, deploy de edge function via mesmo wrapper, push pra `staging`.
2. **PARAR. Aguardar validação manual** do usuário no app de staging (`logos-ia-logosia-baseteste.pqaykh.easypanel.host`). O usuário precisa testar e confirmar EXPLICITAMENTE no chat ("ok pode promover pra prod", "promove", "subir prod" ou similar com sentido inequívoco).
3. **Só DEPOIS da aprovação explícita:** aplicar migration em PROD (`seyljsqmhlopkcauhlor` via `scripts/supabase-logosia.cmd`), deploy de edge function PROD, e merge `staging → main` + push (dispara rebuild EasyPanel prod).

### ❌ NUNCA fazer

- Deploy direto em PROD sem etapa STAGING + validação prévia.
- Assumir que "ok" genérico significa "promove pra prod" — sempre confirmar via AskUserQuestion se houver qualquer ambiguidade.
- Aplicar migration em PROD usando `scripts/supabase-logosia-staging.cmd` (apontaria pra staging) ou vice-versa.
- Acumular múltiplas mudanças e mandar pacote pra prod sem aprovação item-a-item (a menos que o usuário explicitamente diga "promove tudo").
- Pular o backup do `supabase/.temp/project-ref` antes de re-linkar CLI entre staging/prod.

### ✅ SEMPRE fazer

- Confirmar status do link CLI (`cat supabase/.temp/project-ref`) antes de qualquer comando `db query` ou `functions deploy`.
- Backup do link de staging antes de re-linkar pra prod (`cp project-ref project-ref.staging-backup`).
- Re-linkar de volta no staging após terminar trabalho em prod (volta pro fluxo padrão).
- Commit em `staging` ANTES de validar prod (rastreável + facilita rollback).
- Verificar via SELECT pós-migration que a mudança foi aplicada (ex: `SELECT column_name FROM information_schema.columns WHERE ...`).

### 🚨 Exceção única

Se houver **bug crítico em produção** já reportado (ex: vazamento de dados, RLS quebrada, vendedores totalmente bloqueados), a auditoria/correção segue o protocolo normal STAGING-primeiro, mas pode ser priorizada acima de outras tasks. O fluxo STAGING → validação → PROD permanece inviolável mesmo em emergência.

---

## 1. PROJECT OVERVIEW

**Logos IA Platform** é uma plataforma SaaS de agência de marketing digital autônoma, orquestrada por 9 agentes de Inteligência Artificial especializados. Cada agente cobre uma disciplina do marketing digital e trabalha em conjunto sob coordenação do **Salomão** (orquestrador central).

- **Repositório:** `Agencia-Up/humanizeia`
- **Versão:** `1.0.0`
- **Supabase Project:** `seyljsqmhlopkcauhlor`
- **URL Supabase:** `https://seyljsqmhlopkcauhlor.supabase.co`
- **Branch ativo:** `dev-wander` → merge → `main`

### Fluxo de Orquestração
```
CLIENTE
  └─▶ SALOMÃO (recebe briefing, armazena base de conhecimento)
        └─▶ DANIEL (recebe base → monta estratégia)
              └─▶ SALOMÃO (recebe estratégia → distribui tarefas)
                    ├─▶ JOSÉ    (tráfego pago)
                    ├─▶ PAULO   (copywriting)
                    ├─▶ MARIA   (design criativo)
                    ├─▶ DAVI    (social media)
                    ├─▶ JOÃO    (email marketing)
                    ├─▶ LUCAS   (funil de vendas)
                    └─▶ MARCOS  (leads + WhatsApp)
```

### Metodologia Central
Todos os agentes operam sobre a metodologia **AIDA**:
- **A**tenção → JOSÉ + MARIA + DAVI + PAULO (hooks/headlines)
- **I**nteresse → PAULO + DAVI + JOÃO + MARIA
- **D**esejo → PAULO + JOÃO + LUCAS + MARCOS
- **A**ção → MARCOS + LUCAS + PAULO + JOÃO

---

## 2. TECH STACK

### Frontend
| Tecnologia | Versão | Uso |
|---|---|---|
| React | 18 | Framework UI principal |
| TypeScript | 5.x | Tipagem estática (obrigatório) |
| Vite | 5.x | Build tool |
| Tailwind CSS | 3.x | Estilização utilitária |
| shadcn/ui | latest | Componentes de UI (Radix + Tailwind) |
| React Router | 6.x | Roteamento SPA |
| Zustand | 5.x | Estado global (`useAppStore`) |
| React Flow (reactflow) | 11.x | Fluxogramas interativos (Daniel) |
| Recharts | 2.x | Gráficos e dashboards |
| Framer Motion | 6.x | Animações |
| @hello-pangea/dnd | latest | Drag-and-drop (FluxCRM Kanban) |
| React Joyride | latest | Tour onboarding (DESATIVADO) |

### Backend
| Tecnologia | Uso |
|---|---|
| Supabase PostgreSQL | Banco de dados principal |
| Supabase Auth | Autenticação (JWT) |
| Supabase Edge Functions | APIs serverless (Deno runtime) |
| Supabase Storage | Assets e uploads |
| Supabase Realtime | Subscriptions em tempo real |

### Inteligência Artificial
| Provider | Modelo | Uso Principal |
|---|---|---|
| Anthropic | `claude-3-5-sonnet-20241022` | Estratégia, copywriting, geração de prompts, funil |
| OpenAI | `gpt-4o` | Fallback e casos específicos |
| Google Gemini | `gemini-pro` | Fallback do claude-chat |

> ⚠️ **NUNCA use** `claude-opus-4-5` — modelo inválido que causa erro 400.
> **Modelo correto:** `claude-3-5-sonnet-20241022`

### Infraestrutura
| Item | Detalhe |
|---|---|
| Hospedagem | Vercel / Netlify (frontend) |
| CDN Edge | Supabase Edge Functions (Deno) |
| Evolution API | Instâncias WhatsApp Business |
| Resend | Envio transacional de emails |

---

## 3. AGENT ECOSYSTEM

### 👑 SALOMÃO — Orquestrador Central
- **Rota:** `/salomao`
- **Arquivo:** `src/pages/SalomaoOrchestrator.tsx`
- **Edge Functions:** `prompt-generator-api`, `claude-strategy`
- **Responsabilidades:**
  - Armazena a base de conhecimento completa de cada cliente (tabela `client_briefings`)
  - Distribui estratégia e tarefas para todos os outros agentes
  - Gera system prompts completos via IA (7 seções: Negócio, ICP, Oferta, Funil, Comunicação, Provas, Regras)
  - Orquestra o dashboard de execução (`BusinessBriefing`, `OrchestratorDashboard`, `ExecutionTimeline`)
- **Abas:** Equipe de Agentes | ⚡ Gerador de Prompt IA
- **Recursos Críticos (NUNCA REMOVER):**
  - **Base de Conhecimento Dinâmica:** Modal para treinamento individual de cada agente (tabela `agent_knowledge`).
  - **Seletor de IA Engine:** Permite escolher entre OpenAI e Anthropic para a geração de prompts.
  - **Integração Backend:** O campo `ai_provider` é obrigatório na chamada da Edge Function `prompt-generator-api` para que ela concatene o conhecimento dos agentes.

---

### 🧠 DANIEL — Estrategista de Negócio
- **Rota:** `/daniel`
- **Arquivo:** `src/pages/DanielEstrategia.tsx`
- **Edge Functions:** `daniel-strategy-api`, `claude-chat` (context: `assistant`)
- **Responsabilidades:**
  - Recebe base de conhecimento do Salomão e monta estratégia de vendas
  - Devolve estratégia ao Salomão para distribuição
  - **Fluxograma Funnelytics interativo** (React Flow):
    - Canvas com zoom, pan e minimap
    - Paleta drag-and-drop com 14 tipos de nós
    - Conexões dinâmicas entre nós
    - Gaveta de edição lateral por nó
    - Cores AIDA: Vermelho/Amarelo/Verde/Azul/Roxo
    - Persistência no Supabase (tabela `funnel_flows`)
- **Abas:** Estratégia | 🗺️ Fluxograma de Vendas

---

### 🎯 JOSÉ — Tráfego Pago
- **Rota:** `/apollo`
- **Arquivo:** `src/pages/ApolloDashboard.tsx`
- **Edge Functions:** `apollo-agent`, `apollo-analyze`, `apollo-cron-runner`, `apollo-measure-outcomes`, `meta-api`, `meta-oauth`, `google-ads-api`, `google-ads-oauth`
- **Responsabilidades:**
  - Gestão autônoma de campanhas Meta Ads e Google Ads
  - Dashboard de métricas em tempo real (CPA, ROAS, CTR, CPM)
  - Recomendações automáticas de otimização
  - Análise com benchmarks do setor

---

### ✍️ PAULO — Copywriter IA
- **Rotas:** `/copywriter` e `/paulo`
- **Arquivo:** `src/pages/PauloAgente.tsx`
- **Edge Functions:** `claude-chat` (context: `paulo`)
- **Responsabilidades:**
  - Interface chat inteligente — **SEM formulários de briefing**
  - Contexto do cliente carregado invisível via Salomão (tabela `client_briefings`)
  - Termômetro de Estilo: Profissional / Persuasivo / Agressivo / Descontraído / Zoeira
  - Intensidade: Leve / Médio / Forte
  - Plataformas: Meta Ads / Google / WhatsApp / Email / SMS
  - 6 atalhos rápidos: Criar Anúncio, Variações, Melhorar Copy, Hook, CTA, Objeções
  - Análise de referências externas (URL ou texto)
  - Biblioteca de copies salvas

#### ⚡ Regra do Contexto Invisível (CRÍTICO)
```
PAULO NUNCA pede briefing ou informações básicas ao usuário.
O contexto é injetado automaticamente no system prompt via:

1. Frontend consulta client_briefings WHERE user_id = auth.uid()
   ORDER BY created_at DESC LIMIT 1
2. Monta string contextStr com: clientName, produto, publico, oferta, diferencial
3. Injeta em config.description ao chamar claude-chat
4. O system prompt do Paulo em claude-chat lê {{CLIENT_CONTEXT}}

Se não houver briefing cadastrado → usa DEMO_CLIENT (modo demo com badge amarelo)
```

---

### 🎨 MARIA — Design Criativo
- **Rota:** `/creative-studio`
- **Arquivo:** `src/pages/AICreativeStudio.tsx`
- **Edge Functions:** `generate-creative`, `edit-image`, `remove-bg`
- **Responsabilidades:**
  - Geração de criativos com IA generativa
  - Edição de imagens e remoção de fundo
  - Biblioteca de assets visuais

---

### 📱 DAVI — Social Media
- **Rota:** `/davi`
- **Arquivo:** `src/pages/DaviSocialMedia.tsx`
- **Edge Functions:** `social-media-api`
- **Responsabilidades:**
  - Gestão de conteúdo para redes sociais
  - Calendário editorial com IA
  - Criação de posts e legendas

---

### 📧 JOÃO — Email Marketing
- **Rota:** `/email`
- **Arquivo:** `src/pages/JoaoEmail.tsx`
- **Edge Functions:** `joao-email-api`, `send-email`
- **Responsabilidades:**
  - Criação de campanhas de email
  - Sequências automáticas de nutrição
  - Templates transacionais via Resend

---

### 🔀 LUCAS — Funil de Vendas
- **Rota:** `/lucas`
- **Arquivo:** `src/pages/LucasFunil.tsx`
- **Edge Functions:** `lucas-funnel-api`
- **Responsabilidades:**
  - Construtor visual de funil (barras em cascata com cálculo de conversão)
  - 6 templates de funil prontos (Lançamento, Perpétuo, B2B, Saúde, Auto, E-commerce)
  - Gerador de copy para landing page via Anthropic
  - Dashboard de métricas de conversão (Recharts)
- **Abas:** Construtor de Funil | Modelos | Copy de LP | Métricas

---

### 💬 MARCOS — Leads & WhatsApp
- **Rotas:** `/crm`, `/leads`, `/whatsapp/*`
- **Arquivos:** `src/pages/FluxCRM.tsx`, `src/pages/WhatsApp*.tsx`
- **Edge Functions:** `crm-capture`, `wa-inbox-webhook`, `wa-send-reply`, `wa-extract-groups`, `wa-capi-track-lead`, `wa-capi-process-queue`, `process-whatsapp-queue`, `create-evolution-instance`, `get-evolution-qrcode`, `verify-instance-status`, `handle-instance-ban`
- **Responsabilidades:**
  - CRM Kanban (FluxCRM) com drag-and-drop
  - **Toda a estrutura WhatsApp Business** (Instâncias, Inbox, Disparo em Massa, Analytics, Automações, Agente IA, CAPI)
  - Extração de contatos e qualificação de leads
  - MARCOS é o único responsável pelo WhatsApp — nenhum outro agente gerencia este canal

---

## 4. CODE STYLE & STANDARDS

### TypeScript
```typescript
// ✅ CORRETO — sempre tipagem explícita
interface AgentConfig {
  name: string;
  role: string;
  model: 'claude-3-5-sonnet-20241022';
}

// ❌ ERRADO — nunca usar 'any' explicitamente
// const data: any = {};

// Para tabelas não tipadas no Supabase, usar 'as any' no from():
const { data } = await supabase.from('nova_tabela' as any).select('*');
```

### Componentes
```typescript
// ✅ Sempre functional components com export default
export default function NomePagina() {
  return <MainLayout>...</MainLayout>;
}

// ✅ Memo apenas para componentes pesados renderizados em listas
const AgentCard = memo(({ agent }: { agent: Agent }) => { ... });
AgentCard.displayName = 'AgentCard';

// ✅ Lazy loading obrigatório para todas as páginas em App.tsx
const NovaPagina = lazy(() => import('./pages/NovaPagina'));
```

### Hooks
```typescript
// ✅ Padrão de hook customizado
export function useNomeHook() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    // fetch data
  }, [user]);

  return { data, loading };
}
```

### Estado Global (Zustand)
```typescript
import { useAppStore } from '@/store/appStore';

// Disponível em qualquer componente:
const { isDarkMode, toggleDarkMode } = useAppStore();
const { showProductTour, setShowProductTour } = useAppStore();
const { sidebarOpen, setSidebarOpen } = useAppStore();

// Persiste automaticamente: isDarkMode, sidebarOpen, openSidebarGroups, pollingIntervalMinutes
```

### Autenticação
```typescript
import { useAuth } from '@/hooks/useAuth';

const { user, signIn, signUp, signOut, loading } = useAuth();

// Proteger rotas:
<Route path="/rota" element={<ProtectedRoute><Pagina /></ProtectedRoute>} />
```

### Supabase Client
```typescript
import { supabase } from '@/integrations/supabase/client';

// Query padrão:
const { data, error } = await supabase
  .from('tabela')
  .select('*')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });

// Para tabelas sem tipo definido (criadas por migration):
const { data } = await supabase.from('funnel_flows' as any).select('*');
```

### Edge Functions (Deno)
```typescript
// Padrão obrigatório para toda edge function:
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // Auth obrigatória:
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    // Lógica aqui...

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

### Chamada de Edge Function no Frontend
```typescript
const { data, error } = await supabase.functions.invoke('nome-da-funcao', {
  body: { action: 'acao', payload: {} },
});
if (error) throw new Error(error.message);
```

### UI/UX — Padrões de Design
```typescript
// Tema dark (padrão):
// bg-background, text-foreground, border-border/50
// Accent: violet (Paulo), orange (Lucas/José), blue (Daniel), emerald (Marcos)

// Header padrão de agente:
<div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500/20 to-purple-600/20
     border border-violet-500/30 flex items-center justify-center">
  <Icon className="h-5 w-5 text-violet-400" />
</div>

// Badge de status "Online":
<Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30 text-[10px]">
  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse mr-1.5 inline-block" />
  Agente Online
</Badge>

// Toast para feedbacks:
import { useToast } from '@/hooks/use-toast';
const { toast } = useToast();
toast({ title: '✅ Sucesso!', description: 'Operação concluída.' });
toast({ title: 'Erro', description: err.message, variant: 'destructive' });
```

### Sidebar — Grupos de Navegação
```typescript
// src/components/layout/AppSidebar.tsx
// Grupos existentes (em ordem):
// 🏠 Dashboard
// 🤖 Agentes IA  ← todos os 9 agentes aqui
// 🛠️ Ferramentas ← ferramentas (não agentes)
// 🔗 Integrações
// 💬 WhatsApp
// ⚙️ Sistema

// Para adicionar item ao sidebar:
// 1. Adicionar ao array correto (agentItems, aiItems, systemItems, etc.)
// 2. Importar o ícone de 'lucide-react'
// 3. NÃO criar novo grupo — usar os existentes
```

### Dark Mode
```typescript
// Toggle disponível em qualquer componente:
const { isDarkMode, toggleDarkMode } = useAppStore();

// Ícone correto:
{isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}

// Sempre presente em: AppSidebar, LandingPage (header), Auth (fixed top-right)
```

---

## 5. DATABASE SCHEMA

### Tabelas Principais

#### Agentes & Orquestração
| Tabela | Descrição | Agente |
|---|---|---|
| `client_briefings` | Base de conhecimento dos clientes — alimenta todos os agentes | Salomão |
| `orchestrator_tasks` | Tarefas distribuídas entre agentes | Salomão |
| `agent_executions` | Log de execuções e resultados por agente | Salomão |
| `followup_queue` | Fila de follow-ups automáticos | Salomão/Marcos |
| `generated_prompts` | System prompts gerados pelo Gerador de Prompt | Salomão |
| `funnel_flows` | Fluxogramas salvos no editor do Daniel | Daniel |

#### CRM & Leads (Marcos)
| Tabela | Descrição |
|---|---|
| `crm_leads` | Leads no pipeline de vendas |
| `crm_pipeline_stages` | Etapas do kanban (personalizáveis) |
| `crm_pipelines` | Pipelines por usuário/organização |
| `crm_activities` | Histórico de atividades por lead |

#### WhatsApp (Marcos)
| Tabela | Descrição |
|---|---|
| `wa_instances` | Instâncias WhatsApp (Evolution API) |
| `wa_inbox` | Mensagens recebidas |
| `wa_contacts` | Contatos cadastrados |
| `wa_contact_lists` | Listas de contatos para disparo |
| `wa_campaigns` | Campanhas de disparo em massa |
| `wa_queue` | Fila de mensagens para envio |
| `wa_automations` | Regras de automação |
| `wa_ai_agents` | Configurações do Agente IA |
| `wa_capi_funnel` | Eventos de conversão CAPI |
| `wa_audit_logs` | Logs de auditoria |
| `wa_tags` | Tags de segmentação de contatos |
| `whatsapp_config` | Configurações globais do WhatsApp |
| `whatsapp_destinatarios` | Destinatários de campanhas |

#### Campanhas & Anúncios (José)
| Tabela | Descrição |
|---|---|
| `campaigns` | Campanhas de tráfego |
| `campaign_metrics` | Métricas diárias por campanha |
| `ad_accounts` | Contas de anúncio conectadas |
| `meta_pixels` | Pixels Meta configurados |
| `meta_capi_events` | Eventos CAPI enviados |
| `meta_capi_batches` | Lotes de eventos CAPI |
| `meta_cache` | Cache de dados Meta Ads |
| `audiences` | Públicos salvos |

#### Copy & Criativo (Paulo / Maria)
| Tabela | Descrição |
|---|---|
| `copies` | Copies geradas e salvas |
| `copy_formulas` | Frameworks de copy (PAS, AIDA, etc.) |
| `copy_performance` | Métricas de performance por copy |
| `swipe_files` | Biblioteca de referências (Paulo) |
| `creatives` | Criativos gerados |
| `creative_uploads` | Uploads de imagens |
| `creative_performance` | Performance por criativo |

#### Apollo/Midas (José — análise avançada)
| Tabela | Descrição |
|---|---|
| `apollo_conversations` | Histórico de análises |
| `apollo_messages` | Mensagens do chat Apollo |
| `apollo_recommendations` | Recomendações geradas |
| `apollo_diagnostics` | Diagnósticos de campanha |
| `apollo_alerts` | Alertas automáticos |
| `apollo_health_scores` | Saúde das contas |
| `apollo_benchmarks` | Benchmarks do setor |
| `apollo_learning` | Aprendizado do agente |
| `apollo_action_log` | Log de ações executadas |

#### A/B Testing & Inteligência
| Tabela | Descrição |
|---|---|
| `ab_tests` | Testes A/B configurados |
| `ab_test_variants` | Variantes por teste |
| `ai_insights` | Insights gerados por IA |
| `ai_learnings` | Aprendizados acumulados |
| `competitor_ads` | Anúncios de concorrentes monitorados |

#### Automações & Regras
| Tabela | Descrição |
|---|---|
| `automation_rules` | Regras de automação de campanha |
| `rule_execution_log` | Log de execução de regras |
| `external_webhooks` | Webhooks configurados |
| `webhook_logs` | Logs de webhooks |
| `notifications` | Notificações do sistema |

#### Datastores (Base de Conhecimento)
| Tabela | Descrição |
|---|---|
| `datastores` | Bases de conhecimento criadas |
| `datastore_sources` | Fontes de dados (URLs, PDFs) |
| `datastore_chunks` | Chunks vetorizados para busca |

#### Organização & Usuários
| Tabela | Descrição |
|---|---|
| `profiles` | Perfis de usuário |
| `organizations` | Organizações/agências |
| `organization_members` | Membros por organização |
| `organization_invites` | Convites pendentes |

#### Relatórios & Histórico
| Tabela | Descrição |
|---|---|
| `report_templates` | Templates de relatório |
| `saved_reports` | Relatórios salvos |
| `historico_reports` | Histórico de relatórios enviados |
| `activity_log` | Log geral de atividades |

#### E-commerce & Integrações
| Tabela | Descrição |
|---|---|
| `shopify_orders` | Pedidos Shopify |
| `shopify_daily_metrics` | Métricas diárias Shopify |
| `platform_integrations` | Integrações ativas por usuário |
| `capture_forms` | Formulários de captura |
| `capture_form_submissions` | Submissões de formulários |

### Funções SQL Disponíveis
```sql
create_organization_with_owner(name, user_id)
decrement_instance_health(instance_id)
increment_campaign_delivered(campaign_id)
increment_consecutive_undelivered(instance_id)
is_org_member(org_id, user_id) → boolean
is_org_owner(org_id, user_id) → boolean
search_datastore_chunks(query, datastore_id, match_count)
search_datastore_fulltext(query, datastore_id)
```

### RLS (Row Level Security)
Todas as tabelas têm RLS habilitado. Padrão:
```sql
-- Usuário só vê seus próprios dados:
USING (auth.uid() = user_id)
-- Membros de organização veem dados da org:
USING (is_org_member(org_id, auth.uid()))
```

---

## 6. EDGE FUNCTIONS (49 funções)

### Mapeamento por Agente

#### Salomão / Orquestração
| Função | Ação Principal |
|---|---|
| `prompt-generator-api` | Gera system prompts completos via Anthropic. Model: `claude-3-5-sonnet-20241022` |
| `claude-strategy` | Análise estratégica genérica |
| `claude-chat` | Chat multi-contexto: `paulo`, `copywriter`, `assistant`, `optimizer`, `insights`, `creative`, `midas` |

#### Daniel
| Função | Ação Principal |
|---|---|
| `daniel-strategy-api` | Estratégia de negócio e análise competitiva |

#### José (Apollo/Tráfego)
| Função | Ação Principal |
|---|---|
| `apollo-agent` | Agente autônomo de gestão Meta Ads |
| `apollo-analyze` | Análise profunda de campanhas |
| `apollo-cron-runner` | Execução programada de análises |
| `apollo-measure-outcomes` | Medição de resultados e aprendizado |
| `meta-api` | Chamadas diretas à API do Meta |
| `meta-oauth` | Fluxo OAuth com Meta |
| `meta-capi-send` | Envio de eventos CAPI para Meta |
| `meta-capi-track` | Rastreamento de eventos de conversão |
| `google-ads-api` | Integração com Google Ads API |
| `google-ads-oauth` | OAuth com Google Ads |
| `jose-debug` | Debug e diagnóstico do José |

#### Paulo (Copywriting)
| Função | Ação Principal |
|---|---|
| `claude-chat` (context: `paulo`) | Chat de copywriting com contexto invisível do cliente |

#### Lucas (Funil de Vendas)
| Função | Ação Principal |
|---|---|
| `lucas-funnel-api` | Gera copy completo de landing page via Anthropic |

#### Maria (Design)
| Função | Ação Principal |
|---|---|
| `generate-creative` | Geração de criativos com IA |
| `edit-image` | Edição de imagens |
| `remove-bg` | Remoção de fundo de imagens |

#### Davi (Social Media)
| Função | Ação Principal |
|---|---|
| `social-media-api` | Gestão de conteúdo para redes sociais |

#### João (Email)
| Função | Ação Principal |
|---|---|
| `joao-email-api` | Gestão de campanhas de email |
| `send-email` | Envio transacional via Resend (boas-vindas, reset, relatórios) |

#### Marcos (Leads & WhatsApp)
| Função | Ação Principal |
|---|---|
| `crm-capture` | Captura de leads via formulários externos |
| `wa-inbox-webhook` | Webhook para mensagens WhatsApp recebidas |
| `wa-send-reply` | Envio de respostas via WhatsApp |
| `wa-extract-groups` | Extração de grupos e contatos WhatsApp |
| `wa-capi-track-lead` | Rastreamento de leads via CAPI |
| `wa-capi-process-queue` | Processamento de fila CAPI |
| `process-whatsapp-queue` | Processamento de fila de mensagens |
| `create-evolution-instance` | Cria instância WhatsApp na Evolution API |
| `get-evolution-qrcode` | Obtém QR Code para conexão WhatsApp |
| `verify-instance-status` | Verifica status da instância |
| `handle-instance-ban` | Trata banimentos de instância |
| `sanitize-contacts` | Validação e limpeza de contatos |
| `extract-google-maps-leads` | Extração de leads via Google Maps |

#### Campanhas & Automação
| Função | Ação Principal |
|---|---|
| `save-campaign` | Salva configuração de campanha |
| `enqueue-campaign` | Coloca campanha na fila de envio |
| `campaign-executor` | Executa campanhas de disparo |
| `setup-webhooks` | Configura webhooks externos |

#### Relatórios & Analytics
| Função | Ação Principal |
|---|---|
| `send-whatsapp-report` | Envia relatório via WhatsApp |
| `enviar-report-midas` | Relatório Midas/Apollo |

#### Integrações Externas
| Função | Ação Principal |
|---|---|
| `linkedin-ads-api` | Integração LinkedIn Ads API |
| `linkedin-ads-oauth` | OAuth LinkedIn Ads |
| `tiktok-oauth` | OAuth TikTok Ads |
| `shopify-integration` | Integração Shopify |
| `apply-theme` | Aplicação de tema customizado |
| `academy-ai` | IA da Academia de aprendizado |
| `test-integration` | Teste de integrações |
| `test-evolution-connection` | Teste de conexão Evolution API |

### Deploy de Edge Functions
```bash
# Deploy função individual:
npx supabase functions deploy nome-da-funcao --project-ref seyljsqmhlopkcauhlor

# Deploy múltiplas:
npx supabase functions deploy func1 func2 --project-ref seyljsqmhlopkcauhlor
```

---

## 7. GIT WORKFLOW — FLUXO BLINDADO

> ⚠️ SEMPRE seguir este fluxo. Nunca fazer push direto na `main`.

```bash
# 1. Trabalhar sempre em dev-wander
git checkout dev-wander

# 2. Fazer as alterações e commitar
git add arquivo1 arquivo2
git commit -m "feat/fix/chore: descrição clara do que foi feito"

# 3. Push no dev-wander
git push origin dev-wander

# 4. Merge para main
git checkout main
git pull origin main
git merge dev-wander --no-edit
git push origin main

# 5. Voltar para dev-wander
git checkout dev-wander
```

### Convenção de Commits
```
feat: nova funcionalidade
fix: correção de bug
chore: configuração, dependências, sem código de produção
refactor: refatoração sem mudança de comportamento
docs: documentação
style: formatação, sem mudança de lógica
```

---

## 8. SECRETS CONFIGURADAS (Supabase)

| Secret | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Claude 3.5 Sonnet — todos os agentes IA |
| `OPENAI_API_KEY` | GPT-4o — fallback e casos específicos |
| `LINKEDIN_CLIENT_ID` | OAuth LinkedIn Ads (`771ochksli5p4j`) |
| `LINKEDIN_CLIENT_SECRET` | OAuth LinkedIn Ads |
| `SUPABASE_URL` | URL do projeto (interna nas edge functions) |
| `SUPABASE_SERVICE_ROLE_KEY` | Acesso admin nas edge functions |

> Para atualizar secrets:
> ```bash
> npx supabase secrets set NOME_SECRET="valor" --project-ref seyljsqmhlopkcauhlor
> ```

---

## 9. SUBSCRIPTION & TOKENS

### Planos
| Plano | Preço | Tokens/mês |
|---|---|---|
| Básico | R$ 497 | 50.000 |
| Pro | R$ 997 | 150.000 |
| Enterprise | R$ 2.497 | 500.000 |

### TokenWidget
- **Topbar:** `src/components/subscription/TokenWidget.tsx` — barra de progresso com cores (verde → amarelo → vermelho)
- **Sidebar Footer:** `TokenWidgetCompact` — versão compacta quando sidebar expandida
- Ambos navegam para `/meu-plano` ao clicar
- Hook: `src/hooks/useSubscription.ts`

---

## 10. VARIÁVEIS DE AMBIENTE (`.env`)

```env
VITE_SUPABASE_PROJECT_ID="seyljsqmhlopkcauhlor"
VITE_SUPABASE_URL="https://seyljsqmhlopkcauhlor.supabase.co"
VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

> ⚠️ O `.env` aponta para o projeto correto `seyljsqmhlopkcauhlor`.
> O projeto antigo (`qrxsiixufdiemwwyhxvd`) foi abandonado — nunca referenciar.

---

## 11. PONTOS DE ATENÇÃO & REGRAS CRÍTICAS

### ❌ NUNCA FAZER
1. Usar o modelo `claude-opus-4-5` — é inválido, causa erro 400
2. Push direto na branch `main`
3. Remover `ProtectedRoute` de rotas de agentes
4. Fazer Paulo pedir briefing ao usuário
5. Apontar para o projeto Supabase antigo (`qrxsiixufdiemwwyhxvd`)
6. Usar `stream: true` na chamada do Paulo (usa `stream: false`)
7. Alterar o `TOUR_STORAGE_KEY` ou reativar o auto-start do `ProductTour`
8. **REMOVER** os botões de "Base de Dados dos Agentes" ou "IA Engine" no SalomaoOrchestrator.tsx
9. **REMOVER** o parâmetro `ai_provider` da chamada da Edge Function `prompt-generator-api` no frontend.

### ✅ SEMPRE FAZER
1. Lazy import todas as novas páginas em `App.tsx`
2. Envolver rotas de agentes com `<ProtectedRoute>`
3. Usar `as any` quando a tabela não está nos tipos Supabase gerados
4. Seguir o fluxo blindado git (`dev-wander → main`)
5. Fazer deploy da edge function após qualquer alteração nela
6. Testar com usuário autenticado (funções rejeitam token anon)
7. Manter identidade visual por agente (cor + ícone consistentes)

### Identidade Visual dos Agentes
| Agente | Cor | Ícone Lucide |
|---|---|---|
| Salomão | amber/yellow | `Crown`, `Sparkles` |
| Daniel | blue/indigo | `Brain`, `TrendingUp` |
| José | orange/red | `Target`, `Zap` |
| Paulo | violet/purple | `PenTool` |
| Maria | pink/rose | `Palette`, `Wand2` |
| Davi | sky/cyan | `Instagram`, `Camera` |
| João | emerald/teal | `Mail`, `Send` |
| Lucas | orange/amber | `Layers`, `Filter` |
| Marcos | purple/violet | `Users`, `MessageSquare` |

---

*Última atualização: 26/03/2026 — Sessão Claude Code (dev-wander)*
*Mantido por: Agencia-Up / Logos IA Team*
