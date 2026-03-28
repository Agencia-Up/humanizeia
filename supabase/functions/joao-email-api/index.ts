import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Não autorizado');
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) throw new Error('Token inválido');

    const body = await req.json();
    const { action } = body;

    if (action === 'generate_email') {
      return await generateEmail(body, corsHeaders);
    }

    if (action === 'send_campaign') {
      return await sendCampaign(body, user, supabase, corsHeaders);
    }


    throw new Error(`Ação desconhecida: ${action}`);

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function generateEmail(body: any, cors: Record<string, string>) {
  const {
    topic, audience, goal, tone, sender_name = 'Nossa Equipe',
    include_ps = true, include_emoji = true,
  } = body;

  const openaiKey = Deno.env.get('OPENAI_API_KEY');

  if (!openaiKey) {
    // Demo fallback
    return new Response(JSON.stringify({
      email: buildDemoEmail(topic, audience, goal, tone, sender_name, include_ps, include_emoji),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const systemPrompt = `Você é JOÃO, especialista em email marketing de alta conversão.
Escreve emails em português brasileiro que geram abertura, cliques e vendas.
Retorne APENAS um JSON válido.`;

  const goalMap: Record<string, string> = {
    nurturing: 'nutrição de leads (educar e criar relacionamento)',
    vendas: 'venda direta com urgência',
    reativacao: 'reativação de clientes inativos',
    onboarding: 'onboarding de novos clientes',
    newsletter: 'newsletter informativa e de valor',
    promocao: 'promoção / oferta especial com escassez',
  };

  const userPrompt = `Crie um email de ${goalMap[goal] || goal} sobre "${topic}" para "${audience || 'nossos clientes'}".
Tom: ${tone}. Remetente: ${sender_name}. Emojis no assunto: ${include_emoji ? 'sim' : 'não'}. P.S. no final: ${include_ps ? 'sim' : 'não'}.

Retorne este JSON:
{
  "subject": "assunto do email (max 50 chars, impactante)",
  "preview": "texto de preview (max 100 chars, complementa o assunto)",
  "body": "corpo completo do email em texto plano, com saudação, conteúdo principal, CTA claro${include_ps ? ' e P.S.' : ''}"
}

Regras para o body:
- Comece com saudação personalizada (Olá, [nome]! ou similar)
- Parágrafos curtos (2-3 linhas máx)
- CTA explícito e único
- Tom ${tone} do início ao fim
- Máximo 300 palavras
${include_ps ? '- Adicione um P.S. poderoso no final' : ''}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI: ${res.status}`);
  const data = await res.json();
  const email = JSON.parse(data.choices?.[0]?.message?.content || '{}');

  return new Response(JSON.stringify({ email }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function buildDemoEmail(
  topic: string, audience: string, goal: string, tone: string,
  sender: string, ps: boolean, emoji: boolean
) {
  const subjectEmoji = emoji ? '🎯 ' : '';
  return {
    subject: `${subjectEmoji}${topic} — o que você precisa saber`,
    preview: `Olá! Preparamos algo especial para você sobre ${topic}.`,
    body: `Olá, [nome]!

Tudo bem? Eu sou ${sender} e estou escrevendo porque tenho algo importante para compartilhar sobre ${topic}.

Sei que você, como ${audience || 'nosso cliente'}, busca resultados reais. E foi exatamente pensando nisso que preparamos este conteúdo especial.

Aqui está o que você vai descobrir:

✅ Como ${topic} pode transformar seus resultados
✅ Os erros mais comuns que impedem o sucesso
✅ O próximo passo que você deve dar hoje

👉 [CLIQUE AQUI PARA SABER MAIS]

Não deixe para depois — as melhores oportunidades têm prazo.

Um abraço,
${sender}

${ps ? `P.S. Essa é uma oportunidade única. Quem agir agora vai sair na frente. Clique no botão acima e comece hoje mesmo.` : ''}`.trim(),
  };
}

// ─── SEND CAMPAIGN ──────────────────────────────────────────────────────────
async function sendCampaign(body: any, user: any, supabase: any, cors: Record<string, string>) {
  const { to_email, to_name = '', subject, body_text, cta_url = '', cta_label = 'Saiba mais' } = body;

  if (!to_email || !subject || !body_text) {
    return new Response(JSON.stringify({ error: 'to_email, subject e body_text são obrigatórios.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Busca credenciais Resend salvas pelo usuário em platform_integrations
  const { data: integration } = await supabase
    .from('platform_integrations')
    .select('metadata, api_key_encrypted')
    .eq('user_id', user.id)
    .eq('platform', 'resend')
    .eq('is_active', true)
    .maybeSingle();

  // Fallback para RESEND_API_KEY global da plataforma
  const resendKey = integration?.api_key_encrypted || Deno.env.get('RESEND_API_KEY');
  const fromEmail = integration?.metadata?.from_email || 'LogosIA <onboarding@resend.dev>';
  const fromName = integration?.metadata?.from_email
    ? `João — ${integration.metadata.from_email}`
    : 'João — LogosIA';

  if (!resendKey) {
    return new Response(JSON.stringify({
      error: 'Resend não configurado. Vá em Integrações → Outras Integrações → Resend e adicione sua API Key.',
    }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  // Monta HTML simples mas bonito
  const ctaBlock = cta_url
    ? `<div style="text-align:center;margin:28px 0;">
        <a href="${cta_url}" style="display:inline-block;padding:14px 36px;background:#14b89a;color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px;">${cta_label}</a>
       </div>`
    : '';

  const htmlBody = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="background:#071620;font-family:Inter,sans-serif;color:#e8f5f2;padding:32px 16px;">
  <div style="max-width:600px;margin:0 auto;background:#101f2c;border:1px solid #1a3040;border-radius:16px;padding:40px;">
    <div style="height:4px;background:linear-gradient(90deg,#14b89a,#2bbdab);border-radius:4px;margin-bottom:32px;"></div>
    ${to_name ? `<p style="color:#7db5a8;font-size:15px;margin-bottom:20px;">Olá, <strong style="color:#e8f5f2;">${to_name}</strong>!</p>` : ''}
    <div style="white-space:pre-line;color:#e8f5f2;font-size:15px;line-height:1.75;">${body_text.replace(/\n/g, '<br>')}</div>
    ${ctaBlock}
    <hr style="border:none;border-top:1px solid #1a3040;margin:28px 0;">
    <p style="color:#7db5a8;font-size:12px;text-align:center;">Enviado por ${fromName}</p>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail,
      to: [to_email],
      subject,
      html: htmlBody,
    }),
  });

  const result = await res.json();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: 'Erro ao enviar via Resend.', details: result }), {
      status: res.status, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true, email_id: result.id }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
