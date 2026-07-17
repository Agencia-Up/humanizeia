import { pickNextTimeoutSeller } from "../../../../supabase/functions/_shared/transfer/timeoutRouting.ts";

let failures = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`OK ${label}`);
  else { failures++; console.error(`FAIL ${label}`); }
}

const first = { id: "seller-1", whatsapp_number: "5511999991111", is_active: true };
const second = { id: "seller-2", whatsapp_number: "5511999992222", is_active: true };
const tenantSeller = { id: "seller-3", whatsapp_number: "5511999993333", is_active: true };

check(
  "timeout resolves a tenant roster seller",
  pickNextTimeoutSeller([tenantSeller], [], "seller-1", "")?.id === "seller-3",
);
check(
  "timeout excludes the expired seller",
  pickNextTimeoutSeller([first, second], [], "seller-1", "11999991111")?.id === "seller-2",
);
check(
  "timeout prioritizes a seller that never received a transfer",
  pickNextTimeoutSeller([first, second], [{ to_member_id: "seller-1", created_at: "2026-07-17T10:00:00.000Z" }], null, null)?.id === "seller-2",
);
check(
  "timeout returns no recipient when the queue has no alternative",
  pickNextTimeoutSeller([first], [], "seller-1", "11999991111") === null,
);

if (failures > 0) process.exit(1);
console.log("PASS transfer-infrastructure");
