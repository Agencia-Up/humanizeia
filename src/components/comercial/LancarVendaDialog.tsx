// ============================================================================
// LancarVendaDialog — lançamento manual de venda (modal).
// Padrão do projeto: Dialog + useState local + shadcn + useToast (sem RHF).
// Vendedor: auto pro vendedor logado; selecionável pro gestor. `portal` só
// aparece quando origem = 'portais'. Insere em comercial_vendas.
// ============================================================================
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ORIGENS, type OrigemVenda, type VendedorComercial } from '@/types/comercial';
import { Loader2 } from 'lucide-react';

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** user_id do dono (gestor = próprio; vendedor = master). */
  ownerUserId: string;
  isSeller: boolean;
  /** id de ai_team_members do vendedor logado (quando isSeller). */
  currentSellerId: string | null;
  currentSellerName?: string;
  /** lista de vendedores (gestor escolhe). */
  sellers: VendedorComercial[];
  onSaved: () => void;
}

export function LancarVendaDialog({
  open, onOpenChange, ownerUserId, isSeller, currentSellerId, currentSellerName, sellers, onSaved,
}: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    seller_id: '', data_venda: hoje(), valor: '', origem: '' as '' | OrigemVenda,
    portal: '', veiculo: '', observacao: '',
  });

  // Reseta ao abrir; pro vendedor já fixa o seller_id dele.
  useEffect(() => {
    if (open) {
      setForm({
        seller_id: isSeller ? (currentSellerId || '') : '',
        data_venda: hoje(), valor: '', origem: '', portal: '', veiculo: '', observacao: '',
      });
    }
  }, [open, isSeller, currentSellerId]);

  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valorNum = Number(String(form.valor).replace(',', '.'));
    if (!form.seller_id) { toast({ title: 'Selecione o vendedor', variant: 'destructive' }); return; }
    if (!form.data_venda) { toast({ title: 'Informe a data da venda', variant: 'destructive' }); return; }
    if (!form.origem) { toast({ title: 'Selecione a origem', variant: 'destructive' }); return; }
    if (!(valorNum > 0)) { toast({ title: 'Informe um valor válido', variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const { error } = await (supabase as any).from('comercial_vendas').insert({
        user_id: ownerUserId,
        seller_id: form.seller_id,
        data_venda: form.data_venda,
        valor: valorNum,
        origem: form.origem,
        portal: form.origem === 'portais' ? (form.portal.trim() || null) : null,
        veiculo: form.veiculo.trim() || null,
        observacao: form.observacao.trim() || null,
      });
      if (error) throw error;
      toast({ title: 'Venda lançada!', description: 'O painel comercial já foi atualizado.' });
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Erro ao lançar venda', description: err?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lançar venda</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Vendedor */}
            <div className="col-span-2">
              <Label>Vendedor *</Label>
              {isSeller ? (
                <Input value={currentSellerName || 'Você'} disabled />
              ) : (
                <Select value={form.seller_id} onValueChange={(v) => set({ seller_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione o vendedor" /></SelectTrigger>
                  <SelectContent>
                    {sellers.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Data */}
            <div>
              <Label>Data da venda *</Label>
              <Input type="date" value={form.data_venda} onChange={(e) => set({ data_venda: e.target.value })} />
            </div>

            {/* Valor */}
            <div>
              <Label>Valor (R$) *</Label>
              <Input type="number" min="0" step="0.01" placeholder="0,00"
                value={form.valor} onChange={(e) => set({ valor: e.target.value })} />
            </div>

            {/* Origem */}
            <div className={form.origem === 'portais' ? '' : 'col-span-2'}>
              <Label>Origem *</Label>
              <Select value={form.origem} onValueChange={(v) => set({ origem: v as OrigemVenda })}>
                <SelectTrigger><SelectValue placeholder="Selecione a origem" /></SelectTrigger>
                <SelectContent>
                  {ORIGENS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Portal (condicional) */}
            {form.origem === 'portais' && (
              <div>
                <Label>Portal</Label>
                <Input placeholder="Webmotors, OLX, iCarros…"
                  value={form.portal} onChange={(e) => set({ portal: e.target.value })} />
              </div>
            )}

            {/* Veículo */}
            <div className="col-span-2">
              <Label>Veículo</Label>
              <Input placeholder="Ex.: Jeep Compass 2022"
                value={form.veiculo} onChange={(e) => set({ veiculo: e.target.value })} />
            </div>

            {/* Observação */}
            <div className="col-span-2">
              <Label>Observação</Label>
              <Textarea rows={2} placeholder="Opcional"
                value={form.observacao} onChange={(e) => set({ observacao: e.target.value })} />
            </div>
          </div>

          <div className="flex justify-between pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Salvando…</> : 'Salvar venda'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
