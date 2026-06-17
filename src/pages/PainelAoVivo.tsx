import { MainLayout } from '@/components/layout/MainLayout';
import DashboardTV from './DashboardTV';

// "Painel ao Vivo" como item do sistema (sidebar): o mesmo DashboardTV embutido,
// porém dentro do layout normal (com a barra lateral). A versao tela-cheia pra
// projetar em TV continua em /dashboard-tv (sem layout).
export default function PainelAoVivo() {
  return (
    <MainLayout>
      <DashboardTV embedded />
    </MainLayout>
  );
}
