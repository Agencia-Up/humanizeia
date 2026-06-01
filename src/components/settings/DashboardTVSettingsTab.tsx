// ============================================================================
// DashboardTVSettingsTab
// ----------------------------------------------------------------------------
// Configuração do branding + fotos dos vendedores do Dashboard TV (/dashboard-tv).
//
// MVP — foto via URL (input text). Upgrade futuro: upload pra Supabase Storage.
// ============================================================================

import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Tv, Palette, Users, ExternalLink, Upload, Link2, Trash2 } from 'lucide-react';

interface BrandingForm {
  logo_url: string;
  company_name: string;
  primary_color: string;
  secondary_color: string;
}

interface SellerRow {
  id: string;
  name: string;
  whatsapp_number: string | null;
  is_active: boolean;
  /** Foto que o master subiu via esta UI. */
  profile_picture: string | null;
  /** Foto que o vendedor mesmo subiu em /perfil — TEM PRIORIDADE no Dashboard TV. */
  own_avatar_url: string | null;
  auth_user_id: string | null;
}

const DEFAULT_BRANDING: BrandingForm = {
  logo_url: '',
  company_name: '',
  primary_color: '#3b82f6',
  secondary_color: '#f59e0b',
};

function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hashColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  const colors = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
  return colors[Math.abs(h) % colors.length];
}

export function DashboardTVSettingsTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [savingBranding, setSavingBranding] = useState(false);
  const [branding, setBranding] = useState<BrandingForm>(DEFAULT_BRANDING);
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  // Edita 1 URL por vez (avoid double save)
  const [editingSellerId, setEditingSellerId] = useState<string | null>(null);
  const [editingUrl, setEditingUrl] = useState<string>('');
  const [savingSellerId, setSavingSellerId] = useState<string | null>(null);
  const [uploadingSellerId, setUploadingSellerId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetSellerId, setUploadTargetSellerId] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Load inicial
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [profileRes, sellersRes] = await Promise.all([
          (supabase as any)
            .from('profiles')
            .select('dashboard_tv_logo_url, dashboard_tv_company_name, dashboard_tv_primary_color, dashboard_tv_secondary_color, full_name, company_name')
            .eq('id', user.id)
            .maybeSingle(),
          (supabase as any)
            .from('ai_team_members')
            .select('id, name, whatsapp_number, is_active, profile_picture, auth_user_id')
            .eq('user_id', user.id)
            .order('is_active', { ascending: false })
            .order('name', { ascending: true }),
        ]);
        if (cancelled) return;
        const p = profileRes.data || {};
        setBranding({
          logo_url: p.dashboard_tv_logo_url || '',
          company_name: p.dashboard_tv_company_name || p.company_name || p.full_name || '',
          primary_color: p.dashboard_tv_primary_color || DEFAULT_BRANDING.primary_color,
          secondary_color: p.dashboard_tv_secondary_color || DEFAULT_BRANDING.secondary_color,
        });

        // Query adicional pra puxar avatar_url do profile de cada vendedor
        const rawSellers = (sellersRes.data || []) as Array<Omit<SellerRow, 'own_avatar_url'>>;
        const authIds = rawSellers.map(s => s.auth_user_id).filter((x): x is string => !!x);
        const ownAvatarMap = new Map<string, string | null>();
        if (authIds.length > 0) {
          const { data: avatarRows } = await (supabase as any)
            .from('profiles')
            .select('id, avatar_url')
            .in('id', authIds);
          for (const r of (avatarRows || []) as Array<{ id: string; avatar_url: string | null }>) {
            ownAvatarMap.set(r.id, r.avatar_url || null);
          }
        }
        setSellers(rawSellers.map(s => ({
          ...s,
          own_avatar_url: s.auth_user_id ? (ownAvatarMap.get(s.auth_user_id) || null) : null,
        })) as SellerRow[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const handleSaveBranding = async () => {
    if (!user?.id) return;
    // Valida cores (hex)
    const hexOk = /^#[0-9a-fA-F]{6}$/;
    if (!hexOk.test(branding.primary_color) || !hexOk.test(branding.secondary_color)) {
      toast({ title: 'Cor inválida', description: 'Use formato hex tipo #3b82f6.', variant: 'destructive' });
      return;
    }
    setSavingBranding(true);
    try {
      const { error } = await (supabase as any)
        .from('profiles')
        .update({
          dashboard_tv_logo_url: branding.logo_url.trim() || null,
          dashboard_tv_company_name: branding.company_name.trim() || null,
          dashboard_tv_primary_color: branding.primary_color,
          dashboard_tv_secondary_color: branding.secondary_color,
        })
        .eq('id', user.id);
      if (error) throw error;
      toast({ title: '✅ Branding salvo', description: 'Atualize o Dashboard TV pra ver o resultado.' });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err?.message || 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setSavingBranding(false);
    }
  };

  // Upload da LOGO da empresa (aparece no Dashboard TV e no CRM ao Vivo).
  // Sobe pro bucket 'avatars' em {master.id}/branding/logo.{ext} (1o folder = auth.uid
  // -> passa a policy de escrita) e persiste na hora em profiles.dashboard_tv_logo_url.
  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (logoInputRef.current) logoInputRef.current.value = '';
    if (!file || !user?.id) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'Maximo 2MB.', variant: 'destructive' });
      return;
    }
    setUploadingLogo(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${user.id}/branding/logo.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now(); // bust cache
      const { error: updErr } = await (supabase as any)
        .from('profiles')
        .update({ dashboard_tv_logo_url: publicUrl })
        .eq('id', user.id);
      if (updErr) throw updErr;
      setBranding(b => ({ ...b, logo_url: publicUrl }));
      toast({ title: '✅ Logo enviada', description: 'Ja aparece no Dashboard TV e no CRM ao Vivo.' });
    } catch (err: any) {
      toast({ title: 'Erro ao subir logo', description: err?.message || 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setUploadingLogo(false);
    }
  };

  const startEditSeller = (s: SellerRow) => {
    setEditingSellerId(s.id);
    setEditingUrl(s.profile_picture || '');
  };

  const cancelEditSeller = () => {
    setEditingSellerId(null);
    setEditingUrl('');
  };

  const handleSaveSellerPhoto = async (sellerId: string) => {
    const trimmed = editingUrl.trim() || null;
    setSavingSellerId(sellerId);
    try {
      const { error } = await (supabase as any)
        .from('ai_team_members')
        .update({ profile_picture: trimmed })
        .eq('id', sellerId);
      if (error) throw error;
      setSellers(prev => prev.map(s => s.id === sellerId ? { ...s, profile_picture: trimmed } : s));
      setEditingSellerId(null);
      setEditingUrl('');
      toast({ title: '✅ Foto atualizada' });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar foto', description: err?.message, variant: 'destructive' });
    } finally {
      setSavingSellerId(null);
    }
  };

  const handleClickUpload = (sellerId: string) => {
    setUploadTargetSellerId(sellerId);
    // Pequeno delay garante que state atualize antes do click do input
    setTimeout(() => fileInputRef.current?.click(), 0);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const sellerId = uploadTargetSellerId;
    // Reset input pra permitir re-selecionar mesmo arquivo
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !sellerId || !user?.id) {
      setUploadTargetSellerId(null);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Arquivo muito grande', description: 'Máximo 2MB.', variant: 'destructive' });
      setUploadTargetSellerId(null);
      return;
    }
    setUploadingSellerId(sellerId);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      // Path: {master.id}/sellers/{seller.id}.{ext}
      // Primeiro folder = auth.uid() → passa policy avatars_user_write
      const path = `${user.id}/sellers/${sellerId}.${ext}`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now(); // bust cache
      const { error: updErr } = await (supabase as any)
        .from('ai_team_members')
        .update({ profile_picture: publicUrl })
        .eq('id', sellerId);
      if (updErr) throw updErr;
      setSellers(prev => prev.map(s => s.id === sellerId ? { ...s, profile_picture: publicUrl } : s));
      toast({ title: '✅ Foto enviada' });
    } catch (err: any) {
      toast({ title: 'Erro ao subir foto', description: err?.message || 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setUploadingSellerId(null);
      setUploadTargetSellerId(null);
    }
  };

  const handleRemoveSellerPhoto = async (sellerId: string) => {
    setSavingSellerId(sellerId);
    try {
      const { error } = await (supabase as any)
        .from('ai_team_members')
        .update({ profile_picture: null })
        .eq('id', sellerId);
      if (error) throw error;
      setSellers(prev => prev.map(s => s.id === sellerId ? { ...s, profile_picture: null } : s));
      toast({ title: '🗑️ Foto removida' });
    } catch (err: any) {
      toast({ title: 'Erro ao remover', description: err?.message, variant: 'destructive' });
    } finally {
      setSavingSellerId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Header com link pro dashboard ─── */}
      <Card className="border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-cyan-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Tv className="h-4 w-4 text-blue-400" />
                Dashboard TV
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Tela em tempo real pra projetar em TV mostrando produção dos vendedores por origem (Tráfego Pago, Porta, OLX, Marketplace, Consignado, Indicação).
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/dashboard-tv" target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Abrir Dashboard
              </Link>
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* ─── Branding ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Palette className="h-4 w-4 text-purple-400" />
            Identidade visual
          </CardTitle>
          <CardDescription className="text-xs">
            Configure logo, nome da empresa e cores que aparecem no Dashboard TV. Tudo opcional — sem nada preenchido, usa o nome do seu perfil + cores padrão (azul e dourado).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Logo da empresa</Label>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                className="hidden"
                onChange={handleLogoFileChange}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="h-9 text-xs gap-1.5"
                >
                  {uploadingLogo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {branding.logo_url ? 'Trocar imagem' : 'Enviar imagem'}
                </Button>
                {branding.logo_url && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setBranding({ ...branding, logo_url: '' })}
                    className="h-9 w-9 p-0 text-red-400 hover:text-red-300"
                    title="Remover logo (clique em Salvar branding para confirmar)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <Input
                type="url"
                placeholder="ou cole uma URL: https://meusite.com/logo.png"
                value={branding.logo_url}
                onChange={e => setBranding({ ...branding, logo_url: e.target.value })}
                className="h-9 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">Envie um arquivo (PNG/JPG/WEBP/SVG, máx 2MB) ou cole uma URL. PNG transparente fica melhor. Aparece no <strong>Dashboard TV</strong> e no <strong>CRM ao Vivo (painel ao vivo)</strong>.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nome da empresa</Label>
              <Input
                placeholder="Ex: ICOM Motors"
                value={branding.company_name}
                onChange={e => setBranding({ ...branding, company_name: e.target.value })}
                className="h-9 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">Aparece em destaque no topo. Vazio = usa nome do seu perfil.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cor primária</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={branding.primary_color}
                  onChange={e => setBranding({ ...branding, primary_color: e.target.value })}
                  className="h-9 w-12 rounded border border-border bg-transparent cursor-pointer"
                />
                <Input
                  value={branding.primary_color}
                  onChange={e => setBranding({ ...branding, primary_color: e.target.value })}
                  className="h-9 text-sm tabular-nums flex-1"
                  placeholder="#3b82f6"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">Cor do número grande "Leads Gerais" e títulos.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Cor secundária (destaque)</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={branding.secondary_color}
                  onChange={e => setBranding({ ...branding, secondary_color: e.target.value })}
                  className="h-9 w-12 rounded border border-border bg-transparent cursor-pointer"
                />
                <Input
                  value={branding.secondary_color}
                  onChange={e => setBranding({ ...branding, secondary_color: e.target.value })}
                  className="h-9 text-sm tabular-nums flex-1"
                  placeholder="#f59e0b"
                />
              </div>
              <p className="text-[10px] text-muted-foreground">Cor do total de cada vendedor + ranking.</p>
            </div>
          </div>

          {/* Preview live do header */}
          <div className="rounded-lg border border-border bg-slate-950 p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">Preview do cabeçalho</p>
            <div className="flex items-center gap-4">
              {branding.logo_url ? (
                <img src={branding.logo_url} alt="logo preview" className="h-10 w-auto object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <div
                  className="h-10 w-10 rounded-lg flex items-center justify-center font-bold text-lg text-white"
                  style={{ background: `linear-gradient(135deg, ${branding.primary_color}, ${branding.secondary_color})` }}
                >
                  {(branding.company_name || '?')[0]?.toUpperCase() || '?'}
                </div>
              )}
              <div>
                <p className="text-base font-black uppercase tracking-wider text-white">{branding.company_name || 'Painel Comercial'}</p>
                <p className="text-[10px] uppercase tracking-widest text-blue-300/70">Dashboard Comercial · Produção em Tempo Real</p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveBranding} disabled={savingBranding} size="sm" className="gap-1.5">
              {savingBranding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar branding
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Fotos dos vendedores ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-400" />
            Fotos dos vendedores
          </CardTitle>
          <CardDescription className="text-xs">
            Foto que aparece no card de cada vendedor no Dashboard TV.
            <span className="block mt-1 text-amber-300/80">
              ⚡ Prioridade: foto que o próprio vendedor sobe em <strong>/perfil</strong> (sempre vence).
              Você só precisa subir aqui se o vendedor ainda não configurou a foto dele.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sellers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nenhum vendedor cadastrado. Cadastre em <Link to="/pedro" className="underline">Pedro SDR → Vendedores</Link>.
            </p>
          ) : (
            <div className="space-y-2">
              {/* Input file escondido (compartilhado pra todos os botões Upload) */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                className="hidden"
                onChange={handleFileChange}
              />
              {sellers.map(s => {
                const isEditing = editingSellerId === s.id;
                const isSaving = savingSellerId === s.id;
                const isUploading = uploadingSellerId === s.id;
                const hasMasterPhoto = !!s.profile_picture;
                const hasOwnPhoto = !!s.own_avatar_url;
                // Foto que VAI APARECER no Dashboard TV (prioridade: vendedor > master > iniciais)
                const effectivePhoto = s.own_avatar_url || s.profile_picture || null;
                return (
                  <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/30 px-3 py-2 flex-wrap">
                    {/* Preview avatar (mostra a foto EFETIVA — a que vai aparecer no Dashboard TV) */}
                    {effectivePhoto ? (
                      <img
                        src={effectivePhoto}
                        alt={s.name}
                        className="h-10 w-10 rounded-full object-cover border border-border/40"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div
                        className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm text-white border border-border/40"
                        style={{ background: hashColor(s.id) }}
                      >
                        {getInitials(s.name)}
                      </div>
                    )}

                    {/* Nome + status das 2 fontes */}
                    <div className="flex-1 min-w-[120px]">
                      <p className="text-sm font-medium truncate">
                        {s.name}
                        {!s.is_active && <span className="ml-2 text-[10px] text-muted-foreground">(inativo)</span>}
                      </p>
                      {!isEditing && (
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {hasOwnPhoto && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium" title="Vendedor configurou em /perfil — tem prioridade">
                              ✓ Foto própria
                            </span>
                          )}
                          {hasMasterPhoto && !hasOwnPhoto && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium" title="Foto subida por você (master). Usada porque vendedor não configurou em /perfil">
                              ◆ Foto pelo master
                            </span>
                          )}
                          {hasMasterPhoto && hasOwnPhoto && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-400 font-medium" title="Você subiu foto mas vendedor também configurou. A do vendedor está sendo usada.">
                              ◇ Master (não usada)
                            </span>
                          )}
                          {!hasOwnPhoto && !hasMasterPhoto && (
                            <span className="text-[9px] text-muted-foreground italic">Sem foto — avatar com iniciais</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Modo edição URL */}
                    {isEditing ? (
                      <>
                        <Input
                          type="url"
                          placeholder="https://..."
                          value={editingUrl}
                          onChange={e => setEditingUrl(e.target.value)}
                          className="h-8 text-xs max-w-xs"
                          autoFocus
                        />
                        <Button size="sm" onClick={() => handleSaveSellerPhoto(s.id)} disabled={isSaving} className="h-8 text-xs">
                          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Salvar'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEditSeller} disabled={isSaving} className="h-8 text-xs">Cancelar</Button>
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {/* Upload arquivo (botão principal) */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleClickUpload(s.id)}
                          disabled={isUploading || isSaving}
                          className="h-8 text-xs gap-1.5"
                          title={hasOwnPhoto ? 'Vendedor já tem foto própria (será usada). Você pode subir uma alternativa, mas ela só apareceria se o vendedor remover a dele.' : 'Subir arquivo do computador'}
                        >
                          {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                          {hasMasterPhoto ? 'Trocar' : 'Upload'}
                        </Button>
                        {/* Alternativa via URL */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEditSeller(s)}
                          disabled={isUploading || isSaving}
                          className="h-8 text-xs gap-1.5"
                          title="Usar URL externa em vez de upload"
                        >
                          <Link2 className="h-3 w-3" />
                          URL
                        </Button>
                        {/* Remover foto que MASTER subiu (não mexe na do vendedor) */}
                        {hasMasterPhoto && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveSellerPhoto(s.id)}
                            disabled={isUploading || isSaving}
                            className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                            title="Remover foto subida por você (não afeta a foto que o vendedor configurou em /perfil)"
                          >
                            {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-3 italic">
            <strong>Upload</strong>: arquivo do computador (PNG/JPG/WEBP, máx 2MB). <strong>URL</strong>: link externo (Google Drive público, Cloudinary, etc.).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
