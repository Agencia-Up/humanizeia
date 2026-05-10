import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.split(" ")[1]);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const masterUserId = userData.user.id;

    const { memberId, email } = await req.json();
    if (!memberId || !email) {
      return new Response(JSON.stringify({ error: "memberId and email required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify member belongs to this master
    const { data: member, error: memberErr } = await supabase
      .from("ai_team_members")
      .select("id, name, email, auth_user_id")
      .eq("id", memberId)
      .eq("user_id", masterUserId)
      .single();

    if (memberErr || !member) {
      return new Response(JSON.stringify({ error: "Member not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const origin = req.headers.get("origin") || "https://logosiabrasil.com";
    const redirectTo = `${origin}/auth/confirm`;

    // Try to invite user via Supabase Auth
    const { data: inviteData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name: member.name, role: "seller", master_user_id: masterUserId },
      redirectTo,
    });

    let action = "invited";
    let authUserId: string | null = null;

    if (inviteErr) {
      // User might already exist — try to find and link them
      if (inviteErr.message?.toLowerCase().includes("already") || inviteErr.status === 422) {
        const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const existingUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (existingUser) {
          await supabase.from("ai_team_members").update({ email, auth_user_id: existingUser.id }).eq("id", memberId);
          action = "linked";
          authUserId = existingUser.id;

          // Send email via Resend to notify user their account was linked
          await sendInviteEmailViaResend(email, member.name, origin, "linked");

          return new Response(JSON.stringify({ success: true, action: "linked", message: "Usuário já existia e foi vinculado." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      console.error("invite-seller: inviteUserByEmail failed:", inviteErr.message);
      throw inviteErr;
    }

    // Link auth_user_id
    if (inviteData?.user?.id) {
      authUserId = inviteData.user.id;
      await supabase.from("ai_team_members").update({ email, auth_user_id: inviteData.user.id }).eq("id", memberId);
    }

    // ── Enviar email de convite via Resend API (garantia de entrega) ─────────
    // O Supabase Auth tenta enviar via SMTP, mas pode falhar silenciosamente.
    // Enviamos também via Resend API diretamente para garantir que o vendedor
    // receba o convite. O link de confirmação é gerado pelo Supabase Auth.
    const confirmUrl = inviteData?.user?.confirmation_sent_at
      ? `${origin}/auth/confirm`
      : redirectTo;

    // Gerar um magic link para o vendedor acessar direto
    let magicLink = "";
    if (authUserId) {
      const { data: linkData } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });
      if (linkData?.properties?.action_link) {
        magicLink = linkData.properties.action_link;
      }
    }

    const emailSent = await sendInviteEmailViaResend(
      email,
      member.name,
      origin,
      "invited",
      magicLink || confirmUrl,
    );

    console.log(`invite-seller: convite para ${email} — auth: OK | resend email: ${emailSent ? "OK" : "FALHOU"}`);

    return new Response(JSON.stringify({
      success: true,
      action: "invited",
      message: `Convite enviado para ${email}`,
      emailSent,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("invite-seller error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ── Envio direto via Resend API ──────────────────────────────────────────────
async function sendInviteEmailViaResend(
  toEmail: string,
  sellerName: string,
  siteUrl: string,
  action: "invited" | "linked",
  confirmLink?: string,
): Promise<boolean> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.error("invite-seller: RESEND_API_KEY não configurada — email não enviado");
    return false;
  }

  const loginUrl = confirmLink || `${siteUrl}/login`;

  const subject = action === "linked"
    ? "Sua conta foi vinculada — LogosIA"
    : "Você foi convidado para a LogosIA!";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#1a2350 0%,#2d3a7c 55%,#b8953a 100%);padding:32px 24px;text-align:center;">
      <h1 style="color:#ffffff;font-size:22px;margin:0;">LogosIA</h1>
      <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:8px 0 0;">${action === "linked" ? "Conta vinculada com sucesso" : "Convite para a equipe"}</p>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:#1a2350;font-size:18px;margin:0 0 16px;">Olá, ${sellerName}!</h2>
      ${action === "linked"
        ? `<p style="color:#555;font-size:14px;line-height:1.6;">Sua conta foi vinculada à plataforma LogosIA. Você já pode acessar usando seu email <strong>${toEmail}</strong>.</p>`
        : `<p style="color:#555;font-size:14px;line-height:1.6;">Você foi convidado para fazer parte da equipe na plataforma <strong>LogosIA</strong>. Clique no botão abaixo para criar sua conta e começar a acompanhar seus leads:</p>`
      }
      <div style="text-align:center;margin:28px 0;">
        <a href="${loginUrl}" style="
          display:inline-block;
          background:linear-gradient(135deg,#1a2350 0%,#2d3a7c 55%,#b8953a 100%);
          color:#ffffff;
          text-decoration:none;
          font-weight:bold;
          font-size:14px;
          letter-spacing:1px;
          text-transform:uppercase;
          padding:14px 36px;
          border-radius:6px;
        ">${action === "linked" ? "Acessar plataforma" : "Aceitar convite"}</a>
      </div>
      <p style="color:#999;font-size:12px;line-height:1.5;">
        Se o botão não funcionar, copie e cole este link no navegador:<br>
        <a href="${loginUrl}" style="color:#2d3a7c;word-break:break-all;">${loginUrl}</a>
      </p>
    </div>
    <div style="background:#f9f9f9;padding:16px 24px;text-align:center;border-top:1px solid #eee;">
      <p style="color:#aaa;font-size:11px;margin:0;">Equipe LogosIA — suporte@logosiabrasil.com</p>
    </div>
  </div>
</body>
</html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Logosai <suporte@logosiabrasil.com>",
        to: [toEmail],
        subject,
        html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("invite-seller: Resend API error:", JSON.stringify(data));
      return false;
    }

    console.log("invite-seller: Email enviado via Resend, id:", data.id);
    return true;
  } catch (err) {
    console.error("invite-seller: Resend fetch error:", err);
    return false;
  }
}
