// AWS Rekognition CompareFaces - Seoul region (ap-northeast-2)
// Manual AWS Signature V4 signing (no AWS SDK to keep cold start fast)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REGION = "ap-northeast-2";
const SERVICE = "rekognition";
const HOST = `${SERVICE}.${REGION}.amazonaws.com`;
const ENDPOINT = `https://${HOST}/`;

// ---- SigV4 helpers ----
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function getSignatureKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode("AWS4" + secret), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  return kSigning;
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signedFetch(target: string, payload: string, accessKey: string, secretKey: string): Promise<Response> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(payload);
  const canonicalHeaders =
    `content-type:application/x-amz-json-1.1\n` +
    `host:${HOST}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

  const signingKey = await getSignatureKey(secretKey, dateStamp, REGION, SERVICE);
  const signature = toHex(await hmac(signingKey, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      Authorization: authorization,
    },
    body: payload,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { selfie_base64, id_photo_base64, similarity_threshold = 80 } = await req.json();

    if (!selfie_base64 || !id_photo_base64) {
      return new Response(
        JSON.stringify({ error: "selfie_base64 and id_photo_base64 are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const accessKey = Deno.env.get("AWS_REKOGNITION_ACCESS_KEY_ID");
    const secretKey = Deno.env.get("AWS_REKOGNITION_SECRET_ACCESS_KEY");
    if (!accessKey || !secretKey) {
      throw new Error("AWS credentials are not configured");
    }

    const payload = JSON.stringify({
      SourceImage: { Bytes: id_photo_base64 },     // 신분증
      TargetImage: { Bytes: selfie_base64 },        // 셀카
      SimilarityThreshold: similarity_threshold,
      QualityFilter: "AUTO",
    });

    const resp = await signedFetch("RekognitionService.CompareFaces", payload, accessKey, secretKey);
    const text = await resp.text();

    if (!resp.ok) {
      console.error("Rekognition error:", resp.status, text);
      return new Response(
        JSON.stringify({ error: `AWS Rekognition error: ${resp.status}`, detail: text }),
        { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = JSON.parse(text);
    const matches = data.FaceMatches || [];
    const unmatched = data.UnmatchedFaces || [];
    const sourceFaceFound = !!data.SourceImageFace;

    const bestSimilarity = matches.length > 0
      ? Math.max(...matches.map((m: any) => m.Similarity || 0))
      : 0;

    // Pass level by similarity (AWS recommends 80~99 for ID verification)
    let passLevel: "high" | "medium" | "low" | "fail" = "fail";
    if (bestSimilarity >= 95) passLevel = "high";
    else if (bestSimilarity >= 90) passLevel = "medium";
    else if (bestSimilarity >= 80) passLevel = "low";

    return new Response(
      JSON.stringify({
        confidence: bestSimilarity,                 // 0~100
        match: bestSimilarity >= similarity_threshold,
        passLevel,
        faces1: sourceFaceFound ? 1 : 0,            // 신분증에서 검출된 얼굴
        faces2: matches.length + unmatched.length,  // 셀카에서 검출된 얼굴
        matchedFaces: matches.length,
        unmatchedFaces: unmatched.length,
        thresholds: { "80": 80, "90": 90, "95": 95 },
        raw: data,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("aws-rekognition-compare-test error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
