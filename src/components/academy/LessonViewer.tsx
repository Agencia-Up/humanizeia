import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Clock, BookOpen, CheckCircle, Lightbulb, ChevronRight, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { MarkdownRenderer } from '@/components/ui/markdown-renderer';
import type { AcademyModule, Lesson } from '@/data/academyContent';

interface LessonViewerProps {
  module: AcademyModule;
  onBack: () => void;
}

const typeIcons: Record<string, string> = {
  video: '🎬',
  text: '📖',
  exercise: '🧪',
  checklist: '✅',
};

export function LessonViewer({ module, onBack }: LessonViewerProps) {
  const [selectedLessonIndex, setSelectedLessonIndex] = useState(0);
  const lesson = module.lessons[selectedLessonIndex];

  const goNext = () => {
    if (selectedLessonIndex < module.lessons.length - 1) setSelectedLessonIndex(i => i + 1);
  };
  const goPrev = () => {
    if (selectedLessonIndex > 0) setSelectedLessonIndex(i => i - 1);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-3"
      >
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">{module.icon}</span>
            <h2 className="text-lg font-bold">Módulo {module.number}: {module.name}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{module.description}</p>
        </div>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Sidebar - Lessons list */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm lg:sticky lg:top-4 lg:self-start">
          <CardContent className="p-3">
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
              {module.lessons.length} Aulas • {module.duration}
            </h3>
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-1">
                {module.lessons.map((l, i) => (
                  <button
                    key={l.id}
                    onClick={() => setSelectedLessonIndex(i)}
                    className={`flex w-full items-center gap-2 rounded-lg p-2.5 text-left text-sm transition-all ${
                      i === selectedLessonIndex
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted/50 text-foreground'
                    }`}
                  >
                    <span className="shrink-0 text-base">{typeIcons[l.type]}</span>
                    <span className="flex-1 line-clamp-2">{l.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{l.duration}</span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Main content */}
        <motion.div
          key={lesson.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-6">
              {/* Lesson header */}
              <div className="mb-6 flex items-center gap-3">
                <span className="text-2xl">{typeIcons[lesson.type]}</span>
                <div className="flex-1">
                  <h3 className="text-xl font-bold">{lesson.title}</h3>
                  <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {lesson.duration}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      Aula {selectedLessonIndex + 1} de {module.lessons.length}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Markdown content */}
              <ScrollArea className="max-h-[60vh]">
                <MarkdownRenderer content={lesson.content} />

                {/* Key takeaways */}
                <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <h4 className="mb-2 flex items-center gap-2 font-semibold text-primary">
                    <CheckCircle className="h-4 w-4" />
                    Pontos-Chave
                  </h4>
                  <ul className="space-y-1.5">
                    {lesson.keyTakeaways.map((t, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="mt-0.5 text-primary">•</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Pro tips */}
                {lesson.proTips && lesson.proTips.length > 0 && (
                  <div className="mt-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4">
                    <h4 className="mb-2 flex items-center gap-2 font-semibold text-yellow-500">
                      <Lightbulb className="h-4 w-4" />
                      Dicas Pro
                    </h4>
                    <ul className="space-y-1.5">
                      {lesson.proTips.map((t, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <span className="mt-0.5 text-yellow-500">💡</span>
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </ScrollArea>

              {/* Navigation */}
              <div className="mt-6 flex items-center justify-between border-t border-border/30 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goPrev}
                  disabled={selectedLessonIndex === 0}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  {selectedLessonIndex + 1} / {module.lessons.length}
                </span>
                <Button
                  size="sm"
                  onClick={goNext}
                  disabled={selectedLessonIndex === module.lessons.length - 1}
                  className="gap-1"
                >
                  Próxima
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
