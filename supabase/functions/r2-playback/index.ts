// R2 presigned GET URL generator for recording playback (admin/examiner review).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID')!;
const ACCESS_KEY = Deno.env.get('R2_ACCESS_KEY_ID')!;
const SECRET_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')!;
const BUCKET = Deno.env.get('R2_BUCKET')!;
const REGION = 'auto';
const SERVICE = 's3';
const HOST = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;

const enc = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function binary(body: ArrayBuffer, contentType = 'video/webm', extraHeaders: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'none',
      'Access-Control-Expose-Headers': 'Content-Type, Content-Length, X-R2-Content-Type, X-R2-Content-Length',
      ...extraHeaders,
    },
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

async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) =>
    '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function presignGet(objectKey: string, expiresSec = 900): Promise<string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const credential = `${ACCESS_KEY}/${credentialScope}`;

  const canonicalUri = '/' + BUCKET + '/' + objectKey.split('/').map(rfc3986).join('/');
  const signedHeaders = 'host';
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(params).sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(params[k])}`).join('&');
  const canonicalHeaders = `host:${HOST}\n`;
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const canonicalRequest = ['GET', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const kDate = await hmac(enc.encode('AWS4' + SECRET_KEY), dateStamp);
  const kRegion = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, SERVICE);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));
  return `https://${HOST}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY || !BUCKET) {
    return json({ error: '녹화 저장소(R2)가 구성되지 않았습니다.' }, 503);
  }

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthorized' }, 401);

    // 호출자 JWT 로 도는 클라이언트. 권한은 RLS 로 강제한다:
    // recording_chunks 의 'staff' 정책이 is_org_examiner(org_id) or is_platform_admin() 인
    // 행만 노출하므로, 아래 조회는 호출자 org 의 녹화만 본다(교차테넌트 IDOR 차단).
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const mode: string | undefined = body.mode;
    const sessionId: string | undefined = body.session_id;
    const objectKey: string | undefined = body.object_key;
    const requestedKeys: string[] = Array.isArray(body.object_keys)
      ? body.object_keys
      : (objectKey ? [objectKey] : []);
    const expires = Math.min(3600, Math.max(60, Number(body.expires_in) || 900));

    if (mode === 'object') {
      if (!objectKey) return json({ error: 'object_key required' }, 400);
      let q = userClient
        .from('recording_chunks')
        .select('object_key,mime_type,session_id')
        .eq('object_key', objectKey);
      if (sessionId) q = q.eq('session_id', sessionId);
      const { data: row, error } = await q.maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: 'not found' }, 404);

      const signedUrl = await presignGet(objectKey, expires);
      const res = await fetch(signedUrl);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return json({ error: `object fetch failed: ${res.status}${text ? ` ${text.slice(0, 200)}` : ''}` }, 502);
      }
      const bytes = await res.arrayBuffer();
      const upstreamType = res.headers.get('content-type') || '';
      const upstreamLength = res.headers.get('content-length') || String(bytes.byteLength);
      return binary(bytes, row.mime_type || upstreamType || 'video/webm', {
        'X-R2-Content-Type': upstreamType,
        'X-R2-Content-Length': upstreamLength,
      });
    }

    let allowedKeys: string[] = [];
    if (sessionId) {
      // 세션 기반: 해당 세션의 모든 청크 키를 신뢰
      const { data: rows, error } = await userClient
        .from('recording_chunks').select('object_key').eq('session_id', sessionId);
      if (error) throw error;
      allowedKeys = (rows || []).map(r => r.object_key);
    } else if (requestedKeys.length) {
      // 키 기반: 청크 단위 검증 (배치로 분할해 URL 길이 한계 회피)
      const verified = new Set<string>();
      const BATCH = 20;
      for (let i = 0; i < requestedKeys.length; i += BATCH) {
        const slice = requestedKeys.slice(i, i + BATCH);
        const { data: rows, error } = await userClient
          .from('recording_chunks').select('object_key').in('object_key', slice);
        if (error) throw error;
        (rows || []).forEach(r => verified.add(r.object_key));
      }
      allowedKeys = requestedKeys.filter(k => verified.has(k));
    } else {
      return json({ error: 'session_id or object_keys required' }, 400);
    }

    const result: Record<string, string> = {};
    for (const k of allowedKeys) {
      result[k] = await presignGet(k, expires);
    }
    return json({ urls: result, expires_in: expires });
  } catch (e) {
    console.error('[r2-playback] failed', e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
