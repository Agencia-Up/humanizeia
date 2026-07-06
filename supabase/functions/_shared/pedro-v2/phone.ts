export function digitsOnly(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeBrazilPhone(value?: string | null): string {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function phoneVariants(value?: string | null): string[] {
  const normalized = normalizeBrazilPhone(value);
  const withoutCountry = normalized.startsWith("55") ? normalized.slice(2) : normalized;
  const variants = new Set<string>([digitsOnly(value), normalized, withoutCountry]);

  if (withoutCountry.length === 10) {
    const withMobileNine = `${withoutCountry.slice(0, 2)}9${withoutCountry.slice(2)}`;
    variants.add(withMobileNine);
    variants.add(`55${withMobileNine}`);
  }

  if (withoutCountry.length === 11 && withoutCountry[2] === "9") {
    const withoutMobileNine = `${withoutCountry.slice(0, 2)}${withoutCountry.slice(3)}`;
    variants.add(withoutMobileNine);
    variants.add(`55${withoutMobileNine}`);
  }

  return [...variants].filter(Boolean);
}

export function phonesMatch(left?: string | null, right?: string | null): boolean {
  const rightVariants = new Set(phoneVariants(right));
  return phoneVariants(left).some((variant) => rightVariants.has(variant));
}

export function remoteJidToPhone(remoteJid?: string | null): string {
  return normalizeBrazilPhone(String(remoteJid || "").split("@")[0]);
}

export function phoneToRemoteJid(phone?: string | null): string {
  const normalized = normalizeBrazilPhone(phone);
  return normalized ? `${normalized}@s.whatsapp.net` : "";
}

function firstMessageLike(payload: any): any {
  if (Array.isArray(payload?.messages) && payload.messages.length > 0) return payload.messages[0];
  if (Array.isArray(payload?.data) && payload.data.length > 0) return payload.data[0];
  return payload?.message || payload?.data || payload || {};
}

function firstNonEmpty(values: Array<unknown>): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function looksLikeRealWhatsappJid(value: string): boolean {
  const text = String(value || "").trim();
  if (/@s\.whatsapp\.net$/i.test(text) || /@c\.us$/i.test(text)) return true;
  const digits = digitsOnly(text);
  return digits.length >= 10 && !/@lid$/i.test(text);
}

export function resolveUazapiRemoteJid(payload: any): string {
  const message = firstMessageLike(payload);
  const key = message?.key || payload?.key || payload?.message?.key || payload?.data?.key || {};
  const isFromMe = key?.fromMe === true || message?.fromMe === true || payload?.fromMe === true;

  const primary = firstNonEmpty([
    message?.chatId,
    message?.chatid,
    message?.from,
    key?.remoteJid,
    payload?.remoteJid,
    payload?.remote_jid,
    payload?.chatId,
    payload?.jid,
    payload?.message?.chatId,
    payload?.data?.key?.remoteJid,
    payload?.data?.remoteJid,
  ]);

  const lidCandidate = /@lid$/i.test(primary);
  const senderCandidates = [
    message?.sender_pn,
    message?.senderPn,
    key?.senderPn,
    payload?.sender_pn,
    payload?.senderPn,
    payload?.data?.sender_pn,
    payload?.data?.senderPn,
    payload?.message?.sender_pn,
    payload?.message?.senderPn,
  ];
  const remoteAltCandidates = [
    key?.remoteJidAlt,
    message?.remoteJidAlt,
    payload?.remoteJidAlt,
    payload?.data?.remoteJidAlt,
    payload?.message?.remoteJidAlt,
  ];
  const alt = firstNonEmpty([
    ...(isFromMe ? remoteAltCandidates : senderCandidates),
    ...(isFromMe ? senderCandidates : remoteAltCandidates),
  ].filter((value) => looksLikeRealWhatsappJid(String(value || ""))));

  if (lidCandidate && alt) {
    const phone = remoteJidToPhone(alt);
    return phoneToRemoteJid(phone) || alt;
  }

  if (primary) return primary;

  const fallback = firstNonEmpty([
    message?.sender_pn,
    message?.senderPn,
    key?.senderPn,
    key?.remoteJidAlt,
    message?.remoteJidAlt,
    payload?.sender_pn,
    payload?.senderPn,
    payload?.remoteJidAlt,
  ]);
  const fallbackPhone = remoteJidToPhone(fallback);
  return fallbackPhone ? phoneToRemoteJid(fallbackPhone) : fallback;
}

export function resolveUazapiPhone(payload: any): string {
  return remoteJidToPhone(resolveUazapiRemoteJid(payload));
}

export function isSellerAckText(value?: string | null): boolean {
  const raw = String(value || "");
  const text = raw.toLowerCase().trim();
  if (!text) return false;
  return /[👍✅🤝🙏]/.test(raw)
    || /^\s*(ok+|okay|k|blz|beleza|sim|isso|fechado|fechou|show|bora|certo|combinado|positivo|confirmo|confirmado)\b/.test(text)
    || /\b(assumo|assumir|vou assumir|assumido|pode deixar|deixa comigo|deixa cmg|peguei|pego esse|pego ele|to indo|to nessa|vou atender|ja atendo|atendo ele|atendo esse|vou cuidar|cuido dele|consigo atender)\b/.test(text);
}

