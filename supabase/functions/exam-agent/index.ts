// 시험 에이전트 HTTP 껍데기.
//
// 로직은 _shared/examAgent.ts(순수) · _shared/sandbox.ts(공급자 래퍼)에 있다.
// 이 파일이 하는 일은 네 가지뿐이다.
//   (1) JWT 로 호출자 신원 확인 — 본문의 user id 를 믿지 않는다
//   (2) 그 사람이 정말 그 시험 세션의 응시자이고 세션이 진행 중인지 확인
//   (3) 과정 로그를 service_role 로 추가 (응시자는 쓰기 권한이 없다)
//   (4) 샌드박스 수명·턴 상한 등 비용 방어
//
// action
//   start     문항별 작업 공간 확보(없으면 샌드박스 생성) → agent_id 반환
//   chat      응시자 발언 1건 처리(도구 실행 포함)
//   files     샌드박스 현재 파일 목록
//   submit    지정 파일을 answer-files 버킷으로 복사하고 답안에 연결
//   close     샌드박스 종료
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.99.1";
import {
  historyFromEvents,
  runTurn,
  type AgentContext,
  type EventKind,
  type EventRole,
} from "../_shared/examAgent.ts";
import {
  connectSandbox,
  createSandbox,
  resolveWorkPath,
  SandboxPathError,
  WORK_DIR,
  type ExamSandbox,
} from "../_shared/sandbox.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** 응시자 1인이 한 문항에서 쓸 수 있는 대화 턴 상한. 비용 방어 */
const MAX_TURNS_PER_QUESTION = 60;
/** 제출 가능한 파일 크기 상한 */
const MAX_SUBMIT_BYTES = 20 * 1024 * 1024;

/** 과정 로그 기록기. seq 를 서버가 매겨 순서를 보장한다 */
function makeRecorder(service: SupabaseClient, agentId: string, startSeq: number) {
  let seq = startSeq;
  return {
    async record(role: EventRole, kind: EventKind, content: Record<string, unknown>) {
      seq += 1;
      const { error } = await service
        .from("exam_agent_events")
        .insert({ agent_id: agentId, seq, role, kind, content });
      if (error) console.error("[exam-agent] event insert failed", error);
    },
    get seq() {
      return seq;
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let sandbox: ExamSandbox | null = null;

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "인증이 필요합니다." }, 401);

    const authed = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await authed.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: "세션이 유효하지 않습니다." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    const sessionId = String(body.session_id ?? "");
    if (!sessionId) return json({ error: "session_id 가 필요합니다." }, 400);

    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // (2) 세션 소유·상태 확인. 끝난 시험에서는 에이전트를 쓸 수 없다.
    const { data: session } = await service
      .from("exam_sessions")
      .select("id, org_id, exam_id, applicant_id, status, started_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return json({ error: "시험 세션을 찾을 수 없습니다." }, 404);
    if (session.applicant_id !== user.id) {
      return json({ error: "본인 시험 세션이 아닙니다." }, 403);
    }
    if (session.status !== "in_progress") {
      return json({ error: "진행 중인 시험에서만 사용할 수 있습니다." }, 409);
    }

    const questionId = body.question_id ? String(body.question_id) : null;

    // 작업 공간 조회. question_id 가 NULL 인 행과 값이 있는 행을 구분해 찾는다.
    const findAgent = async () => {
      const q = service
        .from("exam_agent_sessions")
        .select("id, sandbox_id, status, turn_count, question_id")
        .eq("session_id", sessionId);
      const { data } = questionId
        ? await q.eq("question_id", questionId).maybeSingle()
        : await q.is("question_id", null).maybeSingle();
      return data;
    };

    if (action === "start") {
      let agent = await findAgent();

      // 이미 있고 살아 있으면 그대로 쓴다. 샌드박스가 죽었으면 새로 띄운다.
      if (agent && agent.sandbox_id && agent.status === "active") {
        try {
          sandbox = await connectSandbox(agent.sandbox_id);
          await sandbox.touch();
          return json({ agent_id: agent.id, reused: true });
        } catch {
          await service
            .from("exam_agent_sessions")
            .update({ status: "expired" })
            .eq("id", agent.id);
          agent = { ...agent, status: "expired" };
        }
      }

      sandbox = await createSandbox({
        session_id: sessionId,
        question_id: questionId ?? "",
        org_id: String(session.org_id),
      });

      if (agent) {
        const { error } = await service
          .from("exam_agent_sessions")
          .update({
            sandbox_id: sandbox.id,
            status: "active",
            last_active_at: new Date().toISOString(),
          })
          .eq("id", agent.id);
        if (error) throw error;
        return json({ agent_id: agent.id, reused: false });
      }

      const { data: created, error } = await service
        .from("exam_agent_sessions")
        .insert({
          session_id: sessionId,
          question_id: questionId,
          sandbox_id: sandbox.id,
          sandbox_provider: "e2b",
          status: "active",
        })
        .select("id")
        .single();
      if (error || !created) throw error ?? new Error("작업 공간 생성 실패");
      return json({ agent_id: created.id, reused: false });
    }

    // start 외의 동작은 모두 기존 작업 공간이 있어야 한다.
    const agent = await findAgent();
    if (!agent) return json({ error: "작업 공간이 없습니다. 먼저 시작하십시오." }, 409);
    if (!agent.sandbox_id) return json({ error: "샌드박스가 준비되지 않았습니다." }, 409);

    if (action === "close") {
      try {
        sandbox = await connectSandbox(agent.sandbox_id);
        await sandbox.dispose();
      } catch {
        // 이미 사라진 샌드박스는 성공으로 본다
      }
      sandbox = null;
      await service
        .from("exam_agent_sessions")
        .update({ status: "closed", closed_at: new Date().toISOString() })
        .eq("id", agent.id);
      return json({ ok: true });
    }

    try {
      sandbox = await connectSandbox(agent.sandbox_id);
      await sandbox.touch();
    } catch {
      await service.from("exam_agent_sessions").update({ status: "expired" }).eq("id", agent.id);
      return json(
        { error: "샌드박스 수명이 끝났습니다. 작업 공간을 다시 시작하십시오.", expired: true },
        409,
      );
    }

    if (action === "files") {
      const path = typeof body.path === "string" ? body.path : undefined;
      const files = await sandbox.listFiles(path);
      return json({ files });
    }

    if (action === "submit") {
      const rel = String(body.path ?? "");
      let abs: string;
      try {
        abs = resolveWorkPath(rel);
      } catch (e) {
        return json({ error: e instanceof SandboxPathError ? e.message : "경로 오류" }, 400);
      }

      const bytes = await sandbox.downloadFile(abs);
      if (bytes.byteLength > MAX_SUBMIT_BYTES) {
        return json({ error: "제출 파일이 너무 큽니다(20MB 초과)." }, 400);
      }

      // answer-files 버킷은 <session_id>/... 규약을 쓴다(0017).
      const name = abs.slice(WORK_DIR.length + 1).replace(/[^\w.\-/]/g, "_");
      const storagePath = `${sessionId}/agent/${name}`;
      const { error: upErr } = await service.storage
        .from("answer-files")
        .upload(storagePath, bytes, { upsert: true });
      if (upErr) {
        console.error("[exam-agent] upload failed", upErr);
        return json({ error: "파일 저장에 실패했습니다." }, 500);
      }

      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const { error: artErr } = await service.from("exam_agent_artifacts").upsert(
        {
          agent_id: agent.id,
          sandbox_path: abs,
          storage_path: storagePath,
          bytes: bytes.byteLength,
          sha256,
          submitted: true,
        },
        { onConflict: "agent_id,sandbox_path" },
      );
      if (artErr) {
        console.error("[exam-agent] artifact upsert failed", artErr);
        return json({ error: "제출 기록에 실패했습니다." }, 500);
      }

      return json({ ok: true, storage_path: storagePath, bytes: bytes.byteLength });
    }

    if (action !== "chat") return json({ error: "알 수 없는 action" }, 400);

    if ((agent.turn_count ?? 0) >= MAX_TURNS_PER_QUESTION) {
      return json({ error: `이 문항에서 사용할 수 있는 대화 횟수(${MAX_TURNS_PER_QUESTION}회)를 모두 썼습니다.` }, 429);
    }

    const userText = String(body.message ?? "").trim();
    if (!userText) return json({ error: "메시지가 비었습니다." }, 400);

    // 문항 본문은 응시자용 뷰에서 가져온다 — questions 를 직접 읽으면
    // answer_key(정답·루브릭)가 함께 올라와 프롬프트에 섞일 수 있다.
    let ctx: AgentContext = { questionContent: "(문항 정보 없음)", questionType: "work_based" };
    if (agent.question_id) {
      const { data: q } = await service
        .from("questions_public")
        .select("content, type")
        .eq("id", agent.question_id)
        .maybeSingle();
      if (q) ctx = { questionContent: q.content, questionType: q.type };
    }

    const { data: events } = await service
      .from("exam_agent_events")
      .select("seq, role, kind, content")
      .eq("agent_id", agent.id)
      .order("seq", { ascending: true });

    const lastSeq = events?.length ? Number(events[events.length - 1].seq) : 0;
    const recorder = makeRecorder(service, agent.id, lastSeq);
    const history = historyFromEvents(events ?? []);

    const result = await runTurn({ ctx, history, userText, sandbox, recorder });

    // 산출물 목록 갱신(제출 전 상태). 실패해도 대화는 성공으로 돌려준다 —
    // 과정 로그는 이미 남았고, 목록은 files 로 다시 받을 수 있다.
    for (const p of new Set(result.createdPaths)) {
      try {
        const { error } = await service.from("exam_agent_artifacts").upsert(
          { agent_id: agent.id, sandbox_path: resolveWorkPath(p) },
          { onConflict: "agent_id,sandbox_path", ignoreDuplicates: true },
        );
        if (error) console.error("[exam-agent] artifact note failed", error);
      } catch (e) {
        console.error("[exam-agent] artifact path rejected", e);
      }
    }

    await service
      .from("exam_agent_sessions")
      .update({
        turn_count: (agent.turn_count ?? 0) + 1,
        prompt_tokens: result.usage.prompt,
        completion_tokens: result.usage.completion,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", agent.id);

    const files = await sandbox.listFiles().catch(() => []);

    return json({
      reply: result.reply,
      files,
      truncated: result.truncated,
      turns_left: MAX_TURNS_PER_QUESTION - ((agent.turn_count ?? 0) + 1),
    });
  } catch (e) {
    console.error("[exam-agent] failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: `처리 중 오류가 발생했습니다: ${msg}` }, 500);
  }
});
