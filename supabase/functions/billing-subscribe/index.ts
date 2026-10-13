// Pro 월 구독 시작 — 토스 빌링 결제창(카드 등록) 성공 후 호출된다.
// 순서: (1) 호출자 JWT 로 is_org_admin 확인 — 조직 관리자만 결제할 수 있다
//       (2) authKey → 빌링키 발급, billing_methods 저장(service_role)
//       (3) 빌링키로 첫 달 결제(부가세 포함 319,000원), billing_payments 기록
//       (4) subscriptions 를 active 로, 이용기간 = 결제일 ~ +1개월
// 다음 달 재결제는 같은 빌링키로 별도 스케줄러가 돈다(이 함수 범위 밖).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import {
  PRO_PLAN, TossApiError, addOneMonth, chargeBilling, issueBillingKey, makeOrderId, withVat,
} from "../_shared/tossBilling.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const secretKey = Deno.env.get("TOSS_SECRET_KEY");
  if (!secretKey) return json({ error: "결제 설정이 아직 완료되지 않았습니다." }, 503);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const b = await req.json().catch(() => ({}));
    const orgId = String(b.orgId ?? "");
    const authKey = String(b.authKey ?? "");
    const customerKey = String(b.customerKey ?? "");
    if (!UUID_RE.test(orgId) || !authKey || !UUID_RE.test(customerKey)) {
      return json({ error: "잘못된 요청입니다." }, 400);
    }

    // (1) 권한 — 멤버십 테이블 기준(JWT 클레임 아님)
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: isAdmin } = await userClient.rpc("is_org_admin", { _org_id: orgId });
    if (!isAdmin) return json({ error: "조직 관리자만 구독을 시작할 수 있습니다." }, 403);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: plan } = await service.from("plans").select("id").eq("code", PRO_PLAN.code).single();
    if (!plan) return json({ error: "요금제를 찾을 수 없습니다." }, 500);

    // 이미 이용기간이 남은 활성 구독이면 카드만 교체하고 결제하지 않는다(이중결제 방지).
    const { data: sub } = await service
      .from("subscriptions")
      .select("id, status, current_period_end")
      .eq("org_id", orgId)
      .maybeSingle();
    const now = new Date();
    const stillActive = sub?.status === "active" && sub.current_period_end && new Date(sub.current_period_end) > now;

    // (2) 빌링키 발급
    const issued = await issueBillingKey(fetch, secretKey, authKey, customerKey);
    const cardNumber = issued.cardNumber ?? issued.card?.number ?? null;
    const { error: bmErr } = await service.from("billing_methods").upsert({
      org_id: orgId,
      customer_key: customerKey,
      billing_key: issued.billingKey,
      card_company: issued.cardCompany ?? null,
      card_number: cardNumber,
      registered_by: user.id,
    });
    if (bmErr) {
      console.error("[billing-subscribe] billing_methods upsert", bmErr);
      return json({ error: "카드 정보 저장에 실패했습니다." }, 500);
    }

    if (stillActive) {
      return json({ ok: true, charged: false, cardNumber, periodEnd: sub!.current_period_end });
    }

    // (3) 첫 달 결제
    const amount = withVat(PRO_PLAN.supplyAmount);
    const orderId = makeOrderId(orgId, now);
    const periodEnd = addOneMonth(now);
    const base = {
      org_id: orgId,
      subscription_id: sub?.id ?? null,
      order_id: orderId,
      order_name: PRO_PLAN.orderName,
      amount,
      card_company: issued.cardCompany ?? null,
      card_number: cardNumber,
    };

    let charged;
    try {
      charged = await chargeBilling(fetch, secretKey, {
        billingKey: issued.billingKey,
        customerKey,
        amount,
        orderId,
        orderName: PRO_PLAN.orderName,
        customerEmail: user.email ?? undefined,
      });
    } catch (e) {
      const te = e instanceof TossApiError ? e : null;
      await service.from("billing_payments").insert({
        ...base, status: "FAILED", failure_code: te?.code ?? "UNKNOWN", failure_message: te?.message ?? String(e),
      });
      return json({ error: te?.message ?? "결제에 실패했습니다.", code: te?.code }, 402);
    }

    // (4) 구독 활성화
    const { data: upserted, error: subErr } = await service
      .from("subscriptions")
      .upsert({
        org_id: orgId,
        plan_id: plan.id,
        status: "active",
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        cancel_at_period_end: false,
        external_ref: customerKey,
      }, { onConflict: "org_id" })
      .select("id")
      .single();
    if (subErr) console.error("[billing-subscribe] subscription upsert", subErr);

    await service.from("billing_payments").insert({
      ...base,
      subscription_id: upserted?.id ?? base.subscription_id,
      status: charged.status ?? "DONE",
      payment_key: charged.paymentKey,
      period_start: now.toISOString(),
      period_end: periodEnd.toISOString(),
      approved_at: charged.approvedAt ?? now.toISOString(),
    });

    return json({ ok: true, charged: true, amount, orderId, cardNumber, periodEnd: periodEnd.toISOString() });
  } catch (e) {
    if (e instanceof TossApiError) return json({ error: e.message, code: e.code }, 400);
    console.error("[billing-subscribe]", e);
    return json({ error: "처리 중 오류가 발생했습니다." }, 500);
  }
});
