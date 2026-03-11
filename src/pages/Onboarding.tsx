import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, Building2, Mail, Users, Loader2, Check, ArrowRight } from 'lucide-react';

export default function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { pendingInvites, createOrganization, acceptInvite } = useOrganization();
  const { toast } = useToast();

  const [step, setStep] = useState<'choose' | 'create' | 'invites'>('choose');
  const [orgName, setOrgName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) {
      toast({ title: 'Nome obrigatório', description: 'Informe o nome da empresa.', variant: 'destructive' });
      return;
    }

    setIsLoading(true);
    const { error } = await createOrganization(orgName.trim());
    setIsLoading(false);

    if (error) {
      toast({ title: 'Erro ao criar empresa', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '🎉 Empresa criada!', description: 'Sua organização foi criada com sucesso.' });
      navigate('/', { replace: true });
    }
  };

  const handleAcceptInvite = async (inviteId: string) => {
    setAcceptingId(inviteId);
    const { error } = await acceptInvite(inviteId);
    setAcceptingId(null);

    if (error) {
      toast({ title: 'Erro ao aceitar convite', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Convite aceito!', description: 'Você agora faz parte da organização.' });
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-primary">
            <Sparkles className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Bem-vindo ao HumanizeAI</h1>
          <p className="text-sm text-muted-foreground">
            Configure sua empresa para começar
          </p>
        </div>

        {/* Choose step */}
        {step === 'choose' && (
          <div className="space-y-4">
            <Card
              className="cursor-pointer border-border/50 bg-card/80 backdrop-blur-sm transition-all hover:border-primary/50 hover:shadow-md"
              onClick={() => setStep('create')}
            >
              <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base">Criar nova empresa</CardTitle>
                  <CardDescription className="text-sm">
                    Crie sua organização e convide sua equipe
                  </CardDescription>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
            </Card>

            <Card
              className={`border-border/50 bg-card/80 backdrop-blur-sm transition-all ${
                pendingInvites.length > 0
                  ? 'cursor-pointer hover:border-primary/50 hover:shadow-md'
                  : 'opacity-60'
              }`}
              onClick={() => pendingInvites.length > 0 && setStep('invites')}
            >
              <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Mail className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base">Aceitar convite</CardTitle>
                  <CardDescription className="text-sm">
                    {pendingInvites.length > 0
                      ? `Você tem ${pendingInvites.length} convite(s) pendente(s)`
                      : 'Nenhum convite pendente para seu email'}
                  </CardDescription>
                </div>
                {pendingInvites.length > 0 && (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {pendingInvites.length}
                  </div>
                )}
              </CardHeader>
            </Card>
          </div>
        )}

        {/* Create organization */}
        {step === 'create' && (
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg">Criar empresa</CardTitle>
              <CardDescription>Informe os dados da sua organização</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Nome da empresa</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="org-name"
                      placeholder="Minha Empresa"
                      className="pl-10"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep('choose')} className="flex-1">
                    Voltar
                  </Button>
                  <Button type="submit" className="flex-1 gradient-primary text-primary-foreground" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Criar empresa
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Pending invites */}
        {step === 'invites' && (
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg">Convites pendentes</CardTitle>
              <CardDescription>Aceite um convite para entrar em uma organização</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between rounded-lg border border-border/50 p-3"
                >
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">
                        {(invite.organizations as any)?.name || 'Organização'}
                      </p>
                      <p className="text-xs text-muted-foreground">Convite pendente</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleAcceptInvite(invite.id)}
                    disabled={acceptingId === invite.id}
                  >
                    {acceptingId === invite.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1 h-4 w-4" />
                    )}
                    Aceitar
                  </Button>
                </div>
              ))}
              <Button variant="outline" onClick={() => setStep('choose')} className="w-full">
                Voltar
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
