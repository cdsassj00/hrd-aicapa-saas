import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email: rawEmail, code, invite_code, name } = await req.json();
    if (!rawEmail || !code || !invite_code) {
      return new Response(JSON.stringify({ error: "email, code, and invite_code are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const email = String(rawEmail).trim().toLowerCase();

    async function findUserByEmail(serviceClient: any, targetEmail: string) {
      for (let page = 1; page <= 20; page++) {
        const { data } = await serviceClient.auth.admin.listUsers({ page, perPage: 1000 });
        const found = data?.users?.find((u: any) => (u.email || "").toLowerCase() === targetEmail);
        if (found) return found;
        if (!data?.users?.length || data.users.length < 1000) return null;
      }
      return null;
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate invite code (test mode 시험은 is_used 무시)
    const { data: inv } = await serviceClient
      .from("exam_invitations")
      .select("id, email, exam_id, name, is_used, exams(is_test_mode)")
      .eq("invite_code", invite_code.toUpperCase())
      .maybeSingle();

    if (!inv) {
      return new Response(JSON.stringify({ success: false, error: "유효하지 않은 초대코드입니다." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isTestMode = (inv as any).exams?.is_test_mode === true;

    // 본인 active session 있으면 재접속 허용 (튕긴 응시자 복귀)
    let hasActiveSession = false;
    if (inv.is_used && !isTestMode) {
      const user = await findUserByEmail(serviceClient, email);
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
      return new Response(JSON.stringify({ success: false, error: "이미 사용된 초대코드입니다." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify OTP
    const { data: otp } = await serviceClient
      .from("sms_otp_codes")
      .select("*")
      .eq("session_id", inv.id)
      .eq("phone", email)
      .eq("code", code)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!otp) {
      return new Response(JSON.stringify({ success: false, error: "인증코드가 일치하지 않습니다." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (new Date(otp.expires_at) < new Date()) {
      return new Response(JSON.stringify({ success: false, error: "인증코드가 만료되었습니다. 다시 요청해주세요." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark OTP as verified
    await serviceClient.from("sms_otp_codes").update({ verified: true }).eq("id", otp.id);

    // Check if user already exists
    let existingUser = await findUserByEmail(serviceClient, email);

    let userId: string;
    let accessToken: string;
    let refreshToken: string;

    const tempPassword = `otp_${crypto.randomUUID()}`;

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!
    );

    async function signInExisting(uid: string) {
      await serviceClient.auth.admin.updateUserById(uid, { password: tempPassword });
      const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
        email,
        password: tempPassword,
      });
      if (signInErr || !signInData.session) {
        console.error("Sign in error:", signInErr);
        return null;
      }
      return signInData.session;
    }

    if (existingUser) {
      userId = existingUser.id;
      const session = await signInExisting(userId);
      if (!session) {
        return new Response(JSON.stringify({ success: false, error: "로그인 처리 중 오류가 발생했습니다." }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      accessToken = session.access_token;
      refreshToken = session.refresh_token;
    } else {
      // Create new user
      const { data: newUser, error: createErr } = await serviceClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });

      // Fallback: race/dup — user already exists in auth but we missed it
      const errMsg = (createErr as any)?.message?.toLowerCase?.() || "";
      const errCode = (createErr as any)?.code || "";
      if ((createErr || !newUser?.user) && (errMsg.includes("already") || errCode === "email_exists")) {
        const found = await findUserByEmail(serviceClient, email);
        if (found) {
          userId = found.id;
          const session = await signInExisting(userId);
          if (!session) {
            return new Response(JSON.stringify({ success: false, error: "로그인 처리 중 오류가 발생했습니다." }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          accessToken = session.access_token;
          refreshToken = session.refresh_token;
        } else {
          console.error("Create user error (dup but not found):", createErr);
          return new Response(JSON.stringify({ success: false, error: "계정 생성 중 오류가 발생했습니다." }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else if (createErr || !newUser?.user) {
        console.error("Create user error:", createErr);
        return new Response(JSON.stringify({ success: false, error: "계정 생성 중 오류가 발생했습니다." }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        userId = newUser.user.id;

        // Create profile
        const displayName = name || inv.name || email.split("@")[0];
        await serviceClient.from("profiles").insert({ id: userId, name: displayName });

        // Set role to applicant
        await serviceClient.rpc("set_user_role", { _user_id: userId, _role: "applicant" });

        // Sign in
        const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
          email,
          password: tempPassword,
        });
        if (signInErr || !signInData.session) {
          console.error("Sign in error:", signInErr);
          return new Response(JSON.stringify({ success: false, error: "로그인 처리 중 오류가 발생했습니다." }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        accessToken = signInData.session.access_token;
        refreshToken = signInData.session.refresh_token;
      }
    }

    // Create exam session
    // - 테스트 모드: 매번 새 session (이전 응시와 분리)
    // - 일반 시험: active session(waiting/in_progress) 있으면 재사용, 없으면 새로 생성
    let examSessionId: string;
    if (isTestMode) {
      const { data: newSession } = await serviceClient
        .from("exam_sessions")
        .insert({ exam_id: inv.exam_id, applicant_id: userId })
        .select("id")
        .single();
      examSessionId = newSession!.id;
    } else {
      const { data: existingSession } = await serviceClient
        .from("exam_sessions")
        .select("id, status")
        .eq("exam_id", inv.exam_id)
        .eq("applicant_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingSession && (existingSession.status === "waiting" || existingSession.status === "in_progress")) {
        examSessionId = existingSession.id;
      } else {
        const { data: newSession } = await serviceClient
          .from("exam_sessions")
          .insert({ exam_id: inv.exam_id, applicant_id: userId })
          .select("id")
          .single();
        examSessionId = newSession!.id;
      }
    }

    // Mark invitation as used (테스트 모드 시험은 재사용 가능하므로 마킹 스킵)
    if (!isTestMode) {
      await serviceClient
        .from("exam_invitations")
        .update({ is_used: true, session_id: examSessionId })
        .eq("id", inv.id);
    }

    return new Response(JSON.stringify({
      success: true,
      access_token: accessToken,
      refresh_token: refreshToken,
      user_id: userId,
      exam_session_id: examSessionId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("verify-guest-otp error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
