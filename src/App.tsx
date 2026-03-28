import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Loader2 } from "lucide-react";

// Lazy load all pages — split the bundle so the initial load is fast
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AgentHub = lazy(() => import("./pages/AgentHub"));
const MetricsDashboard = lazy(() => import("./pages/Dashboard"));
const Tutorials = lazy(() => import("./pages/Tutorials"));
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
const Onboarding = lazy(() => import("./pages/Onboarding"));
const ConnectAccounts = lazy(() => import("./pages/ConnectAccounts"));
const UnifiedPixel = lazy(() => import("./pages/UnifiedPixel"));
const Integrations = lazy(() => import("./pages/Integrations"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const WhatsAppContacts = lazy(() => import("./pages/WhatsAppContacts"));
const WhatsAppBroadcast = lazy(() => import("./pages/WhatsAppBroadcast"));
const WhatsAppInbox = lazy(() => import("./pages/WhatsAppInbox"));
const WhatsAppAnalytics = lazy(() => import("./pages/WhatsAppAnalytics"));
const WhatsAppAutomations = lazy(() => import("./pages/WhatsAppAutomations"));
const WhatsAppInstances = lazy(() => import("./pages/WhatsAppInstances"));
const WhatsAppAIAgent = lazy(() => import("./pages/WhatsAppAIAgent"));
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
const GeradorPrompt = lazy(() => import('./pages/GeradorPrompt'));
const PauloAgente = lazy(() => import('./pages/PauloAgente'));
const JoseTrafego = lazy(() => import('./pages/JoseTrafego'));

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
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<ProtectedRoute><AgentHub /></ProtectedRoute>} />
            <Route path="/metrics" element={<ProtectedRoute><MetricsDashboard /></ProtectedRoute>} />
            <Route path="/connect-accounts" element={<ProtectedRoute><ConnectAccounts /></ProtectedRoute>} />
            <Route path="/copywriter" element={<ProtectedRoute><PauloAgente /></ProtectedRoute>} />
            <Route path="/paulo" element={<ProtectedRoute><PauloAgente /></ProtectedRoute>} />
            {/* <Route path="/copywriter-old" element={<ProtectedRoute><AICopywriter /></ProtectedRoute>} /> */}
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
            <Route path="/tutorials" element={<ProtectedRoute><Tutorials /></ProtectedRoute>} />
            <Route path="/whatsapp/inbox" element={<ProtectedRoute><WhatsAppInbox /></ProtectedRoute>} />
            <Route path="/whatsapp/contacts" element={<ProtectedRoute><WhatsAppContacts /></ProtectedRoute>} />
            <Route path="/whatsapp/broadcast" element={<ProtectedRoute><WhatsAppBroadcast /></ProtectedRoute>} />
            <Route path="/whatsapp/analytics" element={<ProtectedRoute><WhatsAppAnalytics /></ProtectedRoute>} />
            <Route path="/whatsapp/automations" element={<ProtectedRoute><WhatsAppAutomations /></ProtectedRoute>} />
            <Route path="/whatsapp/instances" element={<ProtectedRoute><WhatsAppInstances /></ProtectedRoute>} />
            <Route path="/whatsapp/ai-agent" element={<ProtectedRoute><WhatsAppAIAgent /></ProtectedRoute>} />
            <Route path="/meta-pixels" element={<ProtectedRoute><MetaPixels /></ProtectedRoute>} />
            <Route path="/meta-audiences" element={<ProtectedRoute><MetaAudiences /></ProtectedRoute>} />
            <Route path="/whatsapp/capi" element={<ProtectedRoute><WhatsAppCAPI /></ProtectedRoute>} />
            <Route path="/salomao" element={<ProtectedRoute><SalomaoOrchestrator /></ProtectedRoute>} />
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
            <Route path="/meu-plano" element={<ProtectedRoute><MeuPlano /></ProtectedRoute>} />
            <Route path="/gerador-prompt" element={<ProtectedRoute><GeradorPrompt /></ProtectedRoute>} />
            <Route path="/jose" element={<ProtectedRoute><JoseTrafego /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
