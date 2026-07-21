import { MainLayout } from '@/components/layout/MainLayout';
import { FeedbacksArea } from '@/components/pedro/FeedbacksArea';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { Loader2, FileText } from 'lucide-react';
import { Navigate } from 'react-router-dom';

// Relatório da CONTA (feedbacks/relatórios da IA — engloba Pedro E Marcos, não é
// exclusivo do Pedro). Saiu de DENTRO do agente Pedro (sub-aba "Relatórios") e virou
// item próprio da sidebar em WhatsApp. Só master/gerente acessa; vendedor não (mesma
// regra !isSeller da aba antiga). Enquanto o perfil carrega, mostra spinner — nunca
// renderiza o relatório antes de saber se é vendedor (ver flash-useSellerProfile).
export default function Relatorios() {
  const { user } = useAuth();
  const { isSeller, loading } = useSellerProfile(user?.id);

  if (loading) {
    return (
      <MainLayout>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  if (isSeller) return <Navigate to="/conversas" replace />;

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-none md:text-2xl">Relatórios</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Feedbacks e relatórios da IA — Pedro e Marcos juntos.
            </p>
          </div>
        </div>
        <FeedbacksArea />
      </div>
    </MainLayout>
  );
}
