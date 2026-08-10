const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlEncode(str: string): string {
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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

    const { meetingNumber, role = 0 } = await req.json();

    if (!meetingNumber) {
      return new Response(JSON.stringify({ error: "meetingNumber is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sdkKey = Deno.env.get("ZOOM_SDK_KEY")!;
    const sdkSecret = Deno.env.get("ZOOM_SDK_SECRET")!;

    const iat = Math.round(Date.now() / 1000) - 30;
    const exp = iat + 60 * 60 * 2;
    const tokenExp = iat + 60 * 60 * 2;

    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      sdkKey,
      mn: String(meetingNumber),
      role,
      iat,
      exp,
      tokenExp,
    };

    const headerB64 = base64urlEncode(JSON.stringify(header));
    const payloadB64 = base64urlEncode(JSON.stringify(payload));
    const message = `${headerB64}.${payloadB64}`;

    // Use Web Crypto API (Deno compatible)
    const encoder = new TextEncoder();
    const keyData = encoder.encode(sdkSecret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
    const signatureB64 = base64url(new Uint8Array(signatureBuffer));

    const signature = `${message}.${signatureB64}`;

    return new Response(JSON.stringify({ signature, sdkKey }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("zoom-sdk-signature error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
