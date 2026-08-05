import { describe, expect, it } from "vitest";

import { evaluateOrphanRescue } from "../../supabase/functions/_shared/transfer/orphanRescueGuard";

describe("orphan rescue guard", () => {
  const orphan = { id: "lead-1", status: "transferido", assigned_to_id: null };

  it("accepts only a transferred lead without owner or active transfer", () => {
    expect(evaluateOrphanRescue(orphan, [
      { id: "expired", transfer_status: "expired", is_confirmed: false },
    ])).toEqual({ eligible: true, reason: "orphan" });
  });

  it("blocks a lead already assigned while a stale batch is running", () => {
    expect(evaluateOrphanRescue({ ...orphan, assigned_to_id: "ronye" }, [])).toEqual({
      eligible: false,
      reason: "lead_already_assigned",
    });
  });

  it("blocks any confirmed handoff even if the CRM projection is temporarily orphaned", () => {
    expect(evaluateOrphanRescue(orphan, [
      { id: "ronye-confirmed", transfer_status: "confirmed", is_confirmed: true },
    ])).toEqual({ eligible: false, reason: "confirmed_transfer" });
  });

  it("blocks a pending handoff owned by the timeout worker", () => {
    expect(evaluateOrphanRescue(orphan, [
      { id: "pending", transfer_status: "pending", is_confirmed: false },
    ])).toEqual({ eligible: false, reason: "pending_transfer" });
  });

  it("blocks stale snapshots whose status is no longer transferred", () => {
    expect(evaluateOrphanRescue({ ...orphan, status: "em_atendimento" }, [])).toEqual({
      eligible: false,
      reason: "lead_not_transferido",
    });
  });
});
