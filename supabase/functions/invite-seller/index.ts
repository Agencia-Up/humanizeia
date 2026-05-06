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

    const origin = req.headers.get("origin") || "https://app.logosiaplatform.com";
    const redirectTo = `${origin}/auth/confirm`;

    // Try to invite user
    const { data: inviteData, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { full_name: member.name, role: "seller", master_user_id: masterUserId },
      redirectTo,
    });

    if (inviteErr) {
      // User might already exist — try to find and link them
      if (inviteErr.message?.toLowerCase().includes("already") || inviteErr.status === 422) {
        const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const existingUser = listData?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (existingUser) {
          await supabase.from("ai_team_members").update({ email, auth_user_id: existingUser.id }).eq("id", memberId);
          return new Response(JSON.stringify({ success: true, action: "linked", message: "Usuário já existia e foi vinculado." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      throw inviteErr;
    }

    // Link auth_user_id
    if (inviteData?.user?.id) {
      await supabase.from("ai_team_members").update({ email, auth_user_id: inviteData.user.id }).eq("id", memberId);
    }

    return new Response(JSON.stringify({ success: true, action: "invited", message: `Convite enviado para ${email}` }), {
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
