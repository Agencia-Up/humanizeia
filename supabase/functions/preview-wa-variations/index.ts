import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================================
// Contatos fictícios padrão (quando frontend não passa contacts no body)
// Cobrem 3 cenários típicos de concessionária pro vendedor ver como a
// personalização funciona: 1 sem dados extras, 1 com dados ricos, 1 intermediário.
// ============================================================================
const DEFAULT_CONTACTS = [
  { name: "João Silva", dados_extras: "" },
  {
    name: "Maria Souza",
    dados_extras: "Gestora, 2 filhos, busca SUV familiar com bom espaço de bagagem. Já visitou loja em maio.",
  },
  { name: "Pedro Oliveira", dados_extras: "Vendedor autônomo, anda muito de carro pelo interior, prefere câmbio manual." },
];

type ContactInput = { name?: string; dados_extras?: string };

// ============================================================================
// SYSTEM PROMPTS POR NÍVEL — instruções distintas de tom, comprimento e estilo
// ============================================================================
const SYSTEM_PROMPTS: Record<string, string> = {
  low: `Você é um vendedor experiente de concessionária escrevendo mensagens curtas de WhatsApp para retomar contato com leads.

TOM: CONSERVADOR — direto, profissional, respeitoso. Mensagens objetivas, sem rodeios, sem gírias. Espelha o jeito de quem trabalha há anos com vendas e prefere não tomar tempo do cliente.

DIRETRIZES:
- Português brasileiro natural, mas sem regionalismos
- Máximo 280 caracteres por mensagem
- 0-1 emojis no máximo
- Sempre cumprimente pelo primeiro nome do contato
- Quando houver dados extras, mencione-os de forma SUTIL (não liste fato por fato — incorpore na fala)
- Termine com pergunta clara de CTA (ex: "Posso te mandar mais detalhes?", "Quer dar uma olhada?")
- NUNCA invente fatos, marcas, modelos, preços ou condições que não tenham sido passados`,

  medium: `Você é um vendedor humanizado de concessionária escrevendo mensagens de WhatsApp pessoais para reativar leads.

TOM: MODERADO — natural, cordial, equilibra profissionalismo e calor humano. Soa como uma pessoa real conversando — não uma máquina nem um script comercial frio.

DIRETRIZES:
- Português brasileiro com naturalidade (pode usar "tudo bem?", "passando pra te falar", "vi aqui que")
- Máximo 400 caracteres por mensagem
- 1-2 emojis no máximo, integrados ao texto (não enfileirados no fim)
- Sempre cumprimente pelo primeiro nome
- Quando houver dados extras, use-os pra demonstrar que LEMBRA do contato — incorpore 1 detalhe específico na mensagem (ex: cita o tipo de carro que ele busca, ou que tem filhos)
- Termine com pergunta que abra conversa (não só "sim/não")
- NUNCA invente fatos, marcas, modelos, preços ou condições`,

  high: `Você é um vendedor que QUEBRA O PADRÃO da abordagem comercial fria em mensagens de WhatsApp. Sua missão é fazer o lead PARAR de scrollar e responder.

TOM: CRIATIVO — descontraído, com hook inesperado, ritmo diferente. Soa como uma pessoa que sabe vender mas tem personalidade. Pode usar uma pergunta surpresa, um gancho de curiosidade ou uma virada inesperada.

DIRETRIZES:
- Português brasileiro vivo, pode usar coloquial leve ("é o seguinte", "olha só")
- Máximo 500 caracteres por mensagem
- 2-3 emojis bem posicionados (criam ritmo, não decoram)
- Sempre cumprimente pelo primeiro nome ou abra com hook que segue cumprimento natural
- Quando houver dados extras, transforme-os em GANCHO da mensagem (ex: lembra do SUV familiar que conversamos? acabou de chegar uma opção que combina demais com o que você procurava)
- Termine com CTA forte (não passivo) — algo que faz o lead querer responder agora
- NUNCA invente fatos, marcas, modelos, preços ou condições — criatividade é no JEITO de dizer, não no CONTEÚDO`,
};

// ============================================================================
// Fallback hardcoded — só quando OPENAI_API_KEY ausente ou erro 5xx
// ============================================================================
function fallbackVariations(prompt: string, level: string, contacts: ContactInput[]) {
  const base = prompt.trim().replace(/\s+/g, " ");
  return contacts.map((c, idx) => {
    const first = (c.name || "").split(" ")[0] || `Contato ${idx + 1}`;
    const direct = level === "low";
    const creative = level === "high";
    const text = direct
      ? `Oi ${first}! Passando pra te lembrar: ${base}. Posso te mandar mais detalhes?`
      : creative
        ? `Oi ${first}! Olha só, vi uma oportunidade que pode te interessar: ${base}. Quer dar uma olhada?`
        : `Oi ${first}, tudo bem? Te chamei aqui porque: ${base}. Se fizer sentido pra você, me responde que eu te explico rapidinho.`;
    return {
      contact_name: c.name || `Contato ${idx + 1}`,
      message: text.slice(0, 500),
    };
  });
}

function normalizeContacts(input: unknown): ContactInput[] {
  if (!Array.isArray(input) || input.length === 0) return DEFAULT_CONTACTS;
  const filtered = input
    .map((c) => ({
      name: typeof (c as any)?.name === "string" ? (c as any).name.trim() : "",
      dados_extras: typeof (c as any)?.dados_extras === "string" ? (c as any).dados_extras.trim() : "",
    }))
    .filter((c) => c.name);
  return filtered.length > 0 ? filtered.slice(0, 3) : DEFAULT_CONTACTS;
}

function parseGptVariations(raw: string): Array<{ contact_name: string; message: string }> | null {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed?.variations)) {
      const arr = parsed.variations
        .map((v: any) => ({
          contact_name: typeof v?.contact_name === "string" ? v.contact_name : "",
          message: typeof v?.message === "string" ? v.message.trim() : "",
        }))
        .filter((v: any) => v.message);
      return arr.length > 0 ? arr : null;
    }
  } catch {
    return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "").trim();
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const variationLevel = ["low", "medium", "high"].includes(body.variation_level)
      ? body.variation_level
      : "medium";
    const contacts = normalizeContacts(body.contacts);

    if (!prompt) return jsonResponse({ error: "Prompt base obrigatorio." }, 400);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return jsonResponse({
        variations: fallbackVariations(prompt, variationLevel, contacts),
        fallback: true,
        reason: "OPENAI_API_KEY ausente",
      });
    }

    const systemPrompt = SYSTEM_PROMPTS[variationLevel];

    // Monta lista de contatos pro user prompt — cada um com nome + dados extras
    const contactsBlock = contacts
      .map((c, i) => {
        const extras = c.dados_extras ? c.dados_extras : "(nenhum dado extra cadastrado)";
        return `${i + 1}. Nome: ${c.name}\n   Dados extras: ${extras}`;
      })
      .join("\n\n");

    const userPrompt = `INTENÇÃO/PROMPT BASE DO DISPARO:
"${prompt}"

CONTATOS (gere UMA mensagem personalizada para CADA um deles):

${contactsBlock}

REGRAS DE RESPOSTA:
- Retorne APENAS JSON válido, sem markdown, sem texto antes ou depois
- Formato exato: {"variations":[{"contact_name":"NOME","message":"TEXTO"}, ...]}
- Exatamente ${contacts.length} entradas no array, na mesma ordem dos contatos acima
- Cada message deve respeitar o tom e as diretrizes do system prompt
- Personalize CADA mensagem com base no nome e dados extras do contato (mesmo a do contato sem dados extras precisa parecer pessoal, não genérica)`;

    const temperature = variationLevel === "low" ? 0.5 : variationLevel === "high" ? 0.95 : 0.75;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("preview-wa-variations OpenAI error:", response.status, errText);
      return jsonResponse({
        variations: fallbackVariations(prompt, variationLevel, contacts),
        fallback: true,
        reason: `OpenAI ${response.status}`,
      });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = parseGptVariations(content);

    if (!parsed || parsed.length !== contacts.length) {
      console.warn("preview-wa-variations parse failed or count mismatch:", { contentLen: content.length, parsedLen: parsed?.length });
      return jsonResponse({
        variations: fallbackVariations(prompt, variationLevel, contacts),
        fallback: true,
        reason: "Parsing JSON GPT falhou",
      });
    }

    // Garante que contact_name bate com a ordem dos contatos solicitados
    const normalized = parsed.map((v, i) => ({
      contact_name: contacts[i].name,
      message: v.message,
    }));

    return jsonResponse({
      variations: normalized,
      fallback: false,
      model: "gpt-4o",
      level: variationLevel,
    });
  } catch (err) {
    console.error("preview-wa-variations error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Erro interno" }, 500);
  }
});
