import { MainLayout } from '@/components/layout/MainLayout';
import { ProfileSettingsTab } from '@/components/settings/ProfileSettingsTab';

export default function ProfilePage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">Meu Perfil</h1>
          <p className="text-muted-foreground">Seus dados pessoais e preferências</p>
        </div>
        <ProfileSettingsTab />
      </div>
    </MainLayout>
  );
}
