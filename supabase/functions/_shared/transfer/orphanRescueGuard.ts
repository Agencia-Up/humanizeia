export type OrphanLeadSnapshot = {
  id?: string | null;
  status?: string | null;
  assigned_to_id?: string | null;
};

export type OrphanTransferSnapshot = {
  id?: string | null;
  transfer_status?: string | null;
  is_confirmed?: boolean | null;
};

export type OrphanRescueEligibility =
  | { eligible: true; reason: "orphan" }
  | {
      eligible: false;
      reason: "lead_missing" | "lead_not_transferido" | "lead_already_assigned" | "pending_transfer" | "confirmed_transfer";
    };

/**
 * A rescue candidate must be an actual orphan at the instant it is processed.
 *
 * A confirmed transfer is authoritative even when a stale writer temporarily
 * left the CRM row as transferido/without assigned_to_id. Automatically
 * reassigning that lead would steal an attendance already accepted by a human.
 */
export function evaluateOrphanRescue(
  lead: OrphanLeadSnapshot | null | undefined,
  transfers: OrphanTransferSnapshot[] | null | undefined,
): OrphanRescueEligibility {
  if (!lead?.id) return { eligible: false, reason: "lead_missing" };
  if (lead.status !== "transferido") return { eligible: false, reason: "lead_not_transferido" };
  if (lead.assigned_to_id) return { eligible: false, reason: "lead_already_assigned" };

  const rows = Array.isArray(transfers) ? transfers : [];
  if (rows.some((row) => row?.is_confirmed === true || row?.transfer_status === "confirmed")) {
    return { eligible: false, reason: "confirmed_transfer" };
  }
  if (rows.some((row) => row?.is_confirmed !== true && row?.transfer_status === "pending")) {
    return { eligible: false, reason: "pending_transfer" };
  }

  return { eligible: true, reason: "orphan" };
}
