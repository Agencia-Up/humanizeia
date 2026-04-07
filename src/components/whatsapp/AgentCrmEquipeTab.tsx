import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Users, UserPlus, Phone, Loader2, Trash2, PhoneForwarded } from 'lucide-react';
import { Label } from '@/components/ui/label';

interface AgentCrmEquipeTabProps {
  agentId: string | null;
  userId: string;
}

export function AgentCrmEquipeTab({ agentId, userId }: AgentCrmEquipeTabProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);

  // Equipe State
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [newSellerName, setNewSellerName] = useState('');
  const [newSellerPhone, setNewSellerPhone] = useState('');
  const [savingSeller, setSavingSeller] = useState(false);

  const fetchData = useCallback(async () => {
    if (!agentId || !userId) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    try {
      const { data: teamData, error: teamErr } = await (supabase as any)
        .from('ai_team_members')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: true });
        
      if (teamErr) throw teamErr;
      setTeamMembers(teamData || []);

    } catch (err: any) {
      console.error('Erro ao carregar Equipe:', err);
    } finally {
      setLoading(false);
    }
  }, [agentId, userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddSeller = async () => {
    if (!agentId) return;
    if (!newSellerName.trim() || !newSellerPhone.trim()) {
      toast({ title: 'Aviso', description: 'Preencha nome e WhatsApp do vendedor.' });
      return;
    }

    setSavingSeller(true);
    try {
      const cleanPhone = newSellerPhone.replace(/\D/g, ''); // Apenas números
      const { error } = await (supabase as any).from('ai_team_members').insert({
        user_id: userId,
        agent_id: agentId,
        name: newSellerName.trim(),
        whatsapp_number: cleanPhone
      });

      if (error) throw error;
      
      toast({ title: 'Vendedor adicionado!' });
      setNewSellerName('');
      setNewSellerPhone('');
      fetchData();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setSavingSeller(false);
    }
  };

  const handleToggleSellerStatus = async (id: string, currentStatus: boolean) => {
    try {
      await (supabase as any).from('ai_team_members').update({ is_active: !currentStatus }).eq('id', id);
      setTeamMembers(prev => prev.map(m => m.id === id ? { ...m, is_active: !currentStatus } : m));
    } catch (err: any) {
      toast({ title: 'Erro', variant: 'destructive' });
    }
  };

  const handleDeleteSeller = async (id: string) => {
    if (!confirm('Excluir este vendedor da equipe?')) return;
    try {
      await (supabase as any).from('ai_team_members').delete().eq('id', id);
      setTeamMembers(prev => prev.filter(m => m.id !== id));
      toast({ title: 'Vendedor removido' });
    } catch (err: any) {
      toast({ title: 'Erro', variant: 'destructive' });
    }
  };

  if (!agentId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center bg-muted/20 border border-dashed rounded-xl">
        <Users className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
        <h3 className="text-sm font-semibold mb-1">Salve o agente primeiro</h3>
        <p className="text-xs text-muted-foreground max-w-[250px]">
          Você precisa criar o agente antes de cadastrar a equipe de transbordo.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
        <PhoneForwarded className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <strong>Inteligência Comercial:</strong> Quando o Pedro identificar clientes quentes e qualificá-los no CRM, ele automaticamente encaminhará o resumo da conversa via WhatsApp para os seus vendedores configurados nesta lista.
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-muted/30 p-3 rounded-xl border border-border flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Nome do Vendedor</Label>
            <Input 
              placeholder="Ex: João Silva" 
              value={newSellerName} 
              onChange={e => setNewSellerName(e.target.value)} 
              className="h-8 text-xs"
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Número WhatsApp</Label>
            <Input 
              placeholder="Ex: 5511999999999" 
              value={newSellerPhone} 
              onChange={e => setNewSellerPhone(e.target.value)} 
              className="h-8 text-xs font-mono"
            />
          </div>
          <Button size="sm" className="h-8 px-4 shrink-0 bg-blue-600 hover:bg-blue-700" onClick={handleAddSeller} disabled={savingSeller}>
            {savingSeller ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />} 
            Adicionar
          </Button>
        </div>

        <div className="space-y-2">
          {teamMembers.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">
              Sua equipe de atendimento está vazia.<br/>Adicione membros para permitir o transbordo ("Handoff") do Agente de IA.
            </div>
          ) : (
            teamMembers.map(member => (
              <div key={member.id} className="flex items-center justify-between p-3 border rounded-lg bg-card group hover:border-blue-500/30 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                    <UserPlus className="h-4 w-4 text-blue-500" />
                  </div>
                  <div>
                    <h5 className="text-sm font-semibold">{member.name}</h5>
                    <span className="text-xs text-muted-foreground flex items-center gap-1 font-mono mt-0.5">
                      <Phone className="h-3 w-3" /> {member.whatsapp_number}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-[10px] uppercase font-bold text-muted-foreground cursor-pointer" htmlFor={`status-${member.id}`}>
                      {member.is_active ? 'Disponível' : 'Ausente'}
                    </Label>
                    <Switch 
                      id={`status-${member.id}`} 
                      checked={member.is_active} 
                      onCheckedChange={() => handleToggleSellerStatus(member.id, member.is_active)}
                      className="scale-90"
                    />
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 w-7 p-0 text-red-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" 
                    onClick={() => handleDeleteSeller(member.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
