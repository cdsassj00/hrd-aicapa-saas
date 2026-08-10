// 운영용 본인확인 — AWS Rekognition CompareFaces (Seoul, ap-northeast-2)
// 응답 shape:
//   {
//     match: boolean,
//     confidence: 'high'|'medium'|'low',
//     reason: string,
//     name_on_id: null,
//     errorCode: 'NO_FACE_IN_ID'|'NO_FACE_IN_SELFIE'|'LOW_QUALITY'|'MISMATCH'|'IMAGE_TOO_LARGE'|'INVALID_FORMAT'|'API_ERROR'|null,
//     similarity?: number
//   }
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

const PASS_THRESHOLD = 90;          // 통과 기준 similarity
const SIMILARITY_THRESHOLD = 70;    // CompareFaces 응답 필터 임계값

// ---------- AWS SigV4 ----------
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf as unknown as BufferSource);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", key as BufferSource,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}
async function getSignatureKey(secret: string, date: string, region: string, service: string) {
  const kDate = await hmac(new TextEncoder().encode("AWS4" + secret), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return await hmac(kService, "aws4_request");
}
function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function callRekognition(target: string, payload: string, accessKey: string, secretKey: string) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
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

  return await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: payload,
  });
}

type ErrorCode =
  | "NO_FACE_IN_ID"
  | "NO_FACE_IN_SELFIE"
  | "LOW_QUALITY"
  | "MISMATCH"
  | "IMAGE_TOO_LARGE"
  | "INVALID_FORMAT"
  | "API_ERROR"
  | null;

function buildResponse(opts: {
  match: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  errorCode: ErrorCode;
  similarity?: number;
  status?: number;
}) {
  const body = {
    match: opts.match,
    confidence: opts.confidence,
    reason: opts.reason,
    name_on_id: null,
    errorCode: opts.errorCode,
    ...(opts.similarity !== undefined ? { similarity: opts.similarity } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Exported for tests
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch {
    return buildResponse({
      match: false, confidence: "low",
      reason: "요청 형식이 올바르지 않습니다.",
      errorCode: "API_ERROR", status: 400,
    });
  }
  const { selfie_base64, id_photo_base64 } = body ?? {};

  if (!selfie_base64 || !id_photo_base64) {
    return buildResponse({
      match: false, confidence: "low",
      reason: "셀카와 신분증 사진이 모두 필요합니다.",
      errorCode: "API_ERROR", status: 400,
    });
  }

  const accessKey = Deno.env.get("AWS_REKOGNITION_ACCESS_KEY_ID");
  const secretKey = Deno.env.get("AWS_REKOGNITION_SECRET_ACCESS_KEY");
  if (!accessKey || !secretKey) {
    return buildResponse({
      match: false, confidence: "low",
      reason: "본인 확인 서비스가 설정되지 않았습니다. 관리자에게 문의해 주세요.",
      errorCode: "API_ERROR", status: 500,
    });
  }

  try {
    const payload = JSON.stringify({
      SourceImage: { Bytes: id_photo_base64 },
      TargetImage: { Bytes: selfie_base64 },
      SimilarityThreshold: SIMILARITY_THRESHOLD,
      QualityFilter: "AUTO",
    });

    const resp = await callRekognition(
      "RekognitionService.CompareFaces", payload, accessKey, secretKey,
    );
    const text = await resp.text();

    if (!resp.ok) {
      console.error("Rekognition error:", resp.status, text);
      let errorCode: ErrorCode = "API_ERROR";
      let reason = "본인 확인 서비스 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.";
      try {
        const errData = JSON.parse(text);
        const errType = (errData.__type || "").split("#").pop();
        const msg = (errData.Message || errData.message || "").toLowerCase();

        if (errType === "InvalidParameterException") {
          // 메시지에 source/target 구분이 들어옴
          if (msg.includes("source")) {
            errorCode = "NO_FACE_IN_ID";
            reason = "신분증에서 얼굴을 찾지 못했습니다.";
          } else if (msg.includes("target")) {
            errorCode = "NO_FACE_IN_SELFIE";
            reason = "셀카에서 얼굴을 찾지 못했습니다.";
          } else {
            errorCode = "LOW_QUALITY";
            reason = "사진 품질이 낮아 얼굴을 인식할 수 없습니다.";
          }
        } else if (errType === "ImageTooLargeException") {
          errorCode = "IMAGE_TOO_LARGE";
          reason = "이미지 용량이 너무 큽니다(최대 5MB).";
        } else if (errType === "InvalidImageFormatException") {
          errorCode = "INVALID_FORMAT";
          reason = "지원하지 않는 이미지 형식입니다.";
        }
      } catch { /* keep defaults */ }

      return buildResponse({ match: false, confidence: "low", reason, errorCode });
    }

    const data = JSON.parse(text);
    const sourceFaceFound = !!data.SourceImageFace;
    const matches: Array<{ Similarity: number; Face?: any }> = data.FaceMatches || [];
    const unmatched: any[] = data.UnmatchedFaces || [];

    if (!sourceFaceFound) {
      return buildResponse({
        match: false, confidence: "low",
        reason: "신분증에서 얼굴을 찾지 못했습니다.",
        errorCode: "NO_FACE_IN_ID",
      });
    }
    if (matches.length === 0 && unmatched.length === 0) {
      return buildResponse({
        match: false, confidence: "low",
        reason: "셀카에서 얼굴을 찾지 못했거나 품질이 낮습니다.",
        errorCode: "NO_FACE_IN_SELFIE",
      });
    }

    const bestSimilarity = matches.length > 0
      ? Math.max(...matches.map((m) => m.Similarity || 0))
      : 0;

    if (bestSimilarity >= 95) {
      return buildResponse({
        match: true, confidence: "high",
        reason: `얼굴 일치도 ${bestSimilarity.toFixed(1)}% — 본인 확인이 완료되었습니다.`,
        errorCode: null, similarity: bestSimilarity,
      });
    }
    if (bestSimilarity >= PASS_THRESHOLD) {
      return buildResponse({
        match: true, confidence: "medium",
        reason: `얼굴 일치도 ${bestSimilarity.toFixed(1)}% — 본인 확인이 완료되었습니다.`,
        errorCode: null, similarity: bestSimilarity,
      });
    }
    if (bestSimilarity >= SIMILARITY_THRESHOLD) {
      return buildResponse({
        match: false, confidence: "low",
        reason: `얼굴 일치도 ${bestSimilarity.toFixed(1)}% — 기준(${PASS_THRESHOLD}%)에 미달합니다.`,
        errorCode: "LOW_QUALITY", similarity: bestSimilarity,
      });
    }
    return buildResponse({
      match: false, confidence: "low",
      reason: "신분증 인물과 셀카가 일치하지 않습니다.",
      errorCode: "MISMATCH", similarity: bestSimilarity,
    });
  } catch (e) {
    console.error("verify-identity error:", e);
    return buildResponse({
      match: false, confidence: "low",
      reason: "본인 확인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      errorCode: "API_ERROR", status: 500,
    });
  }
}

serve(handle);
