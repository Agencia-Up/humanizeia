// ============================================================================
// ResponseRenderer — PURO. Resolve ResponseDraft contra fatos/estado.
// Fase 1.5: campo "preco" removido de vehicle_ref. Preço só por money_ref.
// Matriz MoneyRole × MoneySource validada rigidamente.
// ============================================================================
import type { ResponseDraft, QueryResult } from "../domain/decision.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type { VehicleFact } from "../domain/types.ts";

export const ResponseRenderer = {
  render(draft: ResponseDraft, facts: QueryResult[], state: ConversationState): string {
    let out = "";

    // Indexa todos os fatos de veículo bem-sucedidos do turno
    const vehicles = new Map<string, VehicleFact>();
    for (const f of facts) {
      if (f.ok) {
        if (f.tool === "stock_search") {
          for (const v of f.data.items) {
            vehicles.set(v.vehicleKey, v);
          }
        }
        if (f.tool === "vehicle_details") {
          vehicles.set(f.data.vehicle.vehicleKey, f.data.vehicle);
        }
      }
    }

    for (const part of draft.parts) {
      if (part.type === "text") {
        out += part.content;
      } else if (part.type === "vehicle_ref") {
        const v = vehicles.get(part.vehicleKey);
        if (!v) {
          throw new Error(`vehicle_ref: veículo '${part.vehicleKey}' não encontrado nos fatos do turno`);
        }
        // Fase 1.5: field "preco" REMOVIDO do tipo. Apenas marca/modelo/ano.
        if (part.field === "marca") {
          out += v.marca;
        } else if (part.field === "modelo") {
          out += v.modelo;
        } else if (part.field === "ano") {
          out += v.ano.toString();
        } else {
          // Compilação do TS já impede isso pelo tipo, mas defesa em profundidade:
          throw new Error(`vehicle_ref: campo '${(part as any).field}' não é permitido`);
        }
      } else if (part.type === "money_ref") {
        let value: number;

        // Validação estrita da matriz MoneyRole × MoneySource (Fase 1.5)
        if (part.role === "vehicle_price") {
          if (part.source.kind !== "vehicle_fact") {
            throw new Error(`money_ref: role 'vehicle_price' exige source 'vehicle_fact', recebeu '${part.source.kind}'`);
          }
          const v = vehicles.get(part.source.vehicleKey);
          if (!v) {
            throw new Error(`money_ref: veículo '${part.source.vehicleKey}' não encontrado nos fatos do turno`);
          }
          value = v.preco;
        } else if (part.role === "down_payment") {
          if (part.source.kind !== "slot_value" || part.source.slotName !== "entrada") {
            throw new Error(`money_ref: role 'down_payment' exige source slot_value/entrada, recebeu '${part.source.kind}/${(part.source as any).slotName ?? "N/A"}'`);
          }
          const slot = state.slots.entrada;
          if (!slot || slot.value == null) {
            throw new Error(`money_ref: valor do slot 'entrada' não preenchido no estado`);
          }
          value = slot.value;
        } else if (part.role === "installment") {
          if (part.source.kind !== "slot_value" || part.source.slotName !== "parcelaDesejada") {
            throw new Error(`money_ref: role 'installment' exige source slot_value/parcelaDesejada, recebeu '${part.source.kind}/${(part.source as any).slotName ?? "N/A"}'`);
          }
          const slot = state.slots.parcelaDesejada;
          if (!slot || slot.value == null) {
            throw new Error(`money_ref: valor do slot 'parcelaDesejada' não preenchido no estado`);
          }
          value = slot.value;
        } else if (part.role === "budget") {
          if (part.source.kind !== "slot_value" || part.source.slotName !== "faixaPreco") {
            throw new Error(`money_ref: role 'budget' exige source slot_value/faixaPreco, recebeu '${part.source.kind}/${(part.source as any).slotName ?? "N/A"}'`);
          }
          const slot = state.slots.faixaPreco;
          if (!slot || slot.value == null) {
            throw new Error(`money_ref: valor do slot 'faixaPreco' não preenchido no estado`);
          }
          const valObj = slot.value;
          value = valObj.max ?? valObj.min ?? 0;
          if (value === 0) {
            throw new Error(`money_ref: valor numérico não extraído do slot 'faixaPreco'`);
          }
        } else {
          throw new Error(`money_ref: role desconhecido ou incompatível`);
        }

        out += formatCurrency(value);
      } else {
        throw new Error("ResponseDraft: tipo de parte desconhecido");
      }
    }

    return out;
  }
};

function formatCurrency(val: number): string {
  const formatted = val.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `R$ ${formatted}`;
}
