// ─────────────────────────────────────────────────────────────────────────────
// FASE 2 — testes de INTEGRAÇÃO do persistPrivateInbound (nível módulo).
//
// Rodam em Node (deno indisponível nesta máquina): o módulo é puro e recebe o
// client por injeção. O FakeSupabase reproduz a semântica REAL do banco:
//   * índice único parcial wa_inbox_remote_msg_unique
//     (user_id, instance_id, remote_message_id) WHERE remote_message_id IS NOT NULL
//     → violação vira erro 23505, igual ao PostgREST;
//   * v3_effect_outbox programável (found / notfound / error) p/ os vereditos.
// Os invariantes que SÓ o Postgres prova (23505 de verdade, isolamento por
// tenant no índice) são cobertos também por prova SQL transacional em prod
// (scripts/sql/test_persist_fase2.sql — INSERT + ROLLBACK).
//
// Como rodar:
//   npx esbuild supabase/functions/_shared/pedro-v2/persistPrivateInbound.ts \
//     --bundle --format=esm --outfile=/tmp/persist_bundle.mjs
//   node scripts/tests/persist_integration.test.mjs /tmp/persist_bundle.mjs
// ─────────────────────────────────────────────────────────────────────────────

const bundlePath = process.argv[2];
if (!bundlePath) { console.error("uso: node persist_integration.test.mjs <bundle.mjs>"); process.exit(2); }
const mod = await import(new URL(`file://${bundlePath.replace(/\\/g, "/")}`));
const { persistPrivateInboundMessage, fallbackMessageKey, classifyForPersist } = mod;

// ── FakeSupabase com semântica do índice único real ──────────────────────────
function makeFakeSupabase(opts = {}) {
  const rows = [];                       // wa_inbox
  const outboxMode = { v: opts.outbox ?? "notfound" }; // notfound|found|error
  const uniq = new Set();                // (user_id|instance_id|remote_message_id)
  function from(table) {
    if (table === "wa_inbox") {
      return {
        insert(row) {
          if (row.remote_message_id != null) {          // índice PARCIAL
            const k = `${row.user_id}|${row.instance_id}|${row.remote_message_id}`;
            if (uniq.has(k)) return Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint \"wa_inbox_remote_msg_unique\"" } });
            uniq.add(k);
          }
          rows.push(row);
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === "v3_effect_outbox") {
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, like: () => chain, gte: () => chain,
        limit: () => {
          if (outboxMode.v === "error") return Promise.resolve({ data: null, error: { message: "boom" } });
          if (outboxMode.v === "found") return Promise.resolve({ data: [{ effect_id: "x" }], error: null });
          return Promise.resolve({ data: [], error: null });
        },
      };
      return chain;
    }
    throw new Error(`tabela inesperada: ${table}`);
  }
  return { from, rows, outboxMode };
}

const NOW = "2026-07-28T18:00:00.000Z";
const instA = { id: "inst-A", user_id: "tenant-A", phone_number: "5512988880000" };
const instB = { id: "inst-B", user_id: "tenant-B", phone_number: "5511977770000" };
const agents = [{ gerente_phone: "5512999990000", gerente_phone_2: null, human_whatsapp: null }];

function inboundPayload(over = {}) {
  return {
    message: {
      key: { id: over.msgId === undefined ? "MSG-1" : over.msgId, remoteJid: over.jid ?? "5512981112233@s.whatsapp.net", fromMe: over.fromMe ?? false },
      fromMe: over.fromMe ?? false,
      body: over.text ?? "quero o carro",
      messageTimestamp: over.ts ?? 1784916000,
      pushName: "Cliente Teste",
    },
    ...(over.extra || {}),
  };
}
const AUD = {
  direct: { kind: "direct", remoteJid: "x" }, self: { kind: "self", remoteJid: "x" },
  group: { kind: "group", remoteJid: "g@g.us" }, broadcast: { kind: "broadcast", remoteJid: "status@broadcast" },
};

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FALHOU ${name} ${extra}`); }
}
async function persist(sb, { inst = instA, payload, audience = AUD.direct, isUpd = false }) {
  return persistPrivateInboundMessage({
    supabase: sb, waInstance: inst, agentsList: agents, payload, audience, isMessageUpdate: isUpd, now: () => NOW,
  });
}

// ── Cenário 1/2/3: inbound persiste 1x com agente ativo, inativo ou pausado ──
// (o módulo é chamado ANTES dessas decisões; aqui provamos que ele grava
//  independente delas — a fiação no webhook é ponto único pré-selectActiveAgent)
{
  const sb = makeFakeSupabase();
  const r = await persist(sb, { payload: inboundPayload({}) });
  check("c1-3: inbound persiste 1 linha incoming", r.status === "persisted" && sb.rows.length === 1 && sb.rows[0].direction === "incoming" && sb.rows[0].is_read === false);
  check("c1-3: remote_message_id preservado", sb.rows[0].remote_message_id === "MSG-1");
}

// ── Cenário 4: fromMe MANUAL persiste como outgoing ──────────────────────────
{
  const sb = makeFakeSupabase({ outbox: "notfound" });
  const r = await persist(sb, { payload: inboundPayload({ fromMe: true, msgId: "MAN-1", text: "vou te ligar" }), audience: AUD.self });
  check("c4: manual fromMe grava outgoing lida", r.status === "persisted" && sb.rows[0].direction === "outgoing" && sb.rows[0].is_read === true && sb.rows[0].is_archived === false);
}

// ── Cenário 5: fromMe AUTOMÁTICA do V3 NÃO duplica ───────────────────────────
{
  const sb = makeFakeSupabase({ outbox: "found" });
  const r = await persist(sb, { payload: inboundPayload({ fromMe: true, msgId: "3EB0-V3" }), audience: AUD.self });
  check("c5: automática V3 é pulada", r.status === "skipped" && r.reason === "from_me_v3_auto" && sb.rows.length === 0);
}

// ── Cenário 5b (revisão): fromMe SEM id com texto igual a envio V3 recente ───
{
  const sb = makeFakeSupabase({ outbox: "found" });
  const r = await persist(sb, { payload: inboundPayload({ fromMe: true, msgId: null, text: "resposta da ia" }), audience: AUD.self });
  check("c5b: eco sem id casado por conteúdo é pulado", r.status === "skipped" && r.reason === "from_me_v3_auto_content" && sb.rows.length === 0);
}

// ── Cenário 5c (revisão, ponto 2): consulta ao outbox FALHA → estaciona, não some
{
  const sb = makeFakeSupabase({ outbox: "error" });
  const r = await persist(sb, { payload: inboundPayload({ fromMe: true, msgId: "MAN-2", text: "manual no apagão" }), audience: AUD.self });
  check("c5c: incerta é estacionada (durável, fora do público)", r.status === "persisted" && r.reason === "from_me_uncertain_parked" && sb.rows[0].is_archived === true && sb.rows[0].ai_category === "v3_uncertain");
}

// ── Cenário 6: RETRY do mesmo webhook = 1 linha (dedupe 23505) ───────────────
{
  const sb = makeFakeSupabase();
  const p = inboundPayload({});
  const r1 = await persist(sb, { payload: p });
  const r2 = await persist(sb, { payload: p });
  check("c6: retry deduplica", r1.status === "persisted" && r2.status === "deduped" && sb.rows.length === 1);
}

// ── Cenário 7 (revisão, ponto 1): SEM remote_message_id → fallback determinístico
{
  const sb = makeFakeSupabase();
  const p = inboundPayload({ msgId: null });
  const r1 = await persist(sb, { payload: p });
  const r2 = await persist(sb, { payload: p });   // retry idêntico
  check("c7: sem id ganha chave fb1 e retry deduplica", r1.status === "persisted" && String(r1.remote_message_id).startsWith("fb1:") && r2.status === "deduped" && sb.rows.length === 1);
  const k1 = fallbackMessageKey({ direction: "incoming", phone: "5512981112233", providerTsSec: 1784916000, nowIso: NOW, messageType: "text", content: "a", mediaUrl: null });
  const k2 = fallbackMessageKey({ direction: "incoming", phone: "5512981112233", providerTsSec: 1784916000, nowIso: NOW, messageType: "text", content: "b", mediaUrl: null });
  check("c7: conteúdos diferentes → chaves diferentes", k1 !== k2);
}

// ── Cenário 8: receipt/message_update nunca persiste ─────────────────────────
{
  const sb = makeFakeSupabase();
  const r = await persist(sb, { payload: inboundPayload({}), isUpd: true });
  check("c8: message_update é pulado", r.status === "skipped" && sb.rows.length === 0);
  check("c8: classify puro confere", classifyForPersist(AUD.direct, { isMessageUpdate: true }).persist === false);
}

// ── Cenário 9: grupo/broadcast nunca persistem ───────────────────────────────
{
  const sb = makeFakeSupabase();
  const r1 = await persist(sb, { payload: inboundPayload({}), audience: AUD.group });
  const r2 = await persist(sb, { payload: inboundPayload({}), audience: AUD.broadcast });
  check("c9: grupo e broadcast pulados", r1.status === "skipped" && r2.status === "skipped" && sb.rows.length === 0);
}

// ── Cenário 10: número INTERNO (gerente/linha da instância) não persiste ─────
{
  const sb = makeFakeSupabase();
  const r1 = await persist(sb, { payload: inboundPayload({ jid: "5512999990000@s.whatsapp.net" }) }); // gerente
  const r2 = await persist(sb, { payload: inboundPayload({ jid: "5512988880000@s.whatsapp.net" }) }); // linha da instância
  // controle: final IGUAL ao do gerente mas DDD/prefixo diferentes NÃO é interno (não é last-8)
  const r3 = await persist(sb, { payload: inboundPayload({ jid: "5521977790000@s.whatsapp.net", msgId: "CTL-1" }) });
  check("c10: internos pulados; quase-igual NÃO é engolido", r1.status === "skipped" && r2.status === "skipped" && r3.status === "persisted" && sb.rows.length === 1);
}

// ── Cenário 11: DOIS TENANTS com o MESMO telefone não se misturam ────────────
{
  const sb = makeFakeSupabase();
  const p = inboundPayload({});
  const rA = await persist(sb, { inst: instA, payload: p });
  const rB = await persist(sb, { inst: instB, payload: p });   // mesmo fone+mesmo msgid, outro tenant/instância
  check("c11: mesmo fone em 2 tenants = 2 linhas independentes", rA.status === "persisted" && rB.status === "persisted" && sb.rows.length === 2 && sb.rows[0].user_id !== sb.rows[1].user_id);
}

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail > 0 ? 1 : 0);
