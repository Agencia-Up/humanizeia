import { supabase } from '@/integrations/supabase/client';
import type { AgentInstruction } from '@/services/claude';

export interface ExecutionResult {
  instructionId: string;
  platform: string;
  action: string;
  success: boolean;
  result?: unknown;
  error?: string;
  executedAt: string;
}

export interface ExecutionSummary {
  total: number;
  successful: number;
  failed: number;
  results: ExecutionResult[];
  startedAt: string;
  completedAt: string;
  createdIds: Record<string, string>;
}

class CampaignAgent {
  private executionLog: ExecutionResult[] = [];
  private isExecuting = false;

  async executeInstructions(
    instructions: AgentInstruction[],
    options: {
      dryRun?: boolean;
      stopOnError?: boolean;
      onProgress?: (result: ExecutionResult) => void;
    } = {}
  ): Promise<ExecutionSummary> {
    if (this.isExecuting) {
      throw new Error('Já existe uma execução em andamento');
    }

    this.isExecuting = true;
    
    try {
      const startedAt = new Date().toISOString();
      
      const { data, error } = await supabase.functions.invoke('campaign-executor', {
        body: {
          instructions,
          dryRun: options.dryRun || false,
        }
      });

      if (error) {
        throw new Error(`Erro na execução: ${error.message}`);
      }

      const summary: ExecutionSummary = data;

      // Registrar resultados no log
      summary.results.forEach(result => {
        this.executionLog.push(result);
        options.onProgress?.(result);
      });

      // Se stopOnError e houve falhas, interromper
      if (options.stopOnError && summary.failed > 0) {
        console.warn(`Execução interrompida: ${summary.failed} falha(s)`);
      }

      return summary;

    } finally {
      this.isExecuting = false;
    }
  }

  // Obter log de todas as execuções
  getExecutionLog(): ExecutionResult[] {
    return [...this.executionLog];
  }

  // Limpar log
  clearLog(): void {
    this.executionLog = [];
  }

  // Verificar se está executando
  isRunning(): boolean {
    return this.isExecuting;
  }
}

export const campaignAgent = new CampaignAgent();
