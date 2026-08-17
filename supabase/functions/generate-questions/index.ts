// AI 문항 생성 — 주제를 받아 이론형 문항(객관식/단답/서술)을 초안으로 생성한다.
// 생성물은 questions(visibility='org')에 바로 적재하되, 호출자 JWT 로 insert 하므로
// RLS(question write = is_org_admin) 가 조직 관리자 권한을 그대로 강제한다.
// answer_key jsonb 구조는 업로드/응시/채점 화면이 읽는 형식과 동일하게 맞춘다.
// 설계문서 §8: 비즈니스 로직은 순수 모듈로, 함수는 HTTP 껍데기만.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import { AiPaymentRequiredError, AiRateLimitError, chatCompletion } from "../_shared/ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ALLOWED_TYPES = ["multiple_choice", "short_answer", "essay"] as const;
type QType = typeof ALLOWED_TYPES[number];
const DIFF_POINTS: Record<string, number> = { easy: 5, medium: 10, hard: 15 };
const letter = (i: number) => String.fromCharCode(97 + i); // 0→a

function buildPrompt(topic: string, count: number, types: QType[], difficulty: string, category: string | null) {
  return `당신은 기업 채용·재직자 대상 "AI 활용 역량평가" 문제은행을 설계하는 출제 전문가입니다.
아래 조건으로 한국어 문항 ${count}개를 만들어 주세요.

[주제] ${topic}
${category ? `[역량 영역] ${category}` : ""}
[난이도] ${difficulty}
[허용 유형] ${types.join(", ")}

규칙:
- 실무에서 생성형 AI를 활용하는 상황에 밀착된, 현업 적용형 문항으로.
- multiple_choice 는 보기 4개(정답 1개), 정답과 오답이 명확해야 함.
- short_answer 는 채점 가능한 짧은 정답이 있어야 함.
- essay 는 정답 대신 채점 기준(rubric)을 제시.
- 표절/저작권 문제 없는 순수 창작 문항으로.

반드시 아래 JSON 스키마로만 응답(설명·마크다운 금지):
{
  "questions": [
    {
      "type": "multiple_choice | short_answer | essay",
      "content": "문항 지문(한국어)",
      "difficulty": "${difficulty}",
      "options": [ { "text": "보기", "is_correct": true|false } ],   // multiple_choice 만
      "correct_answer": "단답 정답",                                  // short_answer 만
      "rubric": "채점 기준"                                           // essay 만
    }
  ]
}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const b = await req.json().catch(() => ({}));
    const orgId = String(b.org_id ?? "").trim();
    const topic = String(b.topic ?? "").trim();
    const count = Math.max(1, Math.min(20, Number(b.count) || 5));
    const difficulty = ["easy", "medium", "hard"].includes(b.difficulty) ? b.difficulty : "medium";
    const category = b.category ? String(b.category).trim() : null;
    const types: QType[] = Array.isArray(b.types) && b.types.length
      ? b.types.filter((t: string) => (ALLOWED_TYPES as readonly string[]).includes(t))
      : ["multiple_choice"];
    if (!orgId) return json({ error: "org_id 가 필요합니다." }, 400);
    if (!topic) return json({ error: "주제(topic)를 입력해 주세요." }, 400);
    if (!types.length) return json({ error: "유효한 문항 유형이 없습니다." }, 400);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    // AI 생성
    let aiText: string;
    try {
      aiText = await chatCompletion({
        jsonMode: true,
        temperature: 0.7,
        messages: [
          { role: "system", content: "너는 한국어 시험 출제 전문가다. 반드시 유효한 JSON 하나만 출력한다." },
          { role: "user", content: buildPrompt(topic, count, types, difficulty, category) },
        ],
      });
    } catch (e) {
      const msg = e instanceof AiRateLimitError ? "AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
        : e instanceof AiPaymentRequiredError ? "AI 크레딧이 부족합니다."
        : e instanceof Error ? e.message : "AI 생성 실패";
      return json({ error: msg }, 502);
    }

    let parsed: any;
    try { parsed = JSON.parse(aiText); } catch { return json({ error: "AI 응답 파싱 실패", raw: aiText.slice(0, 500) }, 502); }
    const items: any[] = Array.isArray(parsed) ? parsed : (parsed.questions ?? parsed.items ?? []);
    if (!Array.isArray(items) || items.length === 0) return json({ error: "생성된 문항이 없습니다." }, 502);

    // questions 행으로 정규화 (answer_key 는 앱 형식과 동일)
    const rows = items.slice(0, count).map((q: any) => {
      const type: QType = (ALLOWED_TYPES as readonly string[]).includes(q?.type) ? q.type : types[0];
      let options: any = null;
      let correct_answer: any = null;
      let rubric: string | null = null;

      if (type === "multiple_choice") {
        const raw = Array.isArray(q?.options) ? q.options : [];
        options = raw.slice(0, 6).map((o: any, i: number) => ({
          id: letter(i),
          text: String(o?.text ?? o ?? "").slice(0, 500),
          is_correct: o?.is_correct === true,
        }));
        if (!options.some((o: any) => o.is_correct) && options.length) options[0].is_correct = true;
        correct_answer = (options.find((o: any) => o.is_correct)?.id) ?? "a";
      } else if (type === "short_answer") {
        correct_answer = q?.correct_answer != null ? String(q.correct_answer).slice(0, 500) : null;
      } else {
        rubric = q?.rubric != null ? String(q.rubric).slice(0, 2000) : null;
      }

      return {
        org_id: orgId,
        visibility: "org",
        type,
        content: String(q?.content ?? "").slice(0, 4000),
        difficulty,
        points: DIFF_POINTS[difficulty] ?? 10,
        answer_key: {
          correct_answer,
          submission_slots: null,
          options,
          tags: [],
          category,
          grade: null,
          allow_file_upload: false,
        },
        rubric,
        attachments: [],
        created_by: user.id,
      };
    }).filter((r: any) => r.content);

    if (!rows.length) return json({ error: "유효한 문항이 생성되지 않았습니다." }, 502);

    // 호출자 JWT 로 insert → RLS(question write = is_org_admin) 가 권한을 강제한다.
    const { data: inserted, error } = await userClient
      .from("questions").insert(rows).select("id, type, content, difficulty, points, answer_key");
    if (error) {
      const msg = /row-level security|permission|insufficient/i.test(error.message)
        ? "이 조직에 문항을 추가할 권한이 없습니다(관리자만 가능)."
        : error.message;
      return json({ error: msg }, 400);
    }

    return json({ ok: true, created: inserted?.length ?? 0, questions: inserted });
  } catch (e) {
    console.error("[generate-questions] error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
