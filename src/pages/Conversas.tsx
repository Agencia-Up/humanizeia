import { MainLayout } from '@/components/layout/MainLayout';
import { AgentInboxTab } from '@/components/pedro/AgentInboxTab';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { Loader2 } from 'lucide-react';

// Inbox UNIFICADO de conversas (aba lateral "Conversas"): junta os leads do Pedro
// (ai_crm_leads, tráfego pago) e do Marcos (crm_leads, manuais) num lugar só, com
// filtro de origem (Todos/Pedro/Marcos). Reutiliza o AgentInboxTab (componente do
// Pedro) em modo `unified` — o inbox do Pedro e do Marcos atuais seguem intactos.
export default function Conversas() {
  const { user } = useAuth();
  const { isSeller, masterUserId, memberIds, loading } = useSellerProfile(user?.id);
  const effectiveUserId = (isSeller && masterUserId) ? masterUserId : user?.id;

  return (
    <MainLayout>
      <div className="p-4 lg:p-6">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-foreground">Conversas</h1>
          <p className="text-sm text-muted-foreground">
            Todas as conversas dos leads num lugar só — Pedro (tráfego) e Marcos (manuais).
          </p>
        </div>
        {loading || !effectiveUserId ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <AgentInboxTab
            userId={effectiveUserId}
            isSeller={isSeller}
            sellerMemberIds={memberIds || []}
            unified
          />
        )}
      </div>
    </MainLayout>
  );
}
