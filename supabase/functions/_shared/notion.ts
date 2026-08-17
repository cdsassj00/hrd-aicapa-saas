// Notion API 로 도입 문의를 페이지로 기록한다. (HTTP 껍데기 밖의 순수 로직)
// env: NOTION_TOKEN, NOTION_DB_ID — 미설정 시 null 반환하고 스킵(Supabase 저장은 이미 완료).
const NOTION_VERSION = "2022-06-28";

export interface InquiryInput {
  company: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  headcount?: string | null;
  timeframe?: string | null;
  inquiry_type?: string | null; // 채용 / 재직자 진단 / 기타
  source?: string | null;
  message?: string | null;
}

const rt = (s?: string | null) =>
  s && s.trim() ? { rich_text: [{ text: { content: s.trim().slice(0, 1900) } }] } : undefined;

/** 성공 시 Notion page id, 미설정/실패 시 null (throw 하지 않음). */
export async function createInquiryNotionPage(input: InquiryInput): Promise<string | null> {
  const token = Deno.env.get("NOTION_TOKEN");
  const dbId = Deno.env.get("NOTION_DB_ID");
  if (!token || !dbId) return null; // 아직 통합 토큰 미설정 → 스킵

  const props: Record<string, unknown> = {
    "기업명": { title: [{ text: { content: (input.company || "무제").slice(0, 1900) } }] },
    "상태": { select: { name: "신규" } },
  };
  const nm = rt(input.contact_name); if (nm) props["담당자"] = nm;
  if (input.email?.trim()) props["이메일"] = { email: input.email.trim() };
  if (input.phone?.trim()) props["연락처"] = { phone_number: input.phone.trim() };
  const hc = rt(input.headcount); if (hc) props["예상 인원"] = hc;
  const tf = rt(input.timeframe); if (tf) props["희망 시기"] = tf;
  if (input.inquiry_type?.trim()) props["유형"] = { select: { name: input.inquiry_type.trim() } };
  const src = rt(input.source); if (src) props["유입경로"] = src;
  const msg = rt(input.message); if (msg) props["메모"] = msg;

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent: { database_id: dbId }, properties: props }),
  });
  if (!res.ok) {
    console.error("[notion] create page failed", res.status, await res.text());
    return null; // 실패해도 Supabase 저장은 유지
  }
  const data = await res.json();
  return data?.id ?? null;
}
