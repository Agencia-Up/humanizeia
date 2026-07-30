// ============================================================================
// ETAPA 1 — testes determinísticos do roteamento de disparo automático.
//
// Roda de QUALQUER diretório: as paths são resolvidas a partir do próprio
// arquivo (import.meta.url), nunca do cwd.
//   node scripts/tests/campaign_sender_eligibility.test.mjs
//   node /caminho/absoluto/campaign_sender_eligibility.test.mjs
//
// Sem rede, sem banco, sem aleatoriedade: o módulo TS é bundlado com esbuild e
// exercitado com casos fixos.
// ============================================================================
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..", "..");            // scripts/tests -> raiz do repo
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
const VEND   = { ...base, id: "vend-1",   seller_member_id: "membro-123" };
const VEND2  = { ...base, id: "vend-2",   seller_member_id: "membro-456" };
const AGENTE = { ...base, id: "ia-1",     seller_member_id: null, purpose: "agent" };
const BULK   = { ...base, id: "bulk-1",   seller_member_id: null, purpose: "bulk_sender" };

const CAMP_MASTER = { id: "c-master", seller_member_id: null, instance_id: null };
const CAMP_VEND   = { id: "c-vend",   seller_member_id: "membro-123", instance_id: null };

console.log("\n— Elegibilidade —");
t("vendedor nunca é elegível", campaignSenderIneligibility(VEND) === "seller_instance");
t("vendedor bloqueado mesmo marcado bulk_sender", !isEligibleCampaignSender({ ...VEND, purpose: "bulk_sender" }));
t("vendedor bloqueado no modo estrito", !isEligibleCampaignSender(VEND, { requireExplicitBulkSender: true }));
t("linha agent nunca é elegível", campaignSenderIneligibility(AGENTE) === "ai_agent_line");
t("master NULL elegível hoje (compatibilidade)", isEligibleCampaignSender(MASTER));
t("master NULL inelegível no modo estrito",
  campaignSenderIneligibility(MASTER, { requireExplicitBulkSender: true }) === "bulk_sender_required");
t("desconectada bloqueada", campaignSenderIneligibility({ ...MASTER, status: "disconnected" }) === "not_connected");
t("inativa bloqueada", campaignSenderIneligibility({ ...MASTER, is_active: false }) === "not_active");
t("shadow_ban bloqueada", campaignSenderIneligibility({ ...MASTER, shadow_ban_suspect: true }) === "shadow_ban_suspect");
t("quarentena futura bloqueada",
  campaignSenderIneligibility({ ...MASTER, quarantine_until: "2030-01-01T00:00:00Z" }, { now: new Date("2026-07-30T00:00:00Z") }) === "quarantined");
t("quarentena vencida não bloqueia",
  isEligibleCampaignSender({ ...MASTER, quarantine_until: "2026-01-01T00:00:00Z" }, { now: new Date("2026-07-30T00:00:00Z") }));
t("saúde baixa bloqueada", campaignSenderIneligibility({ ...MASTER, health_score: 10 }) === "unhealthy");
t("purpose manual/test bloqueados",
  ["manual", "test"].every((p) => !isEligibleCampaignSender({ ...MASTER, purpose: p })));
t("'sync_only' NÃO é usado (o CHECK do banco não aceita)",
  JSON.stringify(campaignSenderIneligibility({ ...MASTER, purpose: "sync_only" })) === '"purpose_not_allowed"');
t("nulo é fail-closed", !isEligibleCampaignSender(null) && !isEligibleCampaignSender(undefined));

console.log("\n1) Campanha do VENDEDOR é roteada para linha oficial (não bloqueada)");
{
  const d = decideCampaignSender(CAMP_VEND, [VEND, VEND2, AGENTE, BULK, MASTER]);
  t("ação = enviar (não bloqueia)", d.action === "send");
  t("marcada como pertencente ao vendedor", d.ownedBySeller === true);
  t("pool não contém nenhum número de vendedor", d.pool.every((i) => !i.seller_member_id));
  t("pool não contém a linha agent", d.pool.every((i) => i.purpose !== "agent"));
  t("pool = master + bulk_sender", d.pool.length === 2);
}

console.log("\n2) Nenhuma campanha automática usa número de vendedor");
{
  const dm = decideCampaignSender(CAMP_MASTER, [VEND, MASTER]);
  t("campanha master não pega vendedor", dm.action === "send" && dm.pool.every((i) => !i.seller_member_id));
  const dv = decideCampaignSender(CAMP_VEND, [VEND, MASTER]);
  t("campanha de vendedor não pega o próprio número", dv.action === "send" && dv.pool.every((i) => i.id !== "vend-1"));
}

console.log("\n3) Linha agent nunca é usada");
t("conta só com agent => estaciona", decideCampaignSender(CAMP_MASTER, [AGENTE]).action === "park");

console.log("\n4) Sem remetente elegível => item recuperável, sem failed");
{
  const d = decideCampaignSender(CAMP_VEND, [VEND, VEND2, AGENTE]);
  t("ação = estacionar", d.action === "park");
  t("motivo estável", d.reason === "no_eligible_campaign_sender");
  t("não penaliza: dono continua sendo o vendedor", d.ownedBySeller === true);
  t("bulk_sender desconectado => estaciona",
    decideCampaignSender(CAMP_MASTER, [{ ...BULK, status: "disconnected" }]).action === "park");
  t("bulk_sender sem saúde => estaciona",
    decideCampaignSender(CAMP_MASTER, [{ ...BULK, health_score: 5 }]).action === "park");
}

console.log("\n5) instance_id antigo apontando para vendedor é tratado");
{
  const d = decideCampaignSender({ ...CAMP_MASTER, instance_id: "vend-1" }, [VEND, BULK]);
  t("não trava a fila (segue enviando)", d.action === "send");
  t("pin é ignorado e sinalizado", d.pinIgnored === true);
  t("usa a linha oficial, não a do vendedor", d.pool.every((i) => i.id === "bulk-1"));
  const d2 = decideCampaignSender({ ...CAMP_MASTER, instance_id: "bulk-1" }, [VEND, BULK, MASTER]);
  t("pin válido é respeitado", d2.action === "send" && d2.pool.length === 1 && d2.pool[0].id === "bulk-1" && d2.pinIgnored === false);
  const d3 = decideCampaignSender({ ...CAMP_MASTER, instance_id: "vend-1" }, [VEND]);
  t("pin inelegível + sem pool => estaciona", d3.action === "park");
}

console.log("\n6) Isolamento entre contas (pool já chega por tenant)");
t("pool de A só tem instância de A",
  decideCampaignSender(CAMP_MASTER, [{ ...MASTER, id: "a1", user_id: "A" }]).pool.every((i) => i.user_id === "A"));
t("instância de B não aparece no pool de A",
  decideCampaignSender(CAMP_MASTER, [{ ...MASTER, id: "a1", user_id: "A" }]).pool.every((i) => i.id !== "b1"));

console.log("\n7) Modo estrito futuro");
{
  const d = decideCampaignSender(CAMP_MASTER, [MASTER, BULK], { requireExplicitBulkSender: true });
  t("só bulk_sender passa", d.action === "send" && d.pool.length === 1 && d.pool[0].id === "bulk-1");
  t("sem bulk_sender => estaciona",
    decideCampaignSender(CAMP_MASTER, [MASTER], { requireExplicitBulkSender: true }).action === "park");
}

console.log("\n— PLANO DE DESPACHO DO ITEM (o que o processador consome) —");
{
  const ITEM_CAMP = { id: "q1", campaign_id: "c-vend", instance_id: null };
  const ITEM_SEM = { id: "q2", campaign_id: null, instance_id: "vend-1" };

  // 1) pin em número de vendedor + linha oficial disponível => envia pela oficial
  const p1 = planQueueItemDispatch(ITEM_CAMP, { ...CAMP_VEND, instance_id: "vend-1" }, [VEND, BULK]);
  t("pin de vendedor: envia (não trava)", p1.kind === "send");
  t("pin de vendedor: effectiveInstanceId vira null", p1.effectiveInstanceId === null);
  t("pin de vendedor: pool é a linha oficial", p1.pool.length === 1 && p1.pool[0].id === "bulk-1");
  t("pin de vendedor: sinalizado", p1.pinIgnored === true);
  t("pin de vendedor: campanha segue do vendedor", p1.ownedBySeller === true);

  const p2 = planQueueItemDispatch(ITEM_CAMP, { ...CAMP_MASTER, instance_id: "bulk-1" }, [VEND, BULK, MASTER]);
  t("pin válido: repassado ao seletor", p2.kind === "send" && p2.effectiveInstanceId === "bulk-1");
  t("pin válido: pool restrito a ele", p2.pool.length === 1 && p2.pool[0].id === "bulk-1");

  // 2) lista VAZIA e lista SEM elegível caem no MESMO caminho: park
  t("lista vazia => park", planQueueItemDispatch(ITEM_CAMP, CAMP_VEND, []).kind === "park");
  t("lista nula => park", planQueueItemDispatch(ITEM_CAMP, CAMP_VEND, null).kind === "park");
  t("só vendedor => park", planQueueItemDispatch(ITEM_CAMP, CAMP_VEND, [VEND, VEND2]).kind === "park");
  t("só agent => park", planQueueItemDispatch(ITEM_CAMP, CAMP_MASTER, [AGENTE]).kind === "park");
  t("park preserva dono vendedor (não penaliza)",
    planQueueItemDispatch(ITEM_CAMP, CAMP_VEND, [VEND]).ownedBySeller === true);

  // 3) item SEM campanha: política de campanha NÃO se aplica
  const p3 = planQueueItemDispatch(ITEM_SEM, null, [VEND, MASTER]);
  t("sem campanha: fora da política", p3.kind === "no_campaign");
  t("sem campanha: preserva instance_id do item", p3.pinnedInstanceId === "vend-1");
  t("sem campanha: pool intacto (regra antiga)", p3.pool.length === 2);
  t("sem campanha e conta só com vendedor: não estaciona",
    planQueueItemDispatch(ITEM_SEM, null, [VEND]).kind === "no_campaign");
  t("campaign_id órfão (campanha não carregada): trata como sem campanha",
    planQueueItemDispatch({ ...ITEM_SEM, campaign_id: "sumiu" }, null, [MASTER]).kind === "no_campaign");

  // 4) vendedor e agent nunca enviam campanha, em nenhum plano
  const p4 = planQueueItemDispatch(ITEM_CAMP, CAMP_VEND, [VEND, VEND2, AGENTE, MASTER, BULK]);
  t("nenhum vendedor no pool final", p4.pool.every((i) => !i.seller_member_id));
  t("nenhuma linha agent no pool final", p4.pool.every((i) => i.purpose !== "agent"));
}

console.log("\n— CRIAÇÃO DE CAMPANHA (save-campaign usa a MESMA regra do worker) —");
{
  const strict = { requireExplicitBulkSender: true };
  t("vendedor não cria campanha com o próprio número",
    campaignSenderIneligibility(VEND) === "seller_instance");
  t("agente não é elegível como remetente",
    campaignSenderIneligibility(AGENTE) === "ai_agent_line");
  t("manual não é elegível",
    campaignSenderIneligibility({ ...MASTER, purpose: "manual" }) === "purpose_not_allowed");
  t("test não é elegível",
    campaignSenderIneligibility({ ...MASTER, purpose: "test" }) === "purpose_not_allowed");
  t("master purpose=NULL só passa no modo compatível",
    isEligibleCampaignSender(MASTER) && !isEligibleCampaignSender(MASTER, strict));
  t("bulk_sender passa nos dois modos",
    isEligibleCampaignSender(BULK) && isEligibleCampaignSender(BULK, strict));
  t("desconectada/inativa/quarentena/saúde bloqueiam na criação também",
    [{ ...BULK, status: "disconnected" }, { ...BULK, is_active: false },
     { ...BULK, shadow_ban_suspect: true }, { ...BULK, health_score: 1 }]
      .every((i) => !isEligibleCampaignSender(i)));
}

console.log("\n— FLUXOS QUE NÃO PODEM SER AFETADOS —");
{
  // Mensagem manual do vendedor, follow-up sem campanha, inbox e realtime não
  // passam pelo plano de campanha: item sem campaign_id sai por "no_campaign",
  // preservando a regra antiga e o instance_id do próprio item (o do vendedor).
  const manual = planQueueItemDispatch({ id: "m1", campaign_id: null, instance_id: "vend-1" }, null, [VEND]);
  t("mensagem manual do vendedor: fora da política de campanha", manual.kind === "no_campaign");
  t("mensagem manual do vendedor: mantém o número dele", manual.pinnedInstanceId === "vend-1");
  t("follow-up sem campanha: pool não é filtrado pela política",
    planQueueItemDispatch({ id: "f1", campaign_id: null, instance_id: null }, null, [VEND, AGENTE]).pool.length === 2);
}

console.log(`\n${ok} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
