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
import NotFound from "./pages/NotFound";


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
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/connect-accounts" element={<ProtectedRoute><ConnectAccounts /></ProtectedRoute>} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
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
          <Route path="/midas" element={<ProtectedRoute><MidasAgent /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
