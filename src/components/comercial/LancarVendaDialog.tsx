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
import { ORIGENS, type OrigemVenda, type VendedorComercial, type VendaComercial } from '@/types/comercial';
import { Loader2, Trash2 } from 'lucide-react';

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
  /** Se passado, o modal entra em modo EDIÇÃO (corrige/exclui esta venda) em vez de lançar. */
  venda?: VendaComercial | null;
}

export function LancarVendaDialog({
  open, onOpenChange, ownerUserId, isSeller, currentSellerId, currentSellerName, sellers, onSaved, venda,
}: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const isEdit = !!venda;
  const [form, setForm] = useState({
    seller_id: '', data_venda: hoje(), valor: '', origem: '' as '' | OrigemVenda,
    portal: '', veiculo: '', observacao: '',
    // Dados do lead (usados só ao LANÇAR — a venda cria o lead no CRM).
    nome: '', telefone: '', cidade: '',
  });

  // Ao abrir: modo EDIÇÃO pré-preenche com a venda; modo LANÇAR começa em branco
  // (pro vendedor já fixa o seller_id dele).
  useEffect(() => {
    if (open) {
      if (venda) {
        setForm({
          seller_id: venda.seller_id || '',
          data_venda: venda.data_venda || hoje(),
          valor: venda.valor != null ? String(venda.valor) : '',
          origem: (venda.origem || '') as '' | OrigemVenda,
          portal: venda.portal || '',
          veiculo: venda.veiculo || '',
          observacao: venda.observacao || '',
          nome: '', telefone: '', cidade: '',
        });
      } else {
        setForm({
          seller_id: isSeller ? (currentSellerId || '') : '',
          data_venda: hoje(), valor: '', origem: '', portal: '', veiculo: '', observacao: '',
          nome: '', telefone: '', cidade: '',
        });
      }
    }
  }, [open, isSeller, currentSellerId, venda]);

  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Valor é OPCIONAL: vazio/inválido conta como 0 (a venda entra na quantidade/meta, só não puxa ticket médio).
    const valorParsed = Number(String(form.valor).replace(',', '.'));
    const valorNum = Number.isFinite(valorParsed) && valorParsed > 0 ? valorParsed : 0;
    if (!form.seller_id) { toast({ title: 'Selecione o vendedor', variant: 'destructive' }); return; }
    if (!form.data_venda) { toast({ title: 'Informe a data da venda', variant: 'destructive' }); return; }
    if (!form.origem) { toast({ title: 'Selecione a origem', variant: 'destructive' }); return; }
    const telDigits = form.telefone.replace(/\D/g, '');
    if (!isEdit && form.origem === 'trafego' && telDigits.length < 10) {
      toast({ title: 'Telefone é obrigatório no tráfego pago', description: 'A venda de tráfego vira lead do Pedro (WhatsApp), que precisa do número.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        // EDIÇÃO: só atualiza a própria venda (não mexe no lead).
        const { error } = await (supabase as any).from('comercial_vendas').update({
          seller_id: form.seller_id,
          data_venda: form.data_venda,
          valor: valorNum,
          origem: form.origem,
          portal: form.origem === 'portais' ? (form.portal.trim() || null) : null,
          veiculo: form.veiculo.trim() || null,
          observacao: form.observacao.trim() || null,
        }).eq('id', venda!.id);
        if (error) throw error;
        toast({ title: 'Venda atualizada!', description: 'O painel comercial já foi atualizado.' });
      } else {
        // LANÇAR: cria o lead no CRM certo (Pedro se tráfego; Marcos senão), atribui ao
        // vendedor e marca fechado -> o gatilho gera a venda LIGADA (nada fica solto).
        const { error } = await (supabase as any).rpc('comercial_lancar_venda', {
          p_seller_id: form.seller_id,
          p_origem: form.origem,
          p_data_venda: form.data_venda,
          p_valor: valorNum,
          p_nome: form.nome.trim() || null,
          p_telefone: telDigits || null,
          p_cidade: form.cidade.trim() || null,
          p_veiculo: form.veiculo.trim() || null,
          p_observacao: form.observacao.trim() || null,
          p_portal: form.origem === 'portais' ? (form.portal.trim() || null) : null,
        });
        if (error) throw error;
        toast({
          title: 'Venda lançada!',
          description: form.origem === 'trafego'
            ? 'Lead criado no Pedro e venda atribuída ao vendedor.'
            : 'Lead criado no Marcos (Venda concluída) e venda atribuída ao vendedor.',
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: isEdit ? 'Erro ao salvar a venda' : 'Erro ao lançar venda', description: err?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // Excluir venda lançada (só gestor — RLS do vendedor não tem delete).
  const handleDelete = async () => {
    if (!venda) return;
    if (!window.confirm('Excluir esta venda? Essa ação não pode ser desfeita.')) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from('comercial_vendas').delete().eq('id', venda.id);
      if (error) throw error;
      toast({ title: 'Venda excluída', description: 'O painel comercial já foi atualizado.' });
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Erro ao excluir', description: err?.message || 'Tente novamente.', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar venda' : 'Lançar venda'}</DialogTitle>
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

            {/* Campos do lead — só ao LANÇAR (a venda cria o lead no CRM, não fica solta) */}
            {!isEdit && (
              <>
                <p className="col-span-2 text-[11px] text-muted-foreground leading-snug -mt-1">
                  Ao lançar, o cliente vira um lead no CRM (tráfego pago → Pedro; demais origens → Marcos), atribuído ao vendedor e marcado como venda concluída.
                </p>
                <div>
                  <Label>Nome do cliente</Label>
                  <Input placeholder="Nome do lead" value={form.nome} onChange={(e) => set({ nome: e.target.value })} />
                </div>
                <div>
                  <Label>Telefone{form.origem === 'trafego' ? ' *' : ''}</Label>
                  <Input placeholder="5512999999999" value={form.telefone}
                    onChange={(e) => set({ telefone: e.target.value.replace(/[^\d]/g, '') })} />
                </div>
              </>
            )}

            {/* Data */}
            <div>
              <Label>Data da venda *</Label>
              <Input type="date" value={form.data_venda} onChange={(e) => set({ data_venda: e.target.value })} />
            </div>

            {/* Valor */}
            <div>
              <Label>Valor (R$)</Label>
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

            {/* Cidade — só ao lançar (campo do lead) */}
            {!isEdit && (
              <div className="col-span-2">
                <Label>Cidade</Label>
                <Input placeholder="Cidade do cliente" value={form.cidade} onChange={(e) => set({ cidade: e.target.value })} />
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
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              {isEdit && !isSeller && (
                <Button type="button" variant="ghost" className="text-red-500 hover:text-red-600 gap-1.5"
                  onClick={handleDelete} disabled={saving}>
                  <Trash2 className="h-4 w-4" /> Excluir
                </Button>
              )}
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Salvando…</> : (isEdit ? 'Salvar alterações' : 'Salvar venda')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
