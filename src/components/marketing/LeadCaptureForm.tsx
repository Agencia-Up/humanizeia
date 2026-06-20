import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';

// CTA primário da home/páginas de detalhe: captura o lead (grava em site_leads)
// e dispara o evento "Lead" do Pixel. NAO redireciona — o Wander entra em contato
// pelo WhatsApp do lead pra marcar reunião e fechar.

export function LeadCaptureForm({
  open, onOpenChange, origem,
}: { open: boolean; onOpenChange: (o: boolean) => void; origem?: string }) {
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(false);

  const reset = (closing: boolean) => {
    if (closing) {
      setNome(''); setWhatsapp(''); setEmail(''); setMensagem('');
      setSent(false);
    }
    onOpenChange(closing ? false : true);
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
      try { (window as any).fbq?.('track', 'Lead'); } catch { /* pixel opcional */ }
      setSent(true);
    } catch {
      toast.error('Não conseguimos registrar agora. Tente de novo em alguns segundos.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => reset(!o)}>
      <DialogContent className="sm:max-w-md">
        {sent ? (
          <div className="flex flex-col items-center text-center py-4 px-1 space-y-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <DialogTitle className="text-xl">Recebido!</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Em breve falo com você no WhatsApp pra entender seu cenário e marcar uma reunião rápida.
            </DialogDescription>
            <Button onClick={() => reset(true)} className="mt-2 bg-primary text-primary-foreground hover:bg-primary/90 px-6">Fechar</Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Quase lá — me deixa um contato</DialogTitle>
              <DialogDescription>
                Vou falar com você no WhatsApp pra entender o que precisa e marcar uma reunião rápida.
              </DialogDescription>
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
                <Label htmlFor="lead-email">E-mail *</Label>
                <Input id="lead-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@empresa.com" required />
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
                Quero falar com a Logos IA
              </Button>
              <p className="text-center text-[11px] text-muted-foreground">A gente fala com você no WhatsApp em poucas horas.</p>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
