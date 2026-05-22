// =============================================================================
// /configuracoes/campos-dinamicos — tela completa de admin
// Fase 6.5 (a-f) + 6.6 (analytics)
// - Restrição: apenas master (não vendedor)
// - Tabs: Cidades / Origens / Histórico
// - Stats + dashboard analytics
// - Aprovar / Editar+Aprovar / Rejeitar / Arquivar / Mesclar
// - Toggle auto_approve (settings)
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/hooks/useAuth";
import { useSellerProfile } from "@/hooks/useSellerProfile";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Loader2, MapPin, Layers, History, CheckCircle2, XCircle, Archive,
  GitMerge, RefreshCw, Sparkles, Edit3, TrendingUp, Users as UsersIcon, Award,
} from "lucide-react";
import {
  listActive, listPending, listAuditHistory,
  approve, reject, archive, merge, editAndApprove,
  getSettings, updateSettings, fetchAnalytics,
  type DynamicEntity, type DynamicRow, type AuditLogRow,
  type DynamicFieldSettings, type AnalyticsResult,
} from "@/services/dynamicFields/dynamicFieldsService";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function DynamicFieldsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const { isSeller, loading: sellerLoading } = useSellerProfile(user?.id);

  // Fase 6.5a: restrição — apenas master (isSeller=false). Redireciona vendedor.
  if (authLoading || sellerLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[300px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </MainLayout>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (isSeller) {
    return (
      <MainLayout>
        <Card className="max-w-md mx-auto mt-12 border-red-500/30 bg-red-500/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-400" />
              Acesso restrito
            </CardTitle>
            <CardDescription>
              Apenas o master/gerente da conta pode gerenciar campos dinâmicos.
            </CardDescription>
          </CardHeader>
        </Card>
      </MainLayout>
    );
  }

  const userId = user.id;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-amber-400" />
              Campos Dinâmicos
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Cidades e origens cadastradas pelos vendedores. Aprove, rejeite, mescle ou edite.
            </p>
          </div>
          <SettingsCard userId={userId} />
        </div>

        <Tabs defaultValue="cities" className="space-y-4">
          <TabsList className="grid w-full max-w-xl grid-cols-3">
            <TabsTrigger value="cities" className="gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Cidades
            </TabsTrigger>
            <TabsTrigger value="lead_sources" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              Origens
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              Histórico
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cities">
            <EntityManager entity="city" userId={userId} title="Cidades" />
          </TabsContent>
          <TabsContent value="lead_sources">
            <EntityManager entity="lead_source" userId={userId} title="Origens" />
          </TabsContent>
          <TabsContent value="history">
            <HistoryTab userId={userId} />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 6.5b — Settings (toggle auto_approve)
// ─────────────────────────────────────────────────────────────────────────────
function SettingsCard({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<DynamicFieldSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getSettings(userId).then(setSettings).catch(() => {});
  }, [userId]);

  const update = async (patch: Partial<Omit<DynamicFieldSettings, "user_id">>) => {
    if (!settings) return;
    setSaving(true);
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    try {
      await updateSettings(userId, patch);
      toast({ title: "Configuração salva" });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
      setSettings(settings); // rollback
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return null;

  return (
    <Card className="border-border/50">
      <CardContent className="p-3 space-y-2 min-w-[260px]">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="auto-cities" className="text-xs cursor-pointer">
            Aprovação automática — Cidades
          </Label>
          <Switch
            id="auto-cities"
            checked={settings.cities_auto_approve}
            onCheckedChange={(c) => update({ cities_auto_approve: c })}
            disabled={saving}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="auto-sources" className="text-xs cursor-pointer">
            Aprovação automática — Origens
          </Label>
          <Switch
            id="auto-sources"
            checked={settings.lead_sources_auto_approve}
            onCheckedChange={(c) => update({ lead_sources_auto_approve: c })}
            disabled={saving}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="notify-pending" className="text-xs cursor-pointer">
            Notificar pendências
          </Label>
          <Switch
            id="notify-pending"
            checked={settings.notify_on_pending}
            onCheckedChange={(c) => update({ notify_on_pending: c })}
            disabled={saving}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EntityManager — pendentes + ativas + analytics
// ─────────────────────────────────────────────────────────────────────────────
function EntityManager({ entity, userId, title }: { entity: DynamicEntity; userId: string; title: string }) {
  const { toast } = useToast();
  const [activeRows, setActiveRows] = useState<DynamicRow[]>([]);
  const [pendingRows, setPendingRows] = useState<DynamicRow[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [mergeFromId, setMergeFromId] = useState<string | null>(null);
  const [mergeIntoId, setMergeIntoId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  const reload = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [a, p, an] = await Promise.all([
        listActive(entity, userId),
        listPending(entity, userId),
        fetchAnalytics(entity, userId),
      ]);
      setActiveRows(a);
      setPendingRows(p);
      setAnalytics(an);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, userId]);

  const filteredActive = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return activeRows;
    return activeRows.filter((r) => r.name.toLowerCase().includes(s));
  }, [activeRows, search]);

  const handleApprove = async (id: string) => {
    setActingId(id);
    try {
      await approve(entity, id, userId);
      toast({ title: "✅ Aprovado!" });
      await reload();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setActingId(null); }
  };
  const handleReject = async (id: string) => {
    setActingId(id);
    try {
      await reject(entity, id);
      toast({ title: "Rejeitado" });
      await reload();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setActingId(null); }
  };
  const handleArchive = async (id: string) => {
    setActingId(id);
    try {
      await archive(entity, id);
      toast({ title: "Arquivado" });
      await reload();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setActingId(null); }
  };
  const handleMerge = async () => {
    if (!mergeFromId || !mergeIntoId || mergeFromId === mergeIntoId) return;
    setActingId(mergeFromId);
    try {
      await merge(entity, mergeFromId, mergeIntoId);
      toast({ title: "✅ Mesclado! Leads movidos." });
      setMergeFromId(null);
      setMergeIntoId("");
      await reload();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setActingId(null); }
  };
  const handleEditAndApprove = async (id: string) => {
    if (!editingName.trim()) return;
    setActingId(id);
    try {
      await editAndApprove(entity, id, editingName.trim(), userId);
      toast({ title: "✅ Editado e aprovado" });
      setEditingId(null);
      setEditingName("");
      await reload();
    } catch (err: any) {
      toast({ title: "Erro ao editar", description: err.message, variant: "destructive" });
    } finally { setActingId(null); }
  };

  return (
    <div className="space-y-4">
      {/* Mini-dashboard (Fase 6.6) */}
      {analytics && <AnalyticsCards analytics={analytics} />}

      {/* Pendentes */}
      {pendingRows.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              {pendingRows.length} pendente(s) de revisão
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingRows.map((r) => (
              <div key={r.id} className="rounded-lg border border-amber-500/20 bg-background/50 p-3">
                {editingId === r.id ? (
                  <div className="space-y-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      placeholder="Novo nome"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleEditAndApprove(r.id)}
                        disabled={actingId === r.id || !editingName.trim()}
                        className="bg-emerald-600 hover:bg-emerald-700"
                      >
                        {actingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                        Salvar e aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditingName(""); }}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Criado: {new Date(r.created_at).toLocaleString("pt-BR")}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" onClick={() => handleApprove(r.id)} disabled={actingId === r.id}
                        className="bg-emerald-600 hover:bg-emerald-700">
                        {actingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                        Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setEditingId(r.id); setEditingName(r.name); }}
                        disabled={actingId === r.id}>
                        <Edit3 className="h-3 w-3 mr-1" />
                        Editar e aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleReject(r.id)}
                        disabled={actingId === r.id} className="border-red-500/50 text-red-400">
                        <XCircle className="h-3 w-3 mr-1" />
                        Rejeitar
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Ativas */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base">{title} ativas ({activeRows.length})</CardTitle>
              <CardDescription>Visíveis pros vendedores nos formulários.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Recarregar
            </Button>
          </div>
          <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="mt-3 max-w-xs" />
        </CardHeader>
        <CardContent className="space-y-1 max-h-[400px] overflow-y-auto">
          {loading && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            </div>
          )}
          {!loading && filteredActive.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma encontrada</p>
          )}
          {filteredActive.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 rounded-md hover:bg-muted/30 p-2 text-sm">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {(r as any).icon && <span>{(r as any).icon}</span>}
                <span className="truncate">{r.name}</span>
                {r.is_system_default && <Badge variant="outline" className="text-[10px] shrink-0">Padrão</Badge>}
                {(r as any).category && <Badge variant="outline" className="text-[10px] shrink-0">{(r as any).category}</Badge>}
                {r.usage_count > 0 && <Badge variant="outline" className="text-[10px] shrink-0">{r.usage_count} leads</Badge>}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" className="h-7 text-xs"
                  onClick={() => setMergeFromId(r.id)} disabled={actingId === r.id}>
                  <GitMerge className="h-3 w-3 mr-1" />
                  Mesclar
                </Button>
                {!r.is_system_default && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground"
                    onClick={() => handleArchive(r.id)} disabled={actingId === r.id}>
                    {actingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3 mr-1" />}
                    Arquivar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Modal mesclar */}
      {mergeFromId && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <GitMerge className="h-4 w-4 text-blue-400" />
              Mesclar: {activeRows.find((r) => r.id === mergeFromId)?.name}
            </CardTitle>
            <CardDescription>
              Todos os leads que apontam pra essa entrada serão movidos pra outra. A entrada original será arquivada.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Mover leads para:
              </label>
              <Select value={mergeIntoId} onValueChange={setMergeIntoId}>
                <SelectTrigger><SelectValue placeholder="Selecione o destino..." /></SelectTrigger>
                <SelectContent>
                  {activeRows.filter((r) => r.id !== mergeFromId).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleMerge} disabled={!mergeIntoId || actingId === mergeFromId} className="bg-blue-600 hover:bg-blue-700">
                {actingId === mergeFromId ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <GitMerge className="h-3 w-3 mr-1" />}
                Confirmar mesclagem
              </Button>
              <Button variant="outline" onClick={() => { setMergeFromId(null); setMergeIntoId(""); }}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 6.6 — Analytics
// ─────────────────────────────────────────────────────────────────────────────
function AnalyticsCards({ analytics }: { analytics: AnalyticsResult }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Ativas" value={analytics.total_active} icon={<CheckCircle2 className="h-3 w-3" />} />
        <StatCard title="Pendentes" value={analytics.total_pending} highlight={analytics.total_pending > 0} />
        <StatCard title="Criadas últ. 30d" value={analytics.created_last_30d} icon={<TrendingUp className="h-3 w-3" />} />
        <StatCard title="Taxa rejeição" value={`${Math.round(analytics.rejection_rate * 100)}%`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {analytics.top_used.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Award className="h-3.5 w-3.5 text-amber-400" />
                Top 5 mais usadas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {analytics.top_used.map((t, i) => (
                <div key={t.id} className="flex items-center justify-between">
                  <span className="truncate">
                    <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                    {t.name}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{t.usage_count} leads</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        {analytics.top_creators.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <UsersIcon className="h-3.5 w-3.5 text-blue-400" />
                Quem mais sugere
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              {analytics.top_creators.map((t, i) => (
                <div key={t.performed_by} className="flex items-center justify-between">
                  <span className="truncate">
                    <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
                    {t.performed_by_name}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{t.count} criações</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, highlight, icon }: { title: string; value: number | string; highlight?: boolean; icon?: React.ReactNode }) {
  return (
    <Card className={highlight ? "border-amber-500/40 bg-amber-500/5" : ""}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground flex items-center gap-1">{icon} {title}</div>
        <div className={`text-2xl font-bold mt-1 ${highlight ? "text-amber-400" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 6.5c — Histórico
// ─────────────────────────────────────────────────────────────────────────────
function HistoryTab({ userId }: { userId: string }) {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listAuditHistory(userId).then(setRows).finally(() => setLoading(false));
  }, [userId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Últimos 50 eventos</CardTitle>
        <CardDescription>Histórico de criações, aprovações, rejeições e mesclagens.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 max-h-[600px] overflow-y-auto">
        {loading && <div className="py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>}
        {!loading && rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhum evento ainda</p>
        )}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/30 text-sm border-b border-border/30 last:border-0">
            <ActionBadge action={r.action} />
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{r.payload?.name || r.entity_id}</div>
              <div className="text-[10px] text-muted-foreground">
                {r.entity_type === "city" ? "Cidade" : "Origem"} •{" "}
                {new Date(r.created_at).toLocaleString("pt-BR")}
                {r.payload?.old_status && r.payload?.new_status && (
                  <> • {r.payload.old_status} → {r.payload.new_status}</>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ActionBadge({ action }: { action: string }) {
  const cfg: Record<string, { label: string; cls: string }> = {
    created:  { label: "criada",     cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
    approved: { label: "aprovada",   cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
    rejected: { label: "rejeitada",  cls: "bg-red-500/10 text-red-400 border-red-500/30" },
    archived: { label: "arquivada",  cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30" },
    merged:   { label: "mesclada",   cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
    edited:   { label: "editada",    cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  };
  const c = cfg[action] || { label: action, cls: "" };
  return <Badge variant="outline" className={`text-[10px] shrink-0 ${c.cls}`}>{c.label}</Badge>;
}
