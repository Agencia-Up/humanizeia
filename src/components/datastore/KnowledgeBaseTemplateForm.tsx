import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BookOpen, Loader2 } from "lucide-react";

interface KnowledgeBaseTemplateFormProps {
  onSubmit: (data: { name: string; content: string }) => Promise<void>;
  isPending: boolean;
}

const TEMPLATE_SECTIONS = [
  {
    title: "1. O Produto/Serviço (A Oferta)",
    fields: [
      { key: "problema", label: "Problema Resolvido", placeholder: "Qual dor principal seu produto/serviço resolve?" },
      { key: "beneficios", label: "Benefícios/Diferenciais", placeholder: "Quais são os 3 maiores benefícios e diferenciais competitivos?" },
      { key: "oferta", label: "Oferta Irresistível", placeholder: "Garantias, bônus, descontos, condições especiais..." },
      { key: "ticket", label: "Ticket Médio / LTV", placeholder: "Ex: Ticket R$ 297, LTV R$ 1.200" },
    ],
  },
  {
    title: "2. O Público-Alvo (A Persona)",
    fields: [
      { key: "dores", label: "Dores, Medos e Desejos", placeholder: "Quais são as dores profundas, medos e desejos do cliente ideal?" },
      { key: "canais", label: "Canais de Consumo", placeholder: "Onde o público consome conteúdo? (Instagram, YouTube, Google, etc.)" },
      { key: "objecoes", label: "Objeções Comuns", placeholder: "Quais são as objeções mais frequentes na hora da compra?" },
      { key: "demografico", label: "Dados Demográficos/Comportamentais", placeholder: "Idade, gênero, renda, localização, interesses..." },
    ],
  },
  {
    title: "3. Funil de Marketing e Metas",
    fields: [
      { key: "objetivo", label: "Objetivo Principal", placeholder: "Leads, vendas diretas, reconhecimento, etc." },
      { key: "cpa", label: "CPA Ideal / Máximo", placeholder: "Ex: CPA ideal R$ 30, máximo R$ 50" },
      { key: "jornada", label: "Jornada Pós-Clique", placeholder: "O que acontece depois do clique? (LP, WhatsApp, checkout, etc.)" },
    ],
  },
  {
    title: "4. Contexto de Mercado e Concorrência",
    fields: [
      { key: "concorrentes", label: "Principais Concorrentes", placeholder: "Quem são e o que fazem de diferente?" },
      { key: "erros", label: "Erros a Evitar", placeholder: "O que NÃO deve ser replicado do mercado?" },
      { key: "sazonalidade", label: "Sazonalidade", placeholder: "Épocas de alta/baixa demanda, datas importantes..." },
    ],
  },
  {
    title: "5. Ativos de Marca e Comunicação",
    fields: [
      { key: "tom", label: "Tom de Voz da Marca", placeholder: "Formal, descontraído, técnico, aspiracional..." },
      { key: "criativos", label: "Criativos de Sucesso", placeholder: "Tipos de criativos que performam melhor (vídeo, carrossel, etc.)" },
      { key: "restricoes", label: "Restrições de Comunicação", placeholder: "Palavras, frases ou temas proibidos/sensíveis" },
    ],
  },
];

export function KnowledgeBaseTemplateForm({ onSubmit, isPending }: KnowledgeBaseTemplateFormProps) {
  const [clientName, setClientName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});

  const updateField = (key: string, value: string) => {
    setFields(prev => ({ ...prev, [key]: value }));
  };

  const hasAnyContent = Object.values(fields).some(v => v.trim().length > 0);

  const buildMarkdown = (): string => {
    let md = `# Base de Conhecimento para ${clientName || "Meu Negócio"}\n\n`;

    for (const section of TEMPLATE_SECTIONS) {
      md += `## ${section.title}\n\n`;
      for (const field of section.fields) {
        const value = fields[field.key]?.trim() || "[Não preenchido]";
        md += `**${field.label}:** ${value}\n\n`;
      }
    }

    return md;
  };

  const handleSubmit = async () => {
    if (!hasAnyContent) return;
    const content = buildMarkdown();
    const name = `Base de Conhecimento - ${clientName || "Meu Negócio"}`;
    await onSubmit({ name, content });
  };

  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-2 text-primary">
        <BookOpen className="w-5 h-5" />
        <span className="font-semibold text-sm">Template Estratégico de Tráfego Pago</span>
      </div>

      <div className="space-y-2">
        <Label>Nome do Cliente / Produto</Label>
        <Input
          placeholder="Ex: Curso Marketing Digital"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
        />
      </div>

      <ScrollArea className="h-[400px] pr-4">
        <div className="space-y-6">
          {TEMPLATE_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-3">
              <h3 className="text-sm font-bold text-foreground border-b border-border pb-1">
                {section.title}
              </h3>
              {section.fields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label className="text-xs">{field.label}</Label>
                  <Textarea
                    placeholder={field.placeholder}
                    rows={2}
                    value={fields[field.key] || ""}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    className="resize-none text-sm"
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>

      <Button
        onClick={handleSubmit}
        disabled={!hasAnyContent || isPending}
        className="w-full"
      >
        {isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</>
        ) : (
          "Salvar Base de Conhecimento"
        )}
      </Button>
    </div>
  );
}
