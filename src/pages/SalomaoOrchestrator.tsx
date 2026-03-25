import { MainLayout } from '@/components/layout/MainLayout';
import OrchestratorDashboard from '@/features/orchestrator/components/OrchestratorDashboard';

export default function SalomaoOrchestrator() {
  return (
    <MainLayout>
      <OrchestratorDashboard />
    </MainLayout>
  );
}
