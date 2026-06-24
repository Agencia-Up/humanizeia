import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, PlayCircle, PauseCircle } from 'lucide-react';

// Indicador CLARO de José ligado/desligado, no topo do painel. Fala a língua certa (sem a inversão
// do kill-switch): selo verde "ATIVO" / vermelho "PARADO" + botão "Ligar"/"Pausar". Lê e grava o
// MESMO campo do botão de emergência (jose_spend_caps.kill_switch) -> os dois ficam sincronizados.
// kill_switch=true => José PARADO; false => ATIVO.
const db = supabase as any;

export function JoseStatusBadge() {
  const { user } = useAuth();
  const userId = user?.id || '';
  const [kill, setKill] = useState<boolean | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    (async () => {
      try {
        const { data } = await db.from('jose_spend_caps')
          .select('id, kill_switch').eq('user_id', userId)
          .order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (cancel) return;
        setRowId(data?.id || null);
        setKill(!!data?.kill_switch);
      } catch { if (!cancel) setKill(false); }
    })();
    return () => { cancel = true; };
  }, [userId]);

  const setKillSwitch = async (v: boolean) => {
    setSaving(true);
    try {
      if (rowId) {
        const { error } = await db.from('jose_spend_caps').update({ kill_switch: v, updated_at: new Date().toISOString() }).eq('id', rowId);
        if (error) throw error;
      } else {
        const { data, error } = await db.from('jose_spend_caps').insert({ user_id: userId, ad_account_id: null, kill_switch: v, updated_at: new Date().toISOString() }).select('id').maybeSingle();
        if (error) throw error;
        if (data?.id) setRowId(data.id);
      }
      setKill(v);
      toast.success(v ? 'José pausado. Ele não vai agir sozinho até você ligar.' : 'José ligado — voltou a agir.');
    } catch {
      toast.error('Não consegui mudar o estado do José agora.');
    } finally { setSaving(false); }
  };

  const pausar = () => {
    if (window.confirm('Pausar o José? Ele para de agir sozinho (auto-piloto, executar ações e relatório automático) até você ligar de novo. O chat continua respondendo.')) {
      setKillSwitch(true);
    }
  };

  if (!userId) return null;
  if (kill === null) {
    return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> verificando José…</span>;
  }

  const ativo = !kill;
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${ativo ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30' : 'bg-red-500/15 text-red-400 ring-red-500/30'}`}>
        <span className={`h-2 w-2 rounded-full ${ativo ? 'bg-emerald-500' : 'bg-red-500'}`} />
        José: {ativo ? 'ATIVO' : 'PARADO'}
      </span>
      {ativo ? (
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={pausar} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />} Pausar José
        </Button>
      ) : (
        <Button size="sm" className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white" onClick={() => setKillSwitch(false)} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />} Ligar José
        </Button>
      )}
    </div>
  );
}
