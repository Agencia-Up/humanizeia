import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  isJoseSenderEligible,
  pickJoseSenderInstance,
  resolveJoseSenderInstance,
  type JoseSenderInstance,
} from "../_shared/jose-v2/joseSender.ts";

const TENANT = "11111111-1111-1111-1111-111111111111";
const AGENT_LINE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SELLER_LINE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function instance(id: string, extra: Partial<JoseSenderInstance> = {}): JoseSenderInstance {
  return {
    id,
    user_id: TENANT,
    seller_member_id: null,
    status: "connected",
    is_active: true,
    api_url: "https://uazapi.test",
    instance_name: `inst-${id.slice(0, 4)}`,
    api_key_encrypted: "token",
    updated_at: "2026-08-05T12:00:00Z",
    ...extra,
  };
}

Deno.test("Jose nunca escolhe numero de vendedor, mesmo se for o preferido e o mais recente", () => {
  const seller = instance(SELLER_LINE, {
    seller_member_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    updated_at: "2026-08-05T13:00:00Z",
  });
  const institutional = instance(AGENT_LINE);
  const activeAgents = [{ id: "agent-1", instance_id: AGENT_LINE, instance_ids: [SELLER_LINE] }];

  const picked = pickJoseSenderInstance([seller, institutional], activeAgents, SELLER_LINE);
  assertEquals(picked?.id, AGENT_LINE);
});

Deno.test("Jose falha fechado quando so existe linha de vendedor", () => {
  const seller = instance(SELLER_LINE, {
    seller_member_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  });
  const picked = pickJoseSenderInstance(
    [seller],
    [{ id: "agent-1", instance_id: SELLER_LINE }],
    SELLER_LINE,
  );
  assertEquals(picked, null);
});

Deno.test("linha desconectada, inativa, sem credencial ou sem agente ativo e inelegivel", () => {
  const ids = new Set([AGENT_LINE]);
  assertEquals(isJoseSenderEligible(instance(AGENT_LINE, { status: "disconnected" }), ids), false);
  assertEquals(isJoseSenderEligible(instance(AGENT_LINE, { is_active: false }), ids), false);
  assertEquals(isJoseSenderEligible(instance(AGENT_LINE, { api_key_encrypted: null }), ids), false);
  assertEquals(isJoseSenderEligible(instance(AGENT_LINE), new Set()), false);
});

function fakeSupabase(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] || [])];
      const query: any = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        is: (column: string, value: unknown) => {
          rows = rows.filter((row) => (row[column] ?? null) === value);
          return query;
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          rows.sort((a, b) => String(a[column] || "").localeCompare(String(b[column] || "")));
          if (options?.ascending === false) rows.reverse();
          return query;
        },
        then: (resolve: (value: any) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return query;
    },
  };
}

Deno.test("resolver consulta o tenant e devolve somente a linha institucional ligada ao agente", async () => {
  const admin = fakeSupabase({
    wa_ai_agents: [{
      id: "agent-1",
      user_id: TENANT,
      is_active: true,
      instance_id: AGENT_LINE,
      instance_ids: [SELLER_LINE],
      updated_at: "2026-08-05T10:00:00Z",
    }],
    wa_instances: [
      instance(SELLER_LINE, {
        seller_member_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        updated_at: "2026-08-05T13:00:00Z",
      }),
      instance(AGENT_LINE),
      instance("dddddddd-dddd-dddd-dddd-dddddddddddd", {
        user_id: "22222222-2222-2222-2222-222222222222",
      }),
    ],
  });

  const picked = await resolveJoseSenderInstance(admin, {
    user_id: TENANT,
    preferred_instance_id: SELLER_LINE,
  });
  assertEquals(picked?.id, AGENT_LINE);
});

Deno.test("todos os caminhos automaticos do Jose usam o resolvedor isolado", async () => {
  const apollo = await Deno.readTextFile(new URL("../apollo-agent/index.ts", import.meta.url));
  const approval = await Deno.readTextFile(new URL("../_shared/jose-v2/approvalGate.ts", import.meta.url));
  const proactive = await Deno.readTextFile(new URL("../_shared/jose-v2/proactiveSummary.ts", import.meta.url));

  assertStringIncludes(apollo, "resolveJoseSenderInstance(admin");
  assert(!apollo.includes("senão a primeira conectada"));
  assert(!approval.includes("resolvePedroInstance"));
  assert(!proactive.includes("resolvePedroInstance"));
});

Deno.test("painel e banco excluem linha de vendedor", async () => {
  const dashboard = await Deno.readTextFile(new URL("../../../src/pages/ApolloDashboard.tsx", import.meta.url));
  const migration = await Deno.readTextFile(
    new URL("../../../supabase/migrations/20260805170000_jose_sender_instance_isolation.sql", import.meta.url),
  );

  assertStringIncludes(dashboard, ".is('seller_member_id', null)");
  assertStringIncludes(dashboard, ".from('wa_ai_agents')");
  assertStringIncludes(migration, "BLOQUEADO: numero de vendedor nunca pode enviar como Jose");
  assertStringIncludes(migration, "trg_enforce_jose_report_sender_instance");
  assertStringIncludes(migration, "trg_clear_jose_sender_when_instance_becomes_seller");
});
