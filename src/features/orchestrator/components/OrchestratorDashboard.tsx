import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Target, MessageSquare, ListTodo, Activity, Plus, History, RefreshCw, Zap, Sparkles, PenTool, Palette, Send, Megaphone, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import BusinessBriefing from './BusinessBriefing';
import TaskCard from './TaskCard';
import FollowupQueue from './FollowupQueue';
import ExecutionTimeline from './ExecutionTimeline';
import ExecutiveDashboard from './ExecutiveDashboard';
import { useOrchestrator } from '../hooks/useOrchestrator';
import { useFollowups } from '../hooks/useFollowups';
import { toast } from "sonner";
import { motion, AnimatePresence } from 'framer-motion';

const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { 
      duration: 0.6, 
      staggerChildren: 0.1 
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0 }
};

const OrchestratorDashboard = () => {

  const { 
    briefing, 
    activeTasks, 
    recentExecutions, 
    isLoading, 
    generateTasks, 
    isGenerating,
    runTask,
    isExecuting,
    resetOrchestrator
  } = useOrchestrator();
  const { overdue, today } = useFollowups();
  const [activeTab, setActiveTab] = useState('overview');

  const pendingCount = overdue.length + today.length;

  // SLA Alert System
  React.useEffect(() => {
    if (overdue.length > 0) {
      toast.error(`Atenção: Você possui ${overdue.length} follow-ups atrasados!`, {
        description: "O Salomão recomenda priorizar esses atendimentos imediatamente.",
        duration: 5000,
      });
    }
  }, [overdue.length]);

  const handleSyncInteligence = () => {
    if (!briefing) {
        toast.error("Por favor, preencha o briefing antes de sincronizar a inteligência.");
        return;
    }
    generateTasks(briefing);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <Brain className="w-8 h-8 text-purple-500 animate-pulse" />
            Orquestrador SALOMÃO
          </h1>
          <p className="text-muted-foreground">
            O Cérebro Operacional da sua estratégia de marketing e vendas.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {briefing && (
             <Button 
                variant="outline" 
                className="border-purple-500/50 text-purple-400 hover:bg-purple-500/10"
                onClick={handleSyncInteligence}
                disabled={isGenerating}
             >
               <Zap className={`w-4 h-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
               {isGenerating ? 'Sincronizando...' : 'Sincronizar Inteligência'}
             </Button>
          )}
          {(activeTasks.length > 0 || recentExecutions.length > 0) && (
            <Button 
              variant="outline" 
              className="border-red-500/20 text-red-500 hover:bg-red-500/10"
              onClick={() => {
                if (confirm('Tem certeza que deseja apagar todo o pipeline e histórico de tarefas deste negócio?')) {
                  resetOrchestrator();
                }
              }}
            >
              <History className="w-4 h-4 mr-2" />
              Resetar Timeline
            </Button>
          )}
        </div>
      </div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
        <motion.div variants={itemVariants}>
            <Card className="bg-black/40 border-purple-500/20 glass-morphism overflow-hidden relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Status do Cérebro</CardTitle>
                <Activity className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">Online</div>
                <p className="text-xs text-muted-foreground">Latência: 124ms</p>
              </CardContent>
            </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
            <Card className="bg-black/40 border-purple-500/20 glass-morphism overflow-hidden relative group">
               <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Tarefas Ativas</CardTitle>
                <ListTodo className="h-4 w-4 text-purple-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{activeTasks.length}</div>
                <p className="text-xs text-muted-foreground">Gerenciando {activeTasks.filter(t => t.status === 'in_progress').length} em progresso</p>
              </CardContent>
            </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
            <Card className="bg-black/40 border-purple-500/20 glass-morphism overflow-hidden relative group">
               <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Execuções IA</CardTitle>
                <Brain className="h-4 w-4 text-blue-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">{recentExecutions.length}</div>
                <p className="text-xs text-muted-foreground">Últimas 24 horas</p>
              </CardContent>
            </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
            <Card className="bg-black/40 border-purple-500/20 glass-morphism overflow-hidden relative group">
               <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-widest font-mono">Metas Batidas</CardTitle>
                <Target className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-white">92%</div>
                <div className="w-full bg-white/5 rounded-full h-1 mt-2">
                  <div className="bg-gradient-to-r from-yellow-500 to-orange-500 h-1 rounded-full w-[92%]" />
                </div>
              </CardContent>
            </Card>
        </motion.div>
      </motion.div>


      <AnimatePresence mode="wait">
        <motion.div
           key={activeTab}
           initial={{ opacity: 0, x: 10 }}
           animate={{ opacity: 1, x: 0 }}
           exit={{ opacity: 0, x: -10 }}
           transition={{ duration: 0.2 }}
        >
          <Tabs defaultValue="overview" className="space-y-6" onValueChange={setActiveTab} value={activeTab}>
            <TabsList className="bg-black/20 border border-white/5 p-1">
              <TabsTrigger value="overview">Visão Geral</TabsTrigger>
              <TabsTrigger value="analytics">Analytics Executivo</TabsTrigger>
              <TabsTrigger value="memory">Memória Operacional</TabsTrigger>
              <TabsTrigger value="tasks">Tarefas Master</TabsTrigger>
              <TabsTrigger value="followups" className="relative">
                Fila de Atendimento
                {pendingCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_5px_rgba(239,68,68,0.5)]" />
                )}
              </TabsTrigger>
              <TabsTrigger value="agents">Agentes Especialistas</TabsTrigger>
            </TabsList>



        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-7">
            <Card className="md:col-span-4 bg-black/40 border-white/5 overflow-hidden">
              <CardHeader className="border-b border-white/5 bg-white/5 flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Timeline de Orquestração</CardTitle>
                <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Live Sync</Badge>
              </CardHeader>
              <CardContent className="p-6">
                <ExecutionTimeline executions={recentExecutions} isLoading={isLoading} />
              </CardContent>
            </Card>


            <Card className="md:col-span-3 bg-black/40 border-white/5 overflow-hidden">
              <CardHeader className="border-b border-white/5 bg-white/5">
                <CardTitle className="text-lg">Contexto Preservado</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {briefing ? (
                    <>
                      <div className="p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/5 border border-purple-500/20">
                        <h3 className="text-sm font-semibold mb-2 text-white">Foco Atual</h3>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 italic">
                          "{briefing.offering_details}"
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs py-1 border-b border-white/5">
                          <span className="text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis mr-2">Negócio</span>
                          <span className="text-white font-medium text-right max-w-[150px] whitespace-nowrap overflow-hidden text-ellipsis">{briefing.business_name}</span>
                        </div>
                        <div className="flex justify-between text-xs py-1 border-b border-white/5">
                          <span className="text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis mr-2">Público Alvo</span>
                          <span className="text-white font-medium text-right max-w-[150px] whitespace-nowrap overflow-hidden text-ellipsis">{briefing.target_audience}</span>
                        </div>
                        <div className="flex justify-between text-xs py-1">
                          <span className="text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis mr-2">Tom de Voz</span>
                          <span className="text-white font-medium text-right max-w-[150px] whitespace-nowrap overflow-hidden text-ellipsis">{briefing.tone_of_voice}</span>
                        </div>
                      </div>
                      <Button variant="ghost" className="w-full text-xs text-purple-400 hover:text-purple-300 hover:bg-white/5" onClick={() => setActiveTab('memory')}>
                        Editar Contexto Completo
                      </Button>
                    </>
                  ) : (
                    <div className="text-center py-4 space-y-4">
                      <p className="text-xs text-muted-foreground italic leading-relaxed">
                        "Ainda não conheço os detalhes do seu negócio. Preencha o briefing para eu começar a orquestrar."
                      </p>
                      <Button size="sm" className="bg-purple-600 hover:bg-purple-700 w-full" onClick={() => setActiveTab('memory')}>
                        Configurar Briefing
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="analytics">
            <ExecutiveDashboard />
        </TabsContent>

        <TabsContent value="memory">

          <BusinessBriefing />
        </TabsContent>

        <TabsContent value="tasks">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Fluxo Organizado de Etapas Master</h3>
                <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20">{activeTasks.length} tarefas</Badge>
            </div>
            
            {activeTasks.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {activeTasks.map(task => (
                        <TaskCard 
                           key={task.id} 
                           task={task} 
                           onAction={runTask} 
                           execution={recentExecutions.find(e => e.task_id === task.id)}
                        />
                    ))}
                </div>
            ) : (
                <div className="text-center p-16 bg-black/40 rounded-xl border border-dashed border-white/10 space-y-4">
                    <ListTodo className="w-12 h-12 text-muted-foreground/20 mx-auto" />
                    <div className="space-y-2">
                        <p className="text-muted-foreground">O motor de tarefas está aguardando a sincronização do briefing.</p>
                        <Button variant="outline" size="sm" onClick={() => setActiveTab('memory')}>
                            Ir para Briefing
                        </Button>
                    </div>
                </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="followups">
          <FollowupQueue />
        </TabsContent>

        <TabsContent value="agents">

           <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {[
                { name: 'SALOMÃO', role: 'Orquestrador', icon: Sparkles },
                { name: 'JOSÉ', role: 'Tráfego Pago', icon: Target },
                { name: 'PAULO', role: 'Copywriter', icon: PenTool },
                { name: 'MARIA', role: 'Design', icon: Palette },
                { name: 'DAVI', role: 'Social Media', icon: Send },
                { name: 'JOÃO', role: 'E-mail Marketing', icon: Megaphone },
                { name: 'PEDRO', role: 'Atendimento', icon: Bot },
                { name: 'DANIEL', role: 'Estratégia', icon: Brain },
              ].map(agent => (
                  <Card key={agent.name} className="bg-black/40 border-white/5 hover:border-purple-500/20 transition-colors">
                      <CardContent className="p-4 flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
                              <agent.icon className="w-5 h-5 text-purple-400" />
                          </div>
                          <div>
                              <p className="text-sm font-bold text-white">{agent.name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono">STATUS: ATIVO</p>
                          </div>
                      </CardContent>
                  </Card>
              ))}
           </div>
        </TabsContent>
      </Tabs>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default OrchestratorDashboard;


