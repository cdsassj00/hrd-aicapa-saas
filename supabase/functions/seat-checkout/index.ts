// 응시권 선불 구매 — 일반 결제(1회).
//   action=create  : 조직 관리자가 수량을 고르면 서버가 금액을 정하고 주문(READY)을 남긴다.
//   action=confirm : 결제창 successUrl 로 돌아온 paymentKey·orderId·amount 를 받아
//                    주문 금액과 대조한 뒤 토스 승인 → 주문 DONE → 장부에 +수량.
// 금액은 언제나 서버의 주문 행이 기준이다. 브라우저가 보낸 amount 는 대조용일 뿐.
// 로직(금액·주문번호·승인 호출)은 _shared/tossBilling.ts, 이 파일은 HTTP 껍데기.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import {
  TossApiError, confirmPayment, makeSeatOrderId, seatAmount, seatOrderName, SEAT_PRODUCT,
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

  // 일반결제 MID 의 키. 정기결제(빌링) MID 키와 다를 수 있어 이름을 나눴다.
  const secretKey = Deno.env.get("TOSS_PAYMENT_SECRET_KEY") ?? Deno.env.get("TOSS_SECRET_KEY");
  if (!secretKey) return json({ error: "결제 설정이 아직 완료되지 않았습니다." }, 503);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);
    const b = await req.json().catch(() => ({}));

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (b.action === "create") {
      const orgId = String(b.orgId ?? "");
      const seats = Number(b.seats);
      if (!UUID_RE.test(orgId)) return json({ error: "잘못된 요청입니다." }, 400);
      if (!Number.isInteger(seats) || seats < 1 || seats > SEAT_PRODUCT.maxSeatsPerOrder) {
        return json({ error: `수량은 1~${SEAT_PRODUCT.maxSeatsPerOrder}명 사이로 정해 주세요.` }, 400);
      }
      // 권한 — 멤버십 테이블 기준(JWT 클레임 아님)
      const { data: isAdmin } = await userClient.rpc("is_org_admin", { _org_id: orgId });
      if (!isAdmin) return json({ error: "조직 관리자만 결제할 수 있습니다." }, 403);

      const amount = seatAmount(seats);
      const orderId = makeSeatOrderId(orgId, new Date());
      const orderName = seatOrderName(seats);
      const { error } = await service.from("seat_orders").insert({
        org_id: orgId, order_id: orderId, seats, amount, created_by: user.id,
      });
      if (error) {
        console.error("[seat-checkout] order insert", error);
        return json({ error: "주문을 만들지 못했습니다." }, 500);
      }
      return json({ ok: true, orderId, orderName, amount, seats });
    }

    if (b.action === "confirm") {
      const orderId = String(b.orderId ?? "");
      const paymentKey = String(b.paymentKey ?? "");
      const amount = Number(b.amount);
      if (!orderId || !paymentKey || !Number.isInteger(amount)) return json({ error: "잘못된 요청입니다." }, 400);

      const { data: order } = await service.from("seat_orders").select("*").eq("order_id", orderId).maybeSingle();
      if (!order) return json({ error: "주문을 찾을 수 없습니다." }, 404);
      const { data: isAdmin } = await userClient.rpc("is_org_admin", { _org_id: order.org_id });
      if (!isAdmin) return json({ error: "조직 관리자만 결제할 수 있습니다." }, 403);

      // 이미 처리된 주문(새로고침으로 다시 들어온 경우)은 결과만 돌려준다.
      if (order.status === "DONE") return json({ ok: true, already: true, seats: order.seats, amount: order.amount });
      if (order.status !== "READY") return json({ error: "처리할 수 없는 주문 상태입니다." }, 409);
      // 위변조 방어: 결제된 금액이 서버가 정한 주문 금액과 같아야 한다.
      if (amount !== order.amount) {
        await service.from("seat_orders").update({ status: "FAILED", failure_message: `금액 불일치 ${amount} ≠ ${order.amount}` }).eq("order_id", orderId);
        return json({ error: "결제 금액이 주문과 다릅니다." }, 400);
      }

      let confirmed;
      try {
        confirmed = await confirmPayment(fetch, secretKey, { paymentKey, orderId, amount });
      } catch (e) {
        const te = e instanceof TossApiError ? e : null;
        await service.from("seat_orders").update({ status: "FAILED", payment_key: paymentKey, failure_message: te?.message ?? String(e) }).eq("order_id", orderId);
        return json({ error: te?.message ?? "결제 승인에 실패했습니다.", code: te?.code }, 402);
      }

      // 주문 DONE 전환은 READY 일 때만 — 동시에 두 번 들어와도 한 번만 적립된다.
      const { data: done } = await service.from("seat_orders")
        .update({ status: "DONE", payment_key: confirmed.paymentKey, approved_at: confirmed.approvedAt ?? new Date().toISOString() })
        .eq("order_id", orderId).eq("status", "READY")
        .select("order_id");
      if (done && done.length > 0) {
        const { error: lErr } = await service.from("seat_ledger").insert({
          org_id: order.org_id, delta: order.seats, reason: "purchase", order_id: orderId, created_by: user.id,
        });
        if (lErr) console.error("[seat-checkout] ledger insert", lErr);
      }
      return json({ ok: true, seats: order.seats, amount: order.amount });
    }

    return json({ error: "알 수 없는 요청입니다." }, 400);
  } catch (e) {
    if (e instanceof TossApiError) return json({ error: e.message, code: e.code }, 400);
    console.error("[seat-checkout]", e);
    return json({ error: "처리 중 오류가 발생했습니다." }, 500);
  }
});
