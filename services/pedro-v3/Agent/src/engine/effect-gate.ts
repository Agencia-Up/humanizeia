// ============================================================================
// effect-gate.ts - F2.3. Controle de Shadow Mode / Active Mode in-memory.
// Garante por construção que efeitos reais nunca disparem em Shadow Mode.
// ============================================================================

export interface EffectGate {
  /**
   * Avalia se uma conversa está em modo ativo (com disparos de efeitos reais)
   * ou em modo shadow (onde disparos reais são suprimidos e simulados).
   */
  isActiveMode(conversationId: string): boolean;
}

export class InMemoryEffectGate implements EffectGate {
  private activeConversations = new Set<string>();

  /**
   * Ativa ou desativa o modo de disparo real (Active Mode) para uma conversa.
   */
  setActiveMode(conversationId: string, active: boolean): void {
    if (active) {
      this.activeConversations.add(conversationId);
    } else {
      this.activeConversations.delete(conversationId);
    }
  }

  isActiveMode(conversationId: string): boolean {
    return this.activeConversations.has(conversationId);
  }
}
