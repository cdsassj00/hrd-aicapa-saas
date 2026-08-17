// Server-side recording chunk uploader.
// Browser sends the chunk to this function; the function uploads to R2 so browser CORS on R2 cannot block recording saves.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID')!;
const ACCESS_KEY = Deno.env.get('R2_ACCESS_KEY_ID')!;
const SECRET_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')!;
const BUCKET = Deno.env.get('R2_BUCKET')!;
const REGION = 'auto';
const SERVICE = 's3';
const HOST = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const MAX_CHUNK_BYTES = 25 * 1024 * 1024;

const enc = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return await crypto.subtle.sign('HMAC', k, enc.encode(msg));
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const data = typeof value === 'string' ? enc.encode(value) : value;
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function signedPut(objectKey: string, body: ArrayBuffer, contentType: string) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = '/' + BUCKET + '/' + objectKey.split('/').map(rfc3986).join('/');
  const payloadHash = await sha256Hex(body);
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${HOST}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
  ].join('\n');
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmac(enc.encode('AWS4' + SECRET_KEY), dateStamp);
  const kRegion = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, SERVICE);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${HOST}${canonicalUri}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 upload failed: ${res.status}${text ? ` ${text.slice(0, 300)}` : ''}`);
  }
}

async function logDiag(adminClient: any, sessionId: string, applicantId: string | null, kind: string, stage: string, status: string, message: string, meta?: any) {
  if (!sessionId || !applicantId) return;
  try {
    await adminClient.from('recording_diagnostics').insert({
      session_id: sessionId,
      applicant_id: applicantId,
      kind,
      stage,
      status,
      message: message?.slice(0, 1000) || null,
      meta: meta || null,
    });
  } catch (e) {
    console.warn('[r2-upload][diag] failed to log', e);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET) {
    return json({ error: '녹화 저장소(R2)가 구성되지 않았습니다.' }, 503);
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  let diagSession = '';
  let diagApplicant: string | null = null;
  let diagKind = 'system';
  let diagChunkIdx: number | null = null;

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthorized' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);
    diagApplicant = user.id;

    const form = await req.formData();
    const sessionId = String(form.get('session_id') || '');
    const kind = String(form.get('kind') || '');
    const chunkIndex = Number(form.get('chunk_index'));
    const mime = String(form.get('mime') || 'video/webm');
    const startedAt = String(form.get('started_at') || new Date().toISOString());
    const endedAt = String(form.get('ended_at') || new Date().toISOString());
    const file = form.get('file');
    diagSession = sessionId;
    diagKind = kind || 'system';
    diagChunkIdx = Number.isInteger(chunkIndex) ? chunkIndex : null;

    if (!sessionId || !['webcam', 'screen'].includes(kind) || !Number.isInteger(chunkIndex) || !(file instanceof File)) {
      await logDiag(adminClient, sessionId, diagApplicant, diagKind, 'upload', 'error', '잘못된 파라미터', { has_file: file instanceof File, kind, chunkIndex });
      return json({ error: 'invalid params' }, 400);
    }
    if (file.size <= 0) {
      await logDiag(adminClient, sessionId, diagApplicant, diagKind, 'upload', 'error', '빈 파일', { idx: chunkIndex });
      return json({ error: 'empty chunk' }, 400);
    }
    if (file.size > MAX_CHUNK_BYTES) {
      await logDiag(adminClient, sessionId, diagApplicant, diagKind, 'upload', 'error', `파일 크기 초과 (${file.size} bytes)`, { idx: chunkIndex });
      return json({ error: 'chunk too large' }, 413);
    }

    // exam_sessions 의 응시자 식별 컬럼은 user_id 다(squash 스키마). 이식된 코드가
    // 쓰던 applicant_id 는 이 테이블에 없어 조회가 깨졌었다 — recording_chunks 쪽만
    // applicant_id 를 갖는다. 세션 소유권은 user_id 로 검증한다.
    const { data: sess, error: sErr } = await userClient
      .from('exam_sessions')
      .select('id, user_id, exam_id, org_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (sErr || !sess || sess.user_id !== user.id) {
      await logDiag(adminClient, sessionId, diagApplicant, diagKind, 'presign', 'error', `세션 권한 검증 실패: ${sErr?.message || 'forbidden'}`, { idx: chunkIndex });
      return json({ error: 'forbidden' }, 403);
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    // 키를 org_id 로 프리픽스한다 — 테넌트별 프리픽스/보존정책/스코프 토큰이 가능해진다(설계문서 §6).
    const objectKey = `recordings/${sess.org_id}/${sess.exam_id}/${sessionId}/${kind}/${String(chunkIndex).padStart(5, '0')}_${ts}.webm`;
    const body = await file.arrayBuffer();
    let r2LastErr: any = null;
    let r2Success = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await signedPut(objectKey, body, mime);
        r2Success = true;
        break;
      } catch (uploadErr: any) {
        r2LastErr = uploadErr;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }
    if (!r2Success) {
      await logDiag(adminClient, sessionId, diagApplicant, diagKind, 'upload', 'error', `R2 업로드 3회 실패: ${r2LastErr?.message || r2LastErr}`, { idx: chunkIndex, object_key: objectKey });
      throw r2LastErr;
    }

    const durationMs = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
    // EBML header detection (Matroska/WebM): 0x1A 0x45 0xDF 0xA3
    const head = new Uint8Array(body, 0, Math.min(4, body.byteLength));
    const isHeader = head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    const { error: insertErr } = await adminClient.from('recording_chunks').insert({
      session_id: sessionId,
      exam_id: sess.exam_id,
      applicant_id: user.id,
      kind,
      chunk_index: chunkIndex,
      object_key: objectKey,
      mime_type: mime,
      size_bytes: file.size,
      duration_ms: durationMs,
      started_at: startedAt,
      ended_at: endedAt,
      is_header: isHeader,
    });
    if (insertErr) {
      await logDiag(adminClient, sessionId, diagApplicant, diagKind, 'db_insert', 'error', `DB insert 실패: ${insertErr.message}`, { idx: chunkIndex, object_key: objectKey });
      throw insertErr;
    }

    return json({ ok: true, object_key: objectKey, exam_id: sess.exam_id });
  } catch (e) {
    console.error('[r2-upload] failed', e);
    await logDiag(adminClient, diagSession, diagApplicant, diagKind, 'upload', 'error', String((e as any)?.message || e), { idx: diagChunkIdx });
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});