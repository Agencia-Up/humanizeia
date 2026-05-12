import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/hooks/useAuth';
import { CrmAvancadoTab } from '@/pages/PedroSDR';

export default function WhatsAppAutomations({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();

  const Wrapper = embedded
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : MainLayout;

  return (
    <Wrapper>
      <CrmAvancadoTab userId={user?.id} />
    </Wrapper>
  );
}
