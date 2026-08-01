import { pickNextTimeoutSeller } from "../../../../supabase/functions/_shared/transfer/timeoutRouting.ts";
import {
  effectiveTransferDeadline,
  isWithinTransferWindow,
  nextTransferWindowStart,
  rearmTransferAtNextWindow,
  resolveAutomationRules,
} from "../../../../supabase/functions/_shared/automation/rules.ts";
import {
  buildConversationBriefing,
  buildTransferAuditNotes,
} from "../../../../supabase/functions/_shared/transfer/buildBriefing.ts";

let failures = 0;
function check(label: string, ok: boolean) {
  if (ok) console.log(`OK ${label}`);
  else { failures++; console.error(`FAIL ${label}`); }
}

const first = { id: "seller-1", whatsapp_number: "5511999991111", is_active: true, last_lead_received_at: "2026-07-20T13:00:00.000Z" };
const second = { id: "seller-2", whatsapp_number: "5511999992222", is_active: true, last_lead_received_at: "2026-07-20T14:00:00.000Z" };
const tenantSeller = { id: "seller-3", whatsapp_number: "5511999993333", is_active: true, last_lead_received_at: "2026-07-20T15:00:00.000Z" };
const neverSeller = { id: "seller-never", whatsapp_number: "5511999994444", is_active: true, last_lead_received_at: null };

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
  pickNextTimeoutSeller([first, neverSeller], [{ to_member_id: "seller-1", created_at: "2026-07-17T10:00:00.000Z" }], null, null)?.id === "seller-never",
);
check(
  "timeout returns no recipient when the queue has no alternative",
  pickNextTimeoutSeller([first], [], "seller-1", "11999991111") === null,
);

const sunday = new Date("2026-07-19T15:00:00.000Z"); // 12:00 BRT, domingo
const monday = new Date("2026-07-20T15:00:00.000Z"); // 12:00 BRT, segunda
const configured = resolveAutomationRules({
  transfer: { enabled: true, seller_response_min: 15, window: { enabled: true, start: "09:11", end: "18:29" } },
});
check("domingo nunca repassa mesmo com janela personalizada", !isWithinTransferWindow(configured.transfer.window, sunday));
check("janela personalizada vale em dia comercial", isWithinTransferWindow(configured.transfer.window, monday));
const nextMonday = nextTransferWindowStart(configured.transfer.window, sunday);
check("domingo reabre na segunda no inicio configurado", nextMonday.toISOString() === "2026-07-20T12:11:00.000Z");
check("timeout rearmado começa depois da abertura", rearmTransferAtNextWindow(configured.transfer.window, sunday, 15).toISOString() === "2026-07-20T12:26:00.000Z");

check(
  "prazo persistido vence sobre created_at antigo",
  effectiveTransferDeadline({
    created_at: "2026-07-18T22:00:00.000Z",
    confirmation_timeout_at: "2026-07-20T12:26:00.000Z",
  }, 15).toISOString() === "2026-07-20T12:26:00.000Z",
);
check(
  "registro legado usa created_at mais seller_response_min",
  effectiveTransferDeadline({ created_at: "2026-07-20T12:00:00.000Z" }, 15).toISOString() === "2026-07-20T12:15:00.000Z",
);

const sameLeadHistory = [
  { to_member_id: "seller-3", created_at: "2026-07-20T15:00:00.000Z" },
  { to_member_id: "seller-2", created_at: "2026-07-20T14:00:00.000Z" },
  { to_member_id: "seller-1", created_at: "2026-07-20T13:00:00.000Z" },
];
check("fila volta ao primeiro vendedor depois do ultimo", pickNextTimeoutSeller([first, second, tenantSeller], sameLeadHistory, "seller-3", "11999993333")?.id === "seller-1");
check("fila segue para o segundo no ciclo seguinte", pickNextTimeoutSeller([first, second, tenantSeller], [
  { to_member_id: "seller-1", created_at: "2026-07-20T16:00:00.000Z" },
  ...sameLeadHistory,
], "seller-1", "11999991111")?.id === "seller-2");

function briefingDb(input: {
  readonly v3Rows?: any[];
  readonly v3Error?: any;
  readonly legacyRows?: any[];
}) {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const query: any = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        async limit() {
          if (table === "v3_conversation_state") {
            return { data: input.v3Rows ?? [], error: input.v3Error ?? null };
          }
          if (table === "wa_chat_history") {
            return { data: input.legacyRows ?? [], error: null };
          }
          return { data: [], error: null };
        },
      };
      return query;
    },
  };
}

const canonicalDb = briefingDb({
  v3Rows: [{
    state: {
      recentTurns: [
        { role: "lead", text: "Quero saber o valor do Compass" },
        { role: "agent", text: "Ele custa R$ 121.400." },
        { role: "lead", text: "Pode me passar para um vendedor?" },
      ],
    },
  }],
  legacyRows: [{ role: "user", content: "historico antigo" }],
});
const canonicalBriefing = await buildConversationBriefing(canonicalDb, {
  id: "lead-v3",
  agent_id: "agent-1",
  remote_jid: "5511999999999@s.whatsapp.net",
});
check("briefing manual usa a conversa canonica do Pedro v3",
  canonicalBriefing.includes("Quero saber o valor do Compass")
    && canonicalBriefing.includes("Pode me passar para um vendedor?"));
check("briefing v3 nao mistura historico legado quando o canonico existe",
  !canonicalDb.calls.includes("wa_chat_history") && !canonicalBriefing.includes("historico antigo"));

const legacyDb = briefingDb({
  v3Rows: [{ state: { recentTurns: [] } }],
  legacyRows: [
    { role: "assistant", content: "Qual veiculo voce procura?" },
    { role: "user", content: "Uma SUV automatica" },
  ],
});
const legacyBriefing = await buildConversationBriefing(legacyDb, {
  id: "lead-legado",
  agent_id: "agent-1",
  remote_jid: "5511888888888@s.whatsapp.net",
});
check("briefing mantem fallback para historico legado",
  legacyDb.calls.includes("wa_chat_history") && legacyBriefing.includes("Uma SUV automatica"));

const auditNotes = buildTransferAuditNotes("Briefing completo do Pedro v3", "Cliente pediu retorno hoje");
check("observacao manual e anexada sem substituir o briefing",
  auditNotes.includes("Briefing completo do Pedro v3")
    && auditNotes.includes("Cliente pediu retorno hoje")
    && auditNotes.indexOf("Briefing completo") < auditNotes.indexOf("Observacao manual"));

if (failures > 0) process.exit(1);
console.log("PASS transfer-infrastructure");
