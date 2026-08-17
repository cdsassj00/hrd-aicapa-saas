import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

import { sendEmail } from "../_shared/email.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User context client for auth validation
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service role client for DB queries (bypasses RLS)
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { examId, invitationIds, siteUrl } = body;

    if (!examId || !invitationIds?.length || !siteUrl) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch exam info
    const { data: exam } = await supabase
      .from("exams")
      .select("title, exam_date, duration_minutes, grade")
      .eq("id", examId)
      .single();

    if (!exam) {
      return new Response(JSON.stringify({ error: "Exam not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch invitations
    const { data: invitations } = await supabase
      .from("exam_invitations")
      .select("id, email, name, invite_code")
      .in("id", invitationIds);

    if (!invitations?.length) {
      return new Response(JSON.stringify({ error: "No invitations found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch email settings from site_settings
    const { data: emailSettings } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", ["email_subject_prefix", "email_from_name", "email_from_address"]);

    // 원본은 발신자를 "[행정안전부·NIA] / noreply@aicapa.kr" 로 하드코딩하고 있었다.
    // 그 주소는 다른 서비스의 운영 도메인이라 여기서 쓰면 안 되고, 애초에 Resend 에
    // 검증되지 않은 도메인으로 보내면 발송 자체가 거절된다.
    // 조직이 설정하지 않았으면 MAIL_FROM 환경변수를 쓴다.
    let emailPrefix = "";
    let fromName = "";
    let fromAddress = "";
    if (emailSettings) {
      for (const row of emailSettings) {
        if (row.key === "email_subject_prefix") emailPrefix = row.value ?? "";
        if (row.key === "email_from_name") fromName = row.value ?? "";
        if (row.key === "email_from_address") fromAddress = row.value ?? "";
      }
    }

    // 발신 주소가 없으면 MAIL_FROM 으로 떨어진다. 그것도 없으면 보내지 않는다 —
    // 잘못된 발신자로 나가는 것보다 실패하는 편이 낫다.
    const fallbackFrom = Deno.env.get("MAIL_FROM") ?? "";
    if (!fromAddress && !fallbackFrom) {
      return new Response(
        JSON.stringify({ error: "발신 주소가 설정되지 않았습니다. 관리자 설정의 발신 이메일 또는 MAIL_FROM 을 지정하세요." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const examDate = new Date(exam.exam_date).toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const inv of invitations) {
      const examLink = `${siteUrl}/login?invite=${inv.invite_code}`;

      const html = `
        <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; padding: 30px;">
          <h2 style="color: #1a1a1a; font-size: 20px; margin-bottom: 24px;">
            📋 평가 응시 안내
          </h2>
          <p style="color: #333; font-size: 14px; line-height: 1.8;">
            ${inv.name || '응시자'}님, 안녕하세요.<br/>
            아래 평가에 응시하도록 초대되었습니다.
          </p>
          <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 20px 0;">
            <table style="width: 100%; font-size: 14px; color: #333;">
              <tr><td style="padding: 6px 0; font-weight: 600; width: 80px;">평가명</td><td>${exam.title}</td></tr>
              <tr><td style="padding: 6px 0; font-weight: 600;">등급</td><td>${exam.grade}</td></tr>
              <tr><td style="padding: 6px 0; font-weight: 600;">일시</td><td>${examDate}</td></tr>
              <tr><td style="padding: 6px 0; font-weight: 600;">시간</td><td>${exam.duration_minutes}분</td></tr>
              <tr><td style="padding: 6px 0; font-weight: 600;">응시코드</td><td style="font-family: monospace; font-size: 16px; font-weight: bold; color: #2563eb;">${inv.invite_code}</td></tr>
            </table>
          </div>
          <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <p style="color: #856404; font-size: 13px; margin: 0; line-height: 1.6;">
              📧 <strong>별도 회원가입 없이 이메일 인증만으로 응시할 수 있습니다.</strong><br/>
              아래 버튼을 클릭하면 이메일 인증코드가 발송되며, 코드 입력 후 바로 평가에 입장합니다.
            </p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${examLink}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 15px; font-weight: 600;">
              📋 평가 응시하기
            </a>
          </div>
          <p style="color: #888; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 16px;">
            본 메일은 자동 발송되었습니다. 문의사항이 있으시면 관리자에게 연락해 주세요.
          </p>
        </div>
      `;

      try {
        await sendEmail({
          // 조직이 발신 주소를 정했으면 그걸, 아니면 MAIL_FROM 을 그대로 쓴다.
          // MAIL_FROM 은 이미 "이름 <주소>" 형태이므로 다시 감싸지 않는다.
          from: fromAddress
            ? (fromName ? `${fromName} <${fromAddress}>` : fromAddress)
            : fallbackFrom,
          to: inv.email,
          subject: emailPrefix
            ? `${emailPrefix} ${exam.title} 응시 초대`
            : `${exam.title} 응시 초대`,
          html,
        });
        results.push({ email: inv.email, success: true });
      } catch (e) {
        // 한 통 실패가 나머지를 막지 않도록 건별로 모은다(원본 동작 유지)
        results.push({ email: inv.email, success: false, error: (e as Error).message });
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({ sent, failed, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("send-exam-invitation error:", e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
