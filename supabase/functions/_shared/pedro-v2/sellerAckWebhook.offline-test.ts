// Testes offline do hotfix "confirmacao do vendedor no webhook" (incidente 24/07,
// conta WA / Wa Duda). Roda com Deno, sem rede: usa um mock em memoria do supabase
// que reproduz as chains reais de confirmSellerAck. resolveTransferFailures cai em
// no-op (sem SUPABASE_URL/SERVICE_ROLE_KEY nada de fetch — callRpc retorna false).
//
//   deno run --allow-env supabase/functions/_shared/pedro-v2/sellerAckWebhook.offline-test.ts
//
// Cobre os casos 1-9 pedidos pelo dono. O caso 10 (concorrencia timeout x
// confirmacao) pertence a Unidade 2 (transfer-timeout-checker) e sera testado la.

import { handleSellerInbound } from "./transferRouter.ts";
import { isSellerAckText, phonesMatch, resolveUazapiPhone, resolveUazapiText } from "./phone.ts";

let ok = 0;
let failed = 0;
function check(name: string, pass: boolean): void {
  if (pass) { ok += 1; console.log(`  OK  ${name}`); }
  else { failed += 1; console.error(`  RED ${name}`); }
}

// ── Mock supabase em memoria (fiel as chains de confirmSellerAck) ─────────────
type Row = Record<string, any>;
type DB = { ai_team_members: Row[]; ai_lead_transfers: Row[]; ai_crm_leads: Row[] };

function makeSupabase(db: DB) {
  const applyFilters = (rows: Row[], filters: any[]) => {
    let out = rows;
    for (const f of filters) {
      if (f.type === "eq") out = out.filter((r) => r[f.k] === f.v);
      else if (f.type === "in") out = out.filter((r) => f.v.includes(r[f.k]));
      else if (f.type === "neq") out = out.filter((r) => r[f.k] !== f.v);
      else if (f.type === "not_is_null") out = out.filter((r) => r[f.k] != null);
    }
    return out;
  };
  class Q {
    table: string;
    filters: any[] = [];
    op: "select" | "update" | "insert" = "select";
    data: Row | null = null;
    orderBy: { k: string; asc: boolean } | null = null;
    lim: number | null = null;
    constructor(table: string) { this.table = table; }
    select(_c?: string) { return this; }
    update(d: Row) { this.op = "update"; this.data = d; return this; }
    insert(d: Row) { this.op = "insert"; this.data = d; return this; }
    eq(k: string, v: any) { this.filters.push({ type: "eq", k, v }); return this; }
    in(k: string, v: any[]) { this.filters.push({ type: "in", k, v }); return this; }
    neq(k: string, v: any) { this.filters.push({ type: "neq", k, v }); return this; }
    not(k: string, _op: string, _v: any) { this.filters.push({ type: "not_is_null", k }); return this; }
    order(k: string, o?: { ascending?: boolean }) { this.orderBy = { k, asc: o?.ascending !== false }; return this; }
    limit(n: number) { this.lim = n; return this; }
    _run(single: boolean) {
      const base = (db as any)[this.table] as Row[] || [];
      let rows = applyFilters(base, this.filters); // referencias reais (permite mutar no update)
      if (this.orderBy) {
        const { k, asc } = this.orderBy;
        rows = [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.op === "update") {
        for (const r of rows) Object.assign(r, this.data);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      }
      if (this.op === "insert") {
        base.push(this.data as Row);
        return { data: this.data, error: null };
      }
      if (this.lim != null) rows = rows.slice(0, this.lim);
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    }
    maybeSingle() { return Promise.resolve(this._run(true)); }
    then(onF: any, onR?: any) { return Promise.resolve(this._run(false)).then(onF, onR); }
  }
  return { from: (t: string) => new Q(t) };
}

const nowIso = () => new Date().toISOString();
function seedSeller(over: Partial<Row> = {}): Row {
  return { id: crypto.randomUUID(), name: "Vend", whatsapp_number: "5512997710749", agent_id: null, auth_user_id: crypto.randomUUID(), user_id: "TENANT_A", is_active: true, last_lead_received_at: null, ...over };
}
function seedTransfer(sellerId: string, over: Partial<Row> = {}): Row {
  return { id: crypto.randomUUID(), lead_id: crypto.randomUUID(), to_member_id: sellerId, transfer_status: "pending", is_confirmed: false, confirmed_at: null, created_at: nowIso(), user_id: "TENANT_A", ...over };
}
function seedLead(id: string, over: Partial<Row> = {}): Row {
  return { id, user_id: "TENANT_A", assigned_to_id: null, origem: null, status: null, last_interaction_at: null, ...over };
}

console.log("Hotfix: confirmacao do vendedor no webhook (Unidade 1)");

// ── 10) A REGRA (isSellerAckText) — nao confirma com qualquer mensagem ────────
check("regra: 'Ok' e confirmacao", isSellerAckText("Ok"));
check("regra: 'ok!' e confirmacao", isSellerAckText("ok!"));
check("regra: emoji 👍 e confirmacao", isSellerAckText("👍"));
check("regra: 'assumir' e confirmacao", isSellerAckText("vou assumir"));
check("regra: 'beleza' e confirmacao", isSellerAckText("beleza"));
check("regra: 'quanto custa?' NAO e confirmacao", !isSellerAckText("quanto custa?"));
check("regra: 'bom dia' NAO e confirmacao", !isSellerAckText("bom dia"));
check("regra: vazio NAO e confirmacao", !isSellerAckText(""));

// ── 9) telefone com e sem 55 ─────────────────────────────────────────────────
check("phonesMatch: com 55 x sem 55", phonesMatch("5512997710749", "12997710749"));
check("extrator: remoteJid -> phone", resolveUazapiPhone({ message: { sender_pn: "5512997710749@s.whatsapp.net" } }).includes("997710749"));
check("extrator: texto do extendedTextMessage", resolveUazapiText({ message: { message: { extendedTextMessage: { text: "Ok" } } } }) === "Ok");

// ── 1)+2) vendedor + 'Ok' confirma (independe de agente ativo/inativo) ────────
await (async () => {
  const s = seedSeller();
  const t = seedTransfer(s.id);
  const db: DB = { ai_team_members: [s], ai_lead_transfers: [t], ai_crm_leads: [seedLead(t.lead_id)] };
  // agent_id passado = agente INATIVO vinculado (handleSellerInbound nao olha is_active)
  const r = await handleSellerInbound(makeSupabase(db), { user_id: "TENANT_A", agent_id: "AGENTE_INATIVO", seller_phone: "12997710749", seller_text: "Ok", dry_run: false });
  check("1/2: 'Ok' confirma mesmo com agente inativo", r.route === "seller_ack_confirmation" && r.confirmed === true);
  check("1/2: transferencia marcada confirmed", db.ai_lead_transfers[0].is_confirmed === true && db.ai_lead_transfers[0].transfer_status === "confirmed");
  check("1/2: lead recebeu o vendedor", db.ai_crm_leads[0].assigned_to_id === s.id);
  check("1/2: rodizio atualizado (last_lead_received_at)", db.ai_team_members[0].last_lead_received_at != null);
})();

// ── 4) vendedor + mensagem que NAO e confirmacao -> nao confirma, isSeller ────
await (async () => {
  const s = seedSeller();
  const t = seedTransfer(s.id);
  const db: DB = { ai_team_members: [s], ai_lead_transfers: [t], ai_crm_leads: [seedLead(t.lead_id)] };
  const r = await handleSellerInbound(makeSupabase(db), { user_id: "TENANT_A", agent_id: null, seller_phone: "12997710749", seller_text: "qual o valor?", dry_run: false });
  check("4: mensagem comum do vendedor -> ignorada (isSeller, nao confirma)", r.isSeller === true && r.route === "seller_message_ignored" && r.confirmed === false);
  check("4: transferencia continua pendente", db.ai_lead_transfers[0].is_confirmed === false && db.ai_lead_transfers[0].transfer_status === "pending");
})();

// ── 5) vendedor sem transferencia pendente -> idempotente, nada muda ──────────
await (async () => {
  const s = seedSeller();
  const db: DB = { ai_team_members: [s], ai_lead_transfers: [], ai_crm_leads: [] };
  const r = await handleSellerInbound(makeSupabase(db), { user_id: "TENANT_A", agent_id: null, seller_phone: "12997710749", seller_text: "Ok", dry_run: false });
  check("5: sem pendencia -> no_pending idempotente", r.route === "seller_ack_no_pending" && r.confirmed === false && r.isSeller === true);
})();

// ── 6) confirmacao repetida -> nao duplica, nao mexe no rodizio de novo ───────
await (async () => {
  const s = seedSeller();
  const t = seedTransfer(s.id);
  const db: DB = { ai_team_members: [s], ai_lead_transfers: [t], ai_crm_leads: [seedLead(t.lead_id)] };
  const sb = makeSupabase(db);
  await handleSellerInbound(sb, { user_id: "TENANT_A", agent_id: null, seller_phone: "12997710749", seller_text: "Ok", dry_run: false });
  const firstStamp = db.ai_team_members[0].last_lead_received_at;
  const r2 = await handleSellerInbound(sb, { user_id: "TENANT_A", agent_id: null, seller_phone: "12997710749", seller_text: "Ok", dry_run: false });
  check("6: 2o 'Ok' -> no_pending (nao reconfirma)", r2.route === "seller_ack_no_pending" && r2.confirmed === false);
  check("6: rodizio NAO muda na repeticao", db.ai_team_members[0].last_lead_received_at === firstStamp);
})();

// ── 7) dois vendedores mesmo tenant -> so a transferencia do remetente confirma ─
await (async () => {
  const a = seedSeller({ whatsapp_number: "5512997710749" });
  const b = seedSeller({ whatsapp_number: "5512991035173" });
  const ta = seedTransfer(a.id);
  const tb = seedTransfer(b.id);
  const db: DB = { ai_team_members: [a, b], ai_lead_transfers: [ta, tb], ai_crm_leads: [seedLead(ta.lead_id), seedLead(tb.lead_id)] };
  const r = await handleSellerInbound(makeSupabase(db), { user_id: "TENANT_A", agent_id: null, seller_phone: "12997710749", seller_text: "Ok", dry_run: false });
  const taRow = db.ai_lead_transfers.find((x) => x.id === ta.id)!;
  const tbRow = db.ai_lead_transfers.find((x) => x.id === tb.id)!;
  check("7: so a transferencia do remetente (A) confirma", r.confirmed === true && taRow.is_confirmed === true);
  check("7: a transferencia do outro vendedor (B) fica intacta", tbRow.is_confirmed === false && tbRow.transfer_status === "pending");
})();

// ── 8) mesmo telefone em OUTRO tenant -> isolamento total ─────────────────────
await (async () => {
  const aA = seedSeller({ user_id: "TENANT_A", whatsapp_number: "5512997710749" });
  const aB = seedSeller({ user_id: "TENANT_B", whatsapp_number: "5512997710749" });
  const tA = seedTransfer(aA.id, { user_id: "TENANT_A" });
  const tB = seedTransfer(aB.id, { user_id: "TENANT_B" });
  const db: DB = { ai_team_members: [aA, aB], ai_lead_transfers: [tA, tB], ai_crm_leads: [seedLead(tA.lead_id), seedLead(tB.lead_id)] };
  const r = await handleSellerInbound(makeSupabase(db), { user_id: "TENANT_A", agent_id: null, seller_phone: "12997710749", seller_text: "Ok", dry_run: false });
  const tBrow = db.ai_lead_transfers.find((x) => x.id === tB.id)!;
  check("8: confirma so no tenant do remetente (A)", r.confirmed === true && db.ai_lead_transfers.find((x) => x.id === tA.id)!.is_confirmed === true);
  check("8: tenant B (mesmo telefone) NAO e tocado", tBrow.is_confirmed === false && tBrow.transfer_status === "pending");
})();

// ── 3) remetente NAO vendedor -> segue fluxo de lead (isSeller=false) ─────────
await (async () => {
  const s = seedSeller({ whatsapp_number: "5512991035173" });
  const db: DB = { ai_team_members: [s], ai_lead_transfers: [], ai_crm_leads: [] };
  const r = await handleSellerInbound(makeSupabase(db), { user_id: "TENANT_A", agent_id: null, seller_phone: "12988880000", seller_text: "Ok", dry_run: false });
  check("3: nao-vendedor -> not_seller (webhook encaminha lead)", r.isSeller === false && r.route === "not_seller");
})();

// ── VALIDACAO real (dry-run): prova que o 'Ok' CHEGA na confirmacao sem mutar ─
await (async () => {
  const s = seedSeller({ whatsapp_number: "5512997710749" }); // Luiz Felipe
  const t = seedTransfer(s.id);
  const db: DB = { ai_team_members: [s], ai_lead_transfers: [t], ai_crm_leads: [seedLead(t.lead_id)] };
  const r = await handleSellerInbound(makeSupabase(db), { user_id: "TENANT_A", agent_id: "AGENTE_INATIVO", seller_phone: "12997710749", seller_text: "Ok", dry_run: true });
  check("dry-run: chega na confirmacao (would_confirm) sem commitar", r.route === "seller_ack_dry_run" && r.reason === "would_confirm");
  check("dry-run: NADA e mutado", db.ai_lead_transfers[0].is_confirmed === false && db.ai_crm_leads[0].assigned_to_id === null);
})();

// ── ACK ao vendedor: enviado SO na primeira confirmacao (route seller_ack_confirmation) ─
// O gateway envia "Atendimento confirmado" iff route === 'seller_ack_confirmation'.
const shouldSendAck = (route: string) => route === "seller_ack_confirmation";
await (async () => {
  const s = seedSeller();
  const t = seedTransfer(s.id);
  const db: DB = { ai_team_members: [s], ai_lead_transfers: [t], ai_crm_leads: [seedLead(t.lead_id)] };
  const sb = makeSupabase(db);
  const r1 = await handleSellerInbound(sb, { user_id: "TENANT_A", agent_id: null, seller_phone: "12997710749", seller_text: "Ok", dry_run: false });
  check("ACK: 1a confirmacao -> envia ACK", shouldSendAck(r1.route) === true);
  const r2 = await handleSellerInbound(sb, { user_id: "TENANT_A", agent_id: null, seller_phone: "12997710749", seller_text: "Ok", dry_run: false });
  check("ACK: 'Ok' repetido -> NAO reenvia (no_pending)", shouldSendAck(r2.route) === false);
})();
await (async () => {
  const s = seedSeller();
  const t = seedTransfer(s.id);
  const db: DB = { ai_team_members: [s], ai_lead_transfers: [t], ai_crm_leads: [seedLead(t.lead_id)] };
  const r = await handleSellerInbound(makeSupabase(db), { user_id: "TENANT_A", agent_id: null, seller_phone: "12997710749", seller_text: "Olá", dry_run: false });
  check("ACK: mensagem comum ('Ola') -> NAO envia ACK", shouldSendAck(r.route) === false);
})();

console.log(`\nRESULT ok=${ok} failed=${failed}`);
if (failed > 0) Deno.exit(1);
