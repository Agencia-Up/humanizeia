// Perfil operacional do agente. O perfil define capacidades dispon?veis;
// personalidade, funil e condu??o continuam vindo do prompt do portal.

export const AGENT_PROFILE_TYPES = ["generic", "sdr", "sdr_geral"] as const;
export type AgentProfileType = (typeof AGENT_PROFILE_TYPES)[number];

export function normalizeAgentProfileType(value: unknown): AgentProfileType {
  return value === "sdr_geral" ? "sdr_geral"
    : value === "sdr" ? "sdr"
      : "generic";
}

/** SDR Geral ? um agente sem dom?nio automotivo e sem acesso ao estoque. */
export function isGeneralSdrProfile(value: unknown): boolean {
  return normalizeAgentProfileType(value) === "sdr_geral";
}

export const AUTOMOTIVE_AGENT_TOOLS = [
  "stock_search", "vehicle_details", "vehicle_photos_resolve", "tenant_business_info", "knowledge_search",
] as const;

export const GENERAL_SDR_TOOLS = ["tenant_business_info", "knowledge_search"] as const;

export function allowedToolsForAgentProfile(value: unknown): readonly string[] {
  return isGeneralSdrProfile(value) ? GENERAL_SDR_TOOLS : AUTOMOTIVE_AGENT_TOOLS;
}
