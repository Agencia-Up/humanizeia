import React, { lazy as reactLazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AdminRoute } from "@/components/auth/AdminRoute";
import { FEATURES } from "@/config/features";
import { Loader2 } from "lucide-react";
import { AgentTasksProvider } from "@/contexts/AgentTasksContext";
import { AgentChatProvider } from "@/contexts/AgentChatContext";

// ── lazy com re-tentativa (resiliência a piscada de rede) ───────────────────────
// O carregamento de uma tela (import dinâmico) pode falhar SÓ porque a rede
// piscou ao voltar o foco da aba (ERR_CONNECTION_CLOSED / ERR_NETWORK_CHANGED) —
// e nesses casos o navigator.onLine MENTE (continua true). Sem isto, a falha caía
// no ErrorBoundary e RECARREGAVA a página inteira, apagando o trabalho do
// cliente. Aqui a gente re-tenta o import sozinho algumas vezes com espera
// crescente: a conexão volta em 1-3s e a tela carrega normal, SEM reload. Só
// depois de ~4s de tentativas falharem (= versão realmente velha) o erro sobe
// pro ErrorBoundary. TODAS as telas (lazy(...)) abaixo passam por aqui.
function lazy<T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return reactLazy(async () => {
    let lastErr: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        return await factory();
      } catch (err) {
        lastErr = err;
        if (i < 3) await new Promise((r) => setTimeout(r, 700 * (i + 1)));
      }
    }
    throw lastErr;
  });
}

// ── Error Boundary ────────────────────────────────────────────────────────────
// Catches render errors so a broken page never crashes the entire app.
// Auto-retries transient errors (race conditions, lazy load timing) silently,
// and resets automatically when the user navigates to a different route.
const MAX_AUTO_RETRIES = 2;

// Detecta falha de carregamento de CHUNK dinamico (import() lazy). Acontece quando
// um novo deploy muda o hash do bundle e o usuario ainda esta com a aba antiga
// aberta: ao navegar para uma rota lazy, o arquivo .js antigo nao existe mais.
function isChunkLoadError(err?: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  const name = String((err as any)?.name || '');
  return name === 'ChunkLoadError' ||
    /failed to (fetch|load) dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) ||
    /dynamically imported module/i.test(msg);
}

// Recarrega a pagina UMA vez para buscar index.html + chunks novos. Guarda em
// sessionStorage pra evitar loop de reload caso o problema nao seja chunk velho.
function reloadForStaleChunk(): boolean {
  try {
    const TS_KEY = '__chunk_reload_ts';
    const N_KEY = '__chunk_reload_n';
    const last = Number(sessionStorage.getItem(TS_KEY) || '0');
    const count = Number(sessionStorage.getItem(N_KEY) || '0');
    // Recarrega no MAXIMO 2x por sessao (e no max 1x a cada 12s). Se depois de
    // 2 reloads o chunk ainda falha, PARA de recarregar — evita o "loop de
    // recarga sozinha". Ai o ErrorBoundary mostra a tela de erro com o botao
    // "Tentar novamente" em vez de ficar recarregando pra sempre.
    if (count >= 2) return false;
    if (Date.now() - last > 12000) {
      sessionStorage.setItem(TS_KEY, String(Date.now()));
      sessionStorage.setItem(N_KEY, String(count + 1));
      window.location.reload();
      return true;
    }
  } catch { /* sessionStorage indisponivel */ }
  return false;
}

// Vite dispara este evento quando o PRELOAD (de fundo) de um modulo dinamico
// falha — ex.: o bundle ficou velho apos um deploy. ANTES isso recarregava a
// pagina inteira aqui, o que apagava o que o usuario estava fazendo "sozinho",
// sem ele nem trocar de tela. Agora so SUPRIME o erro (preventDefault): a
// recuperacao de chunk velho de verdade acontece quando o usuario NAVEGA pra
// rota afetada (tratada no ErrorBoundary.componentDidCatch, que ai sim recarrega
// 1x). Nao recarregar em preload de fundo.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (e: any) => {
    e?.preventDefault?.();
  });
  // DIAGNOSTICO: marca quando a pagina REALMENTE descarrega (reload/F5 de
  // verdade). Se isto aparecer no console no momento do "reset", foi um reload
  // de verdade (e como o app nao recarrega mais sozinho, veio de FORA — navegador
  // /conexao). Se NAO aparecer, foi so a tela remontando (problema no app).
  window.addEventListener('beforeunload', () => {
    try { console.error('[PAGINA-RECARREGOU-DE-VERDADE] a aba vai descarregar agora'); } catch { /* noop */ }
  });
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey?: string },
  { hasError: boolean; autoRetries: number; renderKey: number; lastError?: Error }
> {
  private retryTimer?: ReturnType<typeof setTimeout>;

  constructor(props: { children: React.ReactNode; resetKey?: string }) {
    super(props);
    this.state = { hasError: false, autoRetries: 0, renderKey: 0 };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, lastError: error };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Page render error:', err);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);

    // ── NUNCA recarregar a pagina automaticamente ──────────────────────────
    // Este era o UNICO window.location.reload() do app inteiro, e era ele que
    // "recarregava a pagina sozinha e apagava o trabalho" quando a conexao do
    // navegador piscava (a falha de um import de rota era confundida com
    // 'versao velha'). REMOVIDO. Em vez de recarregar, o auto-retry suave abaixo
    // tenta remontar; se for chunk realmente velho, o usuario ve a tela de erro
    // com o botao "Atualizar a pagina" e decide ele mesmo (NUNCA automatico).
    void isChunkLoadError; void reloadForStaleChunk;

    // Tenta retentar automaticamente erros transientes (race conditions
    // típicas em primeiras renderizações: lazy load + hooks + queries).
    // IMPORTANTE: primeira retentativa NÃO incrementa renderKey — preserva
    // o estado da sub-árvore (URL, activeTab, etc.). Só remonta tudo a
    // partir da SEGUNDA retentativa.
    if (this.state.autoRetries < MAX_AUTO_RETRIES) {
      const attemptNumber = this.state.autoRetries + 1;
      this.retryTimer = setTimeout(() => {
        this.setState(prev => ({
          hasError: false,
          autoRetries: prev.autoRetries + 1,
          // renderKey só incrementa a partir da 2ª tentativa (preserva estado)
          renderKey: attemptNumber >= 2 ? prev.renderKey + 1 : prev.renderKey,
        }));
      }, 80);
    }
  }

  componentDidUpdate(prevProps: { children: React.ReactNode; resetKey?: string }) {
    // Auto-reset quando rota muda — próxima página parte do zero
    if (prevProps.resetKey !== this.props.resetKey) {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      if (this.state.hasError || this.state.autoRetries > 0) {
        this.setState({ hasError: false, autoRetries: 0, renderKey: 0 });
      }
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
          <p className="text-sm text-muted-foreground">
            Algo deu errado ao carregar esta página.
          </p>
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => this.setState(prev => ({
                hasError: false,
                autoRetries: 0,
                renderKey: prev.renderKey + 1,
              }))}
            >
              Tentar novamente
            </button>
            <button
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground"
              onClick={() => window.location.reload()}
            >
              Atualizar a página
            </button>
          </div>
        </div>
      );
    }
    // renderKey força React a remontar a sub-árvore após retentativa
    return <React.Fragment key={this.state.renderKey}>{this.props.children}</React.Fragment>;
  }
}

// Wraps routes with an ErrorBoundary that resets on navigation.
// NOTE: Suspense is intentionally NOT here — each lazy page provides its own
// Suspense via the <Lazy> helper below so that the global layout (sidebar,
// topbar) stays mounted during page loads and HMR re-evaluations.
function RouteWrapper({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      {children}
    </ErrorBoundary>
  );
}

// Per-route Suspense boundary: only the page content goes into fallback,
// not the sidebar/topbar/layout.
function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

// Lazy load all pages — split the bundle so the initial load is fast
const Auth = lazy(() => import("./pages/Auth"));
const Checkout = lazy(() => import("./pages/Checkout")); // Prompt 10 — checkout PRO
const CheckoutSuccess = lazy(() => import("./pages/CheckoutSuccess")); // Prompt 12 — página de sucesso
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const SetSellerPassword = lazy(() => import("./pages/SetSellerPassword"));
const AgentHub = lazy(() => import("./pages/AgentHub"));
const CommercialDashboard = lazy(() => import("./pages/CommercialDashboard"));
const MetricsDashboard = lazy(() => import("./pages/Dashboard"));
const Tutorials = lazy(() => import("./pages/Tutorials"));
const AICreativeStudio = lazy(() => import("./pages/AICreativeStudio"));
const CampaignOptimizer = lazy(() => import("./pages/CampaignOptimizer"));
const BudgetAllocator = lazy(() => import("./pages/BudgetAllocator"));
const Analytics = lazy(() => import("./pages/Analytics"));
const AutomatedRules = lazy(() => import("./pages/AutomatedRules"));
const ABTestingLab = lazy(() => import("./pages/ABTestingLab"));
const CreativeLibrary = lazy(() => import("./pages/CreativeLibrary"));
const Reports = lazy(() => import("./pages/Reports"));
const AIAcademy = lazy(() => import("./pages/AIAcademy"));
const Settings = lazy(() => import("./pages/Settings"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const ConnectAccounts = lazy(() => import("./pages/ConnectAccounts"));
const UnifiedPixel = lazy(() => import("./pages/UnifiedPixel"));
const Integrations = lazy(() => import("./pages/Integrations"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
// Páginas públicas de detalhe dos agentes (linkadas da home nova).
const PedroDetail = lazy(() => import("./pages/PedroDetail"));
const MarcosDetail = lazy(() => import("./pages/MarcosDetail"));
const JoseDetail = lazy(() => import("./pages/JoseDetail"));
const WhatsAppContacts = lazy(() => import("./pages/WhatsAppContacts"));
const WhatsAppBroadcast = lazy(() => import("./pages/WhatsAppBroadcast"));
const WhatsAppInbox = lazy(() => import("./pages/WhatsAppInbox"));
const WhatsAppAnalytics = lazy(() => import("./pages/WhatsAppAnalytics"));
const WhatsAppAutomations = lazy(() => import("./pages/WhatsAppAutomations"));
const WhatsAppInstances = lazy(() => import("./pages/WhatsAppInstances"));
const WhatsAppAIAgent = lazy(() => import("./pages/WhatsAppAIAgent"));
const CrmAoVivo = lazy(() => import("./pages/CrmAoVivo"));
const DashboardTV = lazy(() => import("./pages/DashboardTV"));
const PainelAoVivo = lazy(() => import("./pages/PainelAoVivo"));
const PainelGeral = lazy(() => import("./pages/PainelGeral"));
const WhatsAppCampaigns = lazy(() => import("./pages/WhatsAppCampaigns"));
const WhatsAppGroups = lazy(() => import("./pages/WhatsAppGroups"));
const MetaPixels = lazy(() => import("./pages/MetaPixels"));
const MetaAudiences = lazy(() => import("./pages/MetaAudiences"));
const WhatsAppCAPI = lazy(() => import("./pages/WhatsAppCAPI"));
const SalomaoOrchestrator = lazy(() => import("./pages/SalomaoOrchestrator"));
const FluxCRM = lazy(() => import("./pages/FluxCRM"));
const CRMContacts = lazy(() => import("./pages/CRMContacts"));
const CreativeIntelligence = lazy(() => import("./pages/CreativeIntelligence"));
const CompetitorRadar = lazy(() => import("./pages/CompetitorRadar"));
const LeadManagement = lazy(() => import('./pages/LeadManagement'));
const GoogleAdsDashboard = lazy(() => import('./pages/GoogleAdsDashboard'));
const LinkedInAdsDashboard = lazy(() => import('./pages/LinkedInAdsDashboard'));
const DaviSocialMedia = lazy(() => import('./pages/DaviSocialMedia'));
const JoaoEmail = lazy(() => import('./pages/JoaoEmail'));
const DanielEstrategia = lazy(() => import('./pages/DanielEstrategia'));
const MeuPlano = lazy(() => import('./pages/MeuPlano'));
const Administracao = lazy(() => import('./pages/Administracao'));
// Fase 6.5 — Admin de campos dinâmicos (cidades + origens)
const DynamicFieldsAdmin = lazy(() => import('./pages/DynamicFieldsAdmin'));
const AgentFunnel = lazy(() => import('./pages/AgentFunnel'));
const LucasFunil = lazy(() => import('./pages/LucasFunil'));
const GeradorPrompt = lazy(() => import('./pages/GeradorPrompt'));
const PauloAgente = lazy(() => import('./pages/PauloAgente'));
const JoseTrafego = lazy(() => import('./pages/JoseTrafego'));
const ApolloDashboard = lazy(() => import('./pages/ApolloDashboard'));
const NicheQuiz = lazy(() => import("./pages/NicheQuiz"));
const BriefingDetails = lazy(() => import("./pages/BriefingDetails"));
const SupportDashboard = lazy(() => import("./pages/SupportDashboard"));
const MarcosLeads = lazy(() => import("./pages/MarcosLeads"));
const PedroSDR    = lazy(() => import("./pages/PedroSDR"));
const MetaAdsConnect = lazy(() => import("./pages/MetaAdsConnect"));
const InstagramConnect = lazy(() => import("./pages/InstagramConnect"));
const ConfirmEmail = lazy(() => import("./pages/ConfirmEmail"));
const CrmFormularios = lazy(() => import("./pages/CrmFormularios"));
const FormPublico = lazy(() => import("./pages/FormPublico"));
const Treinamento = lazy(() => import("./pages/Treinamento"));
const Profile = lazy(() => import("./pages/Profile"));


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Voltar o foco da aba NAO deve refazer todas as queries: era isso que
      // enchia o console de "Failed to fetch" quando a rede piscava ao reativar
      // a aba, e ainda competia banda com a renovacao do token (piorando o
      // reset). refetchOnReconnect tambem desligado pelo mesmo motivo. Quem
      // precisar religar faz por query (ex.: useMetaCachedQuery).
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter>
        <AgentTasksProvider>
          <AgentChatProvider>
            <RouteWrapper>
              <Routes>
                {/* ── Public routes ── */}
                <Route path="/auth"          element={<Lazy><Auth /></Lazy>} />
                <Route path="/auth/confirm"  element={<Lazy><ConfirmEmail /></Lazy>} />
                <Route path="/reset-password"element={<Lazy><ResetPassword /></Lazy>} />
                <Route path="/criar-senha"  element={<Lazy><SetSellerPassword /></Lazy>} />
                <Route path="/privacy"       element={<Lazy><PrivacyPolicy /></Lazy>} />
                <Route path="/terms"         element={<Lazy><TermsOfService /></Lazy>} />
                <Route path="/onboarding"    element={<Lazy><Onboarding /></Lazy>} />
                <Route path="/"              element={<Lazy><LandingPage /></Lazy>} />
                {/* Páginas públicas de detalhe dos agentes (site de vendas).
                    Usam prefixo /agentes/ pra NÃO colidir com /pedro, /marcos e
                    /jose internas do app logado (PedroSDR / MarcosLeads / ApolloDashboard). */}
                <Route path="/agentes/pedro"  element={<Lazy><PedroDetail /></Lazy>} />
                <Route path="/agentes/marcos" element={<Lazy><MarcosDetail /></Lazy>} />
                <Route path="/agentes/jose"   element={<Lazy><JoseDetail /></Lazy>} />
                <Route path="/checkout"      element={<Lazy><Checkout /></Lazy>} />
                <Route path="/checkout/sucesso" element={<Lazy><CheckoutSuccess /></Lazy>} />
                <Route path="/f/:formId"     element={<Lazy><FormPublico /></Lazy>} />

                {/* ── Protected routes ── each page has its own Suspense so the
                     sidebar/topbar stay mounted and never flash during HMR ── */}
                {/* Quiz de nicho REMOVIDO (02/07): rota redireciona pro painel. */}
                <Route path="/niche-quiz"    element={<Navigate to="/tela-inicial" replace />} />
                <Route path="/briefing/:nicho" element={<ProtectedRoute><Lazy><BriefingDetails /></Lazy></ProtectedRoute>} />

                <Route path="/tela-inicial"       element={<ProtectedRoute><Lazy><AgentHub /></Lazy></ProtectedRoute>} />
                {/* [Unificado 05/06/2026] Dashboard foi absorvido pelo Painel Geral.
                    /dashboard redireciona; a tela antiga segue acessivel em /dashboard-antigo
                    pra comparacao e reversao facil. */}
                <Route path="/dashboard"          element={<Navigate to="/painel-geral" replace />} />
                <Route path="/dashboard-antigo"   element={<ProtectedRoute><Lazy><CommercialDashboard /></Lazy></ProtectedRoute>} />
                <Route path="/metrics"            element={<ProtectedRoute><Lazy><MetricsDashboard /></Lazy></ProtectedRoute>} />
                <Route path="/connect-accounts"   element={<ProtectedRoute><Lazy><ConnectAccounts /></Lazy></ProtectedRoute>} />
                {/* ── Agentes principais (master + sellers com permissao) ── */}
                <Route path="/copywriter"         element={<ProtectedRoute><Lazy><PauloAgente /></Lazy></ProtectedRoute>} />
                <Route path="/paulo"              element={<ProtectedRoute><Lazy><PauloAgente /></Lazy></ProtectedRoute>} />
                <Route path="/creative-studio"    element={<ProtectedRoute><Lazy><AICreativeStudio /></Lazy></ProtectedRoute>} />
                <Route path="/maria"              element={<ProtectedRoute><Lazy><AICreativeStudio /></Lazy></ProtectedRoute>} />
                <Route path="/lucas"              element={<ProtectedRoute><Lazy><LucasFunil /></Lazy></ProtectedRoute>} />
                {/* ── Rotas bloqueadas — apenas admin (ferramentas beta) ── */}
                <Route path="/optimizer"          element={<ProtectedRoute><AdminRoute><Lazy><CampaignOptimizer /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/budget"             element={<ProtectedRoute><AdminRoute><Lazy><BudgetAllocator /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/analytics"          element={<ProtectedRoute><AdminRoute><Lazy><Analytics /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/rules"              element={<ProtectedRoute><AdminRoute><Lazy><AutomatedRules /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/ab-testing"         element={<ProtectedRoute><AdminRoute><Lazy><ABTestingLab /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/library"            element={<ProtectedRoute><AdminRoute><Lazy><CreativeLibrary /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/reports"            element={<ProtectedRoute><AdminRoute><Lazy><Reports /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/academy"            element={<ProtectedRoute><AdminRoute><Lazy><AIAcademy /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/perfil"             element={<ProtectedRoute><Lazy><Profile /></Lazy></ProtectedRoute>} />
                <Route path="/settings"           element={<ProtectedRoute><Lazy><Settings /></Lazy></ProtectedRoute>} />
                <Route path="/pixel"              element={<ProtectedRoute><Lazy><UnifiedPixel /></Lazy></ProtectedRoute>} />
                <Route path="/integrations"       element={<ProtectedRoute><Lazy><Integrations /></Lazy></ProtectedRoute>} />
                <Route path="/integrations/meta"  element={<ProtectedRoute><Lazy><MetaAdsConnect /></Lazy></ProtectedRoute>} />
                <Route path="/integrations/instagram" element={<ProtectedRoute><Lazy><InstagramConnect /></Lazy></ProtectedRoute>} />
                <Route path="/tutorials"          element={<ProtectedRoute><Lazy><Tutorials /></Lazy></ProtectedRoute>} />
                <Route path="/treinamento"       element={<ProtectedRoute><Lazy><Treinamento /></Lazy></ProtectedRoute>} />

                <Route path="/whatsapp/inbox"       element={<ProtectedRoute><Lazy><WhatsAppInbox /></Lazy></ProtectedRoute>} />
                <Route path="/whatsapp/contacts"    element={<ProtectedRoute><Lazy><WhatsAppContacts /></Lazy></ProtectedRoute>} />
                <Route path="/whatsapp/broadcast"   element={<ProtectedRoute><Lazy><WhatsAppBroadcast /></Lazy></ProtectedRoute>} />
                <Route path="/whatsapp/analytics"   element={<ProtectedRoute><Lazy><WhatsAppAnalytics /></Lazy></ProtectedRoute>} />
                {/* TAREFA 4 (29/05/2026): Automação OCULTA enquanto FEATURES.automacao = false.
                    Acesso direto à rota redireciona pro dashboard. Código (WhatsAppAutomations)
                    permanece importado e intacto; basta a flag voltar a true pra reativar. */}
                <Route path="/whatsapp/automations" element={
                  FEATURES.automacao
                    ? <ProtectedRoute><Lazy><WhatsAppAutomations /></Lazy></ProtectedRoute>
                    : <Navigate to="/dashboard" replace />
                } />
                <Route path="/whatsapp/instances"   element={<ProtectedRoute><Lazy><WhatsAppInstances /></Lazy></ProtectedRoute>} />
                <Route path="/whatsapp/ai-agent"    element={<ProtectedRoute><Lazy><WhatsAppAIAgent /></Lazy></ProtectedRoute>} />
                <Route path="/whatsapp/crm-ao-vivo" element={<ProtectedRoute><Lazy><CrmAoVivo /></Lazy></ProtectedRoute>} />
                {/* Dashboard TV pra projetar em tela (tela cheia, oculto do menu) */}
                <Route path="/dashboard-tv"         element={<ProtectedRoute><Lazy><DashboardTV /></Lazy></ProtectedRoute>} />
                {/* Painel ao Vivo — mesmo painel, embutido no layout (item da sidebar) */}
                <Route path="/painel-ao-vivo"       element={<ProtectedRoute><Lazy><PainelAoVivo /></Lazy></ProtectedRoute>} />
                {/* Painel Geral — master vê todos (ranking); vendedor vê só os próprios leads (liberado via sidebar_painel_geral) */}
                <Route path="/painel-geral"         element={<ProtectedRoute><Lazy><PainelGeral /></Lazy></ProtectedRoute>} />
                <Route path="/whatsapp/campaigns"   element={<ProtectedRoute><Lazy><WhatsAppCampaigns /></Lazy></ProtectedRoute>} />
                <Route path="/whatsapp/groups"      element={<ProtectedRoute><Lazy><WhatsAppGroups /></Lazy></ProtectedRoute>} />
                <Route path="/whatsapp/capi"        element={<ProtectedRoute><Lazy><WhatsAppCAPI /></Lazy></ProtectedRoute>} />

                <Route path="/meta-pixels"          element={<ProtectedRoute><Lazy><MetaPixels /></Lazy></ProtectedRoute>} />
                <Route path="/meta-audiences"       element={<ProtectedRoute><Lazy><MetaAudiences /></Lazy></ProtectedRoute>} />

                {/* Salomao em STANDBY (02/07): oculto e rota redireciona pro painel. */}
                <Route path="/salomao"        element={<Navigate to="/tela-inicial" replace />} />
                <Route path="/crm"            element={<ProtectedRoute><Lazy><FluxCRM /></Lazy></ProtectedRoute>} />
                <Route path="/marcos"         element={<ProtectedRoute><Lazy><MarcosLeads /></Lazy></ProtectedRoute>} />
                <Route path="/pedro"          element={<ProtectedRoute><Lazy><PedroSDR /></Lazy></ProtectedRoute>} />
                <Route path="/agente/:agentId/funil" element={<ProtectedRoute><Lazy><AgentFunnel /></Lazy></ProtectedRoute>} />
                <Route path="/crm/contacts"   element={<ProtectedRoute><Lazy><CRMContacts /></Lazy></ProtectedRoute>} />
                <Route path="/crm/formularios"element={<ProtectedRoute><Lazy><CrmFormularios /></Lazy></ProtectedRoute>} />

                <Route path="/creative-intelligence" element={<ProtectedRoute><AdminRoute><Lazy><CreativeIntelligence /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/competitor-radar"      element={<ProtectedRoute><AdminRoute><Lazy><CompetitorRadar /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/leads"                 element={<ProtectedRoute><Lazy><LeadManagement /></Lazy></ProtectedRoute>} />
                <Route path="/google-ads"            element={<ProtectedRoute><AdminRoute><Lazy><GoogleAdsDashboard /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/linkedin-ads"          element={<ProtectedRoute><AdminRoute><Lazy><LinkedInAdsDashboard /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/davi"                  element={<ProtectedRoute><Lazy><DaviSocialMedia /></Lazy></ProtectedRoute>} />
                <Route path="/joao"                  element={<ProtectedRoute><Lazy><JoaoEmail /></Lazy></ProtectedRoute>} />
                <Route path="/daniel"                element={<ProtectedRoute><Lazy><DanielEstrategia /></Lazy></ProtectedRoute>} />
                <Route path="/meu-plano"             element={<ProtectedRoute><Lazy><MeuPlano /></Lazy></ProtectedRoute>} />
                <Route path="/administracao"         element={<ProtectedRoute><AdminRoute><Lazy><Administracao /></Lazy></AdminRoute></ProtectedRoute>} />
                {/* Fase 6.5 — admin de cidades + origens dinâmicas */}
                <Route path="/configuracoes/campos-dinamicos" element={<ProtectedRoute><Lazy><DynamicFieldsAdmin /></Lazy></ProtectedRoute>} />
                <Route path="/gerador-prompt"        element={<ProtectedRoute><AdminRoute><Lazy><GeradorPrompt /></Lazy></AdminRoute></ProtectedRoute>} />
                <Route path="/jose"                  element={<ProtectedRoute><Lazy><ApolloDashboard /></Lazy></ProtectedRoute>} />
                <Route path="/performance"           element={<ProtectedRoute><Lazy><SupportDashboard /></Lazy></ProtectedRoute>} />
                <Route path="*"                      element={<Lazy><NotFound /></Lazy>} />
              </Routes>
            </RouteWrapper>
            <Toaster />
            <Sonner />
          </AgentChatProvider>
        </AgentTasksProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
