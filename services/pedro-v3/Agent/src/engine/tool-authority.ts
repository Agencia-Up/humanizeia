import type { PrimaryIntent, TurnCapability } from "../domain/agent-brain.ts";
import type { QueryName } from "../domain/decision.ts";

export type AuditedToolName = QueryName | "tenant_business_info";

export type ToolAuthorityPrincipal = "llm" | "engine_safety" | "engine_factual";

export type ToolAuthoritySource =
  | "llm_tool_call"
  | "llm_intent_completion"
  | "engine_grounding"
  | "engine_institutional_lookup";

export type ToolExecutionAuthority = {
  readonly principal: ToolAuthorityPrincipal;
  readonly source: ToolAuthoritySource;
  readonly primaryIntent: PrimaryIntent | null;
  readonly capability: TurnCapability | null;
  readonly currentTurnEvidence: boolean;
  readonly callSite: string;
};

export type ToolAuthorityRecord = ToolExecutionAuthority & {
  readonly tool: AuditedToolName;
  readonly ok: boolean;
  readonly ms: number;
};

const COMMERCIAL_TOOLS = new Set<AuditedToolName>([
  "stock_search",
  "vehicle_details",
  "vehicle_photos_resolve",
]);

export function isCommercialTool(tool: AuditedToolName): boolean {
  return COMMERCIAL_TOOLS.has(tool);
}

export function capabilityForTool(tool: AuditedToolName): TurnCapability | null {
  if (tool === "stock_search") return "stock_search";
  if (tool === "vehicle_details") return "vehicle_details";
  if (tool === "vehicle_photos_resolve") return "send_photos";
  if (tool === "tenant_business_info") return "institutional_info";
  return null;
}

/**
 * A commercial tool may only be authorized by the accepted understanding from
 * the current lead block. The sole engine exception is read-only detail
 * grounding for a vehicle action the LLM already chose. Institutional lookup
 * is a local factual read and cannot authorize a commercial action.
 */
export function assertToolExecutionAuthority(
  tool: AuditedToolName,
  authority: ToolExecutionAuthority,
): void {
  if (!isCommercialTool(tool)) {
    if (tool === "tenant_business_info" && authority.source !== "engine_institutional_lookup" && authority.principal !== "llm") {
      throw new Error("TOOL_AUTHORITY_INVALID:tenant_business_info");
    }
    return;
  }

  if (authority.principal === "llm") {
    if (!authority.currentTurnEvidence) throw new Error(`TOOL_AUTHORITY_STALE:${tool}`);
    if (authority.source !== "llm_tool_call" && authority.source !== "llm_intent_completion") {
      throw new Error(`TOOL_AUTHORITY_SOURCE:${tool}`);
    }
    if (authority.capability !== capabilityForTool(tool)) {
      throw new Error(`TOOL_AUTHORITY_CAPABILITY:${tool}`);
    }
    return;
  }

  if (
    tool === "vehicle_details"
    && authority.principal === "engine_safety"
    && authority.source === "engine_grounding"
    && authority.capability === null
  ) return;

  throw new Error(`TOOL_AUTHORITY_ENGINE_COMMERCIAL:${tool}`);
}

export function toToolAuthorityRecord(args: {
  readonly tool: AuditedToolName;
  readonly authority: ToolExecutionAuthority;
  readonly ok: boolean;
  readonly ms: number;
}): ToolAuthorityRecord {
  assertToolExecutionAuthority(args.tool, args.authority);
  return { tool: args.tool, ok: args.ok, ms: args.ms, ...args.authority };
}
