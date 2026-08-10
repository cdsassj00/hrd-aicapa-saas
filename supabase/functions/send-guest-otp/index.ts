import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { email: rawEmail, invite_code } = await req.json();
    if (!rawEmail || !invite_code) {
      return new Response(JSON.stringify({ error: "email and invite_code are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const email = String(rawEmail).trim().toLowerCase();

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate invite code (test mode 시험은 is_used 무시)
    const { data: inv } = await serviceClient
      .from("exam_invitations")
      .select("id, email, exam_id, is_used, exams(is_test_mode)")
      .eq("invite_code", invite_code.toUpperCase())
      .maybeSingle();

    if (!inv) {
      return new Response(JSON.stringify({ error: "유효하지 않은 초대코드입니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isTestMode = (inv as any).exams?.is_test_mode === true;

    // 본인 active session 있으면 재접속 허용 (튕긴 응시자 복귀)
    let hasActiveSession = false;
    if (inv.is_used && !isTestMode) {
      const { data: usersList } = await serviceClient.auth.admin.listUsers({ perPage: 1000 });
      const user = usersList?.users?.find((u: any) => u.email === email);
      if (user) {
        const { data: activeSess } = await serviceClient
          .from('exam_sessions')
          .select('id')
          .eq('exam_id', inv.exam_id)
          .eq('applicant_id', user.id)
          .in('status', ['waiting', 'in_progress'])
          .maybeSingle();
        hasActiveSession = !!activeSess;
      }
    }

    if (inv.is_used && !isTestMode && !hasActiveSession) {
      return new Response(JSON.stringify({ error: "이미 사용된 초대코드입니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Store OTP (using invite_code as a pseudo session_id)
    const { error: insertError } = await serviceClient
      .from("sms_otp_codes")
      .insert({
        session_id: inv.id, // reuse invitation id as session ref
        phone: email,
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
        <h2 style="color: #1a1a1a; font-size: 18px; margin-bottom: 20px;">🔐 시험 입장 인증코드</h2>
        <p style="color: #333; font-size: 14px; line-height: 1.6;">
          아래 인증코드를 입력하면 시험에 바로 입장할 수 있습니다.
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
        subject: "[AI역량인증] 시험 입장 인증코드",
        html,
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error("Resend error:", errData);
      throw new Error("Failed to send email");
    }

    return new Response(JSON.stringify({ success: true, invitation_id: inv.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("send-guest-otp error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
