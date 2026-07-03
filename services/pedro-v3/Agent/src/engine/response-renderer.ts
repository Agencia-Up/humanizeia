// ============================================================================
// ResponseRenderer — PURO. Resolve ResponseDraft contra fatos/estado.
// Fase 1.5: campo "preco" removido de vehicle_ref. Preço só por money_ref.
// F2.7.5: junta partes com SEPARADORES (nunca "ONIX2014Ele"/"RENEGADE2016R$..."),
//         e renderiza `vehicle_offer_list` como bloco numerado determinístico.
// Matriz MoneyRole × MoneySource validada rigidamente.
// ============================================================================
import type { ResponseDraft, ResponsePart, QueryResult } from "../domain/decision.ts";
import type { ConversationState } from "../domain/conversation-state.ts";
import type { VehicleFact } from "../domain/types.ts";
import { renderVehicleOfferList, formatBRL } from "./vehicle-offer-render.ts";

type Segment = { kind: "text" | "inline" | "block"; text: string };

function indexVehicles(facts: QueryResult[]): Map<string, VehicleFact> {
  const vehicles = new Map<string, VehicleFact>();
  for (const f of facts) {
    if (f.ok) {
      if (f.tool === "stock_search") for (const v of f.data.items) vehicles.set(v.vehicleKey, v);
      if (f.tool === "vehicle_details") vehicles.set(f.data.vehicle.vehicleKey, f.data.vehicle);
    }
  }
  return vehicles;
}

function renderVehicleRef(part: Extract<ResponsePart, { type: "vehicle_ref" }>, vehicles: Map<string, VehicleFact>): string {
  const v = vehicles.get(part.vehicleKey);
  if (!v) throw new Error(`vehicle_ref: veículo '${part.vehicleKey}' não encontrado nos fatos do turno`);
  if (part.field === "marca") return v.marca;
  if (part.field === "modelo") return v.modelo;
  if (part.field === "ano") return v.ano.toString();
  // F-4: atributos estendidos — valor do VehicleFact EXATO; campo AUSENTE falha fechado (não inventa).
  if (part.field === "km") { if (v.km == null) throw new Error(`vehicle_ref: km ausente no fato de '${part.vehicleKey}'`); return `${v.km.toLocaleString("pt-BR")} km`; }
  if (part.field === "cambio") { if (!v.cambio) throw new Error(`vehicle_ref: câmbio ausente no fato de '${part.vehicleKey}'`); return v.cambio; }
  if (part.field === "cor") { if (!v.cor) throw new Error(`vehicle_ref: cor ausente no fato de '${part.vehicleKey}'`); return v.cor; }
  throw new Error(`vehicle_ref: campo '${(part as any).field}' não é permitido`);
}

function renderMoneyRef(part: Extract<ResponsePart, { type: "money_ref" }>, vehicles: Map<string, VehicleFact>, state: ConversationState): string {
  let value: number;
  if (part.role === "vehicle_price") {
    if (part.source.kind !== "vehicle_fact") throw new Error(`money_ref: role 'vehicle_price' exige source 'vehicle_fact', recebeu '${part.source.kind}'`);
    const v = vehicles.get(part.source.vehicleKey);
    if (!v) throw new Error(`money_ref: veículo '${part.source.vehicleKey}' não encontrado nos fatos do turno`);
    value = v.preco;
  } else if (part.role === "down_payment") {
    if (part.source.kind !== "slot_value" || part.source.slotName !== "entrada") throw new Error(`money_ref: role 'down_payment' exige source slot_value/entrada, recebeu '${part.source.kind}/${(part.source as any).slotName ?? "N/A"}'`);
    const slot = state.slots.entrada;
    if (!slot || slot.value == null) throw new Error(`money_ref: valor do slot 'entrada' não preenchido no estado`);
    value = slot.value;
  } else if (part.role === "installment") {
    if (part.source.kind !== "slot_value" || part.source.slotName !== "parcelaDesejada") throw new Error(`money_ref: role 'installment' exige source slot_value/parcelaDesejada, recebeu '${part.source.kind}/${(part.source as any).slotName ?? "N/A"}'`);
    const slot = state.slots.parcelaDesejada;
    if (!slot || slot.value == null) throw new Error(`money_ref: valor do slot 'parcelaDesejada' não preenchido no estado`);
    value = slot.value;
  } else if (part.role === "budget") {
    if (part.source.kind !== "slot_value" || part.source.slotName !== "faixaPreco") throw new Error(`money_ref: role 'budget' exige source slot_value/faixaPreco, recebeu '${part.source.kind}/${(part.source as any).slotName ?? "N/A"}'`);
    const slot = state.slots.faixaPreco;
    if (!slot || slot.value == null) throw new Error(`money_ref: valor do slot 'faixaPreco' não preenchido no estado`);
    const valObj = slot.value;
    value = valObj.max ?? valObj.min ?? 0;
    if (value === 0) throw new Error(`money_ref: valor numérico não extraído do slot 'faixaPreco'`);
  } else {
    throw new Error(`money_ref: role desconhecido ou incompatível`);
  }
  return formatBRL(value);
}

// Insere espaço entre dois tokens "palavra/numero/pontuacao" para nunca colar
// (ex.: "voce:ONIX" -> "voce: ONIX"; "ONIX2014" -> "ONIX 2014"). Respeita whitespace
// e pontuacao de fechamento/abertura ja presentes. PURO, sem if por conteudo.
function needsSpace(left: string, right: string): boolean {
  const l = left[left.length - 1];
  const r = right[0];
  if (/\s/.test(l) || /\s/.test(r)) return false;
  if (/[,.;:!?)%\]]/u.test(r)) return false; // pontuacao que cola no token anterior
  if (/[(\[]/u.test(l)) return false;          // abre-grupo cola no proximo
  const leftBoundary = /[\p{L}\p{N}:;,.!?]/u.test(l);
  const rightBoundary = /[\p{L}\p{N}$]/u.test(r);
  return leftBoundary && rightBoundary;
}

function joinSegments(segments: Segment[]): string {
  let out = "";
  let prevKind: Segment["kind"] | null = null;
  for (const seg of segments) {
    if (seg.text === "") continue;
    if (out === "") { out = seg.text; prevKind = seg.kind; continue; }
    if (seg.kind === "block" || prevKind === "block") {
      // bloco (lista de ofertas) sempre separado por linha em branco
      out = out.replace(/\s+$/u, "") + "\n\n" + seg.text.replace(/^\s+/u, "");
    } else {
      out += (needsSpace(out, seg.text) ? " " : "") + seg.text;
    }
    prevKind = seg.kind;
  }
  return out;
}

export const ResponseRenderer = {
  render(draft: ResponseDraft, facts: QueryResult[], state: ConversationState): string {
    const vehicles = indexVehicles(facts);
    const segments: Segment[] = [];

    for (const part of draft.parts) {
      if (part.type === "text") {
        segments.push({ kind: "text", text: part.content });
      } else if (part.type === "vehicle_ref") {
        segments.push({ kind: "inline", text: renderVehicleRef(part, vehicles) });
      } else if (part.type === "money_ref") {
        segments.push({ kind: "inline", text: renderMoneyRef(part, vehicles, state) });
      } else if (part.type === "vehicle_offer_list") {
        // Grounding: cada chave precisa existir nos QueryResults (falha fechada).
        const list = part.vehicleKeys.map((k) => {
          const v = vehicles.get(k);
          if (!v) throw new Error(`vehicle_offer_list: veículo '${k}' não encontrado nos fatos do turno`);
          return v;
        });
        segments.push({ kind: "block", text: renderVehicleOfferList(list) });
      } else {
        throw new Error("ResponseDraft: tipo de parte desconhecido");
      }
    }

    return joinSegments(segments);
  },
};
