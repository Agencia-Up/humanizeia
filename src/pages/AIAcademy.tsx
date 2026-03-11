import { useState } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  GraduationCap,
  Play,
  CheckCircle,
  Lock,
  Clock,
  BookOpen,
  FileText,
  Copy,
  Check,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { academyModules, academyPrompts, academyChecklists } from '@/data/academyContent';
import { LessonViewer } from '@/components/academy/LessonViewer';
import { AcademyAITutor } from '@/components/academy/AcademyAITutor';
import { useToast } from '@/hooks/use-toast';

const levelColors = {
  Iniciante: 'bg-green-500/20 text-green-400',
  Intermediário: 'bg-yellow-500/20 text-yellow-400',
  Avançado: 'bg-red-500/20 text-red-400',
};

const platformBadge = {
  meta: { label: 'Meta', className: 'bg-blue-500/20 text-blue-400' },
  both: { label: 'Geral', className: 'bg-purple-500/20 text-purple-400' },
};

export default function AIAcademy() {
  const { toast } = useToast();
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({});

  const totalLessons = academyModules.reduce((acc, m) => acc + m.lessons.length, 0);
  const selectedModule = academyModules.find((m) => m.id === selectedModuleId);

  const handleCopyPrompt = (promptId: string, promptText: string) => {
    navigator.clipboard.writeText(promptText);
    setCopiedPromptId(promptId);
    toast({ title: 'Prompt copiado! 📋', description: 'Cole no MIDAS ou ChatGPT.' });
    setTimeout(() => setCopiedPromptId(null), 2000);
  };

  const toggleCheckItem = (itemId: string) => {
    setChecklistState((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  // If a module is selected, show the lesson viewer
  if (selectedModule) {
    return (
      <MainLayout>
        <div className="grid gap-6 xl:grid-cols-[1fr_350px]">
          <LessonViewer module={selectedModule} onBack={() => setSelectedModuleId(null)} />
          <div className="hidden xl:block">
            <AcademyAITutor
              currentModule={selectedModule.name}
              currentLesson={selectedModule.lessons[0]?.title}
            />
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold lg:text-3xl">AI Academy</h1>
          <p className="text-muted-foreground">
            A plataforma definitiva de IA para Meta Ads
          </p>
        </div>

        {/* Progress Overview */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex h-20 w-20 items-center justify-center rounded-full gradient-primary">
                <GraduationCap className="h-8 w-8 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">Curso Completo de IA para Tráfego Pago</h3>
                <p className="text-sm text-muted-foreground">
                  Do fundamento à escala — domine IA no Meta Ads
                </p>
              </div>
              <div className="flex gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{academyModules.length}</p>
                  <p className="text-xs text-muted-foreground">Módulos</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{totalLessons}</p>
                  <p className="text-xs text-muted-foreground">Aulas</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{academyPrompts.length}</p>
                  <p className="text-xs text-muted-foreground">Prompts</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1fr_350px]">
          <Tabs defaultValue="modules" className="space-y-6">
            <TabsList className="bg-muted/50">
              <TabsTrigger value="modules" className="gap-2">
                <GraduationCap className="h-4 w-4" />
                Módulos
              </TabsTrigger>
              <TabsTrigger value="prompts" className="gap-2">
                <BookOpen className="h-4 w-4" />
                Prompts Library
              </TabsTrigger>
              <TabsTrigger value="checklists" className="gap-2">
                <FileText className="h-4 w-4" />
                Checklists
              </TabsTrigger>
            </TabsList>

            {/* Modules Tab */}
            <TabsContent value="modules" className="space-y-3">
              {academyModules.map((module, index) => (
                <motion.div
                  key={module.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Card
                    className={`border-border/50 bg-card/50 backdrop-blur-sm transition-all cursor-pointer ${
                      module.locked ? 'opacity-60' : 'hover:border-primary/30'
                    }`}
                    onClick={() => !module.locked && setSelectedModuleId(module.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                            module.locked ? 'bg-muted' : 'gradient-primary'
                          }`}
                        >
                          {module.locked ? (
                            <Lock className="h-6 w-6 text-muted-foreground" />
                          ) : (
                            <span className="text-xl">{module.icon}</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{module.name}</h3>
                            <Badge
                              className={
                                levelColors[module.level as keyof typeof levelColors]
                              }
                            >
                              {module.level}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{module.description}</p>
                          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Play className="h-3 w-3" />
                              {module.lessons.length} aulas
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {module.duration}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant={module.locked ? 'secondary' : 'default'}
                          disabled={module.locked}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!module.locked) setSelectedModuleId(module.id);
                          }}
                        >
                          {module.locked ? 'Bloqueado' : 'Estudar'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </TabsContent>

            {/* Prompts Tab */}
            <TabsContent value="prompts" className="space-y-3">
              {academyPrompts.map((prompt) => (
                <Card key={prompt.id} className="border-border/50 bg-card/50 backdrop-blur-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary">{prompt.category}</Badge>
                          <Badge className={platformBadge[prompt.platform].className}>
                            {platformBadge[prompt.platform].label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {prompt.uses} usos
                          </span>
                        </div>
                        <h3 className="font-semibold">{prompt.title}</h3>
                        <p className="text-sm text-muted-foreground">{prompt.description}</p>
                        <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                          {prompt.prompt}
                        </pre>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1.5"
                        onClick={() => handleCopyPrompt(prompt.id, prompt.prompt)}
                      >
                        {copiedPromptId === prompt.id ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Copiar
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            {/* Checklists Tab */}
            <TabsContent value="checklists" className="space-y-4">
              {academyChecklists.map((checklist) => {
                const checked = checklist.items.filter(
                  (item) => checklistState[item.id]
                ).length;
                const total = checklist.items.length;
                const pct = Math.round((checked / total) * 100);

                return (
                  <Card
                    key={checklist.id}
                    className="border-border/50 bg-card/50 backdrop-blur-sm"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <Badge variant="secondary" className="mb-1">
                            {checklist.category}
                          </Badge>
                          <CardTitle className="text-base">{checklist.title}</CardTitle>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium">
                            {checked}/{total}
                          </p>
                          <Progress value={pct} className="mt-1 h-1.5 w-20" />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        {checklist.items.map((item) => (
                          <label
                            key={item.id}
                            className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-all hover:bg-muted/30"
                          >
                            <input
                              type="checkbox"
                              checked={checklistState[item.id] || false}
                              onChange={() => toggleCheckItem(item.id)}
                              className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                            />
                            <span
                              className={`text-sm ${
                                checklistState[item.id]
                                  ? 'text-muted-foreground line-through'
                                  : 'text-foreground'
                              }`}
                            >
                              {item.text}
                            </span>
                          </label>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>
          </Tabs>

          {/* AI Tutor Sidebar */}
          <div className="hidden xl:block">
            <AcademyAITutor />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
