import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Clock, Database, Zap } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { useToast } from '@/hooks/use-toast';

const INTERVAL_OPTIONS = [
  { value: '1', label: '1 minuto', description: 'Tempo real (mais requests)' },
  { value: '3', label: '3 minutos', description: 'Quase em tempo real' },
  { value: '5', label: '5 minutos', description: 'Recomendado' },
  { value: '10', label: '10 minutos', description: 'Equilibrado' },
  { value: '15', label: '15 minutos', description: 'Econômico' },
  { value: '30', label: '30 minutos', description: 'Mínimo de requests' },
];

export function DataSyncSettingsTab() {
  const { pollingIntervalMinutes, setPollingIntervalMinutes } = useAppStore();
  const { toast } = useToast();

  const handleChange = (value: string) => {
    setPollingIntervalMinutes(Number(value));
    toast({ title: `Intervalo atualizado para ${value} min` });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            Sincronização de Dados
          </CardTitle>
          <CardDescription>
            Configure com que frequência os dados são atualizados automaticamente das plataformas conectadas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Intervalo de atualização automática</Label>
            <Select value={String(pollingIntervalMinutes)} onValueChange={handleChange}>
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2">
                      <span>{opt.label}</span>
                      {opt.value === '5' && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Recomendado
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Define a frequência com que o dashboard busca dados atualizados do Meta Ads e Google Ads.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Database className="mt-0.5 h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium">Cache inteligente</p>
                <p className="text-xs text-muted-foreground">
                  Dados são armazenados localmente e exibidos instantaneamente enquanto a API é consultada em segundo plano.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Clock className="mt-0.5 h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium">Polling automático</p>
                <p className="text-xs text-muted-foreground">
                  Os dados são atualizados automaticamente no intervalo configurado sem recarregar a página.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border p-3">
              <Zap className="mt-0.5 h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium">Otimização de requests</p>
                <p className="text-xs text-muted-foreground">
                  O sistema evita chamadas duplicadas e reutiliza cache quando os dados ainda estão válidos.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
