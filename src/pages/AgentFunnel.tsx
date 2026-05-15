// ============================================================================
// AgentFunnel — página dedicada pra editar o Funil do Agente
// ----------------------------------------------------------------------------
// Acessada via /agente/:agentId/funil. Substitui a aba SDR do modal
// AgentFormDialog (que tinha problemas de re-mount intermitente fazendo o
// conteúdo desaparecer). Sendo página inteira, elimina:
//   - Conflitos de portal (Dialog do Radix)
//   - Re-mounts disparados por toast/fetches do componente filho
//   - Stale snapshots devido a Tabs internas
// ============================================================================

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, Brain, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useSellerProfile } from '@/hooks/useSellerProfile';
import FunilDoAgenteTab from '@/components/pedro/FunilDoAgenteTab';

export default function AgentFunnel() {
  const { agentId = '' } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isSeller, seller, loading: sellerLoading } = useSellerProfile(user?.id);
  const [agentName, setAgentName] = useState<string>('');
  const [agentValid, setAgentValid] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const effectiveUserId = sellerLoading
    ? null
    : (isSeller && seller?.user_id) ? seller.user_id : (user?.id || null);

  useEffect(() => {
    if (!agentId || !effectiveUserId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await (supabase as any)
          .from('wa_ai_agents')
          .select('id, name')
          .eq('id', agentId)
          .eq('user_id', effectiveUserId)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setAgentValid(false);
        } else {
          setAgentValid(true);
          setAgentName(data.name || 'Agente');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId, effectiveUserId]);

  return (
    <MainLayout>
      <div className="space-y-4 max-w-5xl mx-auto px-4 py-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/pedro?tab=agente')}
          className="gap-1.5 text-xs text-muted-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para Pedro
        </Button>

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30 flex items-center justify-center">
            <Brain className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              Funil do Agente
              {agentName && <span className="text-blue-400">— {agentName}</span>}
            </h1>
            <p className="text-xs text-muted-foreground">
              Configure os 9 blocos do funil SDR. As regras ficam isoladas por agente.
            </p>
          </div>
        </div>

        {(loading || sellerLoading) && (
          <Card className="border-border/50">
            <CardContent className="py-12 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
            </CardContent>
          </Card>
        )}

        {!loading && !sellerLoading && agentValid === false && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-8 text-center">
              <p className="text-sm font-medium mb-2">Agente não encontrado</p>
              <p className="text-xs text-muted-foreground mb-4">
                Esse agente não existe ou você não tem permissão para configurá-lo.
              </p>
              <Button size="sm" onClick={() => navigate('/pedro?tab=agente')}>
                Voltar para a lista de agentes
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && !sellerLoading && agentValid && effectiveUserId && (
          <FunilDoAgenteTab agentId={agentId} userId={effectiveUserId} />
        )}
      </div>
    </MainLayout>
  );
}
