import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Loader2 } from "lucide-react";

// Public pages
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Onboarding = lazy(() => import("./pages/Onboarding"));

// Agent Home (grid)
const AgentHome = lazy(() => import("./pages/AgentHome"));

// Agent Dashboards
const SalomaoAgent = lazy(() => import("./pages/agents/SalomaoAgent"));
const JoseAgent = lazy(() => import("./pages/agents/JoseAgent"));
const MarcosAgent = lazy(() => import("./pages/agents/MarcosAgent"));
const PauloAgent = lazy(() => import("./pages/agents/PauloAgent"));
const MariaAgent = lazy(() => import("./pages/agents/MariaAgent"));
const DaviAgent = lazy(() => import("./pages/agents/DaviAgent"));
const LucasAgent = lazy(() => import("./pages/agents/LucasAgent"));
const JoaoAgent = lazy(() => import("./pages/agents/JoaoAgent"));
const PedroAgent = lazy(() => import("./pages/agents/PedroAgent"));
const DanielAgent = lazy(() => import("./pages/agents/DanielAgent"));

// Tools / existing pages (keeping old routes alive)
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AICopywriter = lazy(() => import("./pages/AICopywriter"));
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
const MidasAgent = lazy(() => import("./pages/MidasAgent"));
const ConnectAccounts = lazy(() => import("./pages/ConnectAccounts"));
const UnifiedPixel = lazy(() => import("./pages/UnifiedPixel"));
const Integrations = lazy(() => import("./pages/Integrations"));
const FluxCRM = lazy(() => import("./pages/FluxCRM"));
const CRMContacts = lazy(() => import("./pages/CRMContacts"));
const CreativeIntelligence = lazy(() => import("./pages/CreativeIntelligence"));
const CompetitorRadar = lazy(() => import("./pages/CompetitorRadar"));
const LeadManagement = lazy(() => import("./pages/LeadManagement"));
const GoogleAdsDashboard = lazy(() => import("./pages/GoogleAdsDashboard"));
const LinkedInAdsDashboard = lazy(() => import("./pages/LinkedInAdsDashboard"));
const DaviSocialMedia = lazy(() => import("./pages/DaviSocialMedia"));
const JoaoEmail = lazy(() => import("./pages/JoaoEmail"));
const DanielEstrategia = lazy(() => import("./pages/DanielEstrategia"));
const ApolloDashboard = lazy(() => import("./pages/ApolloDashboard"));
const SalomaoOrchestrator = lazy(() => import("./pages/SalomaoOrchestrator"));
const CriarCampanha = lazy(() => import("./pages/CriarCampanha"));

// WhatsApp
const WhatsAppContacts = lazy(() => import("./pages/WhatsAppContacts"));
const WhatsAppBroadcast = lazy(() => import("./pages/WhatsAppBroadcast"));
const WhatsAppInbox = lazy(() => import("./pages/WhatsAppInbox"));
const WhatsAppAnalytics = lazy(() => import("./pages/WhatsAppAnalytics"));
const WhatsAppAutomations = lazy(() => import("./pages/WhatsAppAutomations"));
const WhatsAppInstances = lazy(() => import("./pages/WhatsAppInstances"));
const WhatsAppAIAgent = lazy(() => import("./pages/WhatsAppAIAgent"));
const WhatsAppCAPI = lazy(() => import("./pages/WhatsAppCAPI"));
const MetaPixels = lazy(() => import("./pages/MetaPixels"));
const MetaAudiences = lazy(() => import("./pages/MetaAudiences"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/onboarding" element={<Onboarding />} />

            {/* Agent Home */}
            <Route path="/dashboard" element={<ProtectedRoute><AgentHome /></ProtectedRoute>} />

            {/* Agent Dashboards — New */}
            <Route path="/agents/salomao" element={<ProtectedRoute><SalomaoAgent /></ProtectedRoute>} />
            <Route path="/agents/jose" element={<ProtectedRoute><JoseAgent /></ProtectedRoute>} />
            <Route path="/agents/marcos" element={<ProtectedRoute><MarcosAgent /></ProtectedRoute>} />
            <Route path="/agents/paulo" element={<ProtectedRoute><PauloAgent /></ProtectedRoute>} />
            <Route path="/agents/maria" element={<ProtectedRoute><MariaAgent /></ProtectedRoute>} />
            <Route path="/agents/davi" element={<ProtectedRoute><DaviAgent /></ProtectedRoute>} />
            <Route path="/agents/lucas" element={<ProtectedRoute><LucasAgent /></ProtectedRoute>} />
            <Route path="/agents/joao" element={<ProtectedRoute><JoaoAgent /></ProtectedRoute>} />
            <Route path="/agents/pedro" element={<ProtectedRoute><PedroAgent /></ProtectedRoute>} />
            <Route path="/agents/daniel" element={<ProtectedRoute><DanielAgent /></ProtectedRoute>} />

            {/* Legacy routes (still functional) */}
            <Route path="/salomao" element={<ProtectedRoute><SalomaoOrchestrator /></ProtectedRoute>} />
            <Route path="/apollo" element={<ProtectedRoute><ApolloDashboard /></ProtectedRoute>} />
            <Route path="/apollo/criar-campanha" element={<ProtectedRoute><CriarCampanha /></ProtectedRoute>} />
            <Route path="/connect-accounts" element={<ProtectedRoute><ConnectAccounts /></ProtectedRoute>} />
            <Route path="/copywriter" element={<ProtectedRoute><AICopywriter /></ProtectedRoute>} />
            <Route path="/creative-studio" element={<ProtectedRoute><AICreativeStudio /></ProtectedRoute>} />
            <Route path="/optimizer" element={<ProtectedRoute><CampaignOptimizer /></ProtectedRoute>} />
            <Route path="/budget" element={<ProtectedRoute><BudgetAllocator /></ProtectedRoute>} />
            <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
            <Route path="/rules" element={<ProtectedRoute><AutomatedRules /></ProtectedRoute>} />
            <Route path="/ab-testing" element={<ProtectedRoute><ABTestingLab /></ProtectedRoute>} />
            <Route path="/library" element={<ProtectedRoute><CreativeLibrary /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/academy" element={<ProtectedRoute><AIAcademy /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/pixel" element={<ProtectedRoute><UnifiedPixel /></ProtectedRoute>} />
            <Route path="/integrations" element={<ProtectedRoute><Integrations /></ProtectedRoute>} />
            <Route path="/midas" element={<ProtectedRoute><MidasAgent /></ProtectedRoute>} />
            <Route path="/crm" element={<ProtectedRoute><FluxCRM /></ProtectedRoute>} />
            <Route path="/crm/contacts" element={<ProtectedRoute><CRMContacts /></ProtectedRoute>} />
            <Route path="/creative-intelligence" element={<ProtectedRoute><CreativeIntelligence /></ProtectedRoute>} />
            <Route path="/competitor-radar" element={<ProtectedRoute><CompetitorRadar /></ProtectedRoute>} />
            <Route path="/leads" element={<ProtectedRoute><LeadManagement /></ProtectedRoute>} />
            <Route path="/google-ads" element={<ProtectedRoute><GoogleAdsDashboard /></ProtectedRoute>} />
            <Route path="/linkedin-ads" element={<ProtectedRoute><LinkedInAdsDashboard /></ProtectedRoute>} />
            <Route path="/davi" element={<ProtectedRoute><DaviSocialMedia /></ProtectedRoute>} />
            <Route path="/joao" element={<ProtectedRoute><JoaoEmail /></ProtectedRoute>} />
            <Route path="/daniel" element={<ProtectedRoute><DanielEstrategia /></ProtectedRoute>} />

            {/* WhatsApp */}
            <Route path="/whatsapp/inbox" element={<ProtectedRoute><WhatsAppInbox /></ProtectedRoute>} />
            <Route path="/whatsapp/contacts" element={<ProtectedRoute><WhatsAppContacts /></ProtectedRoute>} />
            <Route path="/whatsapp/broadcast" element={<ProtectedRoute><WhatsAppBroadcast /></ProtectedRoute>} />
            <Route path="/whatsapp/analytics" element={<ProtectedRoute><WhatsAppAnalytics /></ProtectedRoute>} />
            <Route path="/whatsapp/automations" element={<ProtectedRoute><WhatsAppAutomations /></ProtectedRoute>} />
            <Route path="/whatsapp/instances" element={<ProtectedRoute><WhatsAppInstances /></ProtectedRoute>} />
            <Route path="/whatsapp/ai-agent" element={<ProtectedRoute><WhatsAppAIAgent /></ProtectedRoute>} />
            <Route path="/whatsapp/capi" element={<ProtectedRoute><WhatsAppCAPI /></ProtectedRoute>} />
            <Route path="/meta-pixels" element={<ProtectedRoute><MetaPixels /></ProtectedRoute>} />
            <Route path="/meta-audiences" element={<ProtectedRoute><MetaAudiences /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
