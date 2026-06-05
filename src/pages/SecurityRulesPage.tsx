// ============================================================================
// SecurityRulesPage — /dashboard/security-rules (master-only) — FASE 3
// Lista de perfis de regras + criação/edição (formulário) + atribuição.
// ============================================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import { useToast } from '@/hooks/use-toast';
import { useSecurityRules, type ProfileWithAssignments } from '@/hooks/useSecurityRules';
import { summarizeProfile, type SecurityRuleProfileInput, type AssignmentTargetType } from '@/types/securityRules';
import { SecurityRuleProfileForm } from '@/components/security/SecurityRuleProfileForm';
import { SecurityRuleAssignment } from '@/components/security/SecurityRuleAssignment';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Shield, Plus, Pencil, Copy, Power, Trash2, Loader2, Users, AlertCircle } from 'lucide-react';

export default function SecurityRulesPage() {
  const { user, loading: authLoading } = useAuth();
  const { isSeller, loading: sellerLoading } = useSellerProfile(user?.id);
  const navigate = useNavigate();
  const { toast } = useToast();
  const sr = useSecurityRules();

  // Guard: só master. Vendedor → /dashboard com toast.
  useEffect(() => {
    if (!authLoading && !sellerLoading && isSeller) {
      toast({ title: 'Acesso negado', description: 'Apenas o administrador da conta acessa as Regras de Segurança.', variant: 'destructive' });
      navigate('/dashboard', { replace: true });
    }
  }, [authLoading, sellerLoading, isSeller, navigate, toast]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [step, setStep] = useState<'form' | 'assign'>('form');
  const [editing, setEditing] = useState<ProfileWithAssignments | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProfileWithAssignments | null>(null);

  const openNew = () => { setEditing(null); setActiveProfileId(null); setStep('form'); setDialogOpen(true); };
  const openEdit = (p: ProfileWithAssignments) => { setEditing(p); setActiveProfileId(p.id); setStep('form'); setDialogOpen(true); };

  const handleSaveProfile = async (input: SecurityRuleProfileInput) => {
    setSaving(true);
    try {
      let id = activeProfileId;
      if (editing) { await sr.updateProfile(editing.id, input); id = editing.id; }
      else { const created = await sr.createProfile(input); id = created.id; }
      setActiveProfileId(id);
      await sr.refresh();
      setStep('assign'); // após salvar, mostra a atribuição
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e?.message || 'Tente novamente.', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const handleSaveAssignment = async (type: AssignmentTargetType, ids: string[]) => {
    if (!activeProfileId) return;
    setSaving(true);
    try {
      await sr.saveAssignment(activeProfileId, type, ids);
      await sr.refresh();
      toast({ title: 'Pronto!', description: 'Perfil e atribuição salvos.' });
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: 'Erro ao atribuir', description: e?.message || 'Tente novamente.', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const doToggle = async (p: ProfileWithAssignments) => {
    try { await sr.toggleProfile(p.id, !p.is_active); await sr.refresh(); }
    catch (e: any) { toast({ title: 'Erro', description: e?.message, variant: 'destructive' }); }
  };
  const doDuplicate = async (p: ProfileWithAssignments) => {
    try { await sr.duplicateProfile(p.id); await sr.refresh(); toast({ title: 'Perfil duplicado' }); }
    catch (e: any) { toast({ title: 'Erro', description: e?.message, variant: 'destructive' }); }
  };
  const doDelete = async () => {
    if (!deleteTarget) return;
    try { await sr.deleteProfile(deleteTarget.id); await sr.refresh(); toast({ title: 'Perfil excluído' }); }
    catch (e: any) { toast({ title: 'Erro', description: e?.message, variant: 'destructive' }); }
    finally { setDeleteTarget(null); }
  };

  const assignSummary = (p: ProfileWithAssignments) => {
    if (!p.assignments?.length) return 'Sem atribuição';
    if (p.assignments.some((a) => a.target_type === 'all')) return 'Todos os vinculados';
    return `${p.assignments.length} membro(s)`;
  };

  if (authLoading || sellerLoading) {
    return <MainLayout><div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div></MainLayout>;
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-4 lg:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/20 border border-amber-500/30 flex items-center justify-center">
              <Shield className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold lg:text-3xl">Regras de Segurança</h1>
              <p className="text-sm text-muted-foreground">Limites que protegem seus números de WhatsApp de banimento — aplicados à equipe.</p>
            </div>
          </div>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo Perfil de Regras</Button>
        </div>

        {sr.error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> {sr.error}
          </div>
        )}

        {/* Lista */}
        {sr.loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : sr.profiles.length === 0 ? (
          <Card className="border-dashed"><CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Shield className="h-10 w-10 text-muted-foreground/40" />
            <div><p className="font-semibold">Nenhum perfil de regras ainda</p>
              <p className="text-sm text-muted-foreground">Crie o primeiro perfil para travar limites e proteger seus números.</p></div>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Criar primeiro perfil</Button>
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sr.profiles.map((p) => (
              <Card key={p.id} className={`border-border/60 ${p.is_active ? '' : 'opacity-75'}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-bold truncate">{p.name}</h3>
                        <Badge className={p.is_active ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' : 'bg-muted text-muted-foreground'}>{p.is_active ? 'Ativo' : 'Inativo'}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{summarizeProfile(p)}</p>
                      <p className="text-[11px] text-muted-foreground mt-2 inline-flex items-center gap-1"><Users className="h-3 w-3" /> {assignSummary(p)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-4 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar</Button>
                    <Button size="sm" variant="outline" onClick={() => doDuplicate(p)}><Copy className="h-3.5 w-3.5 mr-1.5" /> Duplicar</Button>
                    <Button size="sm" variant="outline" onClick={() => doToggle(p)}><Power className="h-3.5 w-3.5 mr-1.5" /> {p.is_active ? 'Desativar' : 'Ativar'}</Button>
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialog: formulário -> atribuição */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!saving) setDialogOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{step === 'form' ? (editing ? 'Editar perfil de regras' : 'Novo perfil de regras') : 'Atribuir o perfil'}</DialogTitle>
            <DialogDescription>{step === 'form' ? 'Defina os limites que protegem seus números.' : 'Escolha a quem este perfil se aplica.'}</DialogDescription>
          </DialogHeader>
          {step === 'form' ? (
            <SecurityRuleProfileForm initial={editing} saving={saving} onSave={handleSaveProfile} onCancel={() => setDialogOpen(false)} />
          ) : (
            <SecurityRuleAssignment
              members={sr.members}
              initial={editing?.assignments}
              saving={saving}
              onSave={handleSaveAssignment}
              onSkip={() => { setDialogOpen(false); toast({ title: 'Perfil salvo', description: 'Você pode atribuir depois pelo botão Editar.' }); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este perfil?</AlertDialogTitle>
            <AlertDialogDescription>O perfil "{deleteTarget?.name}" e suas atribuições serão removidos. Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
}
