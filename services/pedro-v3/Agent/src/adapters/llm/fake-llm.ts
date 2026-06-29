// ============================================================================
// FakeLlmAdapter — determinístico, para L1/L4 (sem rede, sem provider real).
// proposeNextQueryOrFinal replaia um SCRIPT de DecisionStep por turno.
// compose() monta um texto simples e ATERRADO a partir dos fatos (ou injeta um
// preço inválido quando o script pedir, p/ testar o grounding).
// ============================================================================
import type { DecisionLlm } from "../../domain/llm.ts";
import type { TurnContext } from "../../domain/context.ts";
import type { DecisionStep, QueryResult, TurnDecision, ResponseDraft } from "../../domain/decision.ts";

export type ComposeOverride = (decision: TurnDecision, facts: QueryResult[]) => ResponseDraft;

export class FakeLlm implements DecisionLlm {
  private script: DecisionStep[] = [];
  private cursor = 0;
  private composeOverride?: ComposeOverride;

  /** Define o roteiro de passos de UM turno (queries seguidas do "final"). */
  setTurnScript(steps: DecisionStep[], composeOverride?: ComposeOverride): void {
    this.script = steps;
    this.cursor = 0;
    this.composeOverride = composeOverride;
  }

  async proposeNextQueryOrFinal(_ctx: TurnContext, _facts: QueryResult[]): Promise<DecisionStep> {
    if (this.cursor >= this.script.length) {
      // sem mais passos: o engine trata como "limite atingido" -> saída segura.
      throw new Error("fake-llm: script esgotado sem 'final'");
    }
    return this.script[this.cursor++];
  }

  async compose(decision: TurnDecision, facts: QueryResult[], _ctx: TurnContext): Promise<ResponseDraft> {
    if (this.composeOverride) return this.composeOverride(decision, facts);

    const parts: any[] = [{ type: "text", content: decision.responsePlan.guidance }];

    for (const f of facts) {
      if (f.ok && f.tool === "stock_search") {
        for (const v of f.data.items) {
          parts.push({ type: "text", content: " " });
          parts.push({ type: "vehicle_ref", vehicleKey: v.vehicleKey, field: "modelo" });
          parts.push({ type: "text", content: " por " });
          parts.push({ type: "money_ref", role: "vehicle_price", source: { kind: "vehicle_fact", vehicleKey: v.vehicleKey } });
        }
      }
    }

    return { parts };
  }
}
