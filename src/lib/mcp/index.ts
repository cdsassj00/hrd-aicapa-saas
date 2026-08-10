import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listMySessions from "./tools/list-my-sessions";
import listMyCertifications from "./tools/list-my-certifications";
import listOpenExams from "./tools/list-open-exams";
import getSessionResult from "./tools/get-session-result";

// Issuer must be the direct supabase.co host, built from the project ref.
// VITE_SUPABASE_PROJECT_ID is inlined by Vite at build time so this stays
// import-safe (no runtime env reads at module top).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "aicapa-mcp",
  title: "AI CAPA MCP",
  version: "0.1.0",
  instructions:
    "AI CAPA 인증평가 플랫폼의 사용자 데이터 조회용 MCP 서버입니다. " +
    "본인이 응시한 시험 세션, 인증서, 채점 결과를 조회하거나 현재 응시 가능한 시험 목록을 확인할 수 있습니다.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listOpenExams, listMySessions, listMyCertifications, getSessionResult],
});
