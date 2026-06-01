// Gerentes que recebem os relatorios automaticos de transferencia (max 2).
// Le wa_ai_agents.gerente_phone (1o) + gerente_phone_2 (2o). Retorna so digitos,
// deduplicado e validado (>=10 digitos). Modulo PURO (sem deps) p/ ser importado
// tanto pelas edge functions inline quanto pelo bundle do pedro-webhook-v2.
export function managerPhones(agent: any): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [agent?.gerente_phone, agent?.gerente_phone_2]) {
    const digits = String(raw || "").replace(/\D/g, "");
    if (digits.length >= 10 && !seen.has(digits)) {
      seen.add(digits);
      out.push(digits);
    }
  }
  return out;
}
