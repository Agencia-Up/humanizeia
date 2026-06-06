import { MainLayout } from '@/components/layout/MainLayout';
import { MetaAdsSettingsTab } from '@/components/settings/MetaAdsSettingsTab';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function MetaAdsConnect() {
  const navigate = useNavigate();

  return (
    <MainLayout>
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/integrations')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Conectar Meta Ads</h1>
            <p className="text-muted-foreground text-sm">
              Facebook, Instagram e Messenger Ads
            </p>
          </div>
        </div>

        <MetaAdsSettingsTab />
      </div>
    </MainLayout>
  );
}
