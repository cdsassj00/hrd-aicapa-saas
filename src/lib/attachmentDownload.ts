import JSZip from 'jszip';

export type DownloadableAttachment = {
  name?: string | null;
  url?: string | null;
  size?: number | null;
  mime?: string | null;
  type?: string | null;
};

const fallbackName = (idx: number) => `첨부파일_${idx + 1}`;

function cleanFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'attachment';
}

function uniqueName(name: string, used: Set<string>) {
  const cleaned = cleanFileName(name);
  if (!used.has(cleaned)) {
    used.add(cleaned);
    return cleaned;
  }
  const dot = cleaned.lastIndexOf('.');
  const base = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const ext = dot > 0 ? cleaned.slice(dot) : '';
  let i = 2;
  while (used.has(`${base}_${i}${ext}`)) i += 1;
  const next = `${base}_${i}${ext}`;
  used.add(next);
  return next;
}

async function fetchAttachment(att: DownloadableAttachment, idx: number) {
  const url = att.url || '';
  if (!url) throw new Error('첨부파일 주소가 없습니다.');
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`${att.name || fallbackName(idx)} 다운로드 실패`);
  const blob = await response.blob();
  return {
    blob,
    name: cleanFileName(att.name || fallbackName(idx)),
  };
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = cleanFileName(filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export async function downloadAttachment(att: DownloadableAttachment, idx = 0) {
  const { blob, name } = await fetchAttachment(att, idx);
  triggerBlobDownload(blob, name);
}

export async function downloadAttachmentsAsZip(attachments: DownloadableAttachment[], zipName: string) {
  const zip = new JSZip();
  const used = new Set<string>();
  const valid = attachments.filter((att) => !!att.url);
  if (valid.length === 0) throw new Error('다운로드할 첨부파일이 없습니다.');

  for (let i = 0; i < valid.length; i += 1) {
    const { blob, name } = await fetchAttachment(valid[i], i);
    zip.file(uniqueName(name, used), blob);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(blob, `${cleanFileName(zipName).replace(/\.zip$/i, '')}.zip`);
}