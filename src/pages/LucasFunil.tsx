// ============================================================================
// LucasFunil — placeholder
// ----------------------------------------------------------------------------
// A página completa do Lucas (Funil de Vendas) ainda não foi implementada.
// Esse stub evita o 404 quando o usuário acessa /lucas (rota referenciada
// no Dashboard / sidebar) e indica que está em construção.
// ============================================================================

import { useNavigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Layers, ArrowLeft, Construction } from 'lucide-react';

export default function LucasFunil() {
  const navigate = useNavigate();

  return (
    <MainLayout>
      <div className="space-y-4 max-w-3xl mx-auto px-4 py-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/dashboard')}
          className="gap-1.5 text-xs text-muted-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar para Dashboard
        </Button>

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-600/20 border border-orange-500/30 flex items-center justify-center">
            <Layers className="h-6 w-6 text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Lucas — Funil de Vendas</h1>
            <p className="text-sm text-muted-foreground">Construtor visual de funil + métricas de conversão</p>
          </div>
        </div>

        <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-orange-500/5">
          <CardContent className="py-12 flex flex-col items-center text-center gap-3">
            <Construction className="h-10 w-10 text-amber-400" />
            <h2 className="text-lg font-semibold">Em construção</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              O agente Lucas (Funil de Vendas) está sendo desenvolvido — em breve você vai
              poder construir funis visuais em cascata, gerar copy de landing page e ver
              métricas de conversão em tempo real.
            </p>
            <Button onClick={() => navigate('/dashboard')} className="mt-2">
              Voltar para Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
