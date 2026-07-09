// ============================================================================
// vehicle-offer-render.ts — F2.7.5. Renderizacao DETERMINISTICA de veiculos para
// WhatsApp (lista numerada, preco BRL, km BR, campos ausentes omitidos sem buraco).
// PURO: recebe VehicleFact[] (ja aterrados nos QueryResults) e devolve texto.
// O LLM escolhe QUAIS veiculos (vehicleKeys); a FORMATACAO final nao depende dele.
// Sem if por marca/modelo. Brain/02 — apresentacao comercial legivel.
// ============================================================================
import type { VehicleFact } from "../domain/types.ts";

export type VehicleOfferListOptions = { maxItems?: number };

export const DEFAULT_VEHICLE_OFFER_LIST_MAX_ITEMS = 5;

export function formatBRL(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatKm(value: number): string {
  const n = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return n.toLocaleString("pt-BR");
}

function vehicleName(v: VehicleFact): string {
  return [v.marca, v.modelo, v.ano && v.ano > 0 ? String(v.ano) : null]
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .join(" ");
}

function vehiclePrice(v: VehicleFact): string {
  // Preco ausente/0 NUNCA vira "R$ 0": grounding honesto.
  return v.preco && v.preco > 0 ? formatBRL(v.preco) : "preco a confirmar";
}

function vehicleDetails(v: VehicleFact): string | null {
  const parts = [
    v.km != null && Number.isFinite(v.km) && v.km > 0 ? `${formatKm(v.km)} km` : null,
    v.cambio && String(v.cambio).trim() !== "" ? String(v.cambio).trim() : null,
    v.cor && String(v.cor).trim() !== "" ? String(v.cor).trim() : null,
  ].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join(" | ") : null;
}

// Renderiza a lista numerada. 1 veiculo tambem vira "1. ...". Limite default 5.
export function renderVehicleOfferList(vehicles: readonly VehicleFact[], options: VehicleOfferListOptions = {}): string {
  const max = options.maxItems ?? DEFAULT_VEHICLE_OFFER_LIST_MAX_ITEMS;
  const items = vehicles.slice(0, Math.max(1, max));
  const blocks = items.map((v, i) => {
    const title = `${i + 1}. ${vehicleName(v)} - ${vehiclePrice(v)}`;
    const details = vehicleDetails(v);
    return details ? `${title}\n   ${details}` : title;
  });
  return blocks.join("\n\n");
}
