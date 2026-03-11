import { PenTool, Palette, Rocket, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

const quickActions = [
  { icon: PenTool, label: 'Gerar Copy', route: '/copywriter', color: 'from-blue-500 to-cyan-500' },
  { icon: Palette, label: 'Criar Criativo', route: '/creative-studio', color: 'from-purple-500 to-pink-500' },
  { icon: Rocket, label: 'Otimizar Campanhas', route: '/optimizer', color: 'from-orange-500 to-red-500' },
  { icon: FileText, label: 'Gerar Relatório', route: '/reports', color: 'from-green-500 to-emerald-500' },
];

export function QuickActionsCard() {
  const navigate = useNavigate();

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-primary">
            <Rocket className="h-4 w-4 text-white" />
          </div>
          Ações Rápidas
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map((action, index) => (
            <motion.div
              key={action.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.1 }}
            >
              <Button
                variant="outline"
                className="h-auto w-full flex-col gap-2 border-border/50 bg-muted/30 p-4 hover:border-primary/50 hover:bg-muted/50"
                onClick={() => navigate(action.route)}
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r ${action.color}`}>
                  <action.icon className="h-5 w-5 text-white" />
                </div>
                <span className="text-sm font-medium">{action.label}</span>
              </Button>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
