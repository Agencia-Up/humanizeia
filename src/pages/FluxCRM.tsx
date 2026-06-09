import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/hooks/useAuth';
import { CrmAvancadoTab } from '@/pages/PedroSDR';

export default function FluxCRM({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();

  // Embutido no Marcos (MarcosLeads usa um container overflow-hidden), entao o
  // CRM precisa do PROPRIO scroll vertical — senao o pipeline fica cortado e
  // sem as barras de rolagem que a pagina do Pedro tem (la o MainLayout rola).
  const Wrapper = embedded
    ? ({ children }: { children: React.ReactNode }) => (
        <div className="h-full overflow-y-auto">{children}</div>
      )
    : MainLayout;

  return (
    <Wrapper>
      <CrmAvancadoTab userId={user?.id} mode="marcos" />
    </Wrapper>
  );
}
