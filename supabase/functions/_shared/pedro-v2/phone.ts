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

