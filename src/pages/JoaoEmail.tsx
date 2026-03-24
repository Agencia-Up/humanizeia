import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  AtSign, BarChart3, CheckCircle, Clock, Copy, Eye, Loader2,
  Mail, MousePointerClick, Plus, RefreshCw, Send, Sparkles, Trash2, Users, Zap,
} from 'lucide-react';

const EMAIL_GOALS = [
  { value: 'nurturing', label: '🌱 Nutrição de leads' },
  { value: 'vendas', label: '💰 Venda direta' },
  { value: 'reativacao', label: '🔄 Reativação de clientes' },
  { value: 'onboarding', label: '🚀 Onboarding' },
  { value: 'newsletter', label: '📰 Newsletter' },
  { value: 'promocao', label: '🎁 Promoção / Oferta' },
];

const EMAIL_TONES = [
  { value: 'profissional', label: '👔 Profissional' },
  { value: 'amigavel', label: '😊 Amigável' },
  { value: 'urgente', label: '🔥 Urgente' },
  { value: 'inspiracional', label: '✨ Inspiracional' },
  { value: 'direto', label: '⚡ Direto ao ponto' },
];

interface EmailDraft {
  id: string;
  subject: string;
  preview_text: string;
  body_html: string;
  goal: string;
  tone: string;
  status: 'draft' | 'sent' | 'scheduled';
  open_rate?: number;
  click_rate?: number;
  created_at: string;
}

export default function JoaoEmail() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('gerador');
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);

  // Form state
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('nurturing');
  const [tone, setTone] = useState('amigavel');
  const [senderName, setSenderName] = useState('');
  const [includePS, setIncludePS] = useState(true);
  const [includeEmoji, setIncludeEmoji] = useState(true);

  // Generated email
  const [generated, setGenerated] = useState<{ subject: string; preview: string; body: string } | null>(null);

  useEffect(() => { fetchDrafts(); }, []);

  const fetchDrafts = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('email_drafts' as any)
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setDrafts((data as EmailDraft[]) || []);
    setLoading(false);
  };

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('joao-email-api', {
        body: {
          action: 'generate_email',
          topic: topic.trim(),
          audience: audience.trim(),
          goal,
          tone,
          sender_name: senderName.trim() || 'Nossa Equipe',
          include_ps: includePS,
          include_emoji: includeEmoji,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGenerated(data.email);
    } catch (err: any) {
      toast({ title: 'Erro ao gerar email', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!generated || !user) return;
    try {
      await supabase.from('email_drafts' as any).insert({
        user_id: user.id,
        subject: generated.subject,
        preview_text: generated.preview,
        body_html: generated.body,
        goal,
        tone,
        status: 'draft',
      });
      toast({ title: 'Rascunho salvo!' });
      await fetchDrafts();
      setActiveTab('rascunhos');
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const draftCount = drafts.filter(d => d.status === 'draft').length;
  const sentCount = drafts.filter(d => d.status === 'sent').length;
  const avgOpenRate = drafts.filter(d => d.open_rate != null).reduce((s, d) => s + (d.open_rate || 0), 0) / (drafts.filter(d => d.open_rate != null).length || 1);

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-heading font-bold flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                <Mail className="h-6 w-6 text-amber-400" />
              </div>
              JOÃO — Email Marketing
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Crie emails persuasivos com IA e gerencie suas campanhas
            </p>
          </div>
          <Badge variant="outline" className="gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            JOÃO Online
          </Badge>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-muted-foreground">{draftCount}</p>
            <p className="text-xs text-muted-foreground">Rascunhos</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{sentCount}</p>
            <p className="text-xs text-muted-foreground">Enviados</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{avgOpenRate > 0 ? `${avgOpenRate.toFixed(1)}%` : '—'}</p>
            <p className="text-xs text-muted-foreground">Taxa de Abertura</p>
          </CardContent></Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="gerador" className="gap-1.5"><Sparkles className="h-3.5 w-3.5" />Gerador IA</TabsTrigger>
            <TabsTrigger value="rascunhos" className="gap-1.5"><Mail className="h-3.5 w-3.5" />Rascunhos {drafts.length > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{drafts.length}</Badge>}</TabsTrigger>
            <TabsTrigger value="sequencias" className="gap-1.5"><Zap className="h-3.5 w-3.5" />Sequências</TabsTrigger>
          </TabsList>

          {/* GERADOR */}
          <TabsContent value="gerador" className="space-y-5 mt-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Form */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Zap className="h-4 w-4 text-amber-400" />
                    Configurar Email
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Assunto / Tema *</Label>
                    <Input placeholder="ex: Promoção 50% off, Novo produto lançado..." value={topic} onChange={e => setTopic(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Público-alvo</Label>
                    <Input placeholder="ex: clientes inativos, leads quentes, novos inscritos..." value={audience} onChange={e => setAudience(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Objetivo</Label>
                      <Select value={goal} onValueChange={setGoal}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{EMAIL_GOALS.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tom de voz</Label>
                      <Select value={tone} onValueChange={setTone}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{EMAIL_TONES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome do remetente</Label>
                    <Input placeholder="João da LogosIA..." value={senderName} onChange={e => setSenderName(e.target.value)} />
                  </div>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs">Incluir P.S. no final</Label>
                    <Switch checked={includePS} onCheckedChange={setIncludePS} />
                  </div>
                  <div className="flex items-center justify-between py-0.5">
                    <Label className="text-xs">Usar emojis no assunto</Label>
                    <Switch checked={includeEmoji} onCheckedChange={setIncludeEmoji} />
                  </div>
                  <Button className="w-full gradient-primary text-primary-foreground" onClick={handleGenerate} disabled={generating || !topic.trim()}>
                    {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Gerando...</> : <><Sparkles className="h-4 w-4 mr-2" />Gerar Email com JOÃO</>}
                  </Button>
                </CardContent>
              </Card>

              {/* Preview */}
              <div className="space-y-3">
                {generated ? (
                  <>
                    <Card className="border-amber-500/20">
                      <CardContent className="p-4 space-y-3">
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Assunto</p>
                          <p className="font-bold text-sm mt-0.5">{generated.subject}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Preview text</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{generated.preview}</p>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="flex-1" onClick={() => navigator.clipboard.writeText(generated.subject + '\n\n' + generated.body)}>
                            <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                          </Button>
                          <Button size="sm" className="flex-1 gradient-primary text-primary-foreground" onClick={handleSaveDraft}>
                            Salvar Rascunho
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Corpo do Email</CardTitle></CardHeader>
                      <CardContent>
                        <ScrollArea className="max-h-80">
                          <div className="bg-white rounded-lg p-4 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap border">
                            {generated.body}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </>
                ) : (
                  <Card className="border-dashed border-2 border-amber-500/20">
                    <CardContent className="py-20 text-center">
                      <Mail className="h-12 w-12 mx-auto mb-3 text-muted-foreground/30" />
                      <p className="text-muted-foreground text-sm">Preencha o formulário para gerar seu email</p>
                      <p className="text-xs text-muted-foreground mt-1">JOÃO vai criar um email persuasivo pronto para usar ✉️</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* RASCUNHOS */}
          <TabsContent value="rascunhos" className="mt-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">{drafts.length} emails</p>
              <Button size="sm" variant="outline" onClick={fetchDrafts} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />Atualizar
              </Button>
            </div>
            {drafts.length === 0 && !loading && (
              <Card className="border-dashed border-2">
                <CardContent className="py-12 text-center">
                  <Mail className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-muted-foreground text-sm">Nenhum email salvo</p>
                  <Button size="sm" className="mt-4 gradient-primary text-primary-foreground" onClick={() => setActiveTab('gerador')}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" />Gerar primeiro email
                  </Button>
                </CardContent>
              </Card>
            )}
            <div className="space-y-3">
              {drafts.map(draft => (
                <Card key={draft.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={draft.status === 'sent' ? 'default' : 'secondary'} className="text-[10px]">
                            {draft.status === 'sent' ? '✅ Enviado' : '📝 Rascunho'}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{new Date(draft.created_at).toLocaleDateString('pt-BR')}</span>
                        </div>
                        <p className="font-medium text-sm truncate">{draft.subject}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{draft.preview_text}</p>
                        {draft.open_rate != null && (
                          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                            <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{draft.open_rate.toFixed(1)}% aberturas</span>
                            {draft.click_rate != null && <span className="flex items-center gap-1"><MousePointerClick className="h-3 w-3" />{draft.click_rate.toFixed(1)}% cliques</span>}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(draft.subject + '\n\n' + draft.body_html)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-500"
                          onClick={async () => { await supabase.from('email_drafts' as any).delete().eq('id', draft.id); fetchDrafts(); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* SEQUÊNCIAS */}
          <TabsContent value="sequencias" className="mt-5">
            <Card className="border-dashed border-2 border-primary/20">
              <CardContent className="py-16 text-center">
                <Zap className="h-12 w-12 mx-auto mb-3 text-primary/30" />
                <p className="font-medium">Sequências de Email Automáticas</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Fluxos de nurturing, onboarding e reativação — em breve
                </p>
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                  {['Boas-vindas (5 emails)', 'Nutrição de leads (7 emails)', 'Carrinho abandonado (3 emails)', 'Reativação (4 emails)'].map(seq => (
                    <Badge key={seq} variant="outline" className="text-xs">{seq}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
