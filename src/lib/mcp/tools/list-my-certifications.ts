import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_certifications",
  title: "내 인증서 목록",
  description: "로그인한 사용자가 취득한 AI CAPA 인증서 목록을 반환합니다.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "로그인이 필요합니다." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("certifications")
      .select("id, cert_number, grade, issued_at, status, exam_id")
      .eq("applicant_id", ctx.getUserId())
      .order("issued_at", { ascending: false });
    if (error) {
      return { content: [{ type: "text", text: `조회 실패: ${error.message}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { certifications: data ?? [] },
    };
  },
});
