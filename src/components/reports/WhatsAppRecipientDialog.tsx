import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface WhatsAppRecipientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  onSend: (destinatarioIds: string[]) => void;
  isSending?: boolean;
}

export function WhatsAppRecipientDialog({ open, onOpenChange, templateId, onSend, isSending }: WhatsAppRecipientDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [newNumero, setNewNumero] = useState('');

  const { data: destinatarios = [] } = useQuery({
    queryKey: ['whatsapp-destinatarios', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('whatsapp_destinatarios').select('*').order('nome');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && open,
  });

  const addDestinatario = useMutation({
    mutationFn: async () => {
      if (!newName || !newNumero) throw new Error('Preencha nome e número');
      const { error } = await supabase.from('whatsapp_destinatarios').insert({
        user_id: user!.id,
        nome: newName,
        numero: newNumero.replace(/\D/g, ''),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-destinatarios'] });
      setNewName('');
      setNewNumero('');
      toast.success('Destinatário adicionado');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteDestinatario = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('whatsapp_destinatarios').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp-destinatarios'] });
      toast.success('Removido');
    },
  });

  const toggleSelect = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Selecionar Destinatários</DialogTitle>
          <DialogDescription>Escolha para quem enviar o report via WhatsApp</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Add new */}
          <div className="flex gap-2">
            <Input placeholder="Nome" value={newName} onChange={e => setNewName(e.target.value)} className="flex-1" />
            <Input placeholder="5511999..." value={newNumero} onChange={e => setNewNumero(e.target.value)} className="flex-1" />
            <Button size="icon" variant="outline" onClick={() => addDestinatario.mutate()} disabled={addDestinatario.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          {/* List */}
          <div className="max-h-60 space-y-2 overflow-y-auto">
            {destinatarios.map((d: any) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-3">
                <Checkbox checked={selected.includes(d.id)} onCheckedChange={() => toggleSelect(d.id)} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{d.nome}</p>
                  <p className="text-xs text-muted-foreground">{d.numero}</p>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deleteDestinatario.mutate(d.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {destinatarios.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-4">Nenhum destinatário. Adicione acima.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onSend(selected)} disabled={selected.length === 0 || isSending} className="gradient-primary">
            <Send className="mr-2 h-4 w-4" />
            {isSending ? 'Enviando...' : `Enviar (${selected.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
