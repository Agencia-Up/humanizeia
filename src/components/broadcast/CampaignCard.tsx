import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Play, Pause, CheckCircle, XCircle, Clock, Zap, Loader2,
  RotateCcw, Wand2, Trash2, MoreVertical,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface WACampaign {
  id: string;
  name: string;
  message_template: string;
  prompt_base: string | null;
  status: string;
  total_contacts: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  min_delay_seconds: number;
  max_delay_seconds: number;
  variation_level: string;
  rotation_messages_per_instance: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface CampaignCardProps {
  campaign: WACampaign;
  onRefresh: () => void;
}

export function CampaignCard({ campaign, onRefresh }: CampaignCardProps) {
  const { toast } = useToast();
  const [isStarting, setIsStarting] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const progress = campaign.total_contacts > 0
    ? Math.round((campaign.sent_count / campaign.total_contacts) * 100)
    : 0;

  const startCampaign = async () => {
    setIsStarting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Não autenticado');

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enqueue-campaign`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ campaign_id: campaign.id }),
        }
      );

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Erro ao iniciar');

      toast({ title: '🚀 Campanha iniciada!', description: `${result.enqueued} mensagens enfileiradas` });
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsStarting(false);
    }
  };

  const pauseCampaign = async () => {
    setIsPausing(true);
    try {
      await supabase
        .from('wa_campaigns')
        .update({ status: 'paused' })
        .eq('id', campaign.id);

      // Cancel pending queue items
      await supabase
        .from('wa_queue')
        .update({ status: 'cancelled' })
        .eq('campaign_id', campaign.id)
        .eq('status', 'pending');

      toast({ title: '⏸️ Campanha pausada' });
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsPausing(false);
    }
  };

  const deleteCampaign = async () => {
    setIsDeleting(true);
    try {
      // Delete queue items first
      await supabase.from('wa_queue').delete().eq('campaign_id', campaign.id);
      await supabase.from('wa_campaigns').delete().eq('id', campaign.id);
      toast({ title: '🗑️ Campanha excluída' });
      onRefresh();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Rascunho</Badge>;
      case 'running':
        return <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30"><Zap className="h-3 w-3 mr-1" /> Enviando</Badge>;
      case 'paused':
        return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30"><Pause className="h-3 w-3 mr-1" /> Pausada</Badge>;
      case 'completed':
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30"><CheckCircle className="h-3 w-3 mr-1" /> Concluída</Badge>;
      case 'failed':
        return <Badge className="bg-destructive/20 text-destructive border-destructive/30"><XCircle className="h-3 w-3 mr-1" /> Falhou</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <>
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm hover:border-primary/20 transition-colors">
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg truncate">{campaign.name}</h3>
                {campaign.prompt_base && (
                  <span title="IA ativa"><Wand2 className="h-4 w-4 text-primary shrink-0" /></span>
                )}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {campaign.message_template}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              {getStatusBadge(campaign.status)}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(campaign.status === 'draft' || campaign.status === 'paused') && (
                    <DropdownMenuItem onClick={startCampaign} disabled={isStarting}>
                      <Play className="h-4 w-4 mr-2" /> Iniciar
                    </DropdownMenuItem>
                  )}
                  {campaign.status === 'running' && (
                    <DropdownMenuItem onClick={pauseCampaign} disabled={isPausing}>
                      <Pause className="h-4 w-4 mr-2" /> Pausar
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => setShowDeleteConfirm(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {campaign.sent_count} / {campaign.total_contacts} enviadas
              </span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />

            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-500" /> {campaign.delivered_count} entregues
              </span>
              <span className="flex items-center gap-1">
                <XCircle className="h-3 w-3 text-destructive" /> {campaign.failed_count} falhas
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {campaign.min_delay_seconds}-{campaign.max_delay_seconds}s delay
              </span>
              <span className="flex items-center gap-1">
                <RotateCcw className="h-3 w-3" /> Rodízio a cada {campaign.rotation_messages_per_instance} msgs
              </span>
              {campaign.prompt_base && (
                <span className="flex items-center gap-1">
                  <Wand2 className="h-3 w-3 text-primary" /> IA {campaign.variation_level}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons for draft/paused */}
          {(campaign.status === 'draft' || campaign.status === 'paused') && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <Button
                onClick={startCampaign}
                disabled={isStarting}
                size="sm"
                className="w-full"
              >
                {isStarting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Iniciando...</>
                ) : (
                  <><Play className="h-4 w-4 mr-2" /> {campaign.status === 'paused' ? 'Retomar' : 'Iniciar'} Disparo</>
                )}
              </Button>
            </div>
          )}

          {campaign.status === 'running' && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <Button
                onClick={pauseCampaign}
                disabled={isPausing}
                variant="outline"
                size="sm"
                className="w-full"
              >
                {isPausing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Pausando...</>
                ) : (
                  <><Pause className="h-4 w-4 mr-2" /> Pausar Campanha</>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. Todos os dados de envio serão perdidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteCampaign} disabled={isDeleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
