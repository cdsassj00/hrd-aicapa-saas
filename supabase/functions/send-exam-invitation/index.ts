// 응시 초대 메일 발송.
//
// 초대코드는 "발송 시점에 발급"한다(0026): 평문은 이 메일에만 실리고 DB 에는
// sha256 해시만 남는다. 재발송하면 새 코드로 교체된다.
// 권한: 해당 시험 조직의 관리자(또는 플랫폼 운영자)만 보낼 수 있다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { sendEmail, renderNotifyEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// 사람이 받아 적는 코드라 혼동 문자(0/O, 1/I/L)를 뺀다.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode(len = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

// 0025 의 get_invitation_by_code 와 반드시 같은 규칙이어야 한다.
async function hashCode(code: string): Promise<string> {
  const buf = new TextEncoder().encode(code.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) return json({ error: "Unauthorized" }, 401);

    const { examId, invitationIds, siteUrl } = await req.json().catch(() => ({}));
    if (!examId || !invitationIds?.length || !siteUrl) {
      return json({ error: "Missing required fields" }, 400);
    }

    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: exam } = await service
      .from("exams")
      .select("id, org_id, title, exam_date, duration_minutes")
      .eq("id", examId)
      .single();
    if (!exam) return json({ error: "Exam not found" }, 404);

    // 권한 확인 — 호출자 컨텍스트로 판정한다(service_role 로 우회하지 않는다).
    const { data: isAdmin } = await userClient.rpc("is_org_admin", { _org_id: exam.org_id });
    const { data: isPlatform } = await userClient.rpc("is_platform_admin");
    if (isAdmin !== true && isPlatform !== true) {
      return json({ error: "이 시험의 초대를 보낼 권한이 없습니다." }, 403);
    }

    const { data: invitations } = await service
      .from("exam_invitations")
      .select("id, email, name")
      .eq("exam_id", examId)
      .in("id", invitationIds);
    if (!invitations?.length) return json({ error: "No invitations found" }, 404);

    // 조직 화이트라벨(0027). 없으면 환경변수 MAIL_FROM 으로 떨어진다.
    const { data: brand } = await service
      .from("org_branding")
      .select("email_subject_prefix, email_from_name, email_from_address")
      .eq("org_id", exam.org_id)
      .maybeSingle();

    const fallbackFrom = Deno.env.get("MAIL_FROM") ?? "";
    const fromAddress = brand?.email_from_address ?? "";
    const fromName = brand?.email_from_name ?? "";
    // 발신 주소가 없으면 보내지 않는다 — 잘못된 발신자로 나가는 것보다 실패가 낫다.
    const from = fromAddress
      ? (fromName ? `${fromName} <${fromAddress}>` : fromAddress)
      : fallbackFrom;
    if (!from) {
      return json({ error: "발신 주소가 없습니다. 조직 설정의 발신 이메일 또는 MAIL_FROM 을 지정하세요." }, 500);
    }
    const subjectPrefix = brand?.email_subject_prefix || "[AI 역량평가]";

    const examDate = exam.exam_date
      ? new Date(exam.exam_date).toLocaleString("ko-KR", {
          timeZone: "Asia/Seoul", year: "numeric", month: "long",
          day: "numeric", hour: "2-digit", minute: "2-digit",
        })
      : null;

    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const inv of invitations) {
      const code = newCode();
      try {
        // 코드 발급: 해시만 저장한다. 평문은 아래 메일에만 남는다.
        const { error: upErr } = await service
          .from("exam_invitations")
          .update({ code_hash: await hashCode(code), sent_at: new Date().toISOString() })
          .eq("id", inv.id);
        if (upErr) throw new Error(`코드 발급 실패: ${upErr.message}`);

        await sendEmail({
          from,
          to: inv.email,
          subject: `${subjectPrefix} ${exam.title} 응시 초대`,
          html: renderNotifyEmail({
            kicker: "응시 초대",
            title: `${inv.name || "응시자"}님, 평가에 초대되었습니다`,
            rows: [
              { label: "평가명", value: exam.title },
              { label: "일시", value: examDate },
              { label: "제한시간", value: exam.duration_minutes ? `${exam.duration_minutes}분` : null },
              { label: "응시코드", value: code },
            ],
            message:
              "별도 회원가입 없이 이메일 인증만으로 응시할 수 있습니다.\n아래 버튼을 누르면 인증코드가 발송되며, 코드 입력 후 바로 평가에 입장합니다.",
            cta: { label: "평가 응시하기", href: `${siteUrl}/login?invite=${code}` },
            footnote: "응시코드는 본인 확인용입니다. 타인에게 공유하지 마세요. 재발송 시 이전 코드는 사용할 수 없습니다.",
          }),
        });
        results.push({ email: inv.email, success: true });
      } catch (e) {
        // 한 통 실패가 나머지를 막지 않도록 건별로 모은다.
        results.push({ email: inv.email, success: false, error: (e as Error).message });
      }
    }

    return json({
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (e) {
    console.error("send-exam-invitation error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
