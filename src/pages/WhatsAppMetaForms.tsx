import { MainLayout } from '@/components/layout/MainLayout';
import { MetaLeadFormsTab } from '@/components/pedro/MetaLeadFormsTab';
import { useAuth } from '@/hooks/useAuth';

/**
 * Formulários Meta — agora vive na seção WhatsApp, não mais dentro do agente Pedro.
 *
 * O conteúdo é o MESMO componente de antes (MetaLeadFormsTab): a captura de
 * formulários do Meta é integração de canal, não uma aba do funil do Pedro.
 * Mantendo o componente compartilhado, nada do comportamento muda de lugar —
 * só o caminho até ele.
 */
export default function WhatsAppMetaForms() {
  const { user } = useAuth();

  return (
    <MainLayout>
      <div className="p-4 sm:p-6">
        {user?.id ? (
          <MetaLeadFormsTab userId={user.id} />
        ) : (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
      </div>
    </MainLayout>
  );
}
