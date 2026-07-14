import { createHash } from "node:crypto";

import { loadServiceEnv } from "./real-harness.ts";

const SOURCE_AGENT_ID = "aee7e916-31b1-431c-ba6f-f38178fd4899";
const TIME_ZONE_OFFSET = "-03:00";

type HistoryRow = {
  id: string;
  remote_jid: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`ENV_${name}_MISSING`);
  return value;
}

function contactAlias(remoteJid: string): string {
  return `contato-${createHash("sha256").update(remoteJid).digest("hex").slice(0, 8)}`;
}

function hasAd(metadata: Record<string, unknown> | null): boolean {
  return !!metadata && !!(metadata.ctwa_ad ?? metadata.ad_context ?? metadata.externalAdReply);
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function adLabel(metadata: Record<string, unknown> | null): string {
  const raw = metadata?.ctwa_ad ?? metadata?.ad_context ?? metadata?.externalAdReply;
  if (!raw || typeof raw !== "object") return "-";
  const ad = raw as Record<string, unknown>;
  return compact([ad.title, ad.body, ad.greetingMessageBody ?? ad.greeting].filter((value) => typeof value === "string").join(" | ")) || "-";
}

async function main(): Promise<void> {
  loadServiceEnv();
  const day = process.env.V2_AUDIT_DAY?.trim() || new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const start = new Date(`${day}T00:00:00${TIME_ZONE_OFFSET}`).toISOString();
  const endDate = new Date(`${day}T00:00:00${TIME_ZONE_OFFSET}`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString();
  const params = new URLSearchParams({
    select: "id,remote_jid,role,content,metadata,created_at",
    agent_id: `eq.${SOURCE_AGENT_ID}`,
    created_at: `gte.${start}`,
    order: "created_at.asc",
    limit: "5000",
  });
  params.append("created_at", `lt.${end}`);
  const url = `${requiredEnv("SUPABASE_URL")}/rest/v1/wa_chat_history?${params}`;
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(url, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`REST_${response.status}:${await response.text()}`);
  const rows = await response.json() as HistoryRow[];
  const grouped = new Map<string, HistoryRow[]>();
  for (const row of rows) grouped.set(row.remote_jid, [...(grouped.get(row.remote_jid) ?? []), row]);

  const summaries = [...grouped.entries()].map(([jid, turns]) => ({
    alias: contactAlias(jid),
    turns,
    userTurns: turns.filter((turn) => turn.role === "user").length,
    assistantTurns: turns.filter((turn) => turn.role === "assistant").length,
    hasAd: turns.some((turn) => hasAd(turn.metadata)),
  })).filter((item) => item.userTurns > 0)
    .sort((a, b) => Number(b.hasAd) - Number(a.hasAd) || b.userTurns - a.userTurns);

  process.stdout.write(`Dia ${day}: ${rows.length} mensagens, ${summaries.length} conversas\n`);
  for (const item of summaries.slice(0, 30)) {
    const firstUser = item.turns.find((turn) => turn.role === "user");
    const lastUser = [...item.turns].reverse().find((turn) => turn.role === "user");
    process.stdout.write([
      item.alias,
      `ad=${item.hasAd ? "sim" : "nao"}`,
      `lead=${item.userTurns}`,
      `agente=${item.assistantTurns}`,
      `inicio=${firstUser ? compact(firstUser.content) : "-"}`,
      `fim=${lastUser ? compact(lastUser.content) : "-"}`,
    ].join(" | ") + "\n");
  }
  if (process.env.V2_AUDIT_VERBOSE === "1") {
    for (const item of summaries.filter((summary) => summary.hasAd).slice(0, 3)) {
      process.stdout.write(`\n### ${item.alias}\n`);
      const adTurn = item.turns.find((turn) => hasAd(turn.metadata));
      process.stdout.write(`ANUNCIO: ${adLabel(adTurn?.metadata ?? null)}\n`);
      for (const turn of item.turns) {
        process.stdout.write(`${new Date(turn.created_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })} ${turn.role.toUpperCase()}: ${compact(turn.content)}\n`);
      }
    }
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
