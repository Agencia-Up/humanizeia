import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, ArrowRight } from 'lucide-react';

// CTA primário da home/páginas de detalhe: captura o lead (grava em site_leads),
// dispara o evento "Lead" do Pixel e segue pro checkout (mantém o funil).
const PRO_CHECKOUT_URL = '/checkout?plano=pro&ciclo=mensal';

export function LeadCaptureForm({
  open, onOpenChange, origem,
}: { open: boolean; onOpenChange: (o: boolean) => void; origem?: string }) {
  const navigate = useNavigate();
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [saving, setSaving] = useState(false);

  const proceed = () => {
    try { (window as any).fbq?.('track', 'Lead'); } catch { /* pixel opcional */ }
    onOpenChange(false);
    navigate(PRO_CHECKOUT_URL);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || !whatsapp.trim()) { toast.error('Preencha nome e WhatsApp.'); return; }
    setSaving(true);
    try {
      await (supabase as any).from('site_leads').insert({
        nome: nome.trim(),
        whatsapp: whatsapp.replace(/\D/g, ''),
        email: email.trim() || null,
        mensagem: mensagem.trim() || null,
        origem: origem || 'home',
      });
      toast.success('Recebemos seu contato! Vamos pro próximo passo.');
    } catch {
      // Nunca trava o lead: se gravar falhar, segue pro checkout do mesmo jeito.
    } finally {
      setSaving(false);
      proceed();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quase lá — pra onde te chamo?</DialogTitle>
          <DialogDescription>Deixe seu contato que a gente te coloca no ar em minutos.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="lead-nome">Nome *</Label>
            <Input id="lead-nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-wa">WhatsApp *</Label>
            <Input id="lead-wa" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="(34) 99999-9999" inputMode="tel" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-email">E-mail (opcional)</Label>
            <Input id="lead-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@empresa.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-msg">O que você precisa? (opcional)</Label>
            <textarea
              id="lead-msg" value={mensagem} onChange={e => setMensagem(e.target.value)} rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Ex: quero o Pedro atendendo meu WhatsApp"
            />
          </div>
          <Button type="submit" disabled={saving} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
            Continuar
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">⚡ No ar em 5 minutos · Sem fidelidade</p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
