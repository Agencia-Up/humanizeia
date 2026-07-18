/**
 * TutorialSteps — passo a passo com print, dentro do Chat de Suporte.
 *
 * Recebe o objeto `tutorial` que a edge devolve junto da resposta canônica:
 *   { tutorialId, title, summary, steps: [{ title, description, imageUrl }] }
 *
 * REGRAS DE COMPORTAMENTO (pedido do dono):
 * - A imagem é COMPLEMENTO, nunca requisito. Se o print faltar ou falhar ao
 *   carregar, o passo continua aparecendo com título e descrição — quem lê
 *   ainda consegue seguir. Esconder o passo por falta de imagem seria pior que
 *   não ter imagem nenhuma.
 * - Nada de caminho local de máquina: `imageUrl` é sempre caminho público do
 *   próprio app (`/help/tutorials/...`), servido de `public/`.
 * - Clicar na imagem abre ampliada — no painel lateral (~448px) o print fica
 *   pequeno demais pra ler rótulo de botão.
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ImageOff, ZoomIn } from 'lucide-react';

export interface TutorialStep {
  title: string;
  description?: string;
  imageUrl?: string | null;
}

export interface TutorialData {
  tutorialId: string;
  title?: string;
  summary?: string;
  steps: TutorialStep[];
}

/** Miniatura do passo. Isola o estado de erro POR IMAGEM (uma falha não derruba as outras). */
function StepImage({
  step,
  posicao,
  total,
  onAmpliar,
}: {
  step: TutorialStep;
  posicao: number;
  total: number;
  onAmpliar: () => void;
}) {
  const [falhou, setFalhou] = useState(false);

  // Sem print cadastrado ainda, ou o arquivo não carregou: mostra um aviso
  // discreto no lugar da imagem e SEGUE mostrando o passo.
  if (!step.imageUrl || falhou) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 bg-background/60 px-2.5 py-2 text-[10px] text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span>Imagem deste passo ainda não disponível — siga pelo texto acima.</span>
      </div>
    );
  }

  return (
    <figure className="space-y-1">
      <button
        type="button"
        onClick={onAmpliar}
        aria-label={`Ampliar imagem do passo ${posicao}: ${step.title}`}
        className="group relative block w-full overflow-hidden rounded-lg border border-border/60 bg-background transition hover:border-primary/50"
      >
        <img
          src={step.imageUrl}
          alt={`Passo ${posicao}: ${step.title}`}
          loading="lazy"
          onError={() => setFalhou(true)}
          className="block h-auto w-full"
        />
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md bg-background/85 px-1.5 py-0.5 text-[9px] font-medium text-foreground opacity-0 transition group-hover:opacity-100">
          <ZoomIn className="h-3 w-3" /> ampliar
        </span>
      </button>
      <figcaption className="text-[10px] text-muted-foreground">
        Passo {posicao} de {total} — {step.title}
      </figcaption>
    </figure>
  );
}

export default function TutorialSteps({ tutorial }: { tutorial: TutorialData }) {
  const [ampliada, setAmpliada] = useState<TutorialStep | null>(null);
  const passos = Array.isArray(tutorial?.steps) ? tutorial.steps : [];
  if (!passos.length) return null;

  return (
    <div className="space-y-2 pt-1">
      {(tutorial.title || tutorial.summary) && (
        <div className="rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-2">
          {tutorial.title && <p className="text-[11px] font-semibold">{tutorial.title}</p>}
          {tutorial.summary && (
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{tutorial.summary}</p>
          )}
        </div>
      )}

      <ol className="space-y-2">
        {passos.map((step, i) => (
          <li
            key={`${tutorial.tutorialId}-${i}`}
            className="space-y-1.5 rounded-xl border border-border/60 bg-background/70 p-2.5"
          >
            <div className="flex items-start gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-[11px] font-semibold leading-snug">{step.title}</p>
                {step.description && (
                  <p className="text-[10px] leading-relaxed text-muted-foreground">{step.description}</p>
                )}
              </div>
            </div>

            <StepImage
              step={step}
              posicao={i + 1}
              total={passos.length}
              onAmpliar={() => setAmpliada(step)}
            />
          </li>
        ))}
      </ol>

      {/* Imagem ampliada. O Sheet do suporte é z-50; este Dialog também é z-50 e
          monta DEPOIS, então fica por cima — comportamento padrão do shadcn. */}
      <Dialog open={!!ampliada} onOpenChange={(o) => !o && setAmpliada(null)}>
        <DialogContent className="max-w-3xl p-3">
          <DialogTitle className="text-sm">{ampliada?.title}</DialogTitle>
          {ampliada?.description && (
            <p className="text-xs text-muted-foreground">{ampliada.description}</p>
          )}
          {ampliada?.imageUrl && (
            <img
              src={ampliada.imageUrl}
              alt={ampliada.title}
              className="mt-1 h-auto max-h-[75vh] w-full rounded-lg border border-border/60 object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
