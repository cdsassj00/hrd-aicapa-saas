// Cloudflare R2 presigned PUT URL generator (AWS SigV4)
// Returns a presigned URL the browser can PUT a recording chunk directly to.
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

async function presignPut(objectKey: string, expiresSec = 900): Promise<string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
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
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
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

  return `https://${HOST}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { session_id, kind, chunk_index, ext = 'webm' } = await req.json();
    if (!session_id || !['webcam', 'screen'].includes(kind) || typeof chunk_index !== 'number') {
      return new Response(JSON.stringify({ error: 'invalid params' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // verify ownership
    const { data: sess, error: sErr } = await supabase
      .from('exam_sessions')
      .select('id, applicant_id, exam_id')
      .eq('id', session_id)
      .maybeSingle();
    if (sErr || !sess || sess.applicant_id !== user.id) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const objectKey = `recordings/${sess.exam_id}/${session_id}/${kind}/${String(chunk_index).padStart(5, '0')}_${ts}.${ext}`;
    const url = await presignPut(objectKey, 900);

    return new Response(JSON.stringify({
      upload_url: url,
      object_key: objectKey,
      expires_in: 900,
      exam_id: sess.exam_id,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
