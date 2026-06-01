import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { CheckCircle, XCircle, Loader2, MessageCircle, Plug } from 'lucide-react';
import { useWhatsAppConfig } from '@/hooks/useWhatsAppConfig';
import { EvolutionConnectDialog } from '@/components/evolution/EvolutionConnectDialog';

export function WhatsAppSettingsTab() {
  const {
    config,
    isLoading,
    isTesting,
    testConnection,
    disconnect,
    saveConfig,
    isSaving,
  } = useWhatsAppConfig();

  const [connectOpen, setConnectOpen] = useState(false);
  const [sendDailyReport, setSendDailyReport] = useState(config?.send_daily_report || false);
  const [reportTime, setReportTime] = useState(config?.report_time || '08:00');

  const handleSaveSchedule = () => {
    if (!config) return;
    saveConfig({
      api_url: config.api_url,
      instance_name: config.instance_name,
      phone_number: config.phone_number,
      send_daily_report: sendDailyReport,
      report_time: reportTime,
    });
  };

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/20">
                <MessageCircle className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <CardTitle className="text-lg">WhatsApp Business</CardTitle>
                <CardDescription>
                  Conecte seu WhatsApp e envie relatórios de performance
                </CardDescription>
              </div>
            </div>
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : config?.is_active ? (
              <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
                <CheckCircle className="h-3 w-3 mr-1" />
                Conectado
              </Badge>
            ) : (
              <Badge variant="secondary">
                <XCircle className="h-3 w-3 mr-1" />
                Não configurado
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {config?.is_active ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Instância:</span>
                  <span className="ml-2 font-mono">{config.instance_name}</span>
                </div>
                {config.phone_number && (
                  <div>
                    <span className="text-muted-foreground">Número:</span>
                    <span className="ml-2">{config.phone_number}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={testConnection} disabled={isTesting}>
                  {isTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  Enviar Teste
                </Button>
                <Button variant="destructive" size="sm" onClick={disconnect}>
                  Desconectar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={() => setConnectOpen(true)}
              className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white"
            >
              <Plug className="h-4 w-4 mr-2" /> Conectar via QR Code
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Daily Report Config */}
      {config?.is_active && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-lg">Relatório Diário Automático</CardTitle>
            <CardDescription>
              Receba um resumo de performance todo dia no WhatsApp
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Envio automático diário</p>
                <p className="text-sm text-muted-foreground">
                  Receba o relatório MIDAS automaticamente
                </p>
              </div>
              <Switch
                checked={sendDailyReport}
                onCheckedChange={setSendDailyReport}
              />
            </div>

            {sendDailyReport && (
              <div className="space-y-2">
                <Label>Horário de envio</Label>
                <Select value={reportTime} onValueChange={setReportTime}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="07:00">07:00</SelectItem>
                    <SelectItem value="08:00">08:00</SelectItem>
                    <SelectItem value="09:00">09:00</SelectItem>
                    <SelectItem value="10:00">10:00</SelectItem>
                    <SelectItem value="18:00">18:00</SelectItem>
                    <SelectItem value="19:00">19:00</SelectItem>
                    <SelectItem value="20:00">20:00</SelectItem>
                    <SelectItem value="21:00">21:00</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button onClick={handleSaveSchedule} disabled={isSaving} size="sm">
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Salvar Agendamento
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Help */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg">Como conectar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>Clique em <strong>"Conectar via QR Code"</strong></li>
            <li>Escolha <strong>"WhatsApp (QR Code)"</strong> e dê um nome para a conexão</li>
            <li>Clique em <strong>"Gerar QR Code"</strong></li>
            <li>No celular, abra o WhatsApp → <strong>Aparelhos conectados</strong> e escaneie o QR Code</li>
            <li>Pronto! A conexão será detectada automaticamente</li>
          </ol>
        </CardContent>
      </Card>

      <EvolutionConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
      />
    </div>
  );
}
