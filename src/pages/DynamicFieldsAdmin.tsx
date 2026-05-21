// =============================================================================
// /configuracoes/campos-dinamicos — tela do master pra revisar
// cidades + origens criadas pelos vendedores (e fazer aprovar/rejeitar/mesclar).
// =============================================================================

import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, MapPin, Layers, CheckCircle2, XCircle, Archive, GitMerge, RefreshCw, Sparkles } from "lucide-react";
import {
  listActive,
  listPending,
  approve,
  reject,
  archive,
  merge,
  type DynamicEntity,
  type DynamicRow,
} from "@/services/dynamicFields/dynamicFieldsService";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function DynamicFieldsAdmin() {
  const { user } = useAuth();
  const userId = user?.id || null;

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-400" />
            Campos Dinâmicos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gerencie as cidades e origens cadastradas pelos vendedores. Aprove, rejeite ou mescle entradas.
          </p>
        </div>

        <Tabs defaultValue="cities" className="space-y-4">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="cities" className="gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Cidades
            </TabsTrigger>
            <TabsTrigger value="lead_sources" className="gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              Origens
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cities">
            <EntityManager entity="city" userId={userId} title="Cidades" />
          </TabsContent>
          <TabsContent value="lead_sources">
            <EntityManager entity="lead_source" userId={userId} title="Origens" />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function EntityManager({
  entity,
  userId,
  title,
}: {
  entity: DynamicEntity;
  userId: string | null;
  title: string;
}) {
  const { toast } = useToast();
  const [activeRows, setActiveRows] = useState<DynamicRow[]>([]);
  const [pendingRows, setPendingRows] = useState<DynamicRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [mergeFromId, setMergeFromId] = useState<string | null>(null);
  const [mergeIntoId, setMergeIntoId] = useState<string>("");
  const [actingId, setActingId] = useState<string | null>(null);

  const reload = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [a, p] = await Promise.all([listActive(entity, userId), listPending(entity, userId)]);
      setActiveRows(a);
      setPendingRows(p);
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

  const stats = useMemo(() => {
    return {
      total: activeRows.length,
      system: activeRows.filter((r) => r.is_system_default).length,
      custom: activeRows.filter((r) => !r.is_system_default).length,
      pending: pendingRows.length,
    };
  }, [activeRows, pendingRows]);

  const handleApprove = async (id: string) => {
    if (!userId) return;
    setActingId(id);
    try {
      await approve(entity, id, userId);
      toast({ title: "✅ Aprovado!" });
      await reload();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setActingId(id);
    try {
      await reject(entity, id);
      toast({ title: "Rejeitado" });
      await reload();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setActingId(null);
    }
  };

  const handleArchive = async (id: string) => {
    setActingId(id);
    try {
      await archive(entity, id);
      toast({ title: "Arquivado" });
      await reload();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setActingId(null);
    }
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
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mini-dashboard */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard title="Total ativas" value={stats.total} />
        <StatCard title="Pré-cadastradas" value={stats.system} />
        <StatCard title="Criadas por vendedor" value={stats.custom} />
        <StatCard
          title="Pendentes revisão"
          value={stats.pending}
          highlight={stats.pending > 0}
        />
      </div>

      {/* Pendentes */}
      {pendingRows.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              {pendingRows.length} pendente(s) de revisão
            </CardTitle>
            <CardDescription>Cadastros novos aguardando aprovação manual.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingRows.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-background/50 p-3"
              >
                <div className="flex-1">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Criado: {new Date(r.created_at).toLocaleString("pt-BR")}
                    {r.usage_count > 0 && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {r.usage_count} lead(s) já usando
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(r.id)}
                    disabled={actingId === r.id}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {actingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                    Aprovar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReject(r.id)}
                    disabled={actingId === r.id}
                    className="border-red-500/50 text-red-400"
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Rejeitar
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Ativas */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">{title} ativas ({stats.total})</CardTitle>
              <CardDescription>Visíveis pros vendedores no formulário.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Recarregar
            </Button>
          </div>
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mt-3 max-w-xs"
          />
        </CardHeader>
        <CardContent className="space-y-1">
          {loading && (
            <div className="py-6 text-center text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
            </div>
          )}
          {!loading && filteredActive.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma encontrada</p>
          )}
          {filteredActive.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-md hover:bg-muted/30 p-2 text-sm"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {(r as any).icon && <span>{(r as any).icon}</span>}
                <span className="truncate">{r.name}</span>
                {r.is_system_default && (
                  <Badge variant="outline" className="text-[10px] shrink-0">Padrão</Badge>
                )}
                {(r as any).category && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{(r as any).category}</Badge>
                )}
                {r.usage_count > 0 && (
                  <Badge variant="outline" className="text-[10px] shrink-0">{r.usage_count} leads</Badge>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setMergeFromId(r.id)}
                  disabled={actingId === r.id}
                >
                  <GitMerge className="h-3 w-3 mr-1" />
                  Mesclar
                </Button>
                {!r.is_system_default && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => handleArchive(r.id)}
                    disabled={actingId === r.id}
                  >
                    {actingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3 mr-1" />}
                    Arquivar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Modal mesclar (inline) */}
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
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o destino..." />
                </SelectTrigger>
                <SelectContent>
                  {activeRows
                    .filter((r) => r.id !== mergeFromId)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleMerge}
                disabled={!mergeIntoId || actingId === mergeFromId}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {actingId === mergeFromId ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <GitMerge className="h-3 w-3 mr-1" />}
                Confirmar mesclagem
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setMergeFromId(null);
                  setMergeIntoId("");
                }}
              >
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ title, value, highlight }: { title: string; value: number; highlight?: boolean }) {
  return (
    <Card className={highlight ? "border-amber-500/40 bg-amber-500/5" : ""}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className={`text-2xl font-bold mt-1 ${highlight ? "text-amber-400" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
