// ============================================================================
// Remetente de campanha — testes determinísticos do MODELO DO DONO (30/07):
//
//   * campanha de VENDEDOR sai do NÚMERO DELE (proteção anti-ban = limite,
//     intervalo, aquecimento e rodízio — não trocar o remetente);
//   * campanha do MASTER sai de uma linha da conta, NUNCA do número pessoal
//     de um vendedor;
//   * a LINHA DA IA (purpose='agent') nunca faz disparo em massa — se levar
//     ban, o atendimento inteiro da conta para.
//
// Roda de QUALQUER diretório (paths por import.meta.url). Sem rede, sem banco.
//   node scripts/tests/campaign_sender_eligibility.test.mjs
// ============================================================================
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");
const ENTRY = join(RAIZ, "supabase/functions/_shared/campaign/senderEligibility.ts");

const out = join(mkdtempSync(join(tmpdir(), "sender-")), "mod.mjs");
await build({ entryPoints: [ENTRY], bundle: true, format: "esm", outfile: out, platform: "neutral", logLevel: "silent" });
const { campaignSenderIneligibility, isEligibleCampaignSender, selectCampaignSenderPool, decideCampaignSender, planQueueItemDispatch } =
  await import(pathToFileURL(out).href);

let ok = 0, fail = 0;
const t = (nome, cond, extra = "") => {
  if (cond) { ok++; console.log(`  ok    ${nome}`); }
  else { fail++; console.log(`  FALHA ${nome} ${extra}`); }
};

const base = { status: "connected", is_active: true, health_score: 90, purpose: null };
const MASTER = { ...base, id: "master-1", seller_member_id: null };
const BULK   = { ...base, id: "bulk-1", seller_member_id: null, purpose: "bulk_sender" };
const AGENTE = { ...base, id: "ia-1", seller_member_id: null, purpose: "agent" };
const NUM_JOAO  = { ...base, id: "joao-1", seller_member_id: "joao" };
const NUM_LUIZ  = { ...base, id: "luiz-1", seller_member_id: "luiz" };

const CAMP_JOAO   = { id: "c1", seller_member_id: "joao", instance_id: null };
const CAMP_MASTER = { id: "c2", seller_member_id: null, instance_id: null };
const doJoao = { ownerSellerMemberId: "joao" };

console.log("\n1) Campanha do VENDEDOR sai do número DELE");
t("número do João é válido para a campanha do João", isEligibleCampaignSender(NUM_JOAO, doJoao));
t("número do Luiz NÃO serve para a campanha do João",
  campaignSenderIneligibility(NUM_LUIZ, doJoao) === "wrong_owner");
t("linha do master não substitui o número do vendedor",
  campaignSenderIneligibility(MASTER, doJoao) === "wrong_owner");
{
  const d = decideCampaignSender(CAMP_JOAO, [NUM_JOAO, NUM_LUIZ, MASTER, AGENTE, BULK]);
  t("roteia para envio", d.action === "send");
  t("pool = apenas o número do João", d.pool.length === 1 && d.pool[0].id === "joao-1");
}

console.log("\n2) Campanha do MASTER nunca sai do número pessoal de um vendedor");
t("número de vendedor é recusado para campanha do master",
  campaignSenderIneligibility(NUM_JOAO) === "seller_instance");
{
  const d = decideCampaignSender(CAMP_MASTER, [NUM_JOAO, NUM_LUIZ, MASTER, BULK]);
  t("pool não contém nenhum número de vendedor", d.pool.every((i) => !i.seller_member_id));
  t("pool = linhas da conta (master + bulk_sender)", d.pool.length === 2);
  t("conta só com vendedores => estaciona (sem fallback)",
    decideCampaignSender(CAMP_MASTER, [NUM_JOAO, NUM_LUIZ]).action === "park");
}

console.log("\n3) Linha da IA nunca faz disparo em massa");
t("agent recusado na campanha do master", campaignSenderIneligibility(AGENTE) === "ai_agent_line");
t("agent recusado na campanha do vendedor", campaignSenderIneligibility(AGENTE, doJoao) === "ai_agent_line");
t("conta só com a linha da IA => estaciona",
  decideCampaignSender(CAMP_MASTER, [AGENTE]).action === "park");

console.log("\n4) Estado operacional protege o número do vendedor");
for (const [nome, inst, motivo] of [
  ["desconectado", { ...NUM_JOAO, status: "disconnected" }, "not_connected"],
  ["inativo", { ...NUM_JOAO, is_active: false }, "not_active"],
  ["suspeita de shadow ban", { ...NUM_JOAO, shadow_ban_suspect: true }, "shadow_ban_suspect"],
  ["saúde baixa", { ...NUM_JOAO, health_score: 10 }, "unhealthy"],
]) t(`${nome} não dispara`, campaignSenderIneligibility(inst, doJoao) === motivo);
t("quarentena futura bloqueia",
  campaignSenderIneligibility({ ...NUM_JOAO, quarantine_until: "2030-01-01T00:00:00Z" },
    { ...doJoao, now: new Date("2026-07-30T00:00:00Z") }) === "quarantined");
t("quarentena vencida não bloqueia",
  isEligibleCampaignSender({ ...NUM_JOAO, quarantine_until: "2026-01-01T00:00:00Z" },
    { ...doJoao, now: new Date("2026-07-30T00:00:00Z") }));
t("número do vendedor desconectado => estaciona, não falha",
  decideCampaignSender(CAMP_JOAO, [{ ...NUM_JOAO, status: "disconnected" }]).action === "park");

console.log("\n5) Modo estrito só afeta a campanha do MASTER");
{
  const strict = { requireExplicitBulkSender: true };
  t("master purpose=NULL sai do pool no modo estrito",
    campaignSenderIneligibility(MASTER, strict) === "bulk_sender_required");
  t("bulk_sender passa no modo estrito", isEligibleCampaignSender(BULK, strict));
  t("número do vendedor não é afetado pelo modo estrito",
    isEligibleCampaignSender(NUM_JOAO, { ...doJoao, ...strict }));
}

console.log("\n6) Pin da campanha");
{
  const p1 = planQueueItemDispatch({ id: "q1", campaign_id: "c1" }, { ...CAMP_JOAO, instance_id: "luiz-1" }, [NUM_JOAO, NUM_LUIZ]);
  t("pin no número de OUTRO vendedor é ignorado", p1.kind === "send" && p1.pinIgnored === true);
  t("pin inválido não chega ao seletor", p1.effectiveInstanceId === null);
  t("usa o número do dono da campanha", p1.pool.length === 1 && p1.pool[0].id === "joao-1");
  const p2 = planQueueItemDispatch({ id: "q2", campaign_id: "c1" }, { ...CAMP_JOAO, instance_id: "joao-1" }, [NUM_JOAO]);
  t("pin válido é respeitado e repassado", p2.effectiveInstanceId === "joao-1" && p2.pinIgnored === false);
}

console.log("\n7) Itens sem campanha e sem remetente");
{
  const semCamp = planQueueItemDispatch({ id: "m1", campaign_id: null, instance_id: "joao-1" }, null, [NUM_JOAO]);
  t("item sem campanha fica fora da política", semCamp.kind === "no_campaign");
  t("item sem campanha preserva seu instance_id", semCamp.pinnedInstanceId === "joao-1");
  t("lista vazia => estaciona", planQueueItemDispatch({ id: "q3", campaign_id: "c1" }, CAMP_JOAO, []).kind === "park");
  t("lista nula => estaciona", planQueueItemDispatch({ id: "q4", campaign_id: "c1" }, CAMP_JOAO, null).kind === "park");
  t("estacionar preserva a atribuição ao vendedor",
    planQueueItemDispatch({ id: "q5", campaign_id: "c1" }, CAMP_JOAO, []).ownedBySeller === true);
}

console.log("\n8) Isolamento entre contas");
t("pool só contém instância do próprio tenant",
  selectCampaignSenderPool([{ ...MASTER, id: "a1", user_id: "A" }]).every((i) => i.user_id === "A"));
t("candidato nulo é fail-closed", !isEligibleCampaignSender(null) && !isEligibleCampaignSender(undefined));

console.log(`\n${ok} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
