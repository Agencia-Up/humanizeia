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

function fallbackVariations(prompt: string, level: string) {
  const base = prompt.trim().replace(/\s+/g, " ");
  const direct = level === "low";
  const creative = level === "high";

  return [
    direct
      ? `Oi! Passando para te lembrar: ${base}. Posso te ajudar por aqui?`
      : creative
        ? `Oi! Vi uma oportunidade legal para voce: ${base}. Quer que eu te mande os detalhes?`
        : `Oi, tudo bem? ${base}. Se fizer sentido para voce, me chama aqui que eu te explico rapidinho.`,
    direct
      ? `Tudo bem? Estou entrando em contato sobre: ${base}. Quer continuar por aqui?`
      : creative
        ? `Passando rapidinho com uma novidade que pode te interessar: ${base}. Me responde com um "quero" que eu te mostro.`
        : `Oi! Estou retomando nosso contato porque tenho algo que pode ajudar: ${base}. Quer ver?`,
    direct
      ? `Ola! Sobre ${base}, posso te passar mais informacoes?`
      : creative
        ? `Ei, deixa eu te contar uma coisa boa: ${base}. Se quiser, ja te mando o proximo passo.`
        : `Ola! Separei essa mensagem para voce: ${base}. Caso tenha interesse, responda por aqui.`,
  ].map((text) => text.slice(0, 500));
}

function parseVariations(raw: string): string[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed?.variations)) {
      return parsed.variations.map((v: unknown) => String(v).trim()).filter(Boolean).slice(0, 3);
    }
  } catch {
    // fallback below
  }

  const parts = cleaned
    .split(/\n\s*---+\s*\n|---+/g)
    .map((part) => part.replace(/^\s*\d+[\).\-\s]+/, "").trim())
    .filter(Boolean);

  if (parts.length >= 3) return parts.slice(0, 3);

  return cleaned
    .split(/\n(?=\s*\d+[\).\-\s]+)/g)
    .map((part) => part.replace(/^\s*\d+[\).\-\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
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

    if (!prompt) return jsonResponse({ error: "Prompt base obrigatorio." }, 400);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return jsonResponse({ variations: fallbackVariations(prompt, variationLevel), fallback: true });
    }

    const levelInstructions: Record<string, string> = {
      low: "Faça variacoes conservadoras: mude poucas palavras, mantendo a estrutura.",
      medium: "Faça variacoes moderadas: mude abordagem, estrutura e vocabulario sem perder a intencao.",
      high: "Faça variacoes criativas: mude bastante o gancho, o ritmo e o CTA, mantendo a intencao.",
    };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: variationLevel === "low" ? 0.55 : variationLevel === "high" ? 1 : 0.85,
        max_tokens: 800,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "Voce cria mensagens curtas de WhatsApp para disparo comercial. Responda apenas JSON valido, sem markdown.",
          },
          {
            role: "user",
            content: `Gere exatamente 3 variacoes de mensagem de WhatsApp.\n\nIntencao/prompt base: ${prompt}\n\nNivel: ${variationLevel}\nInstrucao: ${levelInstructions[variationLevel]}\n\nRegras:\n- Portugues brasileiro natural\n- Maximo 500 caracteres por variacao\n- Nao invente dados que nao foram passados\n- Use emojis com moderacao\n- Retorne somente neste formato JSON: {"variations":["texto 1","texto 2","texto 3"]}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("preview-wa-variations AI error:", response.status, await response.text().catch(() => ""));
      return jsonResponse({ variations: fallbackVariations(prompt, variationLevel), fallback: true });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const variations = parseVariations(content);

    return jsonResponse({
      variations: variations.length >= 3 ? variations.slice(0, 3) : fallbackVariations(prompt, variationLevel),
      fallback: variations.length < 3,
    });
  } catch (err) {
    console.error("preview-wa-variations error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Erro interno" }, 500);
  }
});
