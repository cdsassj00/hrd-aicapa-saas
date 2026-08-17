import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } =
      await anonClient.auth.getClaims(token);
    if (claimsError || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerUserId = claims.claims.sub as string;

    // 계정 완전 삭제는 전 조직에서 사용자를 없애는 플랫폼 레벨 작업이므로
    // 플랫폼 운영자만 허용한다. (조직 멤버 제거는 org_members RLS 로 별도 처리)
    // 옛 전역 has_role('admin') 은 squash 재설계에서 제거됨 → is_platform_admin() 로 대체.
    const { data: isPlatformAdmin } = await anonClient.rpc("is_platform_admin");

    if (!isPlatformAdmin) {
      return new Response(JSON.stringify({ error: "Platform admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { user_id } = await req.json();
    if (!user_id || typeof user_id !== "string") {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Prevent self-deletion
    if (user_id === callerUserId) {
      return new Response(
        JSON.stringify({ error: "Cannot delete yourself" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Use service role to delete
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // profiles·org_members·platform_admins 는 auth.users(id) 에 on delete cascade 로
    // 묶여 있어 아래 auth 삭제가 알아서 정리한다. (옛 user_roles 테이블은 존재하지 않음)
    // Delete auth user
    const { error: deleteError } =
      await serviceClient.auth.admin.deleteUser(user_id);

    if (deleteError) {
      return new Response(
        JSON.stringify({ error: deleteError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
