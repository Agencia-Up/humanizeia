import type { QueryCall, QueryResult, ToolError } from "../domain/decision.ts";
import { normalizeStockSearchInput } from "../domain/decision.ts";
import type {
  CrmReadSource,
  StockSource,
  TenantAgentRef,
  VehicleDetailSource,
  VehiclePhotoSource,
} from "../domain/read-ports.ts";
import type { KnowledgeSource } from "../domain/knowledge.ts";
import type { QueryRunner } from "./decision-engine.ts";

export type ReadQueryRunnerSources = {
  readonly stock: StockSource;
  readonly vehicleDetails: VehicleDetailSource;
  readonly vehiclePhotos: VehiclePhotoSource;
  readonly crm: CrmReadSource;
  readonly knowledge?: KnowledgeSource;
  /** Capability boundary shared by the LLM schema and runtime executor. */
  readonly allowedTools?: readonly string[];
};

function validation(message: string): ToolError {
  return { code: "VALIDATION", message, retryable: false };
}

function notFound(message: string): ToolError {
  return { code: "NOT_FOUND", message, retryable: false };
}

function upstream(): ToolError {
  return { code: "UPSTREAM", message: "read tool unavailable", retryable: true };
}

function classifyError(error: unknown): ToolError {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("INVALID") || message.includes("VALIDATION") || message.includes("MISMATCH")) {
    return validation("read tool rejected invalid input");
  }
  return upstream();
}

function isVehicleRef(input: { vehicleRef: unknown }): input is { vehicleRef: { kind: "vehicle"; key: string } } {
  if (typeof input.vehicleRef !== "object" || input.vehicleRef === null) return false;
  const ref = input.vehicleRef as { kind?: unknown; key?: unknown };
  return ref.kind === "vehicle" && typeof ref.key === "string" && ref.key.trim() !== "";
}

function toJsonRecord(value: Record<string, unknown>): Record<string, string | number | boolean | null | string[]> {
  const out: Record<string, string | number | boolean | null | string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null) {
      out[key] = raw;
    } else if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
      out[key] = raw;
    }
  }
  return out;
}

export function createReadQueryRunner(ref: TenantAgentRef, sources: ReadQueryRunnerSources): QueryRunner {
  const allowedTools = sources.allowedTools ? new Set(sources.allowedTools) : null;
  return async (call: QueryCall): Promise<QueryResult> => {
    if (allowedTools && !allowedTools.has(call.tool)) {
      return { ok: false, tool: call.tool, error: { code: "FORBIDDEN", message: "tool not enabled for this agent profile", retryable: false } } as QueryResult;
    }
    try {
      switch (call.tool) {
        case "stock_search": {
          const norm = normalizeStockSearchInput(call.input);
          if (!norm.ok) return { ok: false, tool: "stock_search", error: validation(norm.conflict) };
          const result = await sources.stock.search(ref, norm.input);
          return {
            ok: true,
            tool: "stock_search",
            source: "read-side:stock",
            data: {
              items: [...result.items],
              filtersUsed: toJsonRecord(result.filtersUsed as Record<string, unknown>),
            },
          };
        }
        case "vehicle_details": {
          if (!call.input.vehicleKey.trim()) {
            return { ok: false, tool: "vehicle_details", error: validation("vehicleKey obrigatorio") };
          }
          const vehicle = await sources.vehicleDetails.getDetails(ref, call.input.vehicleKey);
          if (!vehicle) {
            return { ok: false, tool: "vehicle_details", error: notFound("veiculo nao encontrado") };
          }
          return { ok: true, tool: "vehicle_details", source: "read-side:vehicle-details", data: { vehicle } };
        }
        case "vehicle_photos_resolve": {
          if (!isVehicleRef(call.input)) {
            return { ok: false, tool: "vehicle_photos_resolve", error: validation("vehicleRef invalido") };
          }
          const resolved = await sources.vehiclePhotos.resolvePhotos(ref, call.input.vehicleRef.key);
          return {
            ok: true,
            tool: "vehicle_photos_resolve",
            source: "read-side:vehicle-photos",
            data: {
              vehicleKey: resolved.vehicleKey,
              ambiguous: resolved.ambiguous,
              photoIds: [...resolved.photoIds],
              // Keep the URLs from the same stock snapshot. The dispatcher must not
              // re-read a live feed after this tool has resolved the photos.
              ...(resolved.media ? { media: resolved.media.map((photo) => ({ id: photo.id, url: photo.url })) } : {}),
            },
          };
        }
        case "crm_read": {
          if (!call.input.leadId.trim()) {
            return { ok: false, tool: "crm_read", error: validation("leadId obrigatorio") };
          }
          const lead = await sources.crm.readLead(ref, call.input.leadId);
          if (!lead) {
            return { ok: false, tool: "crm_read", error: notFound("lead nao encontrado") };
          }
          return {
            ok: true,
            tool: "crm_read",
            source: "read-side:crm",
            data: { leadId: lead.leadId, name: lead.name },
          };
        }
        case "knowledge_search": {
          const query = call.input.query.trim().slice(0, 1200);
          if (!query) return { ok: false, tool: "knowledge_search", error: validation("query obrigatoria") };
          const limit = Math.max(1, Math.min(call.input.topK ?? 5, 8));
          if (!sources.knowledge) return { ok: true, tool: "knowledge_search", source: "read-side:knowledge-empty", data: { chunks: [], confidence: 0 } };
          const result = await sources.knowledge.search(ref, query, limit);
          return { ok: true, tool: "knowledge_search", source: "read-side:knowledge", data: { chunks: [...result.chunks], confidence: result.confidence } };
        }
      }
    } catch (error) {
      return { ok: false, tool: call.tool, error: classifyError(error) } as QueryResult;
    }
  };
}
