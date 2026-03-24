import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { Copy, Check, Terminal, ExternalLink, Code2 } from 'lucide-react';
import { toast } from 'sonner';

export function LeadCaptureTab() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  // The webhook URL points to the Edge Function we just created
  const webhookUrl = `https://seyljsqmhlopkcauhlor.supabase.co/functions/v1/crm-capture`;
  
  const payloadExample = {
    user_id: user?.id || 'SEU_USER_ID',
    name: "João Silva",
    email: "joao@email.com",
    phone: "5511999999999",
    source: "Site Principal",
    custom_fields: {
      origem_campanha: "Black Friday",
      interesse: "Plano Advanced"
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copiado para a área de transferência!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <Terminal className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Captura de Leads via Webhook</CardTitle>
              <CardDescription>
                Integre qualquer formulário externo (Elementor, Contact Form 7, Typeform) enviando os dados para este endpoint.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Webhook URL Box */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground ml-1">Sua URL do Webhook</label>
            <div className="flex gap-2">
              <div className="flex-1 p-3 bg-muted/30 border border-input rounded-md font-mono text-sm break-all">
                {webhookUrl}
              </div>
              <Button variant="outline" size="icon" onClick={() => copyToClipboard(webhookUrl)}>
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground px-1">
              Método: <span className="font-bold text-primary">POST</span> | Content-Type: <span className="font-bold text-primary">application/json</span>
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border/50">
            {/* User ID Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Code2 className="h-4 w-4 text-primary" /> Seu User ID (Obrigatório)
              </div>
              <div className="p-3 bg-muted/20 border border-dashed border-border rounded-lg text-sm flex justify-between items-center group">
                <code className="text-primary font-bold">{user?.id}</code>
                <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copyToClipboard(user?.id || '')}
                >
                    <Copy className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Este ID identifica que os leads pertencem à sua conta. Envie-o no campo <code className="bg-muted px-1 rounded">user_id</code> do seu payload JSON.
              </p>
            </div>

            {/* Instruction Section */}
            <div className="p-4 bg-primary/5 rounded-xl border border-primary/10 space-y-2">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <ExternalLink className="h-4 w-4" /> Como usar?
              </h4>
              <ol className="text-sm text-muted-foreground space-y-3 list-decimal list-inside ml-1">
                <li>No seu formulário, configure um envio via <span className="text-foreground font-medium text-xs">Webhook / POST</span>.</li>
                <li>Mapeie os campos para os nomes aceitos: <span className="text-foreground font-medium text-xs">name, email, phone</span>.</li>
                <li>Certifique-se de enviar o <span className="text-foreground font-medium text-xs">user_id</span> corretamente.</li>
                <li>Leads cairão instantaneamente na etapa <span className="text-primary font-bold text-xs italic">"Novo Lead"</span> do seu CRM.</li>
              </ol>
            </div>
          </div>

          {/* Code Example Box */}
          <div className="space-y-3 pt-6 border-t border-border/50">
            <h4 className="text-sm font-semibold flex items-center gap-2">Exemplo de Payload (JSON)</h4>
            <div className="relative group">
              <pre className="p-4 bg-zinc-950 text-zinc-300 rounded-lg text-xs overflow-x-auto leading-relaxed border border-border/10">
                {JSON.stringify(payloadExample, null, 2)}
              </pre>
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute top-2 right-2 text-zinc-500 hover:text-white"
                onClick={() => copyToClipboard(JSON.stringify(payloadExample, null, 2))}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
