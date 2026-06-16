import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── PALETA DE CORES LogosIA ────────────────────────────────────────
const COLORS = {
  primary:    '#14b89a',
  secondary:  '#2bbdab',
  dark:       '#071620',
  card:       '#101f2c',
  cardBorder: '#1a3040',
  text:       '#e8f5f2',
  muted:      '#7db5a8',
};

// ─── TEMPLATE BASE ─────────────────────────────────────────────────────────
function baseTemplate(content: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>LogosIA</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background-color: ${COLORS.dark}; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: ${COLORS.text}; }
    a { color: ${COLORS.primary}; }
  </style>
</head>
<body style="background-color:${COLORS.dark}; padding:0; margin:0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.dark}; padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

          <!-- HEADER / LOGO -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="
                    background: linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary});
                    border-radius:16px;
                    padding:12px 16px;
                    display:inline-block;
                  ">
                    <span style="font-size:22px; font-weight:800; color:#ffffff; letter-spacing:-0.5px;">
                      ✦ LogosIA
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CARD PRINCIPAL -->
          <tr>
            <td style="
              background-color:${COLORS.card};
              border:1px solid ${COLORS.cardBorder};
              border-radius:20px;
              overflow:hidden;
            ">
              <!-- tabela interna OBRIGATORIA: <tr> nao pode ser filho direto de <td>.
                   Sem ela, o Gmail descarta/embaralha o conteudo (botao + link somem). -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;">
                <!-- BARRA GRADIENTE TOPO -->
                <tr>
                  <td style="
                    height:4px; font-size:0; line-height:0;
                    background: linear-gradient(90deg, ${COLORS.primary}, ${COLORS.secondary}, ${COLORS.primary});
                  ">&nbsp;</td>
                </tr>

                <!-- CONTEÚDO -->
                <tr>
                  <td style="padding:48px 40px;">
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td align="center" style="padding-top:32px;">
              <p style="color:${COLORS.muted}; font-size:12px; line-height:1.6;">
                © ${new Date().getFullYear()} LogosIA. Todos os direitos reservados.<br>
                Você está recebendo este email porque possui uma conta em nossa plataforma.
              </p>
              <p style="margin-top:12px;">
                <a href="https://logosia.com.br/privacy-policy" style="color:${COLORS.muted}; font-size:12px; text-decoration:none; margin:0 8px;">Política de Privacidade</a>
                <span style="color:${COLORS.cardBorder};">|</span>
                <a href="https://logosia.com.br/terms-of-service" style="color:${COLORS.muted}; font-size:12px; text-decoration:none; margin:0 8px;">Termos de Serviço</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── BOTÃO CTA ──────────────────────────────────────────────────────────────
function ctaButton(label: string, url: string): string {
  return `
    <table cellpadding="0" cellspacing="0" style="margin:32px auto;">
      <tr>
        <td align="center" bgcolor="${COLORS.primary}" style="
          background-color: ${COLORS.primary};
          background: linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary});
          border-radius:12px;
        ">
          <a href="${url}" style="
            display:inline-block;
            padding:16px 40px;
            color:#ffffff;
            background-color: ${COLORS.primary};
            border-radius:12px;
            font-weight:700;
            font-size:16px;
            text-decoration:none;
            letter-spacing:0.3px;
          ">${label}</a>
        </td>
      </tr>
    </table>`;
}

// ─── CARD DE FEATURE ────────────────────────────────────────────────────────
function featureItem(emoji: string, title: string, desc: string): string {
  return `
    <tr>
      <td style="padding:10px 0;">
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="44" valign="top" style="padding-top:2px;">
              <div style="
                width:36px; height:36px;
                background: linear-gradient(135deg, ${COLORS.primary}22, ${COLORS.secondary}22);
                border:1px solid ${COLORS.primary}44;
                border-radius:8px;
                text-align:center;
                line-height:36px;
                font-size:18px;
              ">${emoji}</div>
            </td>
            <td style="padding-left:12px;">
              <p style="color:${COLORS.text}; font-weight:600; font-size:14px; margin-bottom:2px;">${title}</p>
              <p style="color:${COLORS.muted}; font-size:13px;">${desc}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// ─── EMAIL: BOAS-VINDAS ─────────────────────────────────────────────────────
function welcomeEmail(name: string, loginUrl: string): string {
  const content = `
    <!-- ÍCONE TOPO -->
    <div style="text-align:center; margin-bottom:28px;">
      <div style="
        display:inline-block;
        width:72px; height:72px;
        background: linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary});
        border-radius:18px;
        line-height:72px;
        text-align:center;
        font-size:36px;
        box-shadow: 0 8px 32px ${COLORS.primary}44;
      ">✦</div>
    </div>

    <h1 style="text-align:center; color:${COLORS.text}; font-size:28px; font-weight:800; margin-bottom:8px;">
      Bem-vindo, ${name}! 🎉
    </h1>
    <p style="text-align:center; color:${COLORS.muted}; font-size:15px; margin-bottom:36px;">
      Sua conta foi criada com sucesso. Você agora faz parte da plataforma de marketing mais inteligente do Brasil.
    </p>

    <!-- DIVISOR -->
    <div style="height:1px; background:${COLORS.cardBorder}; margin:0 0 28px;"></div>

    <p style="color:${COLORS.muted}; font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:1px; margin-bottom:16px;">
      O que você pode fazer agora:
    </p>

    <table cellpadding="0" cellspacing="0" width="100%">
      ${featureItem('📊', 'Meta Ads Dashboard', 'Veja todas as métricas das suas campanhas em tempo real')}
      ${featureItem('🤖', 'IA Avançada', 'Deixe a inteligência artificial otimizar seus anúncios')}
      ${featureItem('⚡', 'Automação', 'Crie regras automáticas e relatórios agendados')}
      ${featureItem('📈', 'Google & TikTok Ads', 'Gerencie todas as plataformas em um só lugar')}
    </table>

    ${ctaButton('Acessar a Plataforma →', loginUrl)}

    <div style="height:1px; background:${COLORS.cardBorder}; margin:0 0 24px;"></div>

    <p style="color:${COLORS.muted}; font-size:13px; text-align:center; line-height:1.6;">
      Precisa de ajuda? Fale conosco em
      <a href="mailto:carvalho@scalpergx.com.br" style="color:${COLORS.primary};">carvalho@scalpergx.com.br</a>
    </p>
  `;
  return baseTemplate(content);
}

// ─── EMAIL: RECUPERAÇÃO DE SENHA ────────────────────────────────────────────
function resetPasswordEmail(name: string, resetUrl: string): string {
  const content = `
    <!-- ÍCONE TOPO -->
    <div style="text-align:center; margin-bottom:28px;">
      <div style="
        display:inline-block;
        width:72px; height:72px;
        background: linear-gradient(135deg, #f59e0b, #f97316);
        border-radius:18px;
        line-height:72px;
        text-align:center;
        font-size:36px;
        box-shadow: 0 8px 32px #f59e0b44;
      ">🔐</div>
    </div>

    <h1 style="text-align:center; color:${COLORS.text}; font-size:26px; font-weight:800; margin-bottom:8px;">
      Recuperação de Senha
    </h1>
    <p style="text-align:center; color:${COLORS.muted}; font-size:15px; margin-bottom:32px;">
      Olá, <strong style="color:${COLORS.text};">${name}</strong>! Recebemos uma solicitação para redefinir a senha da sua conta LogosIA.
    </p>

    <!-- ALERTA -->
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
      <tr>
        <td style="
          background: #f59e0b18;
          border: 1px solid #f59e0b44;
          border-left: 4px solid #f59e0b;
          border-radius:8px;
          padding:14px 18px;
        ">
          <p style="color:#f59e0b; font-size:13px; line-height:1.5; margin:0;">
            ⚠️ Este link expira em <strong>1 hora</strong>. Se você não solicitou a redefinição, ignore este email — sua senha permanece a mesma.
          </p>
        </td>
      </tr>
    </table>

    ${ctaButton('Redefinir Minha Senha →', resetUrl)}

    <div style="height:1px; background:${COLORS.cardBorder}; margin:0 0 24px;"></div>

    <p style="color:${COLORS.muted}; font-size:13px; text-align:center; line-height:1.6;">
      Ou copie e cole este link no seu navegador:<br>
      <a href="${resetUrl}" style="color:${COLORS.primary}; word-break:break-all; font-size:12px;">${resetUrl}</a>
    </p>

    <p style="color:${COLORS.muted}; font-size:12px; text-align:center; margin-top:20px;">
      Por segurança, nunca compartilhe este link com ninguém. A equipe LogosIA jamais pedirá sua senha.
    </p>
  `;
  return baseTemplate(content);
}

// ─── EMAIL: TROCA DE EMAIL ───────────────────────────────────────────────────
function emailChangeEmail(name: string, newEmail: string, confirmUrl: string): string {
  const content = `
    <!-- ÍCONE TOPO -->
    <div style="text-align:center; margin-bottom:28px;">
      <div style="
        display:inline-block;
        width:72px; height:72px;
        background: linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary});
        border-radius:18px;
        line-height:72px;
        text-align:center;
        font-size:36px;
        box-shadow: 0 8px 32px ${COLORS.primary}44;
      ">✉️</div>
    </div>

    <h1 style="text-align:center; color:${COLORS.text}; font-size:26px; font-weight:800; margin-bottom:8px;">
      Confirme seu Novo Email
    </h1>
    <p style="text-align:center; color:${COLORS.muted}; font-size:15px; margin-bottom:32px;">
      Olá, <strong style="color:${COLORS.text};">${name}</strong>! Você solicitou a alteração do email da sua conta.
    </p>

    <!-- NOVO EMAIL DESTAQUE -->
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
      <tr>
        <td style="
          background: ${COLORS.primary}18;
          border: 1px solid ${COLORS.primary}44;
          border-radius:12px;
          padding:20px;
          text-align:center;
        ">
          <p style="color:${COLORS.muted}; font-size:12px; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Novo endereço de email</p>
          <p style="color:${COLORS.primary}; font-size:18px; font-weight:700;">${newEmail}</p>
        </td>
      </tr>
    </table>

    <!-- ALERTA -->
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:8px;">
      <tr>
        <td style="
          background: #3b82f618;
          border: 1px solid #3b82f644;
          border-left: 4px solid #3b82f6;
          border-radius:8px;
          padding:14px 18px;
        ">
          <p style="color:#93c5fd; font-size:13px; line-height:1.5; margin:0;">
            ℹ️ Este link expira em <strong>24 horas</strong>. Caso não tenha feito esta solicitação, ignore este email.
          </p>
        </td>
      </tr>
    </table>

    ${ctaButton('Confirmar Novo Email →', confirmUrl)}

    <div style="height:1px; background:${COLORS.cardBorder}; margin:0 0 24px;"></div>

    <p style="color:${COLORS.muted}; font-size:13px; text-align:center; line-height:1.6;">
      Ou copie e cole este link no seu navegador:<br>
      <a href="${confirmUrl}" style="color:${COLORS.primary}; word-break:break-all; font-size:12px;">${confirmUrl}</a>
    </p>
  `;
  return baseTemplate(content);
}

// ─── HANDLER PRINCIPAL ──────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY não configurada' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { type, email, name = 'Usuário', redirectTo } = body;

    let subject = '';
    let html = '';
    // Dominio canonico do app = site_url do Auth (logosiabrasil.com). PRECISA bater com a
    // uri_allow_list, senao o Supabase descarta o redirect_to e joga pra raiz do site ->
    // cliente clica no link e cai na home, nao na tela de redefinir senha.
    const appUrl = redirectTo?.includes('localhost')
      ? 'http://localhost:8080'
      : 'https://logosiabrasil.com';

    if (type === 'welcome') {
      subject = '🎉 Bem-vindo à LogosIA!';
      html = welcomeEmail(name, `${appUrl}/auth`);

    } else if (type === 'reset_password') {
      // Usa Supabase Admin para gerar o link de recuperação
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );

      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {
          redirectTo: redirectTo ?? `${appUrl}/reset-password`,
        },
      });

      if (error || !data?.properties?.action_link) {
        return new Response(JSON.stringify({ error: error?.message ?? 'Erro ao gerar link' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      subject = '🔐 Recuperação de senha - LogosIA';
      html = resetPasswordEmail(name, data.properties.action_link);

    } else if (type === 'email_change') {
      const { newEmail, confirmUrl } = body;
      subject = '✉️ Confirme seu novo email - LogosIA';
      html = emailChangeEmail(name, newEmail, confirmUrl ?? `${appUrl}/auth`);

    } else {
      return new Response(JSON.stringify({ error: `Tipo de email desconhecido: ${type}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Envia via Resend
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Logosai <suporte@logosiabrasil.com>',
        to: [email],
        subject,
        html,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error('Resend error:', resendData);
      return new Response(JSON.stringify({ error: 'Erro ao enviar email', details: resendData }), {
        status: resendRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('send-email error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
