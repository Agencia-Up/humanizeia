import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import {
  Loader2, Sparkles, CheckCircle, ArrowRight, Building2,
  Users, ShoppingBag, Target, MessageSquare, Shield, TrendingUp,
  Palette, Star, Save, ChevronDown, ChevronUp
} from 'lucide-react';

// ─── Niche Definitions ───────────────────────────────────────────────────────

const NICHE_META: Record<string, { label: string; emoji: string; color: string; description: string }> = {
  automotivo: { label: 'Automotivo', emoji: '🚗', color: 'from-orange-500/20 to-red-500/20', description: 'Concessionárias, Lojas de Carros e Oficinas' },
  saude_bem_estar: { label: 'Saúde e Bem-Estar', emoji: '💊', color: 'from-emerald-500/20 to-teal-500/20', description: 'Clínicas, Consultórios, Spas e Academias' },
  varejo_ecommerce: { label: 'Varejo e E-commerce', emoji: '🛍️', color: 'from-pink-500/20 to-rose-500/20', description: 'Moda, Acessórios e Produtos Físicos' },
  educacao_conhecimento: { label: 'Educação', emoji: '🎓', color: 'from-blue-500/20 to-indigo-500/20', description: 'Cursos Online, Infoprodutos e Consultorias' },
  alimentacao_bebidas: { label: 'Alimentação', emoji: '🍽️', color: 'from-amber-500/20 to-yellow-500/20', description: 'Restaurantes, Bares e Cafeterias' },
  imobiliario: { label: 'Imobiliário', emoji: '🏠', color: 'from-cyan-500/20 to-sky-500/20', description: 'Imobiliárias, Corretores e Construtoras' },
  servicos_b2b: { label: 'Serviços B2B', emoji: '💼', color: 'from-violet-500/20 to-purple-500/20', description: 'Consultoria, Agências e TI' },
  pet: { label: 'Pet', emoji: '🐾', color: 'from-lime-500/20 to-green-500/20', description: 'Pet Shops, Clínicas Veterinárias' },
  financas_investimentos: { label: 'Finanças', emoji: '💰', color: 'from-yellow-500/20 to-amber-500/20', description: 'Seguradoras, Consultores Financeiros' },
  tecnologia_saas: { label: 'Tecnologia', emoji: '💻', color: 'from-sky-500/20 to-blue-500/20', description: 'Software, Apps e Startups' },
  outro: { label: 'Personalizado', emoji: '✨', color: 'from-primary/20 to-purple-500/20', description: 'Nicho Personalizado' },
};

// ─── Briefing fields per niche ────────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  hint?: string;
  placeholder: string;
  type: 'input' | 'textarea';
  required?: boolean;
}

interface SectionDef {
  num: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  fields: FieldDef[];
}

function buildNicheSections(niche: string): SectionDef[] {
  const automotivoCTAEx = 'Agende seu Test Drive';
  const saudeCtaEx = 'Agende sua Consulta';

  const ctaByNiche: Record<string, string> = {
    automotivo: automotivoCTAEx,
    saude_bem_estar: saudeCtaEx,
    varejo_ecommerce: 'Compre Agora com Frete Grátis',
    educacao_conhecimento: 'Garanta sua Vaga',
    alimentacao_bebidas: 'Faça sua Reserva',
    imobiliario: 'Agende uma Visita',
    servicos_b2b: 'Solicite um Orçamento',
    pet: 'Agende o Atendimento',
    financas_investimentos: 'Fale com um Consultor',
    tecnologia_saas: 'Comece seu Trial Grátis',
    outro: 'Entre em Contato',
  };

  const productByNiche: Record<string, string> = {
    automotivo: 'Venda de veículos novos/seminovos, serviços de manutenção, financiamento',
    saude_bem_estar: 'Tratamentos estéticos, consultas médicas/odontológicas, planos de academia',
    varejo_ecommerce: 'Roupas, calçados, joias, acessórios, produtos físicos',
    educacao_conhecimento: 'Cursos digitais, e-books, mentorias, consultorias',
    alimentacao_bebidas: 'Refeições, bebidas, experiências gastronômicas',
    imobiliario: 'Venda/aluguel de imóveis, consultoria imobiliária',
    servicos_b2b: 'Consultoria estratégica, serviços de TI, soluções empresariais',
    pet: 'Produtos para pets, serviços veterinários, banho e tosa',
    financas_investimentos: 'Investimentos, seguros, consultoria financeira',
    tecnologia_saas: 'Software, aplicativos, serviços de tecnologia',
    outro: 'Produto ou serviço principal',
  };

  return [
    {
      num: 1,
      icon: Building2,
      title: 'Negócio & Marca',
      fields: [
        { key: 'nome_negocio', label: 'Nome do Negócio / Marca', placeholder: 'Ex: Minha Empresa Ltda', type: 'input', required: true },
        { key: 'produto_servico', label: 'Produto ou Serviço Principal', placeholder: productByNiche[niche] || 'Descreva o que você oferece', type: 'textarea', required: true, hint: 'Seja específico sobre o que você vende ou entrega.' },
        { key: 'diferencial', label: 'Diferencial Único', placeholder: 'O que te torna diferente da concorrência?', type: 'textarea', required: true },
        { key: 'site', label: 'Site', placeholder: 'https://www.seusite.com.br', type: 'input' },
        { key: 'redes_sociais', label: 'Redes Sociais', placeholder: '@empresa no Instagram, LinkedIn /empresa...', type: 'input' },
      ],
    },
    {
      num: 2,
      icon: Palette,
      title: 'Identidade Visual',
      fields: [
        { key: 'paleta_cores', label: 'Paleta de Cores', placeholder: 'Ex: #003366 (azul marinho), #FFD700 (dourado)', type: 'input', hint: 'Use códigos hex ou nomes das cores.' },
        { key: 'identidade_visual', label: 'Estilo Visual da Marca', placeholder: 'Ex: Luxuoso, moderno, minimalista, familiar, esportivo...', type: 'textarea' },
      ],
    },
    {
      num: 3,
      icon: Users,
      title: 'Cliente Ideal (ICP)',
      fields: [
        { key: 'publico_alvo', label: 'Público-Alvo', placeholder: 'Ex: Homens/Mulheres, 30-55 anos, renda familiar > R$8.000...', type: 'textarea', required: true },
        { key: 'dor_principal', label: 'Dor Principal', placeholder: 'Qual a maior dor ou frustração do seu cliente ideal?', type: 'textarea', required: true },
        { key: 'maior_desejo', label: 'Maior Desejo', placeholder: 'O que o cliente mais quer conquistar ou resolver?', type: 'textarea', required: true },
        { key: 'objecoes', label: 'Principais Objeções', placeholder: 'O que impede o cliente de comprar? Ex: "preço alto", "desconfiança"...', type: 'textarea' },
      ],
    },
    {
      num: 4,
      icon: ShoppingBag,
      title: 'Oferta & Preço',
      fields: [
        { key: 'oferta_principal', label: 'Oferta Principal', placeholder: 'Ex: Condições especiais para financiamento, revisão gratuita no primeiro ano...', type: 'textarea', required: true },
        { key: 'preco', label: 'Preço / Faixa de Investimento', placeholder: 'Ex: A partir de R$1.997 ou parcelas de 12x R$197', type: 'input' },
        { key: 'garantia_bonus', label: 'Garantia ou Bônus', placeholder: 'Ex: 7 dias de garantia, primeiro mês grátis, brinde...', type: 'input' },
      ],
    },
    {
      num: 5,
      icon: Target,
      title: 'Aquisição & Comunicação',
      fields: [
        { key: 'canais_aquisicao', label: 'Canais de Aquisição Preferidos', placeholder: 'Ex: Meta Ads (Facebook/Instagram), Google Ads, orgânico, WhatsApp...', type: 'input', required: true },
        { key: 'tom_voz', label: 'Tom de Voz', placeholder: 'Ex: Profissional, confiável, aspiracional, direto, amigável...', type: 'input', required: true },
        { key: 'objetivo_principal', label: 'Objetivo Principal', placeholder: 'Ex: Gerar leads para consulta, aumentar vendas online, reconhecimento de marca...', type: 'textarea', required: true },
        { key: 'cta_principal', label: 'CTA Principal', placeholder: ctaByNiche[niche] || 'Qual a chamada para ação principal?', type: 'input', required: true },
      ],
    },
    {
      num: 6,
      icon: Star,
      title: 'Autoridade & Provas',
      fields: [
        { key: 'resultados', label: 'Resultados Obtidos / Números', placeholder: 'Ex: +500 clientes, 8 anos de mercado, prêmio X, R$2M em vendas...', type: 'textarea' },
        { key: 'depoimento', label: 'Exemplo de Depoimento', placeholder: '"Em 21 dias recuperei o investimento" — João, Pet Shop SP', type: 'textarea' },
      ],
    },
    {
      num: 7,
      icon: Shield,
      title: 'Regras do Agente Salomão',
      fields: [
        { key: 'deve_fazer', label: 'O que o Agente DEVE fazer', placeholder: 'Ex: Focar em leads qualificados, usar prova social, sempre incluir CTA...', type: 'textarea', required: true },
        { key: 'nao_pode_fazer', label: 'O que o Agente NÃO pode fazer', placeholder: 'Ex: Prometer condições não aprovadas, usar linguagem informal excessiva...', type: 'textarea', required: true },
      ],
    },
  ];
}

// ─── Section Component ────────────────────────────────────────────────────────

function Section({
  section,
  data,
  onChange,
  defaultOpen = false,
}: {
  section: SectionDef;
  data: Record<string, string>;
  onChange: (key: string, val: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = section.icon;
  const filled = section.fields.filter(f => data[f.key]?.trim()).length;

  return (
    <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-5 py-4 border-b border-border/40 bg-card/60 hover:bg-card/80 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold shrink-0">
          {section.num}
        </div>
        <Icon className="h-4 w-4 text-primary shrink-0" />
        <span className="font-semibold text-sm flex-1">{section.title}</span>
        <Badge variant="outline" className={`text-[10px] ${filled > 0 ? 'text-emerald-400 border-emerald-500/30' : 'text-muted-foreground'}`}>
          {filled}/{section.fields.length}
        </Badge>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="p-5 grid grid-cols-1 gap-4">
          {section.fields.map(field => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {field.label} {field.required && <span className="text-primary">*</span>}
              </Label>
              {field.type === 'textarea' ? (
                <Textarea
                  value={data[field.key] || ''}
                  onChange={e => onChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="min-h-[80px] resize-none focus-visible:ring-primary/50"
                />
              ) : (
                <Input
                  value={data[field.key] || ''}
                  onChange={e => onChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  className="focus-visible:ring-primary/50"
                />
              )}
              {field.hint && <p className="text-[10px] text-muted-foreground italic">{field.hint}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BriefingDetails() {
  const { nicho } = useParams<{ nicho: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const meta = NICHE_META[nicho || ''] || NICHE_META.outro;
  const sections = buildNicheSections(nicho || 'outro');

  // Required fields across all sections
  const allRequired = sections.flatMap(s => s.fields.filter(f => f.required).map(f => f.key));
  const filledRequired = allRequired.filter(k => data[k]?.trim()).length;
  const progressPct = Math.round((filledRequired / allRequired.length) * 100);
  const allFieldsTotal = sections.flatMap(s => s.fields).length;
  const filledTotal = Object.values(data).filter(v => v?.trim()).length;

  // Load existing briefing from DB
  useEffect(() => {
    const loadExisting = async () => {
      if (!user) { setLoading(false); return; }
      try {
        const { data: existing } = await supabase
          .from('client_briefings' as any)
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existing) {
          const d = existing as any;
          // Try to load saved briefing fields
          if (d.briefing_data) {
            setData(d.briefing_data);
          } else {
            // Legacy mapping
            setData({
              nome_negocio: d.client_name || d.business_name || '',
              produto_servico: d.product_service || d.produto || '',
              publico_alvo: d.target_audience || d.publico || '',
              objetivo_principal: d.marketing_goal || '',
            });
          }
        }
      } catch {
        // no existing data, start fresh
      } finally {
        setLoading(false);
      }
    };
    loadExisting();
  }, [user]);

  const handleChange = useCallback((key: string, val: string) => {
    setData(prev => ({ ...prev, [key]: val }));
  }, []);

  const buildBriefingText = () => {
    const lines: string[] = [`BRIEFING — ${meta.label.toUpperCase()} ${meta.emoji}`, ''];
    sections.forEach(s => {
      lines.push(`## ${s.title.toUpperCase()}`);
      s.fields.forEach(f => {
        const val = data[f.key]?.trim();
        if (val) lines.push(`${f.label}: ${val}`);
      });
      lines.push('');
    });
    return lines.join('\n');
  };

  const handleSubmit = async () => {
    if (filledRequired < allRequired.length) {
      toast({
        title: 'Campos obrigatórios',
        description: `Preencha os campos marcados com * (${filledRequired}/${allRequired.length} preenchidos)`,
        variant: 'destructive',
      });
      return;
    }

    if (!user) { navigate('/auth'); return; }
    setSubmitting(true);

    try {
      const briefingText = buildBriefingText();

      // Check existing
      const { data: existing } = await supabase
        .from('client_briefings' as any)
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const payload = {
        user_id: user.id,
        client_name: data.nome_negocio || '',
        business_name: data.nome_negocio || '',
        product_service: data.produto_servico || '',
        produto: data.produto_servico || '',
        target_audience: data.publico_alvo || '',
        publico: data.publico_alvo || '',
        marketing_goal: data.objetivo_principal || '',
        niche: nicho,
        briefing_text: briefingText,
        briefing_data: data,
        updated_at: new Date().toISOString(),
      };

      const existingId = (existing as any)?.id;
      if (existingId) {
        await supabase.from('client_briefings' as any).update(payload).eq('id', existingId);
      } else {
        await supabase.from('client_briefings' as any).insert(payload);
      }

      // Also save to quiz_responses if quiz was done
      await supabase
        .from('user_quiz_responses' as any)
        .upsert({
          user_id: user.id,
          nicho_identificado: nicho,
          briefing_text: briefingText,
          briefing_data: data,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      // Mark quiz completed
      await supabase.from('profiles').update({ quiz_completed: true }).eq('id', user.id);

      toast({ title: '✅ Briefing salvo!', description: 'Os agentes de IA já foram atualizados com suas informações.' });

      navigate('/salomao', { replace: true });
    } catch (err: any) {
      toast({ title: 'Erro ao salvar', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Carregando seu briefing personalizado...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Background */}
      <div className={`absolute inset-0 bg-gradient-to-br ${meta.color} opacity-30 pointer-events-none`} />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-gradient-to-b from-primary/5 to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 container max-w-4xl py-10 px-4 space-y-8">

        {/* Header */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-card to-card/50 border border-border/50 shadow-xl text-4xl">
            {meta.emoji}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <Badge className="bg-primary/20 text-primary border-primary/30 px-3 py-1">
                <Sparkles className="h-3 w-3 mr-1.5" />
                Briefing Personalizado
              </Badge>
              <Badge variant="outline" className="px-3 py-1">{meta.label}</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">
              {meta.emoji} Briefing de {meta.label}
            </h1>
            <p className="text-muted-foreground text-sm max-w-2xl mx-auto leading-relaxed">
              Preencha as informações abaixo. Elas alimentam o <span className="text-primary font-medium">Salomão</span> e todos os agentes de IA — quanto mais detalhado, melhor será a estratégia gerada.
            </p>
          </div>
        </div>

        {/* Progress card */}
        <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-5 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Campos obrigatórios preenchidos</span>
            <span className={`font-bold ${progressPct >= 80 ? 'text-emerald-400' : progressPct >= 50 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
              {progressPct}% · {filledRequired}/{allRequired.length}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progressPct >= 80 ? 'bg-gradient-to-r from-emerald-500 to-green-400' : progressPct >= 50 ? 'bg-gradient-to-r from-yellow-500 to-amber-400' : 'bg-gradient-to-r from-primary to-purple-500'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{filledTotal} de {allFieldsTotal} campos totais preenchidos</span>
            <span>Mín. 100% dos campos * para salvar</span>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-3">
          {sections.map((section, i) => (
            <Section
              key={section.num}
              section={section}
              data={data}
              onChange={handleChange}
              defaultOpen={i < 2}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between pt-2">
          <Button
            variant="outline"
            onClick={() => navigate('/niche-quiz')}
            disabled={submitting}
            className="gap-2"
          >
            Refazer Quiz
          </Button>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={async () => {
                toast({ title: '💾 Salvo!', description: 'Rascunho salvo localmente.' });
                localStorage.setItem(`briefing_draft_${nicho}`, JSON.stringify(data));
              }}
              disabled={submitting}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              Salvar Rascunho
            </Button>

            <Button
              className="gap-2 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white font-bold shadow-lg shadow-primary/20 min-w-[220px]"
              onClick={handleSubmit}
              disabled={submitting || filledRequired < allRequired.length}
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Salvando...</>
              ) : (
                <><CheckCircle className="h-4 w-4" /> Enviar para o Salomão <ArrowRight className="h-4 w-4" /></>
              )}
            </Button>
          </div>
        </div>

        {filledRequired < allRequired.length && (
          <p className="text-center text-xs text-amber-400/80">
            ⚠️ Preencha todos os campos obrigatórios (*) para enviar ao Salomão — faltam {allRequired.length - filledRequired} campos.
          </p>
        )}
      </div>
    </div>
  );
}
