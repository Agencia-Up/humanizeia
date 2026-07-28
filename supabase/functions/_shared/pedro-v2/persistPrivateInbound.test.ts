// Testes da FASE 2 — persistência garantida da conversa privada.
// Rodar: deno test supabase/functions/_shared/pedro-v2/persistPrivateInbound.test.ts
//
// Cobrem as 10 validações obrigatórias no nível do MÓDULO (as que dependem de qual
// RAMO do webhook chama o módulo — cenários 1/4/10 — são provadas pelo diff/fiação
// e anotadas no relatório).

import { classifyUazapiInboundAudience } from "./inboundAudience.ts";
import {
  classifyForPersist,
  detectMessageType,
  extractContactName,
  extractContent,
  extractMessageId,
  persistPrivateInboundMessage,
} from "./persistPrivateInbound.ts";

// ── mini-asserts (sem dependências externas) ──────────────────────────────────
function assert(cond: unknown, msg = "assert failed") {
  if (!cond) throw new Error(msg);
}
function assertEquals<T>(a: T, b: T, msg?: string) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(msg || `expected ${sb} got ${sa}`);
}

// ── mock do supabase (só as chamadas que o módulo faz) ────────────────────────
interface MockOpts {
  insert?: (row: any) => { error: any };
  v3Rows?: any[];
  v3Error?: any;
}
function makeMock(opts: MockOpts = {}) {
  const inserted: any[] = [];
  const v3Queries: any[] = [];
  const client: any = {
    inserted,
    v3Queries,
    from(table: string) {
      if (table === "wa_inbox") {
        return {
          insert(row: any) {
            inserted.push(row);
            return Promise.resolve(opts.insert ? opts.insert(row) : { error: null });
          },
        };
      }
      if (table === "v3_effect_outbox") {
        const q: any = { table };
        const builder: any = {
          select() { return builder; },
          eq(k: string, v: any) { q[k] = v; return builder; },
          in(k: string, v: any) { q[k] = v; return builder; },
          like(k: string, v: any) { q.like = [k, v]; return builder; },
          limit() {
            v3Queries.push(q);
            return Promise.resolve({ data: opts.v3Error ? null : (opts.v3Rows || []), error: opts.v3Error || null });
          },
        };
        return builder;
      }
      throw new Error("unexpected table " + table);
    },
  };
  return client;
}

// ── builders de payload uazapi ────────────────────────────────────────────────
function inbound(text: string, phone = "5512999990000", id = "MSGIN1", extra: any = {}) {
  return {
    instanceName: "icom",
    message: {
      key: { id, fromMe: false, remoteJid: `${phone}@s.whatsapp.net` },
      text,
      pushName: "Cliente Teste",
      ...extra,
    },
  };
}
function fromMe(text: string, phone = "5512999990000", id = "MSGOUT1", extra: any = {}) {
  return {
    instanceName: "icom",
    message: {
      key: { id, fromMe: true, remoteJid: `${phone}@s.whatsapp.net` },
      text,
      ...extra,
    },
  };
}
function group(text: string) {
  return { instanceName: "icom", message: { key: { id: "G1", fromMe: false, remoteJid: "12036@g.us" }, text } };
}
function broadcast(text: string) {
  return { instanceName: "icom", message: { key: { id: "B1", fromMe: false, remoteJid: "status@broadcast" }, text } };
}

const WA = { id: "inst-1", user_id: "tenant-1", phone_number: "5512333000111" };
const now = () => "2026-07-28T12:00:00.000Z";

function deps(payload: any, over: any = {}) {
  return {
    supabase: over.supabase ?? makeMock(),
    waInstance: over.waInstance ?? WA,
    agentsList: over.agentsList ?? [],
    payload,
    audience: classifyUazapiInboundAudience(payload),
    isMessageUpdate: over.isMessageUpdate ?? false,
    now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICAÇÃO (requisito 1)
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("classify: receipt/message_update NÃO persiste (cenário 8)", () => {
  const c = classifyForPersist(classifyUazapiInboundAudience(inbound("x")), { isMessageUpdate: true });
  assertEquals(c, { persist: false, reason: "message_update_receipt" });
});
Deno.test("classify: grupo e broadcast NÃO persistem (cenário 9)", () => {
  assertEquals(classifyForPersist(classifyUazapiInboundAudience(group("x")), { isMessageUpdate: false }),
    { persist: false, reason: "group" });
  assertEquals(classifyForPersist(classifyUazapiInboundAudience(broadcast("x")), { isMessageUpdate: false }),
    { persist: false, reason: "broadcast" });
});
Deno.test("classify: inbound do cliente = incoming; fromMe = outgoing", () => {
  const ci = classifyForPersist(classifyUazapiInboundAudience(inbound("oi")), { isMessageUpdate: false });
  assertEquals(ci, { persist: true, direction: "incoming", fromMe: false, reason: "client_inbound" });
  const co = classifyForPersist(classifyUazapiInboundAudience(fromMe("resposta")), { isMessageUpdate: false });
  assertEquals(co, { persist: true, direction: "outgoing", fromMe: true, reason: "from_me_outbound" });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTRAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("extract: tipo/conteúdo/id/nome", () => {
  const p = inbound("quero uma hilux", "5512988887777", "ABC123");
  assertEquals(detectMessageType(p), "text");
  assertEquals(extractContent(p, "text"), "quero uma hilux");
  assertEquals(extractMessageId(p), "ABC123");
  assertEquals(extractContactName(p), "Cliente Teste");
});
Deno.test("extract: mídia sem legenda vira placeholder", () => {
  const p = inbound("", "5512988887777", "IMG1", { messageType: "image", message: { imageMessage: {} } });
  assertEquals(detectMessageType(p), "image");
  assertEquals(extractContent(p, "image"), "[imagem recebida]");
});

// ─────────────────────────────────────────────────────────────────────────────
// PERSISTÊNCIA (efeito) — cenários 2,3,5,6,7,8,9 + interno
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("persist: inbound grava exatamente 1 linha, incoming, unread", async () => {
  const mock = makeMock();
  const r = await persistPrivateInboundMessage(deps(inbound("oi"), { supabase: mock }));
  assertEquals(r.status, "persisted");
  assertEquals(r.direction, "incoming");
  assertEquals(mock.inserted.length, 1);
  const row = mock.inserted[0];
  assertEquals(row.direction, "incoming");
  assertEquals(row.is_read, false);
  assertEquals(row.user_id, "tenant-1");
  assertEquals(row.instance_id, "inst-1");
  assertEquals(row.remote_message_id, "MSGIN1");
  assertEquals(row.created_at, "2026-07-28T12:00:00.000Z");
});

// A persistência é chamada UMA vez ANTES de selectActiveAgent, então é IDÊNTICA
// independentemente do estado do agente (ativo/inativo/pausado). A diferença — se o
// webhook despacha ao V3 ou não — é estrutural (ramos do webhook, provada pelo diff):
// ATIVO segue ao callPedroV3Bridge; INATIVO retorna em agent_not_found; PAUSADO
// retorna em ai_paused_no_dispatch. Aqui garantimos a invariante: SEMPRE persiste 1x.
Deno.test("cenário 1 — agente ATIVO: inbound persiste 1x (o V3 segue depois — fiação)", async () => {
  const mock = makeMock({ v3Rows: [] });
  const r = await persistPrivateInboundMessage(deps(inbound("quero financiar", "5512900001111", "ACT1"), { supabase: mock }));
  assertEquals(r.status, "persisted");
  assertEquals(r.direction, "incoming");
  assertEquals(mock.inserted.length, 1);
});
Deno.test("cenário 2 — agente INATIVO: inbound persiste 1x (webhook encerra sem V3 — fiação)", async () => {
  const mock = makeMock();
  const r = await persistPrivateInboundMessage(deps(inbound("tem hilux?", "5512900002222", "INA1"), { supabase: mock }));
  assertEquals(r.status, "persisted");
  assertEquals(r.direction, "incoming");
  assertEquals(mock.inserted.length, 1);
});
Deno.test("cenário 3 — PAUSADO: inbound persiste 1x (webhook encerra sem V3 — fiação)", async () => {
  const mock = makeMock();
  const r = await persistPrivateInboundMessage(deps(inbound("ainda tem?", "5512900003333", "PAU1"), { supabase: mock }));
  assertEquals(r.status, "persisted");
  assertEquals(r.direction, "incoming");
  assertEquals(mock.inserted.length, 1);
});

Deno.test("persist: fromMe MANUAL grava como outgoing/lida (cenário 5)", async () => {
  // v3Rows vazio => NÃO é automática do V3 => grava como manual.
  const mock = makeMock({ v3Rows: [] });
  const r = await persistPrivateInboundMessage(deps(fromMe("vou te mandar o preço"), { supabase: mock }));
  assertEquals(r.status, "persisted");
  assertEquals(r.direction, "outgoing");
  assertEquals(mock.inserted.length, 1);
  assertEquals(mock.inserted[0].direction, "outgoing");
  assertEquals(mock.inserted[0].is_read, true);
  // confirmou que consultou o v3_effect_outbox por providerMessageId (like %core)
  assert(mock.v3Queries.length === 1, "deveria checar v3_effect_outbox");
  assertEquals(mock.v3Queries[0].like[1], "%MSGOUT1");
});

Deno.test("persist: fromMe AUTOMÁTICA do V3 NÃO duplica (cenário 6)", async () => {
  // v3_effect_outbox casa o providerMessageId => é automática => pula, não grava.
  const mock = makeMock({ v3Rows: [{ effect_id: "eff-1" }] });
  const r = await persistPrivateInboundMessage(deps(fromMe("Olá! Sou a Sarah da iCOM"), { supabase: mock }));
  assertEquals(r.status, "skipped");
  assertEquals(r.reason, "from_me_v3_auto");
  assertEquals(mock.inserted.length, 0);
});

Deno.test("persist: fromMe com v3-check em ERRO faz fail-closed (não duplica) (req.7)", async () => {
  const mock = makeMock({ v3Error: { message: "boom" } });
  const r = await persistPrivateInboundMessage(deps(fromMe("x"), { supabase: mock }));
  assertEquals(r.status, "skipped");
  assertEquals(r.reason, "from_me_v3_auto");
  assertEquals(mock.inserted.length, 0);
});

Deno.test("persist: retry idêntico (unique-violation) = deduped, sem 2ª linha (cenário 7)", async () => {
  const mock = makeMock({ insert: () => ({ error: { code: "23505", message: "duplicate key value violates unique constraint wa_inbox_remote_msg_unique" } }) });
  const r = await persistPrivateInboundMessage(deps(inbound("oi de novo"), { supabase: mock }));
  assertEquals(r.status, "deduped");
  assertEquals(r.reason, "dedup_unique");
});

Deno.test("persist: receipt NÃO vira mensagem (cenário 8)", async () => {
  const mock = makeMock();
  const r = await persistPrivateInboundMessage(deps(inbound("x"), { supabase: mock, isMessageUpdate: true }));
  assertEquals(r.status, "skipped");
  assertEquals(r.reason, "message_update_receipt");
  assertEquals(mock.inserted.length, 0);
});

Deno.test("persist: grupo/broadcast NÃO entram como lead (cenário 9)", async () => {
  const m1 = makeMock();
  assertEquals((await persistPrivateInboundMessage(deps(group("oi grupo"), { supabase: m1 }))).status, "skipped");
  assertEquals(m1.inserted.length, 0);
  const m2 = makeMock();
  assertEquals((await persistPrivateInboundMessage(deps(broadcast("promo"), { supabase: m2 }))).status, "skipped");
  assertEquals(m2.inserted.length, 0);
});

Deno.test("persist: número INTERNO (gerente) é ignorado (requisito 1)", async () => {
  const mock = makeMock();
  const agents = [{ gerente_phone: "5512977776666", human_whatsapp: null, gerente_phone_2: null }];
  const p = inbound("teste interno", "5512977776666", "INT1");
  const r = await persistPrivateInboundMessage(deps(p, { supabase: mock, agentsList: agents }));
  assertEquals(r.status, "skipped");
  assertEquals(r.reason, "internal_identity");
  assertEquals(mock.inserted.length, 0);
});

Deno.test("persist: número da PRÓPRIA instância é interno", async () => {
  const mock = makeMock();
  const p = inbound("eco da linha", "5512333000111", "SELF1"); // == WA.phone_number
  const r = await persistPrivateInboundMessage(deps(p, { supabase: mock }));
  assertEquals(r.status, "skipped");
  assertEquals(r.reason, "internal_identity");
});

Deno.test("persist: erro REAL de banco retorna status=error (req.9, não esconde)", async () => {
  const mock = makeMock({ insert: () => ({ error: { code: "500", message: "connection reset" } }) });
  const r = await persistPrivateInboundMessage(deps(inbound("oi"), { supabase: mock }));
  assertEquals(r.status, "error");
  assertEquals(r.direction, "incoming");
  assert(String(r.error).includes("connection reset"), "erro deve ser observável");
});

Deno.test("persist: sem telefone => skip no_phone (não inventa lead)", async () => {
  const mock = makeMock();
  const p: any = { instanceName: "icom", message: { key: { id: "X", fromMe: false, remoteJid: "" }, text: "?" } };
  const r = await persistPrivateInboundMessage(deps(p, { supabase: mock }));
  assertEquals(r.status, "skipped");
  assertEquals(r.reason, "no_phone");
});
