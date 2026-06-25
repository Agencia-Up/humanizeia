// Templates personalizados de mensagem do Pedro (vendedor/gerente) na transferência.
// O dono escreve a mensagem com {etiquetas} (ex.: {nome}, {interesse}) e aqui cada
// etiqueta vira o dado real do lead. MESMA lógica que o v1 (uazapi-webhook) já usava
// — agora compartilhada pro v2 (orchestrator) aplicar igual. SEGURO: se o agente não
// tem template salvo, composeSellerMsg/composeGerenteMsg devolvem o fallback (a mensagem
// automática de sempre), então quem não mexeu NÃO muda nada.

/** Troca {etiquetas} pelo valor. Se uma LINHA só tem etiqueta(s) e TODAS ficaram
 *  vazias, a linha some inteira (evita "Cidade:" pendurado). */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  const out: string[] = [];
  for (const rawLine of String(tpl).split("\n")) {
    const placeholders = rawLine.match(/\{[a-zA-Z_]+\}/g) || [];
    if (placeholders.length === 0) { out.push(rawLine); continue; }
    let anyFilled = false;
    let line = rawLine;
    for (const ph of placeholders) {
      const key = ph.slice(1, -1).toLowerCase();
      const val = (vars[key] ?? "").toString().trim();
      if (val) anyFilled = true;
      line = line.split(ph).join(val);
    }
    if (!anyFilled) continue; // linha só de etiquetas vazias -> remove
    out.push(line);
  }
  return out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Tem template do vendedor? usa ele (com etiquetas); senão, o fallback (msg automática). */
export function composeSellerMsg(agent: any, vars: Record<string, string>, fallback: string): string {
  const tpl = String(agent?.briefing_template_vendedor || "").trim();
  return tpl ? renderTemplate(tpl, vars) : fallback;
}

/** Tem template do gerente? usa ele; senão, o fallback (relatório automático). */
export function composeGerenteMsg(agent: any, vars: Record<string, string>, fallback: string): string {
  const tpl = String(agent?.briefing_template_gerente || "").trim();
  return tpl ? renderTemplate(tpl, vars) : fallback;
}

/** Monta o mapa de etiquetas a partir do estado/memória do Pedro + dados explícitos
 *  da transferência. Campo ausente = '' (a linha some na renderização). Tudo com
 *  optional chaining — se a memória tiver outro formato, só vem vazio, nunca quebra. */
export function buildEtiquetas(state: any, opts: {
  agentName?: string | null; leadName?: string | null; leadPhone?: string | null;
  sellerName?: string | null; sellerPhone?: string | null;
  temperatura?: string | null; interesse?: string | null;
  classificacao?: string | null; horario?: string | null; resumo?: string | null;
}): Record<string, string> {
 try {
  const s = state || {};
  const digits = String(opts.leadPhone || s?.lead?.telefone || "").replace(/\D/g, "");

  let interesse = String(opts.interesse || "").trim();
  if (!interesse && s?.interesse?.modelo_desejado) {
    const conf = [s.interesse.ano_desejado, s.interesse.configuracao, s.interesse.combustivel, s.interesse.cambio]
      .filter(Boolean).join(", ");
    interesse = `${s.interesse.modelo_desejado}${conf ? ` (${conf})` : ""}`;
  }

  let veiculo = "";
  if (s?.veiculo_apresentado?.ja_apresentado) {
    const vp = s.veiculo_apresentado;
    veiculo = `${[vp.modelo, vp.ano].filter(Boolean).join(" ")}${vp.preco ? ` — R$ ${vp.preco}` : ""}`.trim();
  }

  let troca = "";
  if (s?.negociacao?.tem_troca && s?.negociacao?.carro_troca) {
    const ct = s.negociacao.carro_troca;
    const parts = [ct.modelo, ct.ano, ct.configuracao, ct.cambio].filter(Boolean).join(" ");
    troca = `${parts || "sim"}${ct.status ? ` (${ct.status})` : ""}`;
  }

  const nome = s?.lead?.nome_completo || s?.lead?.nome
    || (opts.leadName && opts.leadName !== "Lead" ? opts.leadName : "")
    || (digits ? `Lead (final ${digits.slice(-4)})` : "Lead");

  return {
    agente: opts.agentName || "Pedro SDR",
    nome,
    telefone: opts.leadPhone || s?.lead?.telefone || digits,
    link: digits ? `https://wa.me/${digits}` : "",
    cidade: s?.lead?.cidade || s?.lead?.client_city || "",
    temperatura: String(opts.temperatura || "").trim(),
    interesse,
    veiculo,
    pagamento: s?.negociacao?.forma_pagamento || "",
    entrada: s?.negociacao?.valor_entrada || "",
    troca,
    objecoes: (Array.isArray(s?.atendimento?.objecoes) && s.atendimento.objecoes.length > 0) ? s.atendimento.objecoes.join(", ") : "",
    decisao: s?.lead?.acompanhante_decisao || "",
    resumo: opts.resumo ? String(opts.resumo).substring(0, 300) : "",
    vendedor: opts.sellerName || "",
    telefone_vendedor: opts.sellerPhone || "",
    classificacao: String(opts.classificacao || "").trim(),
    horario: opts.horario || "",
    motivo: "",
    urgencia: "",
    score: "",
  };
 } catch {
  // Blindagem: buildEtiquetas NUNCA quebra a transferência. Na dúvida devolve só
  // os campos explícitos (sem ler o state) — pior caso = template com menos dados.
  const d = String(opts.leadPhone || "").replace(/\D/g, "");
  return {
    agente: opts.agentName || "Pedro SDR",
    nome: String(opts.leadName || "Lead"),
    telefone: opts.leadPhone || "",
    link: d ? `https://wa.me/${d}` : "",
    cidade: "", temperatura: String(opts.temperatura || ""), interesse: String(opts.interesse || ""),
    veiculo: "", pagamento: "", entrada: "", troca: "", objecoes: "", decisao: "",
    resumo: opts.resumo ? String(opts.resumo).substring(0, 300) : "",
    vendedor: opts.sellerName || "", telefone_vendedor: opts.sellerPhone || "",
    classificacao: String(opts.classificacao || ""), horario: opts.horario || "",
    motivo: "", urgencia: "", score: "",
  };
 }
}
