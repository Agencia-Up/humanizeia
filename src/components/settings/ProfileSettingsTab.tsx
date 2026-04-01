import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { User, Loader2, Save, RotateCcw, Sparkles } from 'lucide-react';


interface Profile {
  full_name: string | null;
  company_name: string | null;
  industry: string | null;
  experience_level: string | null;
  monthly_ad_spend_range: string | null;
  preferred_language: string | null;
  timezone: string | null;
}

export function ProfileSettingsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isResettingQuiz, setIsResettingQuiz] = useState(false);

  const [profile, setProfile] = useState<Profile>({
    full_name: '',
    company_name: '',
    industry: '',
    experience_level: 'intermediate',
    monthly_ad_spend_range: '',
    preferred_language: 'pt-BR',
    timezone: 'America/Sao_Paulo',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user) loadProfile();
  }, [user]);

  const loadProfile = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('full_name, company_name, industry, experience_level, monthly_ad_spend_range, preferred_language, timezone')
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
      });
    }
    if (error) console.error('Error loading profile:', error);
    setIsLoading(false);
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
            <Avatar className="h-20 w-20">
              <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                {profile.full_name?.charAt(0)?.toUpperCase() || '?'}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-lg">{profile.full_name || 'Sem nome'}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
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

      {/* Refazer Quiz */}
      <Card className="border-amber-500/20 bg-amber-500/5 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
              <Sparkles className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <CardTitle className="text-base">Qualificação de Nicho</CardTitle>
              <CardDescription>Refaça o quiz para atualizar seu briefing personalizado</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Ao refazer o quiz, o Agente de Briefing irá gerar um novo briefing estratégico
            baseado nas suas novas respostas.
          </p>
          <Button
            variant="outline"
            onClick={handleResetQuiz}
            disabled={isResettingQuiz}
            className="border-amber-500/30 hover:bg-amber-500/10 text-amber-400 hover:text-amber-300 gap-2"
          >
            {isResettingQuiz
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RotateCcw className="h-4 w-4" />
            }
            Refazer Quiz de Nicho
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
