import { useState, useEffect, useCallback } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMetaApi } from '@/hooks/useMetaApi';
import { useToast } from '@/hooks/use-toast';
import { RefreshCw, Users, UserPlus, Globe } from 'lucide-react';

interface CustomAudience {
  id: string;
  name: string;
  subtype: string;
  approximate_count: number;
  description?: string;
  delivery_status?: { status: string };
  time_created?: string;
}

export default function MetaAudiences() {
  const { callMetaApi } = useMetaApi();
  const { toast } = useToast();
  const [audiences, setAudiences] = useState<CustomAudience[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAudiences = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callMetaApi({
        endpoint: 'act_{ad_account_id}/customaudiences',
        params: {
          fields: 'id,name,subtype,approximate_count,description,delivery_status,time_created',
          limit: '100',
        },
      });
      setAudiences(data?.data || []);
    } catch (err: any) {
      if (err.code !== 'NO_ACCOUNT') {
        toast({ title: 'Erro ao carregar públicos', description: err.message, variant: 'destructive' });
      }
    } finally {
      setLoading(false);
    }
  }, [callMetaApi, toast]);

  useEffect(() => {
    loadAudiences();
  }, []);

  const subtypeLabel = (subtype: string) => {
    const map: Record<string, string> = {
      CUSTOM: 'Personalizado',
      WEBSITE: 'Website',
      LOOKALIKE: 'Semelhante',
      ENGAGEMENT: 'Engajamento',
      DATA_SET: 'Lista',
      VIDEO: 'Vídeo',
      OFFLINE_CONVERSION: 'Conversão Offline',
    };
    return map[subtype] || subtype;
  };

  const subtypeIcon = (subtype: string) => {
    if (subtype === 'LOOKALIKE') return <Globe className="h-4 w-4" />;
    if (subtype === 'WEBSITE') return <Globe className="h-4 w-4" />;
    return <Users className="h-4 w-4" />;
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold lg:text-3xl">Públicos Meta</h1>
            <p className="text-muted-foreground">
              Gerencie seus públicos personalizados e semelhantes
            </p>
          </div>
          <Button variant="outline" onClick={loadAudiences} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total de Públicos</CardDescription>
              <CardTitle className="text-3xl">{audiences.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Personalizados</CardDescription>
              <CardTitle className="text-3xl">
                {audiences.filter(a => a.subtype !== 'LOOKALIKE').length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Semelhantes</CardDescription>
              <CardTitle className="text-3xl">
                {audiences.filter(a => a.subtype === 'LOOKALIKE').length}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Audiences Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Subtipo</TableHead>
                  <TableHead className="text-right">Tamanho</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audiences.map(audience => (
                  <TableRow key={audience.id}>
                    <TableCell>{subtypeIcon(audience.subtype)}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{audience.name}</p>
                        {audience.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">{audience.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{subtypeLabel(audience.subtype)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {audience.approximate_count?.toLocaleString('pt-BR') || '-'}
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && audiences.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-12">
                      <UserPlus className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground">
                        Nenhum público encontrado. Conecte sua conta Meta nas configurações.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
