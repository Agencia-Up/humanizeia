// ============================================================================
// vehicle-label.ts — identidade humana canônica de veículo.
//
// O módulo só transforma fatos/identidades já conhecidos em "Marca Modelo Ano".
// Nunca expõe vehicleKey e nunca inventa atributos comerciais.
// ============================================================================
import type { ConversationState } from "../domain/conversation-state.ts";
import type { QueryResult } from "../domain/decision.ts";
import type { ProposedEffectPlan } from "../domain/decision.ts";
import type { RememberedVehicleIdentity } from "../domain/types.ts";
import { loadPersistedWorkingMemory } from "./working-memory.ts";
import { withTimeout, type QueryRunner } from "./decision-engine.ts";

export function parseLabel(label: string | null | undefined): { marca: string | null; modelo: string | null; ano: number | null } {
  if (!label) return { marca: null, modelo: null, ano: null };
  const tokens = label.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { marca: null, modelo: null, ano: null };
  const yearTok = tokens[tokens.length - 1];
  const hasYear = /^(19|20)\d{2}$/.test(yearTok);
  const marca = tokens[0];
  const modelo = (hasYear ? tokens.slice(1, -1) : tokens.slice(1)).join(" ");
  if (!marca || !modelo) return { marca: null, modelo: null, ano: null };
  return { marca, modelo, ano: hasYear ? Number(yearTok) : null };
}

export function canonicalVehicleLabel(
  vehicleKey: string,
  facts: readonly QueryResult[],
  identities: readonly RememberedVehicleIdentity[],
  state: ConversationState,
): string | null {
  for (const f of facts) {
    if (!f.ok) continue;
    if (f.tool === "stock_search") {
      const v = f.data.items.find((x) => x.vehicleKey === vehicleKey);
      if (v) {
        const label = [v.marca, v.modelo, v.ano].filter(Boolean).join(" ").trim();
        if (label) return label;
      }
    }
    if (f.tool === "vehicle_details" && f.data.vehicle.vehicleKey === vehicleKey) {
      const v = f.data.vehicle;
      const label = [v.marca, v.modelo, v.ano].filter(Boolean).join(" ").trim();
      if (label) return label;
    }
  }
  const id = identities.find((i) => i.vehicleKey === vehicleKey);
  if (id) {
    const label = [id.marca, id.modelo, id.ano].filter(Boolean).join(" ").trim();
    if (label && label !== vehicleKey) return label;
  }
  const item = state.lastRenderedOfferContext?.items.find((i) => i.vehicleKey === vehicleKey);
  if (item) {
    const label = [item.marca, item.modelo, item.ano].filter(Boolean).join(" ").trim();
    if (label) return label;
  }
  const selected = state.vehicleContext.selected;
  if (selected?.key === vehicleKey && selected.label && selected.label !== vehicleKey) return selected.label;
  return null;
}

export function buildRememberedIdentities(state: ConversationState): RememberedVehicleIdentity[] {
  const out: RememberedVehicleIdentity[] = [];
  const seen = new Set<string>();
  const push = (key: string | null | undefined, marca: string | null | undefined, modelo: string | null | undefined, ano: number | null | undefined): void => {
    if (!key || !marca || !modelo || seen.has(key)) return;
    seen.add(key);
    out.push({ vehicleKey: key, marca, modelo, ano: typeof ano === "number" && ano > 0 ? ano : null });
  };
  for (const it of state.lastRenderedOfferContext?.items ?? []) push(it.vehicleKey, it.marca, it.modelo, it.ano ?? null);
  const selected = state.vehicleContext?.selected;
  if (selected?.key) { const parsed = parseLabel(selected.label); push(selected.key, parsed.marca, parsed.modelo, parsed.ano); }
  const lastPhoto = loadPersistedWorkingMemory(state.workingMemory).memory.lastPhotoAction;
  if (lastPhoto?.vehicleKey) { const parsed = parseLabel(lastPhoto.label); push(lastPhoto.vehicleKey, parsed.marca, parsed.modelo, parsed.ano); }
  return out;
}

export async function groundNamedVehicles(args: {
  readonly proposedEffects: readonly ProposedEffectPlan[];
  readonly state: ConversationState;
  readonly facts: readonly QueryResult[];
  readonly identities: readonly RememberedVehicleIdentity[];
  readonly runQuery: QueryRunner;
  readonly timeoutMs: number;
  readonly beforeExecute?: (vehicleKey: string) => void;
  readonly onExecuted?: (result: QueryResult, ms: number) => void;
}): Promise<QueryResult[]> {
  const keys = new Set<string>();
  for (const effect of args.proposedEffects) if (effect.kind === "send_media" && typeof effect.vehicleKey === "string" && effect.vehicleKey) keys.add(effect.vehicleKey);
  if (args.state.vehicleContext.selected?.key) keys.add(args.state.vehicleContext.selected.key);
  if (keys.size === 0) return [];
  const known = new Set<string>();
  for (const fact of args.facts) {
    if (!fact.ok) continue;
    if (fact.tool === "stock_search") for (const vehicle of fact.data.items) known.add(vehicle.vehicleKey);
    if (fact.tool === "vehicle_details") known.add(fact.data.vehicle.vehicleKey);
  }
  for (const identity of args.identities) known.add(identity.vehicleKey);
  const toFetch = [...keys].filter((key) => !known.has(key)).slice(0, 3);
  const out: QueryResult[] = [];
  for (const vehicleKey of toFetch) {
    try {
      args.beforeExecute?.(vehicleKey);
      const started = Date.now();
      const result = await withTimeout(args.runQuery({ tool: "vehicle_details", input: { vehicleKey } }), args.timeoutMs, "query: ground vehicle_details");
      args.onExecuted?.(result, Math.max(0, Date.now() - started));
      if (result.ok) out.push(result);
    } catch { /* best-effort: ausência de grounding deixa o compose falhar fechado */ }
  }
  return out;
}
