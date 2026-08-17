// Daily.co 감독 룸 관리 — 시험별 룸 생성/조회/토큰발급/삭제.
//
// 보안(설계문서 §6): 이 함수는 자체적으로 호출자 신원을 검증한다.
//   - create / delete : 해당 시험 org 의 감독관(is_org_examiner) 만
//   - get             : 감독관 또는 그 시험의 응시 세션 보유자
//   - create-token    : room_name 이 가리키는 시험을 찾아, 감독관이면 owner 토큰,
//                       응시자면 participant 토큰(강제 is_owner=false), 아니면 403.
//                       클라이언트가 보낸 is_owner 는 그대로 신뢰하지 않는다.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY");
const DAILY_BASE = "https://api.daily.co/v1";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function dailyFetch(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${DAILY_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${DAILY_API_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Daily API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function dailyRoomExists(roomName: string) {
  const res = await fetch(`${DAILY_BASE}/rooms/${roomName}`, {
    headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Daily API error ${res.status}: ${body}`);
  }
  await res.json();
  return true;
}

async function createDailyRoom(examId: string, sb: ReturnType<typeof createClient>) {
  const name = `exam-${examId.slice(0, 8)}-${Date.now()}`;
  const room = await dailyFetch("/rooms", {
    method: "POST",
    body: JSON.stringify({
      name,
      properties: {
        enable_screenshare: true,
        enable_chat: false,
        enable_knocking: false,
        start_video_off: false,
        start_audio_off: true,
        exp: Math.floor(Date.now() / 1000) + 86400 * 7,
      },
    }),
  });

  await sb.from("exams").update({ daily_room_name: room.name, daily_room_url: room.url }).eq("id", examId);
  return room;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!DAILY_API_KEY) {
    return json({ error: "감독 서비스(Daily)가 구성되지 않았습니다. 관리자에게 문의해 주세요." }, 503);
  }

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 호출자 JWT 로 도는 클라이언트 — SECURITY DEFINER 권한함수(auth.uid 기반)와 RLS 가 여기서 동작한다.
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    // 서비스 롤 — exams 룸 컬럼 갱신처럼 RLS 우회가 필요한 쓰기에만.
    const sb = createClient(supabaseUrl, serviceKey);

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const { action, exam_id, room_name, user_name, is_owner } = body;

    // --- 권한 헬퍼 ---
    const isExaminer = async (orgId: string): Promise<boolean> => {
      const { data } = await userClient.rpc("is_org_examiner", { _org_id: orgId });
      return data === true;
    };
    const hasSession = async (examId: string): Promise<boolean> => {
      const { data } = await userClient
        .from("exam_sessions").select("id").eq("exam_id", examId).eq("applicant_id", user.id).limit(1);
      return !!(data && data.length);
    };
    const loadExam = async (opts: { examId?: string; roomName?: string }) => {
      let q = sb.from("exams").select("id, org_id, daily_room_name, daily_room_url");
      q = opts.examId ? q.eq("id", opts.examId) : q.eq("daily_room_name", opts.roomName!);
      const { data } = await q.maybeSingle();
      return data as { id: string; org_id: string; daily_room_name: string | null; daily_room_url: string | null } | null;
    };

    if (action === "create") {
      const exam = await loadExam({ examId: exam_id });
      if (!exam) return json({ error: "시험을 찾을 수 없습니다." }, 404);
      if (!(await isExaminer(exam.org_id))) return json({ error: "forbidden" }, 403);

      const room = await createDailyRoom(exam.id, sb);
      return json({ room_name: room.name, room_url: room.url });
    }

    if (action === "get") {
      const exam = await loadExam({ examId: exam_id });
      if (!exam) return json({ error: "시험을 찾을 수 없습니다." }, 404);
      // 감독관이거나, 이 시험의 응시 세션을 가진 응시자만.
      if (!(await isExaminer(exam.org_id)) && !(await hasSession(exam.id))) {
        return json({ error: "forbidden" }, 403);
      }
      if (!exam.daily_room_name || !(await dailyRoomExists(exam.daily_room_name))) {
        const room = await createDailyRoom(exam.id, sb);
        return json({ daily_room_name: room.name, daily_room_url: room.url });
      }
      return json({ daily_room_name: exam.daily_room_name, daily_room_url: exam.daily_room_url });
    }

    if (action === "create-token") {
      if (!room_name) return json({ error: "room_name required" }, 400);
      // room_name 으로 시험을 역추적해 권한을 검증한다(클라이언트가 임의 방 이름을 못 넣게).
      const exam = await loadExam({ roomName: room_name });
      if (!exam) return json({ error: "forbidden" }, 403);

      const examiner = await isExaminer(exam.org_id);
      const applicant = examiner ? false : await hasSession(exam.id);
      if (!examiner && !applicant) return json({ error: "forbidden" }, 403);

      // is_owner 는 서버에서 결정한다 — 감독관만 owner.
      const finalIsOwner = examiner ? (is_owner !== false) : false;

      const token = await dailyFetch("/meeting-tokens", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            room_name,
            user_name: user_name || (examiner ? "examiner" : "participant"),
            is_owner: finalIsOwner,
            enable_screenshare: true,
            start_video_off: finalIsOwner,
            start_audio_off: true,
          },
        }),
      });
      return json({ token: token.token, is_owner: finalIsOwner });
    }

    if (action === "delete") {
      const exam = await loadExam({ examId: exam_id });
      if (!exam) return json({ error: "시험을 찾을 수 없습니다." }, 404);
      if (!(await isExaminer(exam.org_id))) return json({ error: "forbidden" }, 403);

      if (exam.daily_room_name) {
        await dailyFetch(`/rooms/${exam.daily_room_name}`, { method: "DELETE" }).catch(() => {});
        await sb.from("exams").update({ daily_room_name: null, daily_room_url: null }).eq("id", exam.id);
      }
      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
