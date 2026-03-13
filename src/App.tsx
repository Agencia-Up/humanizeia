import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import AICopywriter from "./pages/AICopywriter";
import AICreativeStudio from "./pages/AICreativeStudio";

import CampaignOptimizer from "./pages/CampaignOptimizer";
import BudgetAllocator from "./pages/BudgetAllocator";
import Analytics from "./pages/Analytics";
import AutomatedRules from "./pages/AutomatedRules";
import ABTestingLab from "./pages/ABTestingLab";
import CreativeLibrary from "./pages/CreativeLibrary";
import Reports from "./pages/Reports";
import AIAcademy from "./pages/AIAcademy";
import Settings from "./pages/Settings";
import MidasAgent from "./pages/MidasAgent";
import Onboarding from "./pages/Onboarding";
import ConnectAccounts from "./pages/ConnectAccounts";
import UnifiedPixel from "./pages/UnifiedPixel";
import Integrations from "./pages/Integrations";
import NotFound from "./pages/NotFound";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import LandingPage from "./pages/LandingPage";
// WhatsAppGroups merged into WhatsAppContacts
import WhatsAppContacts from "./pages/WhatsAppContacts";
import WhatsAppBroadcast from "./pages/WhatsAppBroadcast";
// WhatsAppCampaigns removed - merged into WhatsAppBroadcast
import WhatsAppInbox from "./pages/WhatsAppInbox";
import WhatsAppAnalytics from "./pages/WhatsAppAnalytics";
import WhatsAppAutomations from "./pages/WhatsAppAutomations";
import WhatsAppInstances from "./pages/WhatsAppInstances";
import CriarCampanha from "./pages/CriarCampanha";
import WhatsAppAIAgent from "./pages/WhatsAppAIAgent";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/" element={<LandingPage />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
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
          <Route path="/apollo/criar-campanha" element={<ProtectedRoute><CriarCampanha /></ProtectedRoute>} />
          <Route path="/whatsapp/inbox" element={<ProtectedRoute><WhatsAppInbox /></ProtectedRoute>} />
          <Route path="/whatsapp/campaigns" element={<ProtectedRoute><WhatsAppCampaigns /></ProtectedRoute>} />
          {/* /whatsapp/groups route removed - merged into /whatsapp/contacts */}
          <Route path="/whatsapp/contacts" element={<ProtectedRoute><WhatsAppContacts /></ProtectedRoute>} />
          <Route path="/whatsapp/broadcast" element={<ProtectedRoute><WhatsAppBroadcast /></ProtectedRoute>} />
          <Route path="/whatsapp/analytics" element={<ProtectedRoute><WhatsAppAnalytics /></ProtectedRoute>} />
          <Route path="/whatsapp/automations" element={<ProtectedRoute><WhatsAppAutomations /></ProtectedRoute>} />
          <Route path="/whatsapp/instances" element={<ProtectedRoute><WhatsAppInstances /></ProtectedRoute>} />
          <Route path="/whatsapp/ai-agent" element={<ProtectedRoute><WhatsAppAIAgent /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
