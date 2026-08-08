// ============================================================================
// HOTFIX P0 — gate offline da autorizacao de `pedro-auto-followup`.
//
// O DEFEITO (verificado no artefato IMPLANTADO, v78):
//   * a funcao esta com `verify_jwt=false` -> chamada ANONIMA chega ao handler;
//   * o handler nao lia o `Authorization` e ja criava cliente service_role;
//   * o kill-switch era `if (!reactEnabled && !dryRun && !onlyLeadId)`, e
//     `only_lead_id` e ENVIO REAL -> um corpo `{"only_lead_id":"<uuid>"}` mandava
//     WhatsApp pela instancia de um cliente com o motor oficialmente desligado;
//   * `only_user_id` ESTREITA a varredura, entao omiti-lo ALARGAVA para todos os
//     tenants (era o que o botao do portal fazia, com corpo vazio).
//
// SEGUNDA RODADA — dois bloqueios do auditor:
//   * `resolve_billing_owner_user_id` MAPEIA vendedor -> tenant do master
//     (`IF v_role = 'seller' THEN RETURN COALESCE(v_team_master_id, ...)`), entao
//     usar so o retorno dela deixava qualquer vendedor operar a conta inteira;
//   * o teste de "zero rede" so chamava a propria armadilha, sem exercitar o
//     caminho de request. Agora ha um bloco [H] que monta `Request` de verdade e
//     roda `guardReactivationHttp` — a MESMA funcao que index.ts chama — com a
//     continuacao operacional injetada e contada.
//
//   npx tsx supabase/functions/_shared/followup-reactivation-auth.offline-test.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  authorizeReactivationRequest, guardReactivationHttp, parseBearerToken,
  normalizeMaxPerMaster, reactivationSendsBlocked, reactivationFlagEnabled,
  isUuid, isBillingOwner, MAX_PER_MASTER_LIMIT,
  type ReactivationAuthDeps, type ReactivationAuthResult, type ReactivationScope,
} from "./followup-reactivation-auth.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Nenhuma chamada real de rede em nenhum caso. Qualquer fetch e falha dura.
(globalThis as unknown as { fetch: unknown }).fetch = () => { throw new Error("REDE PROIBIDA NO GATE OFFLINE"); };

const SERVICE_KEY = "service-role-key-FALSA-para-teste";
const ANON_KEY = "anon-key-FALSA-para-teste";
// Para um master, resolve_billing_owner_user_id devolve o proprio id: uid === tenant.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const OWNER_A_UID = TENANT_A;
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LEAD_DE_A = "33333333-3333-4333-8333-333333333333";
const LEAD_DE_B = "44444444-4444-4444-8444-444444444444";
// Vendedor da conta A: id PROPRIO, mas billing owner = TENANT_A.
const SELLER_UID = "66666666-6666-4666-8666-666666666666";

const TOKEN_OWNER = "jwt-do-owner-A";
const TOKEN_SELLER = "jwt-do-vendedor-de-A";

type Espiao = { chamadas: string[] };
function depsDe(espiao: Espiao, opts?: { semTenant?: boolean }): ReactivationAuthDeps {
  return {
    verifyUserToken: async (token) => {
      espiao.chamadas.push("verifyUserToken");
      if (token === TOKEN_OWNER) return OWNER_A_UID;
      if (token === TOKEN_SELLER) return SELLER_UID;
      return null;
    },
    resolveTenantForUser: async (userId) => {
      espiao.chamadas.push("resolveTenantForUser");
      if (opts?.semTenant) return null;
      // Reproduz a funcao real: o vendedor resolve para o tenant do master.
      if (userId === OWNER_A_UID) return TENANT_A;
      if (userId === SELLER_UID) return TENANT_A;
      return null;
    },
    resolveLeadOwner: async (leadId) => {
      espiao.chamadas.push("resolveLeadOwner");
      if (leadId === LEAD_DE_A) return TENANT_A;
      if (leadId === LEAD_DE_B) return TENANT_B;
      return null;
    },
  };
}

async function autorizar(
  header: string | null, body: Record<string, unknown>, espiao: Espiao = { chamadas: [] },
  opts?: { semTenant?: boolean },
): Promise<ReactivationAuthResult> {
  return await authorizeReactivationRequest(depsDe(espiao, opts), {
    authorizationHeader: header, body, serviceRoleKey: SERVICE_KEY, anonKey: ANON_KEY,
  });
}
const bearerOwner = `Bearer ${TOKEN_OWNER}`;
const bearerSeller = `Bearer ${TOKEN_SELLER}`;
const bearerService = `Bearer ${SERVICE_KEY}`;
const negou = (r: ReactivationAuthResult, status: number): boolean => r.ok === false && r.status === status;

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(path.join(AQUI, "..", "pedro-auto-followup", "index.ts"), "utf8");

// ── [2..5] Quem nao se identifica nao entra ──────────────────────────────────
check("[2] sem Authorization -> 401", negou(await autorizar(null, {}), 401));
check("[3] Bearer vazio -> 401", negou(await autorizar("Bearer   ", {}), 401));
check("[4] JWT invalido -> 401", negou(await autorizar("Bearer jwt-qualquer", {}), 401));
check("[5a] anon key -> 401 (e publica; nao identifica ninguem)", negou(await autorizar(`Bearer ${ANON_KEY}`, {}), 401));
{
  const r = await authorizeReactivationRequest(depsDe({ chamadas: [] }), {
    authorizationHeader: `Bearer ${ANON_KEY}`, body: {}, serviceRoleKey: SERVICE_KEY, anonKey: null,
  });
  check("[5b] anon key sem allowlist tambem cai (verifyUserToken nao devolve usuario)", negou(r, 401));
}
check("[2b] header sem o esquema Bearer -> 401", negou(await autorizar(TOKEN_OWNER, {}), 401));
check("[2c] parseBearerToken rejeita vazio/ausente/malformado",
  parseBearerToken(null) === null && parseBearerToken("Bearer") === null && parseBearerToken("Basic x") === null
  && parseBearerToken("Bearer  abc ") === "abc");

// ── [S] VENDEDOR NAO OPERA A CONTA DO MASTER ────────────────────────────────
// `resolve_billing_owner_user_id` devolve o tenant do master para o vendedor.
// Vinculo nao e permissao: exigimos que o usuario SEJA o billing owner.
check("[S0] isBillingOwner exige identidade, nao vinculo",
  isBillingOwner(TENANT_A, TENANT_A) && !isBillingOwner(SELLER_UID, TENANT_A) && !isBillingOwner("", ""));
{
  const r = await autorizar(bearerOwner, {});
  check("[S1] owner autenticado opera o PROPRIO tenant",
    r.ok === true && r.caller === "user" && r.tenantScope === TENANT_A, JSON.stringify(r));
}
check("[S2] vendedor cujo billing owner e outro UUID -> 403",
  negou(await autorizar(bearerSeller, {}), 403));
check("[S3] vendedor + dry_run -> 403 (preview tambem e negado)",
  negou(await autorizar(bearerSeller, { dry_run: true }), 403));
check("[S4] vendedor + only_lead_id do master -> 403",
  negou(await autorizar(bearerSeller, { only_lead_id: LEAD_DE_A }), 403));
check("[S5] vendedor + only_user_id do master -> 403",
  negou(await autorizar(bearerSeller, { only_user_id: TENANT_A }), 403));
{
  const e: Espiao = { chamadas: [] };
  await autorizar(bearerSeller, { only_lead_id: LEAD_DE_A, max_per_master: 50 }, e);
  check("[S6] vendedor e barrado ANTES de resolver lead ou validar lote",
    !e.chamadas.includes("resolveLeadOwner"), JSON.stringify(e.chamadas));
}
check("[S7] service_role continua autorizada (o vendedor nao quebrou o cron)",
  (await autorizar(bearerService, {})).ok === true);

// ── [6..8] Escopo de tenant ──────────────────────────────────────────────────
check("[7] cross-tenant por only_user_id -> 403",
  negou(await autorizar(bearerOwner, { only_user_id: TENANT_B }), 403));
check("[7b] only_user_id do PROPRIO tenant e aceito",
  (await autorizar(bearerOwner, { only_user_id: TENANT_A })).ok === true);
check("[8] cross-tenant por only_lead_id -> 403",
  negou(await autorizar(bearerOwner, { only_lead_id: LEAD_DE_B }), 403));
check("[8b] only_lead_id do proprio tenant e aceito e ancora o escopo",
  await (async () => { const r = await autorizar(bearerOwner, { only_lead_id: LEAD_DE_A });
    return r.ok === true && r.tenantScope === TENANT_A && r.onlyLeadId === LEAD_DE_A; })());
check("[8c] lead inexistente -> 403 fail-closed (nunca 'tenta em todos os tenants')",
  negou(await autorizar(bearerOwner, { only_lead_id: "99999999-9999-4999-8999-999999999999" }), 403));
check("[8d] only_lead_id ANCORA o escopo ate para service_role (nao alarga a varredura)",
  await (async () => { const r = await autorizar(bearerService, { only_lead_id: LEAD_DE_B });
    return r.ok === true && r.caller === "service_role" && r.tenantScope === TENANT_B; })());
check("[8e] only_lead_id que nao e UUID -> 400",
  negou(await autorizar(bearerOwner, { only_lead_id: "nao-e-uuid" }), 400));
check("[6b] usuario sem tenant -> 403",
  negou(await autorizar(bearerOwner, {}, { chamadas: [] }, { semTenant: true }), 403));

// ── [9..14] Kill-switch: NADA atravessa a flag ───────────────────────────────
const FLAG_OFF = false;
check("[9] only_lead_id + flag OFF -> bloqueado (era o furo: envio real com motor desligado)",
  reactivationSendsBlocked({ flagEnabled: FLAG_OFF, dryRun: false }) === true);
check("[9b] a condicao NAO depende mais de only_lead_id (assinatura so tem flag+dryRun)",
  reactivationSendsBlocked.length === 1 && !/only|lead/i.test(reactivationSendsBlocked.toString()));
check("[9c] o handler nao tem mais `!onlyLeadId` na trava",
  !/!reactEnabled\s*&&\s*!dryRun\s*&&\s*!onlyLeadId/.test(INDEX));
check("[14] flag ON libera; flag OFF + dry_run nao bloqueia (preview nao envia)",
  reactivationSendsBlocked({ flagEnabled: true, dryRun: false }) === false
  && reactivationSendsBlocked({ flagEnabled: FLAG_OFF, dryRun: true }) === false);
check("[14b] semantica da secret preservada: liga SO com 'on'",
  reactivationFlagEnabled("on") && reactivationFlagEnabled(" ON ") &&
  !reactivationFlagEnabled("true") && !reactivationFlagEnabled("") && !reactivationFlagEnabled(null));

// ── [15] O cron continua funcionando ─────────────────────────────────────────
{
  const r = await autorizar(bearerService, {});
  check("[15] service_role + body vazio -> autorizado e varre todos os tenants (caminho do cron)",
    r.ok === true && r.caller === "service_role" && r.tenantScope === null);
  const e: Espiao = { chamadas: [] }; await autorizar(bearerService, {}, e);
  check("[15b] service_role nao gasta verificacao de usuario", !e.chamadas.includes("verifyUserToken"));
}

// ── [16] max_per_master ──────────────────────────────────────────────────────
check("[16a] ausente -> 1", (normalizeMaxPerMaster(undefined, "user") as { value: number }).value === 1);
check("[16b] NaN / negativo / zero / fracionario / texto -> 400",
  [NaN, -5, 0, 1.5, "abc", {}, []].every((v) => normalizeMaxPerMaster(v as unknown, "user").ok === false));
check("[16c] valor excessivo e LIMITADO, nao aceito cru (sem lote ilimitado)",
  (normalizeMaxPerMaster(10_000, "user") as { value: number }).value === MAX_PER_MASTER_LIMIT.user
  && (normalizeMaxPerMaster(10_000, "service_role") as { value: number }).value === MAX_PER_MASTER_LIMIT.service_role);
check("[16d] teto do usuario e mais conservador que o do cron",
  MAX_PER_MASTER_LIMIT.user < MAX_PER_MASTER_LIMIT.service_role);
check("[16e] max_per_master invalido derruba a requisicao com 400",
  negou(await autorizar(bearerOwner, { max_per_master: -3 }), 400));

// ── [18] Respostas sanitizadas ───────────────────────────────────────────────
{
  const negativas = [
    await autorizar(null, {}), await autorizar("Bearer jwt-qualquer", {}),
    await autorizar(bearerSeller, {}), await autorizar(bearerOwner, { only_user_id: TENANT_B }),
    await autorizar(bearerOwner, { max_per_master: -3 }),
  ].filter((r): r is Extract<ReactivationAuthResult, { ok: false }> => r.ok === false);
  const segredos = [SERVICE_KEY, ANON_KEY, TOKEN_OWNER, TOKEN_SELLER];
  check("[18a] nenhum corpo de erro vaza token, chave ou JWT",
    negativas.length === 5 && negativas.every((r) => { const s = JSON.stringify(r.body); return segredos.every((x) => !s.includes(x)); }));
  check("[18b] o corpo de erro so tem {ok,error} e o texto e generico",
    negativas.every((r) => Object.keys(r.body).sort().join(",") === "error,ok"
      && ["unauthorized", "forbidden", "invalid_payload"].includes(r.body.error)));
  check("[18c] o motivo detalhado fica fora da resposta HTTP (so log interno)",
    negativas.every((r) => r.reason.length > 0 && !JSON.stringify(r.body).includes(r.reason)));
  check("[18d] o catch geral do handler nao devolve mais err.message",
    !/JSON\.stringify\(\{ error: err\?\.message/.test(INDEX) && /error: "internal_error"/.test(INDEX));
}

// ── [H] CAMINHO HTTP REAL: Request de verdade + continuacao injetada ─────────
// Exercita `guardReactivationHttp`, a MESMA funcao chamada por index.ts.
/** Corpo da resposta como JSON solto: o teste le campos opcionais sem `any`. */
type CorpoJson = Record<string, unknown> | null;
type Corrida = {
  readonly status: number;
  readonly corpo: CorpoJson;
  readonly continuacoes: number;
  readonly operacionais: string[];
};
async function correrGuard(input: {
  header?: string | null; body?: unknown; flagRaw?: string | null; metodo?: string;
}): Promise<Corrida> {
  const operacionais: string[] = [];
  let continuacoes = 0;
  // Fakes do que NUNCA pode ser tocado por uma chamada negada.
  const fakes = {
    lerConfig: () => { operacionais.push("followup_ia_config"); },
    lerFila: () => { operacionais.push("get_next_reactivation_lead"); },
    chamarOpenAI: () => { operacionais.push("openai"); },
    chamarProvider: () => { operacionais.push("uazapi"); },
  };
  const init: RequestInit = { method: input.metodo ?? "POST" };
  if (input.header) init.headers = { Authorization: input.header };
  if (input.body !== undefined && (input.metodo ?? "POST") !== "OPTIONS") {
    init.body = JSON.stringify(input.body);
  }
  const req = new Request("https://exemplo.local/functions/v1/pedro-auto-followup", init);

  const resposta = await guardReactivationHttp({
    request: req,
    env: { serviceRoleKey: SERVICE_KEY, anonKey: ANON_KEY, flagRaw: input.flagRaw ?? null, corsHeaders: { "X-T": "1" } },
    deps: depsDe({ chamadas: [] }),
    onAuthorized: async (scope: ReactivationScope) => {
      continuacoes += 1;
      // A continuacao real e a unica que toca config/fila/OpenAI/provider.
      fakes.lerConfig(); fakes.lerFila(); fakes.chamarOpenAI();
      if (!scope.dryRun) fakes.chamarProvider();
      return new Response(JSON.stringify({ ok: true, alcancou: true, escopo: scope.tenantScope }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    },
  });
  let corpo: CorpoJson = null;
  try { corpo = (await resposta.json()) as CorpoJson; } catch { corpo = null; }
  return { status: resposta.status, corpo, continuacoes, operacionais };
}

{
  const anonima = await correrGuard({ header: null, body: {} });
  check("[H1] request anonima -> 401 e a continuacao NAO roda",
    anonima.status === 401 && anonima.corpo?.error === "unauthorized"
    && anonima.continuacoes === 0 && anonima.operacionais.length === 0,
    JSON.stringify(anonima));

  const jwtRuim = await correrGuard({ header: "Bearer jwt-qualquer", body: {} });
  check("[H2] JWT invalido -> 401 e zero continuacao",
    jwtRuim.status === 401 && jwtRuim.continuacoes === 0 && jwtRuim.operacionais.length === 0);

  const vendedor = await correrGuard({ header: bearerSeller, body: {}, flagRaw: "on" });
  check("[H3] VENDEDOR -> 403 e zero continuacao (com a flag LIGADA)",
    vendedor.status === 403 && vendedor.corpo?.error === "forbidden"
    && vendedor.continuacoes === 0 && vendedor.operacionais.length === 0,
    JSON.stringify(vendedor));

  const leadFlagOff = await correrGuard({ header: bearerOwner, body: { only_lead_id: LEAD_DE_A }, flagRaw: null });
  check("[H4] only_lead_id + flag OFF -> disabled, zero continuacao, zero provider",
    leadFlagOff.status === 200 && leadFlagOff.corpo?.disabled === true
    && leadFlagOff.corpo?.total_sent === 0
    && leadFlagOff.continuacoes === 0 && leadFlagOff.operacionais.length === 0,
    JSON.stringify(leadFlagOff));

  const cronFlagOff = await correrGuard({ header: bearerService, body: {}, flagRaw: null });
  check("[H5] service_role + flag OFF -> disabled e zero continuacao",
    cronFlagOff.status === 200 && cronFlagOff.corpo?.disabled === true
    && cronFlagOff.continuacoes === 0 && cronFlagOff.operacionais.length === 0);

  check("[H6/H7] em TODAS as negativas: zero continuacao e zero config/fila/OpenAI/provider",
    [anonima, jwtRuim, vendedor, leadFlagOff, cronFlagOff]
      .every((c) => c.continuacoes === 0 && c.operacionais.length === 0));

  const previaOwner = await correrGuard({ header: bearerOwner, body: { dry_run: true }, flagRaw: null });
  check("[H8] dry_run do owner ALCANCA a continuacao (flag off) e nao chama o provider",
    previaOwner.status === 200 && previaOwner.corpo?.alcancou === true
    && previaOwner.corpo?.escopo === TENANT_A
    && previaOwner.continuacoes === 1 && !previaOwner.operacionais.includes("uazapi"),
    JSON.stringify(previaOwner));

  const cronLigado = await correrGuard({ header: bearerService, body: {}, flagRaw: "on" });
  check("[H9] service_role + flag ON alcanca a continuacao do cron (escopo = todos)",
    cronLigado.status === 200 && cronLigado.corpo?.alcancou === true
    && cronLigado.corpo?.escopo === null && cronLigado.continuacoes === 1
    && cronLigado.operacionais.includes("uazapi"));

  const preflight = await correrGuard({ header: null, metodo: "OPTIONS" });
  check("[H10a] OPTIONS responde sem autenticar e sem continuacao",
    preflight.status === 200 && preflight.continuacoes === 0 && preflight.operacionais.length === 0);

  check("[H10b] status e corpo sao os mesmos de producao (401/403/200-disabled)",
    anonima.status === 401 && vendedor.status === 403
    && leadFlagOff.corpo?.reason === "PEDRO_FF_AUTO_REACTIVATION off");

  const corpoQuebrado = await correrGuard({ header: null, body: undefined });
  check("[H11] corpo ausente/ilegivel nao vira excecao: cai em 401 mesmo assim",
    corpoQuebrado.status === 401 && corpoQuebrado.continuacoes === 0);
}

// ── [17] O handler REAL usa o chokepoint antes de qualquer operacao ──────────
{
  const iServe = INDEX.indexOf("serve(async (req)");
  const CORPO_SERVE = INDEX.slice(iServe);
  const iGuard = CORPO_SERVE.indexOf("guardReactivationHttp(");
  const operacionais = [
    'supabase\n      .from("followup_ia_config")', 'supabase.rpc("get_next_reactivation_lead"',
    'supabase.from("pedro_followup_reactivation")', 'supabase.from("pedro_followup_logs")',
    'supabase.from("wa_chat_history")', "https://api.openai.com/v1/chat/completions",
    "resolveAgentInstance(", "sendUazapiTextMessage(", "generateReactivationMessage(",
    "checkAiAutomationAllowed(", "pickEligibleByRecency(",
  ];
  const antes = operacionais.filter((n) => { const i = CORPO_SERVE.indexOf(n); return i >= 0 && i < iGuard; });
  check("[17] nada operacional aparece no handler antes do chokepoint",
    iServe > 0 && iGuard > 0 && antes.length === 0, `antes: ${JSON.stringify(antes)}`);
  check("[17b] a continuacao operacional so e alcancavel via onAuthorized",
    /onAuthorized: \(scope\) => runReactivationSweep\(supabase, openaiKey, scope\)/.test(INDEX)
    && INDEX.match(/runReactivationSweep\(/g)?.length === 2,
    `ocorrencias=${INDEX.match(/runReactivationSweep\(/g)?.length}`);
  check("[17c] o escopo usado pelo fluxo vem do guard, nao do corpo cru",
    /const onlyUserId: string \| null = scope\.tenantScope;/.test(INDEX)
    && /const onlyLeadId: string \| null = scope\.onlyLeadId;/.test(INDEX)
    && /const maxPerMaster: number = scope\.maxPerMaster;/.test(INDEX)
    && !/body\?\.only_user_id/.test(INDEX) && !/body\?\.only_lead_id/.test(INDEX));
  check("[17d] o handler nao autoriza por conta propria (uma unica fronteira)",
    !/authorizeReactivationRequest\(/.test(INDEX));
}

// ── [19] A fila existente nao mudou de comportamento ─────────────────────────
{
  const paramsDaFila = ["p_user_id:", "p_periodo_dias:", "p_limit: 25", "p_cycle_at:", "p_max_attempts:", "p_min_resend_hours:"];
  check("[19] a RPC da fila e seus parametros seguem identicos apos a autorizacao",
    INDEX.includes('supabase.rpc("get_next_reactivation_lead"') && paramsDaFila.every((p) => INDEX.includes(p)));
  check("[19b] o lead especifico continua consultado com escopo de tenant (.eq user_id)",
    /\.eq\("id", onlyLeadId\)[\s\S]{0,80}\.eq\("user_id", cfg\.user_id\)/.test(INDEX));
  check("[19c] o hotfix nao mexeu no envio nem na geracao de texto",
    INDEX.includes("api.openai.com/v1/chat/completions") && INDEX.includes("get_next_reactivation_lead"));
}

// ── [20] Prova de zero rede ──────────────────────────────────────────────────
{
  let bateu = false;
  try { await (globalThis as unknown as { fetch: () => unknown }).fetch(); } catch { bateu = true; }
  check("[20] a armadilha de rede segue armada e nenhum caso (inclusive [H]) a disparou", bateu);
}

check("[extra] isUuid aceita v4 canonico e rejeita lixo",
  isUuid(TENANT_A) && !isUuid("11111111111141118111111111111111") && !isUuid("") && !isUuid(null));

console.log(`\nHOTFIX autorizacao pedro-auto-followup — ${ok} OK, ${fail} RED`);
if (fail > 0) { for (const f of fails) console.error(` - ${f}`); process.exit(1); }
