import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAILY_API_KEY = Deno.env.get("DAILY_API_KEY")!;
const DAILY_BASE = "https://api.daily.co/v1";

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, exam_id, exam_title, room_name, user_name, is_owner } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    if (action === "create") {
      const room = await createDailyRoom(exam_id, sb);

      return new Response(JSON.stringify({ room_name: room.name, room_url: room.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get") {
      const { data: exam } = await sb
        .from("exams")
        .select("daily_room_name, daily_room_url")
        .eq("id", exam_id)
        .single();
      if (!exam?.daily_room_name || !(await dailyRoomExists(exam.daily_room_name))) {
        const room = await createDailyRoom(exam_id, sb);
        return new Response(JSON.stringify({ daily_room_name: room.name, daily_room_url: room.url }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(exam || {}), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "create-token") {
      const token = await dailyFetch("/meeting-tokens", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            room_name,
            user_name: user_name || "participant",
            is_owner: is_owner || false,
            enable_screenshare: true,
            start_video_off: !!is_owner,
            start_audio_off: true,
          },
        }),
      });
      return new Response(JSON.stringify({ token: token.token }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const { data: exam } = await sb.from("exams").select("daily_room_name").eq("id", exam_id).single();
      if (exam?.daily_room_name) {
        await dailyFetch(`/rooms/${exam.daily_room_name}`, { method: "DELETE" }).catch(() => {});
        await sb.from("exams").update({ daily_room_name: null, daily_room_url: null }).eq("id", exam_id);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
