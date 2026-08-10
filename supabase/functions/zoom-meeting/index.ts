import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getZoomAccessToken(): Promise<string> {
  const accountId = Deno.env.get("ZOOM_ACCOUNT_ID")?.trim();
  const clientId = Deno.env.get("ZOOM_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("ZOOM_CLIENT_SECRET")?.trim();

  if (!accountId || !clientId || !clientSecret) {
    throw new Error("Missing Zoom credentials in backend secrets");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const requestToken = async (url: string, body?: string) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
    const text = await res.text();
    return { ok: res.ok, text };
  };

  const formBody = new URLSearchParams({
    grant_type: "account_credentials",
    account_id: accountId,
  }).toString();

  const primary = await requestToken("https://zoom.us/oauth/token", formBody);
  if (primary.ok) {
    return JSON.parse(primary.text).access_token;
  }

  if (primary.text.includes("unsupported_grant_type")) {
    const fallback = await requestToken(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    );
    if (fallback.ok) {
      return JSON.parse(fallback.text).access_token;
    }
    throw new Error(`Zoom token error: ${fallback.text}`);
  }

  throw new Error(`Zoom token error: ${primary.text}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, exam_id, exam_title } = await req.json();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!exam_id || !uuidRegex.test(exam_id)) {
      return new Response(JSON.stringify({ error: "Invalid exam_id: must be a valid UUID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper: get exam zoom info
    const getExamZoom = async () => {
      const { data, error } = await supabase
        .from("exams")
        .select("id, title, zoom_meeting_id, zoom_join_url, zoom_host_url")
        .eq("id", exam_id)
        .single();
      if (error) throw error;
      return data;
    };

    if (action === "create") {
      const exam = await getExamZoom();

      // Already has a meeting — reuse
      if (exam.zoom_meeting_id && exam.zoom_join_url) {
        return new Response(JSON.stringify({
          meeting_id: exam.zoom_meeting_id,
          join_url: exam.zoom_join_url,
          host_url: exam.zoom_host_url,
          reused: true,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Create new Zoom meeting
      const token = await getZoomAccessToken();
      const meetingRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topic: exam_title || exam.title || "AI챔피언 역량인증 시험 감독",
          type: 2,
          duration: 120,
          settings: {
            host_video: true,
            participant_video: true,
            join_before_host: true,
            mute_upon_entry: true,
            waiting_room: false,
            auto_recording: "cloud",
          },
        }),
      });

      if (!meetingRes.ok) {
        const err = await meetingRes.text();
        throw new Error(`Zoom meeting creation failed: ${err}`);
      }

      const meeting = await meetingRes.json();

      const { error: updateError } = await supabase
        .from("exams")
        .update({
          zoom_meeting_id: String(meeting.id),
          zoom_join_url: meeting.join_url,
          zoom_host_url: meeting.start_url,
        })
        .eq("id", exam_id);

      if (updateError) throw updateError;

      return new Response(
        JSON.stringify({
          meeting_id: String(meeting.id),
          join_url: meeting.join_url,
          host_url: meeting.start_url,
          reused: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "get") {
      const exam = await getExamZoom();
      return new Response(JSON.stringify({
        meeting_id: exam.zoom_meeting_id,
        join_url: exam.zoom_join_url,
        host_url: exam.zoom_host_url,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "end") {
      const exam = await getExamZoom();
      if (exam.zoom_meeting_id) {
        const token = await getZoomAccessToken();
        await fetch(`https://api.zoom.us/v2/meetings/${exam.zoom_meeting_id}/status`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "end" }),
        });

        await supabase
          .from("exams")
          .update({ zoom_meeting_id: null, zoom_join_url: null, zoom_host_url: null })
          .eq("id", exam_id);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
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
