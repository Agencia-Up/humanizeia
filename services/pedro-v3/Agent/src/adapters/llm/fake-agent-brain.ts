// ============================================================================
// fake-agent-brain.ts — AgentBrainPort determinístico (offline §8.1). Sem rede, sem provider.
// Modo SCRIPT (steps por turno, consumidos em ordem) OU RESPONDER (função pura do frame+observações).
// ============================================================================
import type { AgentBrainPort, AgentBrainStep, AgentToolObservation, TurnFrame } from "../../domain/agent-brain.ts";

export type BrainResponder = (frame: TurnFrame, observations: readonly AgentToolObservation[], stepIndex: number) => AgentBrainStep | Promise<AgentBrainStep>;

export class ScriptedAgentBrain implements AgentBrainPort {
  private script: AgentBrainStep[] = [];
  private cursor = 0;
  private responder?: BrainResponder;
  readonly seenFrames: TurnFrame[] = [];
  readonly seenObservations: AgentToolObservation[][] = [];

  /** Define os passos de UM turno (queries seguidas do "final"). */
  setTurnScript(steps: AgentBrainStep[]): void { this.script = steps; this.cursor = 0; this.responder = undefined; }
  /** Responde dinamicamente a cada passo (para testes de timeout/loop/observação). */
  setResponder(fn: BrainResponder): void { this.responder = fn; this.script = []; this.cursor = 0; }

  async proposeNextStep(frame: TurnFrame, observations: readonly AgentToolObservation[]): Promise<AgentBrainStep> {
    this.seenFrames.push(frame);
    this.seenObservations.push([...observations]);
    if (this.responder) return this.responder(frame, observations, this.cursor++);
    if (this.cursor >= this.script.length) throw new Error("scripted-brain: script esgotado sem 'final'");
    return this.script[this.cursor++];
  }
}
