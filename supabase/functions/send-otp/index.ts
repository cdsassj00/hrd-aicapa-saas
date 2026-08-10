import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.99.1/cors";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { session_id } = await req.json();
    if (!session_id) {
      return new Response(JSON.stringify({ error: "session_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // [9] OTP는 invitation.email로 강제 송신 (초대 메일과 인증 메일 주소 일치 보장)
    // 1순위: 해당 session_id의 exam_invitations.email
    // 2순위(폴백): auth.user.email
    const serviceClientLookup = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: invitation } = await serviceClientLookup
      .from("exam_invitations")
      .select("email")
      .eq("session_id", session_id)
      .maybeSingle();

    const email = invitation?.email || user.email;
    if (!email) {
      return new Response(JSON.stringify({ error: "수신할 이메일 주소를 찾을 수 없습니다" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log(`[send-otp] session=${session_id} → ${invitation?.email ? 'invitation.email' : 'user.email(fallback)'}: ${email}`);

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    // Reuse serviceClientLookup created above
    const serviceClient = serviceClientLookup;

    const { error: insertError } = await serviceClient
      .from("sms_otp_codes")
      .insert({
        session_id,
        phone: email, // reusing phone column for email
        code,
        expires_at: expiresAt,
        verified: false,
      });

    if (insertError) {
      console.error("OTP insert error:", insertError);
      throw new Error("Failed to create OTP");
    }

    // Send email via Resend
    const html = `
      <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 480px; margin: 0 auto; padding: 30px;">
        <h2 style="color: #1a1a1a; font-size: 18px; margin-bottom: 20px;">📧 이메일 본인인증</h2>
        <p style="color: #333; font-size: 14px; line-height: 1.6;">
          아래 인증코드를 입력해 주세요.
        </p>
        <div style="background: #f0f4ff; border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #2563eb; font-family: monospace;">
            ${code}
          </span>
        </div>
        <p style="color: #888; font-size: 12px;">
          이 코드는 5분간 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.
        </p>
      </div>
    `;

    const response = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: "AI역량인증 시험 <noreply@aicapa.kr>",
        to: [email],
        subject: "[AI역량인증] 이메일 본인인증 코드",
        html,
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error("Resend error:", errData);
      throw new Error("Failed to send email");
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("send-otp error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
