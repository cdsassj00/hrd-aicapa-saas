import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_sessions",
  title: "내 응시 세션 목록",
  description: "로그인한 사용자 본인이 응시한 시험 세션 목록을 반환합니다 (상태, 점수, 시험 정보 포함).",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("반환할 세션 최대 개수 (기본 20)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "로그인이 필요합니다." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("exam_sessions")
      .select("id, exam_id, status, score_total, start_time, submit_time, exams(title, grade, exam_date)")
      .eq("applicant_id", ctx.getUserId())
      .order("start_time", { ascending: false })
      .limit(limit ?? 20);
    if (error) {
      return { content: [{ type: "text", text: `조회 실패: ${error.message}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { sessions: data ?? [] },
    };
  },
});
