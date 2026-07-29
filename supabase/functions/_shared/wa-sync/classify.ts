// Helpers PUROS da sincronizacao da caixa UAZAPI (testaveis offline, sem rede).
// Autoria por EVIDENCIA (fromMe + assinaturas do v3_effect_outbox), nunca pela
// instancia. Telefone canonico do projeto (logos_phone_key), sem last-8 puro como
// identidade (a dedup real e por provider_message_id).

export const digits = (s: unknown) => String(s ?? "").replace(/[^0-9]/g, "");

// phone_canonical = digitos completos do JID (mesma fonte/formato do webhook).
export const phoneCanonical = (jidOrPhone: unknown) => digits(String(jidOrPhone ?? "").split("@")[0]);

// Chave canonica do projeto: DDD + ultimos 8 (espelha public.logos_phone_key).
export function logosPhoneKey(raw: unknown): string {
  const d = digits(raw);
  const nat = d.length > 11 && d.slice(0, 2) === "55" ? d.slice(2) : d;
  if (nat.length >= 10 && nat.length <= 11) return nat.slice(0, 2) + nat.slice(-8);
  if (nat.length >= 8) return nat.slice(-8);
  return nat;
}

export function isGroupOrSpecial(chat: any): boolean {
  const jid = String(chat?.wa_chatid || chat?.id || "");
  return chat?.wa_isGroup === true || jid.endsWith("@g.us") || jid.endsWith("@broadcast")
    || jid.endsWith("@newsletter") || jid.includes("status@") || jid.startsWith("status");
}

export function mapMessageType(t: unknown): string {
  const s = String(t || "").toLowerCase();
  if (s.includes("image")) return "image";
  if (s.includes("audio") || s.includes("ptt")) return "audio";
  if (s.includes("video")) return "video";
  if (s.includes("document")) return "document";
  if (s.includes("sticker")) return "sticker";
  return "text";
}

export const msgTs = (m: any): number => {
  const n = Number(m?.messageTimestamp ?? m?.timestamp ?? 0);
  return n > 1e12 ? n : n * 1000; // aceita s ou ms
};

// Assinaturas do que o V3 enviou, por chave de telefone: [{ b: minuteBucket, t: text }]
export type V3Sig = { b: number; t: string };

// Autoria por evidencia:
//  - fromMe=false -> cliente (incoming)
//  - fromMe=true  -> ia_v3 se casar assinatura do V3 (+-1 min); senao humano_manual
export function classifyActor(m: any, phoneKey: string, v3map: Map<string, V3Sig[]>): { actor: string; dir: string } {
  if (m?.fromMe === false) return { actor: "cliente", dir: "incoming" };
  const list = v3map.get(phoneKey);
  if (list && list.length) {
    const bucket = Math.floor(msgTs(m) / 60000);
    const txt = String(m?.text || m?.content || "").toLowerCase().trim();
    const match = list.some((s) => Math.abs(s.b - bucket) <= 1 && s.t !== "" && s.t === txt);
    if (match) return { actor: "ia_v3", dir: "outgoing" };
  }
  return { actor: "humano_manual", dir: "outgoing" };
}
