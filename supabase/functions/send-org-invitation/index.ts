// 조직 초대 발급 + 이메일 발송.
// 순서: (1) 호출자 JWT 로 create_org_invitation 실행 — RLS/함수가 is_org_admin 을
//        강제하므로 조직 관리자만 통과한다. 원문 토큰은 이 응답에서만 나온다(DB 는 해시).
//       (2) Resend 로 수신자에게 수락 링크 메일 발송.
// 설계문서 §8: 비즈니스 로직은 순수 모듈로, 함수는 HTTP 껍데기만.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const esc = (s?: string | null) =>
  String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

const ROLE_LABEL: Record<string, string> = {
  org_admin: "관리자",
  examiner: "감독관",
  viewer: "뷰어",
  applicant: "응시자",
};

function inviteHtml(orgName: string, roleLabel: string, link: string): string {
  return `<div style="font-family:-apple-system,'Malgun Gothic',sans-serif;max-width:520px;color:#111">
    <h2 style="font-size:18px;margin:0 0 12px"><b>${esc(orgName)}</b> 조직에 초대되었습니다</h2>
    <p style="font-size:14px;color:#333;line-height:1.6">
      AI 역량평가 플랫폼에서 <b>${esc(roleLabel)}</b> 역할로 초대되었습니다.
      아래 버튼을 눌러 초대를 수락하세요. (초대받은 이메일과 같은 계정으로 로그인해야 합니다.)
    </p>
    <p style="margin:22px 0">
      <a href="${esc(link)}" style="background:#0a84ff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">초대 수락하기</a>
    </p>
    <p style="font-size:12px;color:#8a94a3;word-break:break-all">버튼이 안 되면 이 링크를 붙여넣으세요:<br>${esc(link)}</p>
    <p style="font-size:12px;color:#8a94a3;margin-top:16px">한국데이터사이언티스트협회(CDSA)</p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const b = await req.json().catch(() => ({}));
    const orgId = String(b.org_id ?? "").trim();
    const email = String(b.email ?? "").trim().toLowerCase();
    const role = String(b.role ?? "").trim();
    const origin = String(b.origin ?? "").trim().replace(/\/+$/, "");
    if (!orgId || !email || !role) return json({ error: "org_id·email·role 이 필요합니다." }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "이메일 형식이 올바르지 않습니다." }, 400);
    if (!/^https?:\/\//.test(origin)) return json({ error: "origin 이 필요합니다." }, 400);

    // 호출자 JWT 로 도는 클라이언트 — create_org_invitation 이 is_org_admin 을 강제한다.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: token, error } = await userClient.rpc("create_org_invitation", {
      _org_id: orgId,
      _email: email,
      _role: role,
    });
    if (error || !token) {
      // 권한 없음(RLS)·중복 초대·잘못된 역할 등 DB 제약이 그대로 올라온다.
      const msg = /insufficient_privilege|permission/i.test(error?.message ?? "")
        ? "이 조직에 초대할 권한이 없습니다."
        : (error?.message ?? "초대 발급에 실패했습니다.");
      return json({ error: msg }, 400);
    }

    const link = `${origin}/invite/accept?token=${token}`;

    // 조직 이름(호출자는 멤버이므로 RLS 로 읽힌다)
    const { data: org } = await userClient.from("organizations").select("name").eq("id", orgId).maybeSingle();
    const orgName = org?.name ?? "조직";
    const roleLabel = ROLE_LABEL[role] ?? role;

    // (2) 메일 발송(베스트에포트) — 실패해도 초대 자체는 이미 발급됐으므로 링크를 돌려준다.
    let emailed = false;
    let emailError: string | null = null;
    try {
      await sendEmail({
        to: email,
        subject: `[${orgName}] AI 역량평가 초대`,
        html: inviteHtml(orgName, roleLabel, link),
      });
      emailed = true;
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
      console.error("[send-org-invitation] email failed", emailError);
    }

    return json({ ok: true, link, emailed, email_error: emailError });
  } catch (e) {
    console.error("[send-org-invitation] error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
