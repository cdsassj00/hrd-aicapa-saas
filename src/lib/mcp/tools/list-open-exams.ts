import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_open_exams",
  title: "응시 가능 시험 목록",
  description: "현재 open 상태인 시험(공개 시험) 목록을 반환합니다.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("반환 개수 (기본 20)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "로그인이 필요합니다." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("exams")
      .select("id, title, grade, exam_date, duration_minutes, max_participants, status")
      .eq("status", "open")
      .order("exam_date", { ascending: true })
      .limit(limit ?? 20);
    if (error) {
      return { content: [{ type: "text", text: `조회 실패: ${error.message}` }], isError: true };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { exams: data ?? [] },
    };
  },
});
