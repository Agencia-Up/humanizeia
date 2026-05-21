// Modal "Adicionar nova cidade/origem" — validação fuzzy + confirmação visual.

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import {
  validateInput,
  create,
  type DynamicEntity,
  type ValidateResult,
  type DynamicRow,
} from "@/services/dynamicFields/dynamicFieldsService";
import { useToast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: DynamicEntity;
  userId: string;
  /** Chamado quando cria/seleciona uma row. Recebe a row + se foi pendente */
  onCreated: (row: DynamicRow) => void;
}

const LABELS = {
  city: {
    title: "Adicionar nova cidade",
    placeholder: "Ex: Ubatuba",
    btnAdd: "Adicionar cidade",
  },
  lead_source: {
    title: "Adicionar nova origem do lead",
    placeholder: "Ex: TikTok Ads",
    btnAdd: "Adicionar origem",
  },
} as const;

export function AddDynamicModal({ open, onOpenChange, entity, userId, onCreated }: Props) {
  const { toast } = useToast();
  const cfg = LABELS[entity];
  const [input, setInput] = useState("");
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setInput("");
      setValidation(null);
    }
  }, [open]);

  // Debounce 350ms — valida enquanto digita
  useEffect(() => {
    if (!input || !userId) {
      setValidation(null);
      return;
    }
    const t = setTimeout(async () => {
      setValidating(true);
      try {
        const r = await validateInput(entity, input, userId);
        setValidation(r);
      } catch (err: any) {
        setValidation({
          ok: false,
          display: input,
          normalized: "",
          errors: [err?.message || "Erro de validação"],
          similar: [],
          existing: null,
        });
      } finally {
        setValidating(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [input, entity, userId]);

  const handleUseExisting = (id: string, name: string) => {
    onCreated({ id, name } as DynamicRow);
    onOpenChange(false);
  };

  const handleCreate = async (forceIfSimilar: boolean) => {
    if (!validation?.ok || !input.trim()) return;
    setSaving(true);
    try {
      const result = await create({
        entity,
        input,
        userId,
        createdBy: userId,
        forceIfSimilar,
      });
      toast({
        title: result.wasCreated ? "✅ Adicionado!" : "Já existia, selecionado",
        description: `"${result.row.name}" pronto pra usar.`,
      });
      onCreated(result.row);
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Erro ao adicionar",
        description: err?.message || "Tente novamente",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const canSave = !!validation?.ok && !validating && !saving && !validation.existing;
  const hasSimilar = !!validation && validation.similar.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            {cfg.title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={cfg.placeholder}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) {
                  e.preventDefault();
                  handleCreate(false);
                }
              }}
            />
            {validation?.display && validation.display !== input && (
              <p className="text-[11px] text-muted-foreground">
                Vamos salvar como: <span className="font-semibold text-foreground">{validation.display}</span>
              </p>
            )}
          </div>

          {validating && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Verificando duplicidade...
            </div>
          )}

          {validation && validation.errors.length > 0 && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs">
              <p className="font-medium text-red-400">Erros de validação:</p>
              <ul className="mt-1 ml-3 list-disc text-red-400/90">
                {validation.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {validation?.existing && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-emerald-400">Já existe!</p>
                  <p className="text-sm font-semibold text-foreground mt-1">{validation.existing.name}</p>
                  <Button
                    size="sm"
                    className="mt-2 h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => handleUseExisting(validation.existing!.id, validation.existing!.name)}
                  >
                    Usar este
                  </Button>
                </div>
              </div>
            </div>
          )}

          {hasSimilar && !validation?.existing && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs font-medium text-amber-400">Encontrei similares — quer usar uma destas?</p>
              </div>
              <ul className="space-y-1.5">
                {validation!.similar.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-foreground">{s.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {Math.round(s.similarity * 100)}% parecido
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px]"
                      onClick={() => handleUseExisting(s.id, s.name)}
                    >
                      Usar este
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validation?.ok && !validation.existing && !hasSimilar && validation.errors.length === 0 && input.length > 1 && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-xs text-emerald-400">Nome disponível — pode adicionar!</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          {hasSimilar && !validation?.existing && (
            <Button
              variant="outline"
              onClick={() => handleCreate(true)}
              disabled={saving || !validation?.ok}
              className="border-amber-500/50 text-amber-400"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Adicionar mesmo assim
            </Button>
          )}
          {!hasSimilar && !validation?.existing && (
            <Button onClick={() => handleCreate(false)} disabled={!canSave} className="gradient-primary">
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              {cfg.btnAdd}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
