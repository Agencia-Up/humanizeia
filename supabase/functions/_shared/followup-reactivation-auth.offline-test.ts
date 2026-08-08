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
// Zero rede: as dependencias de I/O sao injetadas e `fetch` global e armadilha.
//
//   npx tsx supabase/functions/_shared/followup-reactivation-auth.offline-test.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  authorizeReactivationRequest, parseBearerToken, normalizeMaxPerMaster,
  reactivationSendsBlocked, reactivationFlagEnabled, isUuid, MAX_PER_MASTER_LIMIT,
  type ReactivationAuthDeps, type ReactivationAuthResult,
} from "./followup-reactivation-auth.ts";

let ok = 0, fail = 0; const fails: string[] = [];
function check(name: string, pass: boolean, detail = ""): void {
  if (pass) { ok++; console.log(`  OK  ${name}`); }
  else { fail++; fails.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  RED ${name}${detail ? ` — ${detail}` : ""}`); }
}

// [20] Nenhuma chamada real de rede. Qualquer fetch neste processo e falha dura.
const globalAny = globalThis as unknown as { fetch?: unknown };
globalAny.fetch = () => { throw new Error("REDE PROIBIDA NO GATE OFFLINE"); };

const SERVICE_KEY = "service-role-key-FALSA-para-teste";
const ANON_KEY = "anon-key-FALSA-para-teste";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LEAD_DE_A = "33333333-3333-4333-8333-333333333333";
const LEAD_DE_B = "44444444-4444-4444-8444-444444444444";
const USER_DE_A = "55555555-5555-4555-8555-555555555555";

/** Registra toda consulta feita, para provar que nada operacional roda numa negativa. */
type Espiao = { chamadas: string[] };
function depsDe(espiao: Espiao, opts?: { tokenValido?: string; semTenant?: boolean }): ReactivationAuthDeps {
  return {
    verifyUserToken: async (token) => {
      espiao.chamadas.push(`verifyUserToken`);
      return token === (opts?.tokenValido ?? "jwt-do-usuario-A") ? USER_DE_A : null;
    },
    resolveTenantForUser: async (userId) => {
      espiao.chamadas.push(`resolveTenantForUser`);
      if (opts?.semTenant) return null;
      return userId === USER_DE_A ? TENANT_A : null;
    },
    resolveLeadOwner: async (leadId) => {
      espiao.chamadas.push(`resolveLeadOwner`);
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
const bearerUsuario = "Bearer jwt-do-usuario-A";
const bearerService = `Bearer ${SERVICE_KEY}`;

const negou = (r: ReactivationAuthResult, status: number): boolean => r.ok === false && r.status === status;

// ── [1] OPTIONS passa sem executar logica (checagem estrutural no handler) ────
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(path.join(AQUI, "..", "pedro-auto-followup", "index.ts"), "utf8");
{
  const iOptions = INDEX.indexOf('req.method === "OPTIONS"');
  const iAuth = INDEX.indexOf("authorizeReactivationRequest(");
  check("[1] OPTIONS responde antes da autorizacao (preflight de CORS nao autentica)",
    iOptions > 0 && iAuth > iOptions, `options=${iOptions} auth=${iAuth}`);
}

// ── [2..5] Quem nao se identifica nao entra ──────────────────────────────────
check("[2] sem Authorization -> 401", negou(await autorizar(null, {}), 401));
check("[3] Bearer vazio -> 401", negou(await autorizar("Bearer   ", {}), 401));
check("[4] JWT invalido -> 401", negou(await autorizar("Bearer jwt-qualquer", {}), 401));
check("[5a] anon key -> 401 (e publica; nao identifica ninguem)", negou(await autorizar(`Bearer ${ANON_KEY}`, {}), 401));
{
  // Mesmo sem conhecer a anon key, um token de papel anon nao resolve usuario.
  const r = await authorizeReactivationRequest(depsDe({ chamadas: [] }), {
    authorizationHeader: `Bearer ${ANON_KEY}`, body: {}, serviceRoleKey: SERVICE_KEY, anonKey: null,
  });
  check("[5b] anon key sem allowlist tambem cai (verifyUserToken nao devolve usuario)", negou(r, 401));
}
check("[2b] header sem o esquema Bearer -> 401", negou(await autorizar("jwt-do-usuario-A", {}), 401));
check("[2c] parseBearerToken rejeita vazio/ausente/malformado",
  parseBearerToken(null) === null && parseBearerToken("Bearer") === null && parseBearerToken("Basic x") === null
  && parseBearerToken("Bearer  abc ") === "abc");

// ── [6..8] Escopo de tenant ──────────────────────────────────────────────────
{
  const r = await autorizar(bearerUsuario, {});
  check("[6] usuario autenticado fica preso ao PROPRIO tenant (nunca varre todos)",
    r.ok === true && r.caller === "user" && r.tenantScope === TENANT_A,
    JSON.stringify(r));
}
check("[7] cross-tenant por only_user_id -> 403",
  negou(await autorizar(bearerUsuario, { only_user_id: TENANT_B }), 403));
check("[7b] only_user_id do PROPRIO tenant e aceito",
  (await autorizar(bearerUsuario, { only_user_id: TENANT_A })).ok === true);
check("[8] cross-tenant por only_lead_id -> 403",
  negou(await autorizar(bearerUsuario, { only_lead_id: LEAD_DE_B }), 403));
check("[8b] only_lead_id do proprio tenant e aceito e ancora o escopo",
  await (async () => { const r = await autorizar(bearerUsuario, { only_lead_id: LEAD_DE_A });
    return r.ok === true && r.tenantScope === TENANT_A && r.onlyLeadId === LEAD_DE_A; })());
check("[8c] lead inexistente -> 403 fail-closed (nunca 'tenta em todos os tenants')",
  negou(await autorizar(bearerUsuario, { only_lead_id: "99999999-9999-4999-8999-999999999999" }), 403));
check("[8d] only_lead_id ANCORA o escopo ate para service_role (nao alarga a varredura)",
  await (async () => { const r = await autorizar(bearerService, { only_lead_id: LEAD_DE_B });
    return r.ok === true && r.caller === "service_role" && r.tenantScope === TENANT_B; })());
check("[8e] only_lead_id que nao e UUID -> 400",
  negou(await autorizar(bearerUsuario, { only_lead_id: "nao-e-uuid" }), 400));
check("[6b] usuario sem tenant -> 403",
  negou(await autorizar(bearerUsuario, {}, { chamadas: [] }, { semTenant: true }), 403));

// ── [9..11][13][14] Kill-switch: NADA atravessa a flag ───────────────────────
const FLAG_OFF = false;
check("[9] only_lead_id + flag OFF -> bloqueado (era o furo: envio real com motor desligado)",
  reactivationSendsBlocked({ flagEnabled: FLAG_OFF, dryRun: false }) === true);
check("[10] only_user_id + flag OFF -> bloqueado",
  reactivationSendsBlocked({ flagEnabled: FLAG_OFF, dryRun: false }) === true);
check("[11] body vazio + flag OFF -> bloqueado",
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

// ── [12][13] dry_run ─────────────────────────────────────────────────────────
check("[12] dry_run anonimo -> 401 (preview tambem exige identidade)",
  negou(await autorizar(null, { dry_run: true }), 401));
{
  const r = await autorizar(bearerUsuario, { dry_run: true });
  check("[13] dry_run autenticado -> permitido, no proprio tenant, e sem envio",
    r.ok === true && r.dryRun === true && r.tenantScope === TENANT_A
    && reactivationSendsBlocked({ flagEnabled: FLAG_OFF, dryRun: r.dryRun }) === false);
}

// ── [15] O cron continua funcionando ─────────────────────────────────────────
{
  const r = await autorizar(bearerService, {});
  check("[15] service_role + body vazio -> autorizado e varre todos os tenants (caminho do cron)",
    r.ok === true && r.caller === "service_role" && r.tenantScope === null);
  check("[15b] service_role nao gasta verificacao de usuario",
    await (async () => { const e: Espiao = { chamadas: [] }; await autorizar(bearerService, {}, e);
      return !e.chamadas.includes("verifyUserToken"); })());
}

// ── [16] max_per_master ──────────────────────────────────────────────────────
check("[16a] ausente -> 1", normalizeMaxPerMaster(undefined, "user").ok === true
  && (normalizeMaxPerMaster(undefined, "user") as { value: number }).value === 1);
check("[16b] NaN / negativo / zero / fracionario / texto -> 400",
  [NaN, -5, 0, 1.5, "abc", {}, []].every((v) => normalizeMaxPerMaster(v as unknown, "user").ok === false));
check("[16c] valor excessivo e LIMITADO, nao aceito cru (sem lote ilimitado)",
  (normalizeMaxPerMaster(10_000, "user") as { value: number }).value === MAX_PER_MASTER_LIMIT.user
  && (normalizeMaxPerMaster(10_000, "service_role") as { value: number }).value === MAX_PER_MASTER_LIMIT.service_role);
check("[16d] teto do usuario e mais conservador que o do cron",
  MAX_PER_MASTER_LIMIT.user < MAX_PER_MASTER_LIMIT.service_role);
check("[16e] max_per_master invalido derruba a requisicao com 400",
  negou(await autorizar(bearerUsuario, { max_per_master: -3 }), 400));

// ── [17] Autorizacao ANTES da primeira consulta operacional ──────────────────
{
  // Ordem de EXECUCAO, nao ordem textual do arquivo: helpers (gerarMensagem, envio)
  // sao DEFINIDOS antes do handler mas so rodam quando chamados. Por isso a janela
  // analisada comeca no corpo do handler.
  const iServe = INDEX.indexOf("serve(async (req)");
  const CORPO = INDEX.slice(iServe);
  const iAuth = CORPO.indexOf("authorizeReactivationRequest(");
  const iGuard = CORPO.indexOf("if (!auth.ok)");
  // Operacional = o que o auditor listou: config, leads, instancia, OpenAI, fila/log, UazAPI.
  const operacionais = [
    'supabase\n      .from("followup_ia_config")', 'supabase.rpc("get_next_reactivation_lead"',
    'supabase.from("pedro_followup_reactivation")', 'supabase.from("pedro_followup_logs")',
    'supabase.from("wa_chat_history")', "https://api.openai.com/v1/chat/completions",
    // Helpers reais do arquivo: resolucao de instancia, envio UazAPI, geracao de
    // texto pela OpenAI, gate de automacao e selecao de lead.
    "resolveAgentInstance(", "sendUazapiTextMessage(", "generateReactivationMessage(",
    "checkAiAutomationAllowed(", "pickEligibleByRecency(",
  ];
  const antes = operacionais.filter((needle) => {
    const i = CORPO.indexOf(needle);
    return i >= 0 && i < iGuard;
  });
  check("[17] nenhuma consulta/efeito operacional roda antes do portao de autorizacao",
    iServe > 0 && iAuth > 0 && iGuard > iAuth && antes.length === 0,
    `antes do portao: ${JSON.stringify(antes)}`);
  check("[17b] a negativa retorna imediatamente (nao ha caminho que siga apos !auth.ok)",
    /if \(!auth\.ok\) \{[\s\S]{0,400}?return new Response/.test(INDEX));
  check("[17c] o escopo usado pelo fluxo vem do resultado autorizado, nao do corpo cru",
    /const onlyUserId: string \| null = auth\.tenantScope;/.test(INDEX)
    && /const onlyLeadId: string \| null = auth\.onlyLeadId;/.test(INDEX)
    && /const maxPerMaster: number = auth\.maxPerMaster;/.test(INDEX)
    && !/body\?\.only_user_id/.test(INDEX) && !/body\?\.only_lead_id/.test(INDEX));
}

// ── [18] Respostas sanitizadas ───────────────────────────────────────────────
{
  const negativas = [
    await autorizar(null, {}), await autorizar("Bearer jwt-qualquer", {}),
    await autorizar(bearerUsuario, { only_user_id: TENANT_B }),
    await autorizar(bearerUsuario, { max_per_master: -3 }),
  ].filter((r): r is Extract<ReactivationAuthResult, { ok: false }> => r.ok === false);
  const segredos = [SERVICE_KEY, ANON_KEY, "jwt-do-usuario-A"];
  check("[18a] nenhum corpo de erro vaza token, chave ou JWT",
    negativas.every((r) => { const s = JSON.stringify(r.body); return segredos.every((x) => !s.includes(x)); }));
  check("[18b] o corpo de erro so tem {ok,error} e o texto e generico",
    negativas.every((r) => {
      const chaves = Object.keys(r.body).sort().join(",");
      return chaves === "error,ok" && ["unauthorized", "forbidden", "invalid_payload"].includes(r.body.error);
    }));
  check("[18c] o motivo detalhado fica fora da resposta HTTP (so log interno)",
    negativas.every((r) => typeof r.reason === "string" && r.reason.length > 0
      && !JSON.stringify(r.body).includes(r.reason)));
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
  check("[20] a armadilha de rede esta armada e nenhum caso a disparou", bateu);
}

check("[extra] isUuid aceita v4 canonico e rejeita lixo",
  isUuid(TENANT_A) && !isUuid("11111111111141118111111111111111") && !isUuid("") && !isUuid(null));

console.log(`\nHOTFIX autorizacao pedro-auto-followup — ${ok} OK, ${fail} RED`);
if (fail > 0) { for (const f of fails) console.error(` - ${f}`); process.exit(1); }
