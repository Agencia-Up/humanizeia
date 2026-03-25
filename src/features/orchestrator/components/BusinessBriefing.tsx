import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Save, Brain, Target, UserCheck, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const BusinessBriefing = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    business_name: '',
    target_audience: '',
    offering_details: '',
    tone_of_voice: '',
  });

  // Load existing briefing on mount
  React.useEffect(() => {
    const loadBriefing = async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from('client_briefings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      
      if (data && !error) {
        setFormData({
          business_name: data.business_name || '',
          target_audience: data.target_audience || '',
          offering_details: data.offering_details || '',
          tone_of_voice: data.tone_of_voice || '',
        });
      }
    };
    loadBriefing();
  }, [user]);

  const handleSave = async () => {

    if (!user) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from('client_briefings')
        .upsert({
          user_id: user.id,
          ...formData,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;
      toast.success("Briefing atualizado com sucesso! Salomão agora conhece melhor o seu negócio.");
    } catch (error: any) {
      toast.error("Erro ao salvar briefing: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-black/40 border-purple-500/20 glass-morphism overflow-hidden">
      <CardHeader className="border-b border-white/5 bg-white/5">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-500" />
          <CardTitle>Memória Operacional do Salomão</CardTitle>
        </div>
        <CardDescription>
          Quanto mais detalhes você fornecer, mais precisas serão as ações do Orquestrador.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="biz-name" className="flex items-center gap-2">
              <span className="text-purple-400">#</span> Nome do Negócio
            </Label>
            <Input 
              id="biz-name" 
              placeholder="Ex: HumanizeIA Marketing" 
              className="bg-white/5 border-white/10"
              value={formData.business_name}
              onChange={(e) => setFormData({...formData, business_name: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audience" className="flex items-center gap-2">
              <Target className="w-3 h-3 text-purple-400" /> Público Alvo
            </Label>
            <Input 
              id="audience" 
              placeholder="Ex: Pequenas empresas, Agências B2B" 
              className="bg-white/5 border-white/10"
              value={formData.target_audience}
              onChange={(e) => setFormData({...formData, target_audience: e.target.value})}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="offering" className="flex items-center gap-2">
            <UserCheck className="w-3 h-3 text-purple-400" /> O que você oferece? (Detalhes do Produto/Serviço)
          </Label>
          <Textarea 
            id="offering" 
            placeholder="Descreva seu principal produto, preço e diferencial competitivo..."
            className="bg-white/5 border-white/10 min-h-[100px]"
            value={formData.offering_details}
            onChange={(e) => setFormData({...formData, offering_details: e.target.value})}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tone" className="flex items-center gap-2">
            <MessageSquare className="w-3 h-3 text-purple-400" /> Tom de Voz / Personalidade da Marca
          </Label>
          <Input 
            id="tone" 
            placeholder="Ex: Profissional, Amigável, Autoritário, Inovador" 
            className="bg-white/5 border-white/10"
            value={formData.tone_of_voice}
            onChange={(e) => setFormData({...formData, tone_of_voice: e.target.value})}
          />
        </div>

        <Button 
          className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold"
          onClick={handleSave}
          disabled={loading}
        >
          {loading ? "Salvando..." : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Salvar Contexto do Negócio
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default BusinessBriefing;
