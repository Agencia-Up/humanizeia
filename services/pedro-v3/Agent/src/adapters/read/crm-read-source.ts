import type { CrmLeadSummary, CrmReadSource, TenantAgentRef } from "../../domain/read-ports.ts";
import type { OwnedCrmLeadRow, V2ReadGateway } from "./v2-read-gateway.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function assertSafeLeadRow(ref: TenantAgentRef, leadId: string, row: OwnedCrmLeadRow): void {
  if (row.id !== leadId || row.tenantId !== ref.tenantId || row.agentId !== ref.agentId) {
    throw new Error("CRM_OWNERSHIP_MISMATCH");
  }
}

export class V2CrmReadSource implements CrmReadSource {
  constructor(private readonly gateway: V2ReadGateway) {}

  async readLead(ref: TenantAgentRef, leadId: string): Promise<CrmLeadSummary | null> {
    if (!UUID_RE.test(leadId)) {
      throw new Error("CRM_LEAD_ID_INVALID");
    }

    const row = await this.gateway.getOwnedCrmLead(ref, leadId);
    if (!row) return null;
    assertSafeLeadRow(ref, leadId, row);

    const name = cleanText(row.leadName) ?? cleanText(row.clientName);
    return Object.freeze({
      leadId: row.id,
      name,
      vehicleInterest: cleanText(row.vehicleInterest),
      stage: cleanText(row.stage),
      createdAt: cleanText(row.createdAt),
      updatedAt: cleanText(row.updatedAt),
    });
  }
}
