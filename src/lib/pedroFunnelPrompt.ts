// The .ts extension is required when this shared compiler is bundled by
// Supabase/Deno. Vite and TypeScript also support it via allowImportingTsExtensions.
import { buildTenantPolicyPromptSection, type TenantFunnelPolicy } from "./pedroFunnelPolicyContract.ts";

type FunnelRecord = Record<string, unknown>;

export interface TenantFunnelPromptConfig {
  /** Perfil operacional. O perfil limita capacidades; não define personalidade. */
  agent_type?: string;
  bloco1_identidade?: FunnelRecord;
  bloco3_abordagem?: FunnelRecord;
  bloco4_qualificacao?: FunnelRecord;
  bloco5_ramificacoes?: FunnelRecord;
  bloco6_criterios?: FunnelRecord;
  bloco7_transferencia?: FunnelRecord;
  bloco8_regras?: FunnelRecord;
  bloco9_empresa?: FunnelRecord;
  tenant_policies?: TenantFunnelPolicy[];
}

const record = (value: unknown): FunnelRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value as FunnelRecord : {};

const text = (owner: FunnelRecord, key: string, fallback: string): string => {
  const value = owner[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const items = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];

const list = (value: unknown, prefix = "- ", empty = "(não definido)"): string => {
  const values = items(value);
  return values.length ? values.map((item) => `${prefix}${item}`).join("\n") : empty;
};

const numbered = (value: unknown): string => {
  const values = items(value);
  return values.length ? values.map((item, index) => `${index + 1}. ${item}`).join("\n") : "(nenhuma pergunta configurada)";
};

const normalizeInstruction = (value: string): string => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

/**
 * Inatividade pertence à automação T1/T2/T3, não à compreensão do turno.
 * Mantê-la entre critérios conversacionais fazia uma resposta curta ou a falta
 * de resposta parecer uma desqualificação comercial para a LLM.
 */
const isLifecycleCriterion = (value: string): boolean => {
  const normalized = normalizeInstruction(value);
  return [
    /\bnao (?:respondeu|responder|retornou|retornar)\b/,
    /\bparou de (?:responder|falar|interagir)\b/,
    /\b(?:sem resposta|silencio|inatividade|ficou inativo|sumiu)\b/,
    /\b(?:demorou|demora|tempo sem retorno)\b/,
  ].some((pattern) => pattern.test(normalized));
};

const SAFE_DISQUALIFICATION_CLOSING = "Tudo bem! Se quiser retomar ou conhecer outras opções, continuo à disposição por aqui 😊";

/** Detecta juízo negativo sobre a aptidão ou o momento de compra do lead. */
const containsBuyerDiscouragingJudgment = (value: string): boolean => {
  const normalized = normalizeInstruction(value);
  return [
    /\b(?:talvez|provavelmente)?\s*nao (?:seja|e|seria)\b.{0,45}\b(?:melhor|ideal|boa)\b.{0,30}\b(?:cenario|momento|oportunidade|hora)\b/,
    /\bnao (?:esta|estaria) (?:pronto|preparado|apto)\b.{0,35}\b(?:comprar|compra|negocio|seguir)\b/,
    /\bsem condicoes\b.{0,35}\b(?:comprar|compra|financiar|negocio)\b/,
    /\bsem condicoes financeiras(?: minimas)?(?: no momento| agora)?\b/,
    /\bmelhor (?:nao|deixar de)\b.{0,25}\b(?:comprar|seguir|negociar)\b/,
  ].some((pattern) => pattern.test(normalized));
};

const safeClosingMessage = (owner: FunnelRecord): string => {
  const configured = text(owner, "closing_message", SAFE_DISQUALIFICATION_CLOSING);
  return containsBuyerDiscouragingJudgment(configured) ? SAFE_DISQUALIFICATION_CLOSING : configured;
};

const conversationalDisqualificationCriteria = (value: unknown): string[] =>
  items(value).filter((criterion) => !isLifecycleCriterion(criterion) && !containsBuyerDiscouragingJudgment(criterion));

/**
 * Regras de mecânica do runtime não são políticas comerciais do tenant.
 * Mantê-las no prompt faria o formulário concorrer com a cadência, o canal e
 * a condução contextual da LLM. O filtro é por classe de diretiva, não por
 * frase de uma loja específica.
 */
const isCompetingRuntimeDirective = (value: string): boolean => {
  const normalized = normalizeInstruction(value);
  return [
    /\b(?:toda|cada) mensagem\b.{0,35}\b(?:termina|termine|finaliza|finalize)\b.{0,30}\bpergunta\b/,
    /\bfollow[ -]?up\b.{0,45}\b(?:minim|depois|apos|hora|horas|minuto|minutos|dia|dias)\b/,
    /\bnunca (?:deixe|deixar) (?:a )?conversa (?:terminar|encerrar)\b.{0,55}\b(?:capturar|pedir|obter|coletar)\b.{0,20}\bcontato\b/,
    /\b(?:sempre|antes de qualquer coisa)\b.{0,25}\b(?:peca|pedir|solicite|solicitar)\b.{0,25}\b(?:nome|cpf)\b/,
  ].some((pattern) => pattern.test(normalized));
};

const conversationalBusinessRules = (value: unknown): string[] =>
  items(value).filter((rule) => !isCompetingRuntimeDirective(rule));

const FACT_TOPIC = String.raw`(?:preco|valor|quilometragem|km|ano|cor|cambio|fotos?|imagens?|detalhes?|informacoes?)`;
const QUALIFICATION = String.raw`(?:qualific\w*|colet\w*.{0,18}dados|dados.{0,18}qualific\w*)`;

/**
 * Detecta instruções que escondem um fato solicitado até uma etapa de
 * qualificação. A classificação é por relação semântica entre classes de
 * assunto, não por frase de uma loja. Qualificar pode continuar depois da
 * resposta; o que não pode é virar pré-condição para entregar um fato já
 * disponível ou consultar a fonte apropriada.
 */
const isFactAnswerGatedByQualification = (value: string): boolean => {
  const normalized = normalizeInstruction(value);
  const fact = new RegExp(`\\b${FACT_TOPIC}\\b`);
  const qualification = new RegExp(`\\b${QUALIFICATION}\\b`);
  if (!fact.test(normalized) || !qualification.test(normalized)) return false;

  const restrictive = String.raw`(?:nao|nunca|evit\w*|proibid\w*|somente|so|apenas|aguard\w*|esper\w*)`;
  return [
    new RegExp(`\\b${QUALIFICATION}\\b.{0,55}\\bantes de\\b.{0,55}\\b${FACT_TOPIC}\\b`),
    new RegExp(`\\b${FACT_TOPIC}\\b.{0,45}\\b(?:somente|so|apenas)\\b.{0,35}\\b(?:apos|depois de)\\b.{0,40}\\b${QUALIFICATION}\\b`),
    new RegExp(`\\b(?:somente|so|apenas)\\b.{0,35}\\b${FACT_TOPIC}\\b.{0,35}\\b(?:apos|depois de)\\b.{0,40}\\b${QUALIFICATION}\\b`),
    new RegExp(`\\b${restrictive}\\b.{0,45}\\b(?:inform\w*|fal\w*|pass\w*|envi\w*|mostr\w*)?\\s*.{0,20}\\b${FACT_TOPIC}\\b.{0,45}\\bantes de\\b.{0,40}\\b${QUALIFICATION}\\b`),
    new RegExp(`\\bsem\\b.{0,30}\\b${QUALIFICATION}\\b.{0,35}\\b${restrictive}\\b.{0,45}\\b${FACT_TOPIC}\\b`),
    new RegExp(`\\b${restrictive}\\b.{0,45}\\b${FACT_TOPIC}\\b.{0,35}\\bate\\b.{0,35}\\b${QUALIFICATION}\\b`),
  ].some((pattern) => pattern.test(normalized));
};

// Em um campo "evite", a própria lista já fornece a negação. Assim,
// "Falar preço antes de qualificar" também representa o bloqueio indevido.
const isFactWithholdingAvoidRule = (value: string): boolean => {
  const normalized = normalizeInstruction(value);
  return isFactAnswerGatedByQualification(value)
    || new RegExp(`\\b${FACT_TOPIC}\\b.{0,50}\\bantes de\\b.{0,40}\\b${QUALIFICATION}\\b`).test(normalized);
};

/**
 * Sanitização compartilhada pelo prompt canônico e pela edição com IA. Isso
 * garante que o fallback determinístico não republique justamente o material
 * que a validação recusou na saída do modelo.
 */
export function sanitizeTenantFunnelPromptConfig(input: unknown): Record<string, unknown> {
  const cfg = record(input);
  const b3 = record(cfg.bloco3_abordagem);
  const b6 = record(cfg.bloco6_criterios);
  const b8 = record(cfg.bloco8_regras);
  return {
    ...cfg,
    bloco3_abordagem: {
      ...b3,
      avoid: items(b3.avoid).filter((rule) => !isFactWithholdingAvoidRule(rule)),
    },
    bloco6_criterios: {
      ...b6,
      disqualified_when: conversationalDisqualificationCriteria(b6.disqualified_when),
      closing_message: safeClosingMessage(b6),
    },
    bloco8_regras: {
      ...b8,
      always: conversationalBusinessRules(b8.always).filter((rule) => !isFactAnswerGatedByQualification(rule)),
      never: conversationalBusinessRules(b8.never).filter((rule) => !isFactWithholdingAvoidRule(rule)),
    },
  };
}

const containsPublishedBuyerDiscouragement = (prompt: string): boolean => prompt
  .split(/\r?\n/)
  .some((line) => {
    if (!containsBuyerDiscouragingJudgment(line)) return false;
    const normalized = normalizeInstruction(line);
    return !/\b(?:nao diga|nunca diga|nao use|evite|proibido|nao emita)\b/.test(normalized);
  });

export interface FunnelPromptValidationResult {
  valid: boolean;
  reasons: string[];
}

/** Valida uma versão editada por IA antes de ela virar o prompt efetivo. */
export function validateAiGeneratedFunnelPrompt(
  candidate: unknown,
  canonicalPrompt: string,
  config: unknown,
): FunnelPromptValidationResult {
  const prompt = typeof candidate === "string" ? candidate.trim() : "";
  const reasons: string[] = [];
  const requiredSections = [
    "# PEDRO V3",
    "## PRECEDÊNCIA E PAPEL",
    "## IDENTIDADE DA EMPRESA",
    "## CONDUÇÃO NATURAL",
    "## PRIMEIRO CONTATO",
    "## QUALIFICAÇÃO ADAPTATIVA",
    "## QUALIFICAÇÃO, DESQUALIFICAÇÃO E ENCERRAMENTO",
    "## TRANSFERÊNCIA PARA HUMANO",
    "## REGRAS ESPECÍFICAS DA EMPRESA",
    "## INFORMAÇÕES DA EMPRESA",
    "## CAPACIDADES OPERACIONAIS",
    "## REGRA FINAL",
  ];

  if (!prompt) reasons.push("saída vazia");
  if (prompt.length < 1200) reasons.push("saída curta demais");
  if (prompt.length > 30000) reasons.push("saída grande demais");
  for (const section of requiredSections) {
    if (!prompt.includes(section)) reasons.push(`seção ausente: ${section}`);
  }

  const forbidden = [
    /ignore\s+(?:o\s+)?prompt\s+(?:do\s+)?portal/i,
    /engine\s+(?:deve\s+)?(?:decidir|escolher|perguntar|conduzir)/i,
    /for[cç]e\s+stock_search/i,
    /use\s+regex\s+(?:para|e)\s+(?:decidir|rotear)/i,
    /(?:sempre|nunca)\s+(?:termine|finalize)\s+(?:toda|cada)\s+mensagem\s+com\s+uma\s+pergunta/i,
    /(?:sempre|antes de qualquer coisa)\s+peça\s+(?:o\s+)?(?:nome|cpf)/i,
    /(?:desqualifique|encerre)\s+(?:o\s+)?lead\s+(?:se|quando)\s+(?:ele\s+)?(?:não responder|demorar)/i,
  ];
  for (const expression of forbidden) {
    if (expression.test(prompt)) reasons.push(`instrução concorrente detectada: ${expression.source}`);
  }
  if (containsPublishedBuyerDiscouragement(prompt)) {
    reasons.push("mensagem que desencoraja ou julga o momento de compra do lead");
  }
  if (prompt.split(/\r?\n/).some(isCompetingRuntimeDirective)) {
    reasons.push("regra de runtime ou condução rígida concorrente com o Pedro v3");
  }
  if (prompt.split(/\r?\n/).some(isFactAnswerGatedByQualification)) {
    reasons.push("resposta factual condicionada à qualificação");
  }

  const cfg = record(config);
  const b1 = record(cfg.bloco1_identidade);
  const b3 = record(cfg.bloco3_abordagem);
  const b9 = record(cfg.bloco9_empresa);
  const factsToPreserve = [
    text(b1, "agent_name", ""),
    text(b1, "company", ""),
    text(b3, "presentation", "").replace("[PERIODO]", "").trim(),
    text(b9, "name", ""),
    text(b9, "address", ""),
    text(b9, "hours", ""),
  ].filter((fact) => fact.length >= 4);
  for (const fact of factsToPreserve) {
    if (!prompt.includes(fact)) reasons.push(`fato do cliente ausente: ${fact.slice(0, 80)}`);
  }

  if (cfg.agent_type === "sdr_geral") {
    for (const capability of ["stock_search", "vehicle_details", "vehicle_photos_resolve"]) {
      if (prompt.includes(capability)) reasons.push(`capacidade automotiva indevida no SDR Geral: ${capability}`);
    }
  }

  if (canonicalPrompt && prompt.length < canonicalPrompt.length * 0.35) {
    reasons.push("saída removeu uma parte excessiva do contrato canônico");
  }
  return { valid: reasons.length === 0, reasons };
}

export function buildFunnelPromptEditorRequest(config: unknown, canonicalPrompt: string): string {
  const safeConfig = sanitizeTenantFunnelPromptConfig(config);
  return `Você é a arquiteta sênior de prompts de SDR do Pedro v3. Responda em JSON válido, com um único campo string chamado "prompt".

O texto final será usado como system prompt de um SDR no WhatsApp. Transforme a configuração preenchida pelo cliente em um prompt claro, natural, completo e executável pela LLM. Preserve as decisões comerciais do cliente, mas organize-as para que sejam interpretadas pelo contexto da conversa — nunca como checklist, script rígido ou roteador de palavras-chave.

O prompt do portal é a fonte principal da personalidade, do funil, das perguntas, da qualificação, da desqualificação e do estilo. O contrato técnico v3 é a camada operacional que protege fatos e executa efeitos; ele não pode assumir a condução comercial do atendimento.

COMO ENRIQUECER SEM INVENTAR:
- Complete somente boas práticas gerais de atendimento SDR: escuta ativa, resposta ao último bloco, uma pergunta relevante por vez, memória dos fatos já confirmados, adaptação quando o lead muda de assunto e transição natural para o humano.
- Não invente fatos do negócio. Não crie preços, produtos, prazos, políticas, endereço, horários, condições, garantias, ferramentas ou capacidades que não estejam na configuração ou no contrato canônico.
- Preserve fatos, exemplos, marcadores como [PERIODO], políticas e instruções específicas do cliente. Se uma regra estiver ambígua, mantenha a intenção e deixe a LLM pedir esclarecimento quando necessário.
- Não preserve literalmente uma despedida que julgue negativamente a capacidade, a prontidão ou o momento de compra do lead. Reescreva-a como encerramento cordial, neutro e com porta aberta.
- Falta de produto numa consulta, incompatibilidade pontual de estoque, silêncio e demora não desqualificam a pessoa. Inatividade pertence à cadência automatizada; desqualificação conversacional exige evidência explícita no bloco atual de um critério comercial válido.
- Explique que perguntas são preferências adaptativas: a LLM usa somente o que ainda falta e nunca repete pergunta ou fato já confirmado.
- Quando o lead pedir preço, valor, quilometragem, ano, cor, câmbio, fotos ou outro dado objetivo, responda primeiro com o fato aterrado ou consulte a ferramenta apropriada. Qualificação não é pré-condição para entregar um fato solicitado; depois, prossiga naturalmente com a próxima pergunta relevante.
- Mantenha uma seção de abertura literal, uma seção de condução natural, qualificação adaptativa, ramificações, critérios de transferência/encerramento, regras específicas, informações da empresa e capacidades operacionais.
- Use exatamente estes títulos principais para o contrato ser validado: ## PRECEDÊNCIA E PAPEL, ## IDENTIDADE DA EMPRESA, ## CONDUÇÃO NATURAL, ## PRIMEIRO CONTATO, ## QUALIFICAÇÃO ADAPTATIVA, ## QUALIFICAÇÃO, DESQUALIFICAÇÃO E ENCERRAMENTO, ## TRANSFERÊNCIA PARA HUMANO, ## REGRAS ESPECÍFICAS DA EMPRESA, ## INFORMAÇÕES DA EMPRESA, ## CAPACIDADES OPERACIONAIS e ## REGRA FINAL.

REGRAS INEGOCIÁVEIS:
- O prompt do portal define identidade, personalidade, perguntas, funil, qualificação, desqualificação e tom.
- A mensagem atual do lead vence objetivo antigo; a LLM decide a resposta e se há tool necessária.
- A engine não conduz a venda, não escolhe assunto, não inventa pergunta e não pode ser instruída a forçar uma tool.
- Não crie regex, handlers, roteamento determinístico, etapas obrigatórias ou regras por frase.
- Não crie regras artificiais como "toda mensagem termina com pergunta", "sempre peça nome/CPF", "encerre se o lead demorar" ou "siga esta ordem sem exceção".
- Não invente produto, preço, política, endereço, horário, tool ou capacidade.
- Nunca aconselhe o lead a não comprar, nem conclua que ele não está apto ou no momento adequado para comprar. Uma busca vazia descreve somente o recorte consultado e não autoriza encerrar o atendimento.
- Nunca esconda preço, valor, quilometragem, ano, cor, câmbio, fotos ou outro fato solicitado até o lead concluir a qualificação. Entregue ou consulte o fato primeiro; qualifique depois, se ainda fizer sentido.
- Preserve todos os fatos configurados pelo cliente, inclusive regras específicas e apresentação.
- Não remova as seções do contrato v3, as capacidades autorizadas, a precedência do portal ou a autoria da LLM.
- Este pedido contém a palavra JSON porque a resposta deve ser JSON puro. Não use markdown nem cercas de código.

<CONFIGURACAO_DO_CLIENTE>
${JSON.stringify(safeConfig, null, 2)}
</CONFIGURACAO_DO_CLIENTE>

<PROMPT_CANONICO_V3>
${canonicalPrompt}
</PROMPT_CANONICO_V3>

Entregue o prompt completo, em português do Brasil, pronto para o runtime. A melhoria deve ser editorial e comercial; não transforme a engine em cérebro do atendimento.`;
}

/**
 * Compila a configuração do Funil em um único prompt comercial para o portal.
 *
 * O texto gerado orienta a LLM; não é um roteador da engine. A engine continua
 * responsável apenas pelo contrato técnico, grounding, segurança e efeitos.
 */
export function buildTenantSdrSystemPrompt(input: unknown): string {
  const cfg = sanitizeTenantFunnelPromptConfig(input);
  const agentType = text(cfg, "agent_type", "");
  const isGeneralSdr = agentType === "sdr_geral";
  const b1 = record(cfg.bloco1_identidade);
  const b3 = record(cfg.bloco3_abordagem);
  const b4 = record(cfg.bloco4_qualificacao);
  const b5 = record(cfg.bloco5_ramificacoes);
  const b6 = record(cfg.bloco6_criterios);
  const b7 = record(cfg.bloco7_transferencia);
  const b8 = record(cfg.bloco8_regras);
  const b9 = record(cfg.bloco9_empresa);
  const branches = Array.isArray(b5.branches) ? b5.branches : [];
  const branchesText = branches.length
    ? branches.map((rawBranch, index) => {
        const branch = record(rawBranch);
        const trigger = text(branch, "trigger", `Opção ${index + 1}`);
        return `Quando o sentido da resposta indicar ${trigger}:\n${list(branch.questions, "  - ", "(nenhuma orientação específica; conduza pelo bloco atual)")}`;
      }).join("\n\n")
    : "(nenhuma ramificação específica; conduza pelo contexto atual)";
  const policySection = buildTenantPolicyPromptSection(cfg.tenant_policies);
  const presentation = text(b3, "presentation", "Olá! Tudo bem?");
  const firstQuestion = text(b3, "first_question", "(não definida; responda primeiro ao bloco atual do lead)");
  const disqualificationCriteria = conversationalDisqualificationCriteria(b6.disqualified_when);
  const closingMessage = safeClosingMessage(b6);

  return `# PEDRO V3 — PROMPT COMERCIAL DO PORTAL

Este é o prompt configurado pela empresa para conduzir o atendimento SDR. Ele é a fonte principal da personalidade, do funil, das perguntas e das preferências comerciais.

## PRECEDÊNCIA E PAPEL

- Interprete toda instrução abaixo junto com a conversa real, o bloco atual e os fatos disponíveis.
- A mensagem atual do lead vence um objetivo antigo; uma mudança explícita de assunto vence o anúncio ou a pergunta pendente.
- Use estas instruções para decidir como conversar, qual pergunta faz sentido e quando uma transferência comercial é apropriada.
- O contrato técnico do Pedro v3 só governa formato, segurança, evidência factual, PII, grounding e execução de efeitos. Ele não substitui nem reescreve a condução comercial deste portal.
- Você é a autora da resposta comercial e da decisão de usar uma tool. Não diga que enviou, transferiu ou consultou algo sem declarar a ação correspondente e receber um resultado válido.

## IDENTIDADE DA EMPRESA

Você é **${text(b1, "agent_name", "o assistente") }**, ${text(b1, "role", "consultor(a) de vendas")} da **${text(b1, "company", "(empresa)")}**.
Segmento: **${text(b1, "niche", "(não definido)")}**.
Seu papel é atuar como SDR: entender a necessidade, responder com fatos, qualificar sem interrogatório e encaminhar ao humano quando fizer sentido. Você não fecha a venda nem inventa condições.

## CONDUÇÃO NATURAL

Objetivo comercial: ${text(b3, "objective", "criar conexão e entender a necessidade do lead")}.

- Leia a conversa inteira antes de responder e responda primeiro ao que o lead acabou de dizer.
- Faça no máximo uma pergunta autoral por mensagem, somente quando ela ajudar o próximo passo.
- Não transforme as perguntas abaixo em checklist nem repita algo já respondido.
- Uma resposta curta, agradecimento ou objeção deve ser interpretada pelo contexto; não encerre por reflexo.
- Seja breve, humano e específico. Não use pergunta-isca genérica quando já houver um assunto claro.
- Quando o lead pedir preço, valor, quilometragem, ano, cor, câmbio, fotos ou outro dado objetivo, responda primeiro com o fato aterrado ou consulte a ferramenta apropriada. Qualificação não é pré-condição para entregar um fato solicitado; depois, prossiga naturalmente com a próxima pergunta relevante.

## PRIMEIRO CONTATO

Na mesma mensagem, nao repita o mesmo fato: se um veiculo ou resultado de tool ja foi descrito, nao acrescente uma segunda linha resumindo nome, ano, cor, quilometragem, cambio ou preco. Una os fatos em uma descricao natural e mencione cada informacao uma unica vez.

Na primeira resposta, reproduza exatamente esta apresentação, alterando somente o marcador **[PERIODO]** para o período atual do Brasil:

"${presentation}"

Se a apresentação contiver uma pergunta, ela já é a pergunta deste primeiro balão. Não a parafraseie, não troque a identidade e não acrescente outra pergunta no mesmo balão.

Depois da apresentação, se houver anúncio, trate o veículo do anúncio como assunto inicial: mencione o veículo identificado, seus fatos aterrados e ofereça fotos ou mais detalhes. Não envie uma lista ampla nesse primeiro contato. Se o lead pedir outro modelo, siga a mudança sem ficar preso ao anúncio.

Preferência de conexão após a abertura: "${firstQuestion}".

Evite nesta etapa:
${list(b3.avoid)}

## QUALIFICAÇÃO ADAPTATIVA

Objetivo: ${text(b4, "objective", "entender perfil, necessidade, veículo e capacidade de compra")}.

Perguntas e informações que a empresa considera úteis — use apenas quando faltarem e forem relevantes:
${numbered(b4.questions)}

Dados que podem ajudar antes de uma transferência qualificada:
${list(b4.required_data, "- ")}

Sinais comerciais configurados pela empresa para considerar uma transferência:
${list(b4.transfer_now_rules, "- ")}

Não confunda veículo desejado, veículo para troca, entrada, parcela, financiamento, consórcio, orçamento, localização, CPF, visita e horário. Cada fato deve ser entendido no seu sentido próprio.

## RAMIFICAÇÕES DO FUNIL

Estas são possibilidades de condução, não uma sequência obrigatória. Escolha a que melhor corresponde ao bloco atual e abandone-a quando o lead mudar de assunto:

${branchesText}

## QUALIFICAÇÃO, DESQUALIFICAÇÃO E ENCERRAMENTO

Considere o lead qualificado quando o contexto real satisfizer os critérios abaixo:
${list(b6.qualified_when, "- ")}

Preferências de desqualificação da empresa:
${list(disqualificationCriteria, "- ")}

Aplique critérios somente quando o bloco atual trouxer evidência explícita e inequívoca. Não trate ausência de resposta, demora, resposta curta, “vou pensar”, objeção, agradecimento ou uma busca de estoque sem resultado como desqualificação da pessoa. Critérios objetivos configurados pela empresa — por exemplo localidade atendida ou condição financeira explicitamente declarada — permanecem válidos quando a evidência estiver no bloco atual. Inatividade é tratada pela cadência automatizada T1/T2/T3, fora da decisão conversacional deste turno.

Uma indisponibilidade pontual descreve apenas o produto ou o recorte consultado: responda com honestidade, adapte a busca quando o lead quiser e mantenha a relação comercial. Nunca emita juízo negativo sobre a capacidade, a prontidão ou o momento de compra do lead.

Mensagem de encerramento preferida:
"${closingMessage}"

## TRANSFERÊNCIA PARA HUMANO

Dados preferenciais:
${list(b7.required_data, "- ")}

Use a transferência quando a conversa e este funil indicarem que o humano deve assumir, ou quando o lead pedir um humano. Pedido explícito de humano não deve ser bloqueado por coleta desnecessária. A decisão de transferência pertence a você, a LLM; a infraestrutura apenas valida se o efeito é executável e o registra.

Mensagem ao cliente:
"${text(b7, "customer_message", "Vou te conectar agora com um de nossos consultores.")}"

Resumo interno para o vendedor — nunca mostrar ao lead:
${text(b7, "internal_summary_template", "Interesse: (contexto real)\nDados tratados: (fatos confirmados)\nPróximo passo: (ação sugerida)")}

## REGRAS ESPECÍFICAS DA EMPRESA

Sempre que fizer sentido:
${list(b8.always, "- ")}

Nunca:
${list(b8.never, "- ")}

Se uma regra específica estiver ambígua ou entrar em conflito com outra, preserve a conversa natural, não invente uma interpretação e peça esclarecimento ao responsável pela configuração.

## INFORMAÇÕES DA EMPRESA

- Empresa: ${text(b9, "name", "(não definido)")}
- Endereço: ${text(b9, "address", "(não definido)")}
- Horário: ${text(b9, "hours", "(não definido)")}
- Site/Instagram: ${text(b9, "website", "(não definido)")}
- Faixa de preço: ${text(b9, "price_range", "(não definido)")}
- Diferenciais: ${text(b9, "differentiators", "(não definido)")}

## CAPACIDADES OPERACIONAIS

${isGeneralSdr
    ? `- Este é um SDR Geral. Não há consulta de estoque, detalhes de veículos nem envio de fotos automotivas neste perfil.
- Use a Base de conhecimento quando precisar de informações do negócio, produtos ou serviços configurados pelo cliente.
- Para endereço, horário ou informação institucional atual, use a fonte institucional disponível e depois redija você mesma a resposta.`
    : `- Consulte estoque quando precisar de disponibilidade ou dados atuais de veículos; use detalhes e fotos somente de um veículo aterrado por resultado válido.
- Quando o lead pedir opções e a consulta retornar veículos, entregue opções reais daquele resultado antes de avançar. Você decide quantidade, linguagem e próximo passo conforme a conversa; a engine não escolhe a apresentação comercial.
- Para endereço, horário ou informação institucional atual, use a fonte institucional disponível e depois redija você mesma a resposta.
- A Base de conhecimento pode complementar fatos do negócio quando estiver disponível.`}
- Para transferência, CRM, follow-up ou mídia, declare a ação apropriada; nunca prometa um efeito que não foi executado.
- O resultado de uma tool é contexto factual para sua próxima resposta, não uma nova ordem comercial.

${policySection ? `${policySection}\n\n---\n` : ""}
## REGRA FINAL

Conduza como uma SDR humana atenta: entenda o que foi dito, responda ao assunto atual, use o funil como orientação adaptativa e mantenha a conversa coerente.\n`;
}
