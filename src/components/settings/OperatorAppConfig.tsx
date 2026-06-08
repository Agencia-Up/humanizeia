// ============================================================================
// OperatorAppConfig
// ----------------------------------------------------------------------------
// Seçao "Configuraçao do app" que aparece DENTRO do modal de cada conexao,
// VISIVEL SO PARA O ADMIN da plataforma (useIsAdmin). Aqui o operador cola as
// chaves do app que ele criou (Meta, Google Ads, TikTok). Os valores sao
// salvos via a edge function platform-app-credentials (admin-only) e NUNCA
// voltam pra tela — so um indicador "configurado".
//
// O passo a passo de CLIENTE (conectar a conta) continua no mesmo modal; este
// bloco e a parte de bastidor que so o dono da plataforma enxerga.
// ============================================================================

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldAlert, CheckCircle2, Copy, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type FieldDef = { key: 'app_id' | 'app_secret' | `extra.${string}`; label: string; secret?: boolean };

interface ProviderCfg {
  provider: 'meta' | 'google_ads' | 'tiktok';
  title: string;
  fields: FieldDef[];
  redirect: string;
  note?: string;
}

const PROVIDER_MAP: Record<string, ProviderCfg> = {
  meta: {
    provider: 'meta',
    title: 'App da Meta (Facebook)',
    fields: [
      { key: 'app_id', label: 'App ID (META_APP_ID)' },
      { key: 'app_secret', label: 'App Secret (META_APP_SECRET)', secret: true },
    ],
    redirect: 'https://humanizeia.lovable.app/settings?meta_callback=true',
  },
  instagram_publisher: {
    provider: 'meta',
    title: 'App da Meta (o Instagram usa o mesmo app)',
    fields: [
      { key: 'app_id', label: 'App ID (META_APP_ID)' },
      { key: 'app_secret', label: 'App Secret (META_APP_SECRET)', secret: true },
    ],
    redirect: 'https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/instagram-publish-oauth',
    note: 'Instagram e Meta Ads compartilham o MESMO app. Configurar aqui vale pros dois.',
  },
  google_ads: {
    provider: 'google_ads',
    title: 'App do Google (Google Ads)',
    fields: [
      { key: 'app_id', label: 'Client ID (GOOGLE_CLIENT_ID)' },
      { key: 'app_secret', label: 'Client Secret (GOOGLE_CLIENT_SECRET)', secret: true },
      { key: 'extra.developer_token', label: 'Developer Token (GOOGLE_ADS_DEVELOPER_TOKEN)', secret: true },
    ],
    redirect: 'https://humanizeia.lovable.app/settings?google_callback=true',
  },
  tiktok: {
    provider: 'tiktok',
    title: 'App do TikTok',
    fields: [
      { key: 'app_id', label: 'App ID (TIKTOK_APP_ID)' },
      { key: 'app_secret', label: 'App Secret (TIKTOK_APP_SECRET)', secret: true },
    ],
    redirect: 'https://humanizeia.lovable.app/connect-accounts?tiktok_callback=true',
  },
};

export function OperatorAppConfig({ platformId }: { platformId: string }) {
  const cfg = PROVIDER_MAP[platformId];
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const loadStatus = async () => {
    if (!cfg) return;
    const { data, error } = await supabase.functions.invoke('platform-app-credentials', {
      body: { action: 'status' },
    });
    if (error) throw error;
    setStatus(data?.status?.[cfg.provider] || null);
  };

  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadStatus();
      } catch {
        if (!cancelled) toast.error('Nao foi possivel carregar o status das chaves.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platformId]);

  if (!cfg) return null;

  const redirectUrl =
    platformId === 'meta' && typeof window !== 'undefined'
      ? `${window.location.origin}/api/meta/callback`
      : cfg.redirect;

  const isSet = (f: FieldDef) => {
    if (f.key === 'app_id') return !!status?.app_id_set;
    if (f.key === 'app_secret') return !!status?.app_secret_set;
    if (f.key.startsWith('extra.')) return !!status?.extra?.[f.key.slice(6)];
    return false;
  };

  const handleSave = async () => {
    const anyValue = cfg.fields.some((f) => (values[f.key] || '').trim());
    if (!anyValue) {
      toast.info('Cole ao menos uma chave para salvar.');
      return;
    }
    setSaving(true);
    try {
      const payload: any = { action: 'save', provider: cfg.provider, extra: {} };
      for (const f of cfg.fields) {
        const v = (values[f.key] || '').trim();
        if (!v) continue;
        if (f.key.startsWith('extra.')) payload.extra[f.key.slice(6)] = v;
        else payload[f.key] = v;
      }
      const { error } = await supabase.functions.invoke('platform-app-credentials', { body: payload });
      if (error) throw error;
      toast.success('Chaves salvas com seguranca.');
      setValues({});
      await loadStatus();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao salvar as chaves.');
    } finally {
      setSaving(false);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(redirectUrl);
    toast.success('URL copiada');
  };

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0" />
        <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
          Configuração do app — só você (admin) vê isto
        </p>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {cfg.title}. Cole as chaves do app que você criou. Os valores ficam guardados com segurança e
        nunca aparecem de volta na tela.{cfg.note ? ` ${cfg.note}` : ''}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando status...
        </div>
      ) : (
        <div className="space-y-2.5">
          {cfg.fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label className="text-[11px] flex items-center gap-1.5">
                {f.label}
                {isSet(f) && (
                  <span className="inline-flex items-center gap-0.5 text-emerald-500">
                    <CheckCircle2 className="h-3 w-3" /> configurado
                  </span>
                )}
              </Label>
              <Input
                type={f.secret ? 'password' : 'text'}
                value={values[f.key] || ''}
                onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                placeholder={isSet(f) ? '•••••• (em branco mantém o atual)' : 'Cole aqui'}
                className="h-8 text-xs font-mono"
                autoComplete="off"
              />
            </div>
          ))}

          <div className="space-y-1">
            <Label className="text-[11px]">URL de retorno (cole no painel da Meta/Google)</Label>
            <div className="flex gap-1.5">
              <Input
                readOnly
                value={redirectUrl}
                className="h-8 text-[11px] font-mono"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button type="button" variant="outline" size="sm" className="h-8 px-2 shrink-0" onClick={copy}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <Button size="sm" className="w-full h-8 text-xs" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Salvar chaves
          </Button>
        </div>
      )}
    </div>
  );
}

export default OperatorAppConfig;
