import { MainLayout } from '@/components/layout/MainLayout';
import { AgentInboxTab } from '@/components/pedro/AgentInboxTab';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { Loader2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

export default function Conversas() {
  const { user } = useAuth();
  const { isSeller, masterUserId, memberIds, loading } = useSellerProfile(user?.id);
  const effectiveUserId = (isSeller && masterUserId) ? masterUserId : user?.id;
  const [searchParams] = useSearchParams();
  const focusLeadId = searchParams.get('leadId');
  const focusPhone = searchParams.get('phone');

  return (
    <MainLayout>
      <div className="h-[calc(100vh-78px)] overflow-hidden">
        {loading || !effectiveUserId ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <AgentInboxTab
            userId={effectiveUserId}
            isSeller={isSeller}
            sellerMemberIds={memberIds || []}
            unified
            focusLeadId={focusLeadId}
            focusPhone={focusPhone}
          />
        )}
      </div>
    </MainLayout>
  );
}
