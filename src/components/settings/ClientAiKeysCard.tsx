import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { KeyRound, CheckCircle2, Loader2, Trash2, ShieldCheck } from 'lucide-react';

/**
 * ClientAiKeysCard — BYOK ("traga sua chave de IA")
 * O cliente cola a chave da OpenAI dele. Fica CIFRADA no Vault (via RPC
 * save_my_ai_key). Quando configurada, os agentes passam a usar a chave dele
 * em vez da nossa — conversas ilimitadas por conta do cliente.
 * SO OpenAI por padrao (decisao 16/06): outros provedores foram tirados da UI
 * pra evitar agentes que nao funcionam bem (ex.: reply quebra no Claude). O
 * backend segue aceitando os 3, mas a tela so oferece OpenAI.
 */

type Provider = 'openai' | 'anthropic' | 'deepseek';

// Apenas OpenAI: padronizado p/ evitar agentes que nao funcionam bem em outros provedores.
// Todo cliente novo PRECISA cadastrar a chave da OpenAI para o agente de atendimento responder.
const PROVIDERS: { id: Provider; label: string; hint: string; placeholder: string }[] = [
  { id: 'openai', label: 'OpenAI', hint: 'Obrigatória — o agente de atendimento responde usando a sua chave da OpenAI. Gere em platform.openai.com/api-keys.', placeholder: 'sk-...' },
];

interface KeyStatus { is_set: boolean; last4: string | null; }

export function ClientAiKeysCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Record<string, KeyStatus>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  const loadStatus = async () => {
    const { data, error } = await supabase.rpc('my_ai_key_status');
    if (!error && Array.isArray(data)) {
      const map: Record<string, KeyStatus> = {};
      for (const row of data as any[]) map[row.provider] = { is_set: !!row.is_set, last4: row.last4 ?? null };
      setStatus(map);
    }
    setLoading(false);
  };

  useEffect(() => { loadStatus(); }, []);

  const setBusyFor = (p: Provider, v: string | null) => setBusy((b) => ({ ...b, [p]: v }));

  const handleTest = async (p: Provider) => {
    const key = (drafts[p] || '').trim();
    if (key.length < 12) { toast({ title: 'Cole a chave primeiro', variant: 'destructive' }); return; }
    setBusyFor(p, 'test');
    try {
      const { data, error } = await supabase.functions.invoke('ai-key-test', { body: { provider: p, key } });
      if (error) throw new Error(error.message);
      if (data?.ok) toast({ title: '✅ Chave válida', description: data.detail });
      else toast({ title: 'Chave não passou no teste', description: data?.detail || 'Verifique a chave.', variant: 'destructive' });
    } catch (e: any) {
      toast({ title: 'Erro ao testar', description: e?.message, variant: 'destructive' });
    } finally { setBusyFor(p, null); }
  };

  const handleSave = async (p: Provider) => {
    const key = (drafts[p] || '').trim();
    if (key.length < 12) { toast({ title: 'Cole a chave primeiro', variant: 'destructive' }); return; }
    setBusyFor(p, 'save');
    try {
      const { error } = await supabase.rpc('save_my_ai_key', { p_provider: p, p_key: key });
      if (error) throw new Error(error.message);
      toast({ title: 'Chave salva', description: 'Guardada de forma cifrada. Os agentes vão usar a sua chave.' });
      setDrafts((d) => ({ ...d, [p]: '' }));
      await loadStatus();
    } catch (e: any) {
      toast({ title: 'Erro ao salvar', description: e?.message, variant: 'destructive' });
    } finally { setBusyFor(p, null); }
  };

  const handleRemove = async (p: Provider) => {
    setBusyFor(p, 'remove');
    try {
      const { error } = await supabase.rpc('remove_my_ai_key', { p_provider: p });
      if (error) throw new Error(error.message);
      toast({ title: 'Chave removida', description: 'Voltamos a usar a configuração padrão da plataforma.' });
      await loadStatus();
    } catch (e: any) {
      toast({ title: 'Erro ao remover', description: e?.message, variant: 'destructive' });
    } finally { setBusyFor(p, null); }
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <CardTitle>Sua chave de IA</CardTitle>
        </div>
        <CardDescription>
          Use a sua própria chave de IA e tenha <strong>conversas ilimitadas</strong> — o consumo
          passa a ser cobrado na sua conta do provedor, não na nossa. A chave fica
          guardada cifrada (cofre Vault) e nunca aparece de volta na tela.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          PROVIDERS.map((prov) => {
            const st = status[prov.id];
            const b = busy[prov.id];
            return (
              <div key={prov.id} className="rounded-lg border border-border/40 bg-background/40 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="font-semibold">{prov.label}</Label>
                  {st?.is_set ? (
                    <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-500">
                      <CheckCircle2 className="h-3 w-3" />
                      Configurada{st.last4 ? ` · final ${st.last4}` : ''}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Usando a nossa chave</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{prov.hint}</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={st?.is_set ? 'Cole uma nova chave para trocar…' : prov.placeholder}
                    value={drafts[prov.id] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [prov.id]: e.target.value }))}
                    className="bg-background/60 font-mono text-sm"
                  />
                  <div className="flex gap-2 shrink-0">
                    <Button variant="outline" onClick={() => handleTest(prov.id)} disabled={!!b}>
                      {b === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Testar'}
                    </Button>
                    <Button onClick={() => handleSave(prov.id)} disabled={!!b}>
                      {b === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
                    </Button>
                    {st?.is_set && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remover chave"
                        onClick={() => handleRemove(prov.id)}
                        disabled={!!b}
                      >
                        {b === 'remove' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
          <span>
            Guardada com criptografia no cofre do Supabase (Vault). Só os agentes leem a chave
            no momento de responder — ela nunca é exibida de volta nem sai pra outro lugar.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
