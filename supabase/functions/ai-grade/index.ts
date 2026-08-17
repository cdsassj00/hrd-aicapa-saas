import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { AiPaymentRequiredError, AiRateLimitError, chatCompletion } from "../_shared/ai.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getClient() {
  return createClient(supabaseUrl, supabaseKey);
}

async function updateJob(
  jobId: string,
  patch: Record<string, unknown>,
) {
  try {
    await getClient().from("grading_jobs").update(patch).eq("id", jobId);
  } catch (e) {
    console.error(`[ai-grade] failed updating job ${jobId}`, e);
  }
}

async function performGrading(jobId: string, session_id: string) {
  const supabase = getClient();
  try {

    await updateJob(jobId, { status: "processing", progress: 5 });

    const { data: session } = await supabase
      .from("exam_sessions").select("*").eq("id", session_id).single();
    if (!session) throw new Error("Session not found");

    const { data: exam } = await supabase
      .from("exams").select("*").eq("id", session.exam_id).single();

    const { data: eqs } = await supabase
      .from("exam_questions")
      .select("question_id, order_num")
      .eq("exam_id", session.exam_id)
      .order("order_num");
    const qIds = (eqs || []).map((eq: any) => eq.question_id);

    const [{ data: answers }, { data: questions }] = await Promise.all([
      supabase.from("answers").select("*").eq("session_id", session_id),
      qIds.length > 0
        ? supabase.from("questions").select("*").in("id", qIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    if (!answers || !questions) throw new Error("Failed to fetch data");

    await updateJob(jobId, { progress: 15 });

    // 슬롯 헬퍼 (프론트 examStructure.ts 와 동일한 정규화)
    const parseSlots = (raw: any, qtype: string, maxScore: number): any[] => {
      if (Array.isArray(raw) && raw.length > 0) {
        return raw.filter((s: any) => s && typeof s === "object" && s.id).map((s: any, i: number) => ({
          id: String(s.id ?? `slot${i + 1}`),
          type: s.type ?? "text",
          label: s.label ?? `답안 ${i + 1}`,
          max_score: Number.isFinite(s.max_score) ? Number(s.max_score) : 0,
          correct_answer: s.correct_answer ?? null,
          auto_grade: s.auto_grade ?? "none",
          tolerance: s.tolerance ?? 0,
          rubric: s.rubric ?? null,
        }));
      }
      const baseType = qtype === "file_upload" || qtype === "work_based" ? "file"
        : qtype === "essay" ? "long_text" : "text";
      return [{ id: "default", type: baseType, label: "답안", max_score: maxScore, auto_grade: "none" }];
    };

    const getSlotValues = (answer: any, slots: any[]): Record<string, string> => {
      const out: Record<string, string> = {};
      const sv = answer?.slot_values;
      if (sv && typeof sv === "object" && !Array.isArray(sv)) {
        for (const slot of slots) out[slot.id] = sv[slot.id] == null ? "" : String(sv[slot.id]);
        return out;
      }
      if (slots.length === 1) {
        const s = slots[0];
        out[s.id] = s.type === "file" ? (answer?.file_url ?? "") : (answer?.content ?? "");
      }
      return out;
    };

    const autoGradeSlot = (slot: any, value: string): { score: number; matched: boolean } | null => {
      if (!slot.auto_grade || slot.auto_grade === "none") return null;
      const correct = slot.correct_answer;
      if (correct == null || correct === "") return null;
      const v = (value ?? "").toString().trim();
      if (slot.auto_grade === "exact") {
        const matched = v === String(correct).trim();
        return { score: matched ? slot.max_score : 0, matched };
      }
      if (slot.auto_grade === "numeric") {
        const num = parseFloat(v.replace(/,/g, ""));
        const target = parseFloat(String(correct));
        if (!isFinite(num) || !isFinite(target)) return { score: 0, matched: false };
        const tol = Number(slot.tolerance ?? 0);
        const matched = Math.abs(num - target) <= tol;
        return { score: matched ? slot.max_score : 0, matched };
      }
      return null;
    };

    type PerAnswerResult = { answer_id: string; score: number; feedback: string; slot_scores: Record<string, number> };
    const results: PerAnswerResult[] = [];
    const total = answers.length || 1;

    for (let i = 0; i < answers.length; i++) {
      const answer = answers[i];
      const question = questions.find((q: any) => q.id === answer.question_id);
      if (!question) continue;

      // 세트 문항은 외부 AI 에이전트 채점 대상 → 스킵 (기존 점수/피드백 보존)
      if (question.set_id) {
        const pct = 15 + Math.round(((i + 1) / total) * 75);
        await updateJob(jobId, { progress: pct });
        continue;
      }



      // 객관식
      if (question.type === "multiple_choice") {
        const opts = Array.isArray(question.options) ? question.options : [];
        const correctOpt = opts.find((o: any) => o.is_correct === true);
        const answerText = (answer.content || "").trim();
        const circledToIndex: Record<string, number> = { "①": 0, "②": 1, "③": 2, "④": 3, "⑤": 4 };
        const letterToIndex: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, a: 0, b: 1, c: 2, d: 3, e: 4 };

        let isCorrect = false;
        let correctLabel = question.correct_answer || "";

        if (correctOpt) {
          const correctId = String(correctOpt.id ?? "").trim();
          if (correctId && correctId === answerText) isCorrect = true;
          if (!isCorrect && correctOpt.text?.trim() === answerText) isCorrect = true;
          const correctIndex = opts.indexOf(correctOpt);
          if (!isCorrect && correctIndex >= 0) {
            const answerIdx = circledToIndex[answerText] ?? letterToIndex[answerText] ?? (answerText.match(/^\d+$/) ? parseInt(answerText) : -1);
            if (answerIdx === correctIndex || answerText === String(correctIndex)) isCorrect = true;
          }
          correctLabel = correctOpt.text || correctLabel;
        } else if (question.correct_answer) {
          const ca = question.correct_answer.trim();
          const correctIdx = circledToIndex[ca] ?? letterToIndex[ca] ?? (ca.match(/^\d+$/) ? parseInt(ca) - 1 : -1);
          const answerIdx = circledToIndex[answerText] ?? letterToIndex[answerText] ?? (answerText.match(/^\d+$/) ? parseInt(answerText) : -1);
          if (correctIdx >= 0 && answerIdx >= 0) isCorrect = correctIdx === answerIdx;
          else isCorrect = answerText === ca;
          if (correctIdx >= 0 && opts[correctIdx]) correctLabel = opts[correctIdx].text || opts[correctIdx].label || ca;
        }

        const s = isCorrect ? question.max_score : 0;
        results.push({
          answer_id: answer.id,
          score: s,
          feedback: isCorrect ? "정답입니다." : `오답입니다. 정답: ${correctLabel}`,
          slot_scores: { default: s },
        });
        const pct = 15 + Math.round(((i + 1) / total) * 75);
        await updateJob(jobId, { progress: pct });
        continue;
      }

      // 서술/단답/작업/실기 → 슬롯별 채점
      const slots = parseSlots(question.submission_slots, question.type, question.max_score);
      const values = getSlotValues(answer, slots);
      const slot_scores: Record<string, number> = {};
      const perSlotFeedback: string[] = [];

      for (const slot of slots) {
        const val = values[slot.id] ?? "";
        const auto = autoGradeSlot(slot, val);
        if (auto) {
          slot_scores[slot.id] = auto.score;
          perSlotFeedback.push(`[${slot.label}] 자동채점: ${auto.matched ? "정답" : "오답"} (${auto.score}/${slot.max_score})`);
          continue;
        }
        if (slot.type === "file") {
          slot_scores[slot.id] = 0;
          const submitted = val ? "제출됨" : "미제출";
          perSlotFeedback.push(`[${slot.label}] 파일 ${submitted} — 수동 채점 필요 (0/${slot.max_score})`);
          continue;
        }
        if (!val || !String(val).trim()) {
          slot_scores[slot.id] = 0;
          perSlotFeedback.push(`[${slot.label}] 미입력 (0/${slot.max_score})`);
          continue;
        }
        const rubric = slot.rubric ? `\n[채점 기준]\n${slot.rubric}\n` : "";
        const correctHint = slot.correct_answer ? `\n[모범답안/참고]\n${slot.correct_answer}\n` : "";
        const prompt = `당신은 시험 채점관입니다. 아래 문항의 특정 슬롯 답안을 채점해주세요.

[문항]
${question.content}

[슬롯 정보]
- 라벨: ${slot.label}
- 배점: ${slot.max_score}점
${rubric}${correctHint}
[응시자 입력]
${val}

다음 형식으로 응답해주세요:
점수: [0~${slot.max_score} 사이 정수]
피드백: [간단한 채점 사유 1~2문장]`;

        try {
          const aiText = await chatCompletion({
            messages: [
              { role: "system", content: "시험 답안을 정확하고 공정하게 채점하는 전문 채점관입니다. 반드시 '점수: N' 형식으로 시작하세요." },
              { role: "user", content: prompt },
            ],
          });
          const scoreMatch = aiText.match(/점수:\s*(\d+)/);
          const feedbackMatch = aiText.match(/피드백:\s*([\s\S]*)/);
          const aiScore = scoreMatch ? Math.min(parseInt(scoreMatch[1]), slot.max_score) : 0;
          const aiFeedback = feedbackMatch ? feedbackMatch[1].trim() : aiText;
          slot_scores[slot.id] = aiScore;
          perSlotFeedback.push(`[${slot.label}] ${aiScore}/${slot.max_score} — ${aiFeedback}`);
        } catch (aiErr: unknown) {
          slot_scores[slot.id] = 0;
          const reason = aiErr instanceof AiRateLimitError ? "요청 한도 초과"
            : aiErr instanceof AiPaymentRequiredError ? "크레딧 부족"
            : aiErr instanceof Error ? aiErr.message : "알 수 없는 오류";
          perSlotFeedback.push(`[${slot.label}] AI 채점 실패: ${reason}`);
        }
      }

      const scoreSum = Object.values(slot_scores).reduce((a, b) => a + (Number(b) || 0), 0);
      results.push({
        answer_id: answer.id,
        score: scoreSum,
        feedback: `[AI 채점]\n${perSlotFeedback.join("\n")}`,
        slot_scores,
      });

      const pct = 15 + Math.round(((i + 1) / total) * 75);
      await updateJob(jobId, { progress: pct });
    }

    for (const r of results) {
      await supabase.from("answers").update({
        score: r.score,
        feedback: r.feedback,
        slot_scores: r.slot_scores as any,
      }).eq("id", r.answer_id);
    }

    // 세트 문항이 있으면 AI 채점은 부분 채점이므로 세션 총점/합격여부를 갱신하지 않는다
    // (외부 AI 에이전트 채점 CSV 업로드가 최종 반영을 수행)
    const hasSetQuestions = questions.some((q: any) => q.set_id);
    if (hasSetQuestions) {
      console.log(`[ai-grade] session=${session_id} has set questions → skip session total update (external grading required)`);
      await updateJob(jobId, { status: "completed", progress: 100 });
      return;
    }

    const maxPossible = questions.reduce((sum: number, q: any) => sum + (q.max_score || 0), 0);
    const rawTotal = results.reduce((sum, r) => sum + r.score, 0);
    const totalScore = maxPossible > 0 ? Math.round((rawTotal / maxPossible) * 100) : 0;
    const passScore = exam?.pass_score ?? 75;
    const finalStatus = totalScore >= passScore ? "passed" : "failed";

    console.log(`[ai-grade] session=${session_id} raw=${rawTotal}/${maxPossible} normalized=${totalScore}/100 pass=${passScore} status=${finalStatus}`);

    await supabase.from("exam_sessions").update({ score_total: totalScore, status: finalStatus }).eq("id", session_id);

    await updateJob(jobId, {
      status: "completed",
      progress: 100,
      result_total: totalScore,
      result_status: finalStatus,
    });
  } catch (e) {
    console.error(`[ai-grade] job ${jobId} failed:`, e);
    await updateJob(jobId, {
      status: "failed",
      error_message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function processQueueSequentially(jobs: { id: string; session_id: string }[]) {
  for (const j of jobs) {
    try {
      await performGrading(j.id, j.session_id);
    } catch (e) {
      console.error(`[ai-grade] queue job ${j.id} crashed`, e);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const supabase = getClient();

    // Bulk mode: { session_ids: [...] }
    if (Array.isArray(body?.session_ids) && body.session_ids.length > 0) {
      const rows = body.session_ids.map((sid: string) => ({ session_id: sid, status: "pending", progress: 0 }));
      const { data: jobs, error } = await supabase.from("grading_jobs").insert(rows).select();
      if (error || !jobs) throw new Error(error?.message || "Failed to create jobs");

      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(processQueueSequentially(jobs.map((j: any) => ({ id: j.id, session_id: j.session_id }))));

      return new Response(
        JSON.stringify({ enqueued: jobs.length, job_ids: jobs.map((j: any) => j.id) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
      );
    }

    // Single mode
    const { session_id } = body;
    if (!session_id) throw new Error("session_id or session_ids is required");

    const { data: job, error } = await supabase
      .from("grading_jobs")
      .insert({ session_id, status: "pending", progress: 0 })
      .select()
      .single();
    if (error || !job) throw new Error(error?.message || "Failed to create job");

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(performGrading(job.id, session_id));

    return new Response(
      JSON.stringify({ job_id: job.id, session_id, status: "pending" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 },
    );
  } catch (e) {
    console.error("ai-grade enqueue error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
