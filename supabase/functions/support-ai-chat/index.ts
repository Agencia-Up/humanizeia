// ══════════════════════════════════════════════════════════════════════════
// support-ai-chat — Assistente de Suporte da Logos IA
//
// Responde dúvidas de USO da plataforma. Não executa ação nenhuma: só orienta.
//
// POR QUE NÃO USA O aiGateway DO JOSÉ (decisão, não esquecimento):
//   aquele gateway grava em jose_usage_ledger, que alimenta o TETO MENSAL e o
//   KILL-SWITCH do José. Cliente perguntando "como conecto o WhatsApp?"
//   queimaria o orçamento do gestor de tráfego dele e podia DERRUBAR o José.
//   Além disso o `capability` de lá é um ENUM do Postgres ('llm'|'stt'|'tts'|
//   'vision') e a config vem de jose_providers_config POR TENANT — o suporte
//   herdaria o provedor/modelo que o cliente escolheu pro José.
//
// POR QUE NÃO USA BYOK (chave do cliente):
//   o resolveAiKey tem corte de grandfathering em 2026-06-16 — conta criada
//   depois disso NÃO tem fallback pra chave da plataforma e receberia 402.
//   Ou seja: o cliente novo, que é justamente quem mais precisa de suporte,
//   abriria o chat de ajuda e levaria erro. E cobrar a chave do cliente pra ele
//   aprender a usar a nossa plataforma é errado — suporte é serviço NOSSO.
//   Logo: chave da PLATAFORMA, modelo barato, custo logado pra ver a margem.
// ══════════════════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiCall } from "../_shared/observability/aiCallLog.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const MODEL = "gpt-4o-mini";        // suporte não precisa de modelo caro
const MAX_OUTPUT_TOKENS = 700;
const MAX_QUESTION_CHARS = 1000;
const RATE_LIMIT_PER_MINUTE = 8;
const HISTORY_TURNS = 6;            // teto de contexto = teto de custo

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Resposta honesta quando a IA não está disponível. Nunca deixa o usuário no vácuo. */
const FALLBACK_MSG =
  "Não consegui responder agora por uma instabilidade do assistente. " +
  "Tente de novo em instantes — se continuar, fale com o suporte da Logos que a gente te ajuda direto.";

const SYSTEM_PROMPT = `Você é o Assistente de Suporte da Logos IA. Você ajuda o usuário a USAR a plataforma Logos IA.

REGRAS INEGOCIÁVEIS:
- Responda SOMENTE sobre uso da plataforma Logos IA. Qualquer outro assunto: diga que só ajuda com a Logos.
- Use APENAS o que estiver na BASE DE CONHECIMENTO abaixo. Se a base não cobrir a pergunta, diga que não encontrou material sobre isso e oriente a acionar o suporte humano. NUNCA invente funcionalidade, caminho de menu, botão ou passo.
- Você chegou aqui porque NÃO existe um passo a passo pronto que responda com segurança. Então NÃO monte um passo a passo por conta própria (poderia estar errado). Seja breve: diga que ainda não tem um tutorial cadastrado pra essa dúvida específica e sugira reformular a pergunta ou falar com o suporte humano. Se a base abaixo tiver algo PARCIALMENTE relacionado, aponte o título, mas não invente os passos.
- ANTES de responder, confira se o material abaixo REALMENTE trata do que a pessoa perguntou. Se ela perguntou de uma ferramenta/assunto que o material não cobre (ex.: perguntou de TikTok ou LinkedIn e o material fala de Meta Ads), NÃO empurre o material como se fosse a resposta — diga que ainda não tem tutorial daquele assunto específico.
- NUNCA invente link de vídeo. Só cite vídeo que estiver na seção VÍDEOS abaixo, com o título e a URL exatamente como vieram.
- Nunca exponha SQL, tokens, chaves, nomes de tabela, detalhes internos, nem dado de outro cliente.
- Você não executa ações: você orienta. Nunca diga que fez algo.
- Cobrança, pagamento, cancelamento ou plano: oriente a ir em "Meu Plano" e, se precisar, acionar o suporte humano.

FORMATO DA RESPOSTA:
1. Uma frase direta respondendo.
2. Passo a passo curto, numerado (só se fizer sentido).
3. Se houver vídeo na seção VÍDEOS, escreva: "Tutorial recomendado: <título> — <url>".
4. Termine com: "Isso resolveu sua dúvida?"

TOM: simples e direto, como um suporte humano paciente. O público tem dificuldade com tecnologia — nada de jargão. Português do Brasil. Seja breve.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });

  try {
    // ─── Auth ───────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Não autorizado" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Não autorizado" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const message: string = String(body?.message ?? "").trim();
    const currentPath: string = String(body?.current_path ?? "").slice(0, 120);
    const currentPageTitle: string = String(body?.current_page_title ?? "").slice(0, 120);
    let sessionId: string | null = body?.session_id ?? null;

    if (!message) return json({ error: "Escreva sua dúvida." }, 400);
    if (message.length > MAX_QUESTION_CHARS) {
      return json({ error: `Pergunta muito longa (máx. ${MAX_QUESTION_CHARS} caracteres). Tente resumir.` }, 400);
    }

    // ─── Tenant ─────────────────────────────────────────────────────────
    // O JWT dá o usuário, não a CONTA. Vendedor tem auth próprio mas os dados
    // vivem sob o master. As edges do José usam user.id cru como tenant — aqui
    // não dá, senão o custo do suporte do vendedor não cai na conta certa (e o
    // ai_call_log.user_id é explicitamente "TENANT (conta master)").
    let tenantId = user.id;
    try {
      const { data: member } = await admin
        .from("ai_team_members")
        .select("user_id")
        .eq("auth_user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (member?.user_id) tenantId = member.user_id;
    } catch { /* sem vínculo = é o próprio master */ }

    // ─── Rate limit ─────────────────────────────────────────────────────
    // Não existia NADA de rate limit no projeto (conferido). Contagem simples
    // por janela; usa idx_support_messages_user_time pra não virar scan.
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await admin
      .from("support_chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("role", "user")
      .gte("created_at", since);
    if ((recentCount ?? 0) >= RATE_LIMIT_PER_MINUTE) {
      return json({ error: "Muitas perguntas seguidas. Espere um minutinho e tente de novo." }, 429);
    }

    // ─── Sessão ─────────────────────────────────────────────────────────
    if (sessionId) {
      // Confere dono ANTES de escrever: sem isso, mandar um session_id alheio
      // no corpo enfiaria mensagem na conversa de outra pessoa (a edge usa
      // service role, então a RLS não protege aqui — a checagem é esta).
      const { data: owned } = await admin
        .from("support_chat_sessions")
        .select("id")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!owned) sessionId = null;
    }
    if (!sessionId) {
      const { data: created, error: sErr } = await admin
        .from("support_chat_sessions")
        .insert({
          user_id: user.id,
          tenant_id: tenantId,
          title: message.slice(0, 60),
        })
        .select("id")
        .single();
      if (sErr || !created) return json({ error: "Não consegui abrir a conversa." }, 500);
      sessionId = created.id;
    }

    await admin.from("support_chat_messages").insert({
      session_id: sessionId, user_id: user.id, tenant_id: tenantId,
      role: "user", content: message,
    });

    // ─── Base de conhecimento ───────────────────────────────────────────
    const [artRes, vidRes] = await Promise.all([
      admin.rpc("search_support_articles", { p_query: message, p_limit: 4 }),
      admin.rpc("search_support_videos", { p_query: message, p_limit: 3 }),
    ]);
    const artigos = (artRes.data ?? []) as any[];
    const videos = (vidRes.data ?? []) as any[];

    // Fonte = o que a IA REALMENTE recebeu. Gravado junto da resposta pra dar
    // pra auditar depois de onde ela tirou o que disse.
    const sources = [
      ...artigos.map((a) => ({ tipo: "artigo", id: a.id, slug: a.slug, titulo: a.title, rank: a.rank, modo: a.match_mode })),
      ...videos.map((v) => ({ tipo: "video", id: v.id, titulo: v.title, url: v.video_url })),
    ];

    // Linhas de vídeo (fixas — vêm do banco, a IA não inventa link).
    const videoLinhas = videos.length
      ? "\n\nTutorial recomendado:\n" + videos.map((v) => `▶ ${v.title} — ${v.video_url}`).join("\n")
      : "";

    // ══════════════════════════════════════════════════════════════════════
    // RESPOSTA CANÔNICA (o pedido do dono: "sempre o mesmo passo a passo")
    //
    // Se um artigo CASA com confiança, devolvemos o conteúdo dele LITERAL —
    // a IA NÃO reescreve o passo a passo. Isso elimina o risco de a IA
    // "gerar de novo" e errar: o texto é exatamente o que foi auditado e
    // salvo, igual toda vez. A IA (gpt-4o-mini) só entra no fallback abaixo,
    // quando NÃO há artigo — e lá ela é proibida de inventar passo.
    //
    // "Confiança" = casou no modo E (TODAS as palavras da pergunta batem).
    // Medido: o modo OU (fallback) NÃO serve pra resposta literal — ele casa
    // por palavra genérica ("conectar") e traz o artigo errado com rank alto
    // (ex.: "conecto o linkedin" → artigo do Meta Ads, rank 0.44). Rank não
    // separa certo de errado. Então: só o modo E vira resposta canônica; o OU
    // cai na IA abaixo, que consegue perceber "isto não responde a pergunta"
    // e admitir em vez de entregar passo errado como se fosse oficial.
    // ══════════════════════════════════════════════════════════════════════
    const top = artigos[0];
    const confiavel = top && top.match_mode === "and";

    if (top && confiavel) {
      // Texto 100% determinístico: conteúdo salvo + vídeo + fecho fixos.
      const reply = `${String(top.content).trim()}${videoLinhas}\n\nIsso resolveu sua dúvida?`;

      const { data: saved } = await admin
        .from("support_chat_messages")
        .insert({
          session_id: sessionId, user_id: user.id, tenant_id: tenantId,
          role: "assistant", content: reply,
          sources,                       // registra de qual artigo/vídeo veio
          tokens_used: 0,                // sem IA = sem token
        })
        .select("id")
        .single();

      await admin.from("support_chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);

      // Loga como atendimento de suporte SEM custo de IA (modelo sentinela).
      await logAiCall(admin, {
        userId: tenantId, disparoTipo: "chat_suporte",
        provedor: "base_conhecimento", modelo: "canonico",
        inputTokens: 0, outputTokens: 0, status: "ok",
        eventoOrigem: sessionId, meta: { artigo: top.slug, modo: top.match_mode, path: currentPath || null },
      });

      return json({
        session_id: sessionId,
        message_id: saved?.id ?? null,
        reply,
        sources,
        videos: videos.map((v) => ({ id: v.id, titulo: v.title, url: v.video_url, thumb: v.thumbnail_url, plataforma: v.platform })),
        canonico: true,        // front pode marcar "resposta oficial"
        sem_base: false,
      });
    }
    // ── Sem artigo confiável: cai no fallback de IA (nunca inventa passo) ──

    const baseTxt = artigos.length
      ? artigos.map((a, i) =>
          `[Artigo ${i + 1}] ${a.title}\n${a.summary ? a.summary + "\n" : ""}${String(a.content ?? "").slice(0, 1800)}`,
        ).join("\n\n---\n\n")
      : "(vazio — não há artigo publicado sobre isso)";

    // A IA só consegue citar link que está AQUI. "Não inventar link" vira
    // garantia estrutural (a lista vem do banco), não promessa no prompt.
    const videosTxt = videos.length
      ? videos.map((v) => `- ${v.title} — ${v.video_url}`).join("\n")
      : "(nenhum vídeo cadastrado para esta dúvida — NÃO cite vídeo nenhum)";

    const ctxTxt = currentPath
      ? `O usuário está agora na tela: ${currentPageTitle || currentPath} (${currentPath}). Use isso para contextualizar, se ajudar.`
      : "";

    // ─── Histórico curto ────────────────────────────────────────────────
    const { data: hist } = await admin
      .from("support_chat_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(HISTORY_TURNS);
    const historico = (hist ?? []).reverse().slice(0, -1); // tira a pergunta atual

    // ─── IA ─────────────────────────────────────────────────────────────
    if (!OPENAI_API_KEY) {
      // Falha fechado e honesto: nunca responder "de cabeça" sem a base.
      await admin.from("support_chat_messages").insert({
        session_id: sessionId, user_id: user.id, tenant_id: tenantId,
        role: "assistant", content: FALLBACK_MSG, sources: [],
      });
      return json({ session_id: sessionId, reply: FALLBACK_MSG, sources: [], videos: [], degraded: true });
    }

    const t0 = Date.now();
    let reply = FALLBACK_MSG;
    let usage: any = null;
    let status: "ok" | "error" = "error";

    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,   // suporte deve ser previsível, não criativo
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "system",
              content: `BASE DE CONHECIMENTO:\n\n${baseTxt}\n\nVÍDEOS DISPONÍVEIS (só pode citar estes):\n${videosTxt}\n\n${ctxTxt}`,
            },
            ...historico.map((m: any) => ({ role: m.role, content: m.content })),
            { role: "user", content: message },
          ],
        }),
      });
      if (r.ok) {
        const data = await r.json();
        const txt = data?.choices?.[0]?.message?.content?.trim();
        if (txt) { reply = txt; status = "ok"; }
        usage = data?.usage ?? null;
      } else {
        console.error("support-ai-chat: openai", r.status, (await r.text()).slice(0, 300));
      }
    } catch (e) {
      console.error("support-ai-chat: openai throw", e);
    }

    const { data: saved } = await admin
      .from("support_chat_messages")
      .insert({
        session_id: sessionId, user_id: user.id, tenant_id: tenantId,
        role: "assistant", content: reply,
        sources: status === "ok" ? sources : [],
        tokens_used: usage?.total_tokens ?? 0,
      })
      .select("id")
      .single();

    await admin.from("support_chat_sessions").update({ updated_at: new Date().toISOString() }).eq("id", sessionId);

    // Custo é da LOGOS (chave da plataforma), mas fica sob o tenant pra dar pra
    // ver quanto cada conta custa de suporte. Best-effort: nunca derruba a resposta.
    await logAiCall(admin, {
      userId: tenantId,
      disparoTipo: "chat_suporte",
      provedor: "openai",
      modelo: MODEL,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      latenciaMs: Date.now() - t0,
      status,
      eventoOrigem: sessionId,
      meta: { artigos: artigos.length, videos: videos.length, path: currentPath || null },
    });

    return json({
      session_id: sessionId,
      message_id: saved?.id ?? null,
      reply,
      sources,
      videos: videos.map((v) => ({ id: v.id, titulo: v.title, url: v.video_url, thumb: v.thumbnail_url, plataforma: v.platform })),
      // Sinaliza pro front quando a base não cobriu — a IA admitiu limitação.
      sem_base: artigos.length === 0,
      degraded: status !== "ok",
    });
  } catch (e: any) {
    console.error("support-ai-chat: fatal", e);
    return json({ error: "Erro no assistente de suporte.", reply: FALLBACK_MSG }, 500);
  }
});
