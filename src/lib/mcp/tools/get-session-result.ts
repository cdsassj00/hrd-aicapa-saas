import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_session_result",
  title: "세션 채점 결과 조회",
  description: "특정 응시 세션의 총점·합격여부·문항별 점수/피드백을 반환합니다. 본인 세션만 조회 가능.",
  inputSchema: {
    session_id: z.string().uuid().describe("조회할 exam_sessions.id"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ session_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "로그인이 필요합니다." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: session, error: sErr } = await supabase
      .from("exam_sessions")
      .select("id, exam_id, status, score_total, start_time, submit_time, applicant_id")
      .eq("id", session_id)
      .maybeSingle();
    if (sErr) return { content: [{ type: "text", text: `세션 조회 실패: ${sErr.message}` }], isError: true };
    if (!session) return { content: [{ type: "text", text: "세션을 찾을 수 없거나 접근 권한이 없습니다." }], isError: true };

    const { data: answers, error: aErr } = await supabase
      .from("answers")
      .select("question_id, score, feedback")
      .eq("session_id", session_id);
    if (aErr) return { content: [{ type: "text", text: `답안 조회 실패: ${aErr.message}` }], isError: true };

    const result = { session, answers: answers ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
