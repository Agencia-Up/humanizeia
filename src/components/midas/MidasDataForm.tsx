import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, Database, Send, Calculator } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';

interface MidasDataFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (formattedMessage: string) => void;
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/[^\d.,]/g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value: number): string {
  return value.toLocaleString('pt-BR');
}

export function MidasDataForm({ open, onOpenChange, onSubmit }: MidasDataFormProps) {
  const { toast } = useToast();

  // Section A - Performance Data
  const [date, setDate] = useState<Date>(new Date());
  const [platform, setPlatform] = useState('');
  const [spend, setSpend] = useState('');
  const [impressions, setImpressions] = useState('');
  const [clicks, setClicks] = useState('');
  const [conversions, setConversions] = useState('');
  const [roas, setRoas] = useState('');
  const [aov, setAov] = useState('');

  // Section B - Context Variables
  const [winningCreative, setWinningCreative] = useState('');
  const [losingCreative, setLosingCreative] = useState('');
  const [changeMadeToday, setChangeMadeToday] = useState('');

  // Auto-calculated metrics
  const calculated = useMemo(() => {
    const spendNum = parseNumber(spend);
    const impressionsNum = parseNumber(impressions);
    const clicksNum = parseNumber(clicks);
    const conversionsNum = parseNumber(conversions);

    const ctr = clicksNum > 0 && impressionsNum > 0 ? (clicksNum / impressionsNum) * 100 : 0;
    const cpm = impressionsNum > 0 ? (spendNum / impressionsNum) * 1000 : 0;
    const cpa = conversionsNum > 0 ? spendNum / conversionsNum : 0;

    return { ctr, cpm, cpa };
  }, [spend, impressions, clicks, conversions]);

  const getCpaColor = (cpa: number) => {
    if (cpa === 0) return 'text-muted-foreground';
    if (cpa <= 85) return 'text-green-500';
    if (cpa <= 105) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getCtrColor = (ctr: number) => {
    if (ctr === 0) return 'text-muted-foreground';
    if (ctr >= 1.4) return 'text-green-500';
    if (ctr >= 0.8) return 'text-yellow-500';
    return 'text-red-500';
  };

  const resetForm = () => {
    setDate(new Date());
    setPlatform('');
    setSpend('');
    setImpressions('');
    setClicks('');
    setConversions('');
    setRoas('');
    setAov('');
    setWinningCreative('');
    setLosingCreative('');
    setChangeMadeToday('');
  };

  const handleSubmit = () => {
    if (!platform) {
      toast({ title: 'Selecione a plataforma', variant: 'destructive' });
      return;
    }
    if (!spend || parseNumber(spend) === 0) {
      toast({ title: 'Informe o gasto total', variant: 'destructive' });
      return;
    }
    if (!conversions || parseNumber(conversions) === 0) {
      toast({ title: 'Informe o número de conversões', variant: 'destructive' });
      return;
    }

    const dateStr = format(date, 'dd/MM/yyyy');
    const spendNum = parseNumber(spend);
    const impressionsNum = parseNumber(impressions);
    const clicksNum = parseNumber(clicks);
    const conversionsNum = parseNumber(conversions);
    const roasNum = parseNumber(roas);
    const aovNum = parseNumber(aov);

    const platformNames: Record<string, string> = {
      meta: 'Meta Ads',
      google: 'Google Ads',
      tiktok: 'TikTok Ads',
    };

    let message = `[DADOS DE PERFORMANCE - DATA: ${dateStr}]\n`;
    message += `Plataforma: ${platformNames[platform] || platform}\n`;
    message += `Gasto Total: R$ ${formatBRL(spendNum)}\n`;
    if (impressionsNum > 0) message += `Impressões: ${formatNumber(impressionsNum)}\n`;
    if (clicksNum > 0) message += `Cliques no Link: ${formatNumber(clicksNum)}\n`;
    if (calculated.ctr > 0) message += `CTR (Link): ${calculated.ctr.toFixed(2)}%\n`;
    if (calculated.cpm > 0) message += `CPM: R$ ${formatBRL(calculated.cpm)}\n`;
    message += `Conversões (Vendas): ${formatNumber(conversionsNum)}\n`;
    message += `CPA: R$ ${formatBRL(calculated.cpa)}\n`;
    if (roasNum > 0) message += `ROAS/MER: ${roasNum.toFixed(1)}x\n`;
    if (aovNum > 0) message += `Ticket Médio (AOV): R$ ${formatBRL(aovNum)}\n`;

    if (winningCreative || losingCreative || changeMadeToday) {
      message += `\n[VARIÁVEIS DE CONTEXTO]\n`;
      if (winningCreative) message += `Criativo Vencedor: ${winningCreative}\n`;
      if (losingCreative) message += `Pior Criativo: ${losingCreative}\n`;
      if (changeMadeToday) message += `Mudança feita hoje: ${changeMadeToday}\n`;
    }

    message += `\n[SALA DE GUERRA APOLLO]\nClassifique a situação atual (🔴🟡🟢) e me dê o próximo passo imediato para escalar ou estancar o prejuízo.`;

    onSubmit(message);
    resetForm();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0">
        <SheetHeader className="px-6 pt-6 pb-4">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
              <Database className="h-4 w-4 text-amber-600" />
            </div>
            Alimentar Brain Trust
          </SheetTitle>
          <SheetDescription>
            Preencha os dados de performance para análise da Sala de Guerra MIDAS.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-180px)] px-6">
          <div className="space-y-6 pb-6">
            {/* Section A - Performance Data */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                  A
                </Badge>
                <span className="text-sm font-semibold">Dados de Performance</span>
              </div>

              <div className="space-y-3">
                {/* Date Picker */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Data</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'w-full justify-start text-left font-normal',
                          !date && 'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {date ? format(date, 'dd/MM/yyyy', { locale: ptBR }) : 'Selecione a data'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={(d) => d && setDate(d)}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Platform */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Plataforma *</Label>
                  <Select value={platform} onValueChange={setPlatform}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a plataforma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="meta">Meta Ads</SelectItem>
                      <SelectItem value="google">Google Ads</SelectItem>
                      <SelectItem value="tiktok">TikTok Ads</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Spend */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Gasto Total (R$) *</Label>
                  <Input
                    type="text"
                    placeholder="Ex: 6642.00"
                    value={spend}
                    onChange={(e) => setSpend(e.target.value)}
                  />
                </div>

                {/* Impressions + Clicks row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Impressões</Label>
                    <Input
                      type="text"
                      placeholder="Ex: 185000"
                      value={impressions}
                      onChange={(e) => setImpressions(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cliques no Link</Label>
                    <Input
                      type="text"
                      placeholder="Ex: 3200"
                      value={clicks}
                      onChange={(e) => setClicks(e.target.value)}
                    />
                  </div>
                </div>

                {/* Auto-calculated metrics */}
                <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Calculator className="h-3 w-3" />
                    Métricas Calculadas Automaticamente
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[10px] text-muted-foreground">CTR</p>
                      <p className={cn('text-sm font-bold', getCtrColor(calculated.ctr))}>
                        {calculated.ctr > 0 ? `${calculated.ctr.toFixed(2)}%` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">CPM</p>
                      <p className="text-sm font-bold">
                        {calculated.cpm > 0 ? `R$ ${formatBRL(calculated.cpm)}` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">CPA</p>
                      <p className={cn('text-sm font-bold', getCpaColor(calculated.cpa))}>
                        {calculated.cpa > 0 ? `R$ ${formatBRL(calculated.cpa)}` : '—'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Conversions */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Conversões (Vendas/Leads) *</Label>
                  <Input
                    type="text"
                    placeholder="Ex: 78"
                    value={conversions}
                    onChange={(e) => setConversions(e.target.value)}
                  />
                </div>

                {/* ROAS + AOV row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">ROAS / MER</Label>
                    <Input
                      type="text"
                      placeholder="Ex: 3.5"
                      value={roas}
                      onChange={(e) => setRoas(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ticket Médio / AOV (R$)</Label>
                    <Input
                      type="text"
                      placeholder="Ex: 297.00"
                      value={aov}
                      onChange={(e) => setAov(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Section B - Context Variables */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                  B
                </Badge>
                <span className="text-sm font-semibold">Variáveis de Contexto</span>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Criativo Vencedor</Label>
                  <Textarea
                    placeholder="Ex: Reels de unboxing com hook nos 3s iniciais..."
                    value={winningCreative}
                    onChange={(e) => setWinningCreative(e.target.value)}
                    className="min-h-[60px] resize-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Pior Criativo</Label>
                  <Textarea
                    placeholder="Ex: Banner estático genérico sem CTA claro..."
                    value={losingCreative}
                    onChange={(e) => setLosingCreative(e.target.value)}
                    className="min-h-[60px] resize-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Mudança feita hoje</Label>
                  <Textarea
                    placeholder="Ex: Subi orçamento em 20%, troquei criativo X pelo Y..."
                    value={changeMadeToday}
                    onChange={(e) => setChangeMadeToday(e.target.value)}
                    className="min-h-[60px] resize-none"
                  />
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Submit Button */}
        <div className="border-t px-6 py-4">
          <Button
            onClick={handleSubmit}
            className="w-full bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700"
          >
            <Send className="h-4 w-4 mr-2" />
            Enviar para MIDAS
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
