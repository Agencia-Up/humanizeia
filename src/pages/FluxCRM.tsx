import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/hooks/useAuth';
import { CrmAvancadoTab } from '@/pages/PedroSDR';

export default function FluxCRM({ embedded }: { embedded?: boolean } = {}) {
  const { user } = useAuth();

  const content = <CrmAvancadoTab userId={user?.id} mode="marcos" />;

  // NUNCA definir um componente Wrapper inline aqui. Uma funcao nova a cada render
  // faz o React tratar como "tipo diferente" e REMONTAR o CrmAvancadoTab inteiro a
  // cada re-render (ex.: o useAuth atualiza a sessao ao focar a aba) — apagando o
  // nome em edicao e fechando o detalhe do lead ("a tela recarrega e perde o que
  // digitei"). Renderiza os ramos com tipos ESTAVEIS (div / MainLayout) pra
  // preservar o estado. Embutido no Marcos: o CRM precisa do PROPRIO scroll
  // vertical (MarcosLeads usa um container overflow-hidden).
  if (embedded) {
    return <div className="h-full overflow-y-auto">{content}</div>;
  }
  return <MainLayout>{content}</MainLayout>;
}
