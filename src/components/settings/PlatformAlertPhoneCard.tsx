import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { BellRing, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';

/**
 * PlatformAlertPhoneCard — ADMIN ONLY.
 * WhatsApp do DONO da plataforma que recebe o alerta quando a NOSSA chave de IA
 * (contas grandfathered) falha por falta de crédito / chave inválida. Guardado em
 * platform_settings via RPC (só superadmin lê/grava). Não confundir com o
 * "WhatsApp do Gerente" (por agente, na aba Vendedores), que avisa o cliente.
 */
export function PlatformAlertPhoneCard() {
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.rpc('get_platform_alert_phone');
    if (!error) {
      const v = (data as string | null) || '';
      setSaved(v || null);
      setPhone(v);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('set_platform_alert_phone', { p_phone: phone });
      if (error) throw new Error(error.message);
      const clean = (data as string | null) || null;
      setSaved(clean);
      setPhone(clean || '');
      toast({
        title: clean ? '✅ Telefone salvo' : 'Telefone removido',
        description: clean
          ? 'Você receberá o alerta quando a nossa chave de IA ficar sem crédito.'
          : 'O alerta da plataforma ficará só no log.',
      });
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-amber-500/30 bg-amber-500/5 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-amber-400" />
          <CardTitle>Alerta da plataforma (admin)</CardTitle>
        </div>
        <CardDescription>
          WhatsApp que recebe o aviso quando a <strong>nossa</strong> chave de IA das contas
          atuais ficar sem crédito ou inválida — pra você recarregar antes que o atendimento pare.
          Diferente do <em>WhatsApp do Gerente</em> (na aba Vendedores de cada agente), que avisa o cliente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <Label className="font-semibold">Seu WhatsApp</Label>
              {saved ? (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500">
                  <CheckCircle2 className="h-3 w-3" /> Configurado
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-400">
                  <ShieldAlert className="h-3 w-3" /> Só no log
                </Badge>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="tel"
                inputMode="numeric"
                placeholder="Ex.: 5512999998888 (com DDI 55 + DDD)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-background/60 font-mono text-sm"
              />
              <Button onClick={handleSave} disabled={saving} className="shrink-0">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Deixe em branco e salve para desativar (o alerta continua sendo registrado no log).
              Inclua o código do país (55) e o DDD.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
