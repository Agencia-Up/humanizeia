import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { User, Loader2, Save, RotateCcw, Sparkles, Camera, Upload } from 'lucide-react';


interface Profile {
  full_name: string | null;
  company_name: string | null;
  industry: string | null;
  experience_level: string | null;
  monthly_ad_spend_range: string | null;
  preferred_language: string | null;
  timezone: string | null;
  avatar_url: string | null;
}

export function ProfileSettingsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isResettingQuiz, setIsResettingQuiz] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile>({
    full_name: '',
    company_name: '',
    industry: '',
    experience_level: 'intermediate',
    monthly_ad_spend_range: '',
    preferred_language: 'pt-BR',
    timezone: 'America/Sao_Paulo',
    avatar_url: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (user) loadProfile();
  }, [user]);

  const loadProfile = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('full_name, company_name, industry, experience_level, monthly_ad_spend_range, preferred_language, timezone, avatar_url')
      .eq('id', user!.id)
      .single();

    if (data) {
      setProfile({
        full_name: data.full_name || '',
        company_name: data.company_name || '',
        industry: data.industry || '',
        experience_level: data.experience_level || 'intermediate',
        monthly_ad_spend_range: data.monthly_ad_spend_range || '',
        preferred_language: data.preferred_language || 'pt-BR',
        timezone: data.timezone || 'America/Sao_Paulo',
        avatar_url: (data as any).avatar_url || null,
      });
    }
    if (error) console.error('Error loading profile:', error);
    setIsLoading(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'Maximo 2MB', variant: 'destructive' });
      return;
    }
    setIsUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      // Path DEVE começar com {user.id}/ pra passar a policy avatars_user_write
      // (storage.foldername(name)[1] = auth.uid()). Fix 2026-05-26.
      const path = `${user.id}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const avatarUrl = urlData.publicUrl + '?t=' + Date.now();
      await supabase.from('profiles').update({ avatar_url: avatarUrl } as any).eq('id', user.id);
      setProfile(prev => ({ ...prev, avatar_url: avatarUrl }));
      toast({ title: 'Logo atualizada!' });
    } catch (err: any) {
      toast({ title: 'Erro ao subir imagem', description: err.message, variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: profile.full_name || null,
        company_name: profile.company_name || null,
        industry: profile.industry || null,
        experience_level: profile.experience_level || null,
        monthly_ad_spend_range: profile.monthly_ad_spend_range || null,
        preferred_language: profile.preferred_language || null,
        timezone: profile.timezone || null,
      })
      .eq('id', user.id);

    setIsSaving(false);

    if (error) {
      toast({ title: 'Erro ao salvar perfil', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Perfil atualizado com sucesso!' });
    }
  };

  const updateField = (field: keyof Profile, value: string) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const handleResetQuiz = async () => {
    if (!user) return;
    setIsResettingQuiz(true);
    try {
      // Limpa localStorage
      Object.keys(localStorage)
        .filter(k => k.startsWith('quiz_'))
        .forEach(k => localStorage.removeItem(k));

      // Tenta resetar no banco (ignora se coluna não existe)
      try {
        await supabase.from('profiles').update({ quiz_completed: false } as any).eq('id', user.id);
      } catch { /* coluna pode não existir */ }

      toast({ title: '✅ Quiz resetado!', description: 'Você será redirecionado para o Quiz de Nicho.' });
      await new Promise(r => setTimeout(r, 1200));
      navigate('/niche-quiz', { replace: true });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsResettingQuiz(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile Info */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Informações do Perfil</CardTitle>
              <CardDescription>Seus dados pessoais e preferências</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <Avatar className="h-20 w-20">
                {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt="Avatar" />}
                <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                  {profile.full_name?.charAt(0)?.toUpperCase() || '?'}
                </AvatarFallback>
              </Avatar>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                {isUploading ? <Loader2 className="h-5 w-5 animate-spin text-white" /> : <Camera className="h-5 w-5 text-white" />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
            </div>
            <div>
              <p className="font-medium text-lg">{profile.full_name || 'Sem nome'}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <button onClick={() => fileInputRef.current?.click()} className="text-xs text-primary hover:underline mt-1 flex items-center gap-1">
                <Upload className="h-3 w-3" /> Alterar logo / foto
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input
                value={profile.full_name || ''}
                onChange={(e) => updateField('full_name', e.target.value)}
                placeholder="Seu nome"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ''} disabled className="opacity-60" />
              <p className="text-xs text-muted-foreground">O email não pode ser alterado</p>
            </div>
            <div className="space-y-2">
              <Label>Empresa</Label>
              <Input
                value={profile.company_name || ''}
                onChange={(e) => updateField('company_name', e.target.value)}
                placeholder="Nome da empresa"
              />
            </div>
            <div className="space-y-2">
              <Label>Indústria</Label>
              <Input
                value={profile.industry || ''}
                onChange={(e) => updateField('industry', e.target.value)}
                placeholder="Ex: E-commerce, SaaS, Educação"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={isSaving} className="gradient-primary">
        {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Salvar Alterações
      </Button>

    </div>
  );
}
