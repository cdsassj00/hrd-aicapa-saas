import { useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Upload, FileJson, Paperclip, Trash2, CheckCircle2, AlertTriangle, Info, Copy, Eye, Download } from 'lucide-react';
import {
  parseJson, dryRun, uploadAttachments, commitPayload,
  SAMPLE_PAYLOAD, type UploadPayload, type DryRunReport,
} from '@/lib/questionSetUpload';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCommitted: () => void;
}

export function QuestionSetUploadDialog({ open, onOpenChange, onCommitted }: Props) {
  const { toast } = useToast();
  const { activeOrgId } = useAuth();
  const [tab, setTab] = useState('json');
  const [jsonText, setJsonText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [payload, setPayload] = useState<UploadPayload | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState('');
  const jsonFileRef = useRef<HTMLInputElement>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);

  const uploadedNames = useMemo(() => files.map(f => f.name), [files]);

  const handleParse = (raw: string) => {
    setJsonText(raw);
    const r = parseJson(raw);
    if (r.error) { setParseError(r.error); setPayload(null); setReport(null); return; }
    setParseError(null);
    setPayload(r.data!);
    setReport(dryRun(r.data!, uploadedNames));
  };

  const refreshReport = (nextFiles?: File[]) => {
    if (!payload) return;
    setReport(dryRun(payload, (nextFiles ?? files).map(f => f.name)));
  };

  const handleJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    e.target.value = '';
    const text = await f.text();
    handleParse(text);
    setTab('json');
  };

  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    if (list.length === 0) return;
    e.target.value = '';
    const next = [...files, ...list];
    setFiles(next);
    refreshReport(next);
  };

  const removeFile = (name: string) => {
    const next = files.filter(f => f.name !== name);
    setFiles(next);
    refreshReport(next);
  };

  const loadSample = () => {
    const txt = JSON.stringify(SAMPLE_PAYLOAD, null, 2);
    handleParse(txt);
  };

  const handleCopySample = async () => {
    await navigator.clipboard.writeText(JSON.stringify(SAMPLE_PAYLOAD, null, 2));
    toast({ title: '샘플 JSON 복사됨' });
  };

  const handleDownloadSample = () => {
    const blob = new Blob([JSON.stringify(SAMPLE_PAYLOAD, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `question-set-template-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: '템플릿 다운로드 완료', description: '1세트 = N과목(questions[]) 구조 예시' });
  };

  const handleCommit = async () => {
    if (!payload || !report?.ok) return;
    if (report.summary.missing_attachments.length > 0) {
      const ok = window.confirm(
        `참조된 첨부파일 ${report.summary.missing_attachments.length}개가 업로드되지 않았습니다.\n` +
        `(${report.summary.missing_attachments.join(', ')})\n\n` +
        `첨부 없이 그대로 등록하시겠습니까? (나중에 문제 편집에서 추가 가능)`
      );
      if (!ok) return;
    }
    if (!activeOrgId) {
      toast({ title: '조직 미선택', description: '상단에서 조직을 선택한 뒤 다시 시도하세요.', variant: 'destructive' });
      return;
    }
    setCommitting(true);
    try {
      setProgress(files.length > 0 ? `첨부 업로드 중... 0/${files.length}` : 'DB 적재 중...');
      const map = await uploadAttachments(files, activeOrgId, (d, t) => setProgress(`첨부 업로드 중... ${d}/${t}`));
      setProgress('DB 적재 중...');
      const res = await commitPayload(payload, map, activeOrgId);
      toast({
        title: '등록 완료',
        description: `세트 ${res.set_ids.length}개 · 문항 ${res.question_ids.length}개`,
      });
      onCommitted();
      onOpenChange(false);
      // reset
      setJsonText(''); setPayload(null); setReport(null); setFiles([]); setTab('json');
    } catch (err: any) {
      toast({ title: '등록 실패', description: err.message, variant: 'destructive' });
    } finally {
      setCommitting(false);
      setProgress('');
    }
  };

  const canCommit = !!payload && !!report?.ok && !committing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] w-[95vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <FileJson className="h-4 w-4" />세트형 문제 업로드 (JSON + 첨부)
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-fit">
            <TabsTrigger value="json" className="text-[12px] gap-1"><FileJson className="h-3.5 w-3.5" />JSON</TabsTrigger>
            <TabsTrigger value="attach" className="text-[12px] gap-1"><Paperclip className="h-3.5 w-3.5" />첨부 ({files.length})</TabsTrigger>
            <TabsTrigger value="preview" className="text-[12px] gap-1" disabled={!payload}><Eye className="h-3.5 w-3.5" />미리보기</TabsTrigger>
          </TabsList>

          {/* JSON 탭 */}
          <TabsContent value="json" className="flex-1 min-h-0 mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input ref={jsonFileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleJsonFile} />
              <Button size="sm" variant="outline" className="text-[12px] gap-1" onClick={() => jsonFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />.json 불러오기
              </Button>
              <Button size="sm" variant="ghost" className="text-[12px] gap-1" onClick={loadSample}>샘플 채우기</Button>
              <Button size="sm" variant="ghost" className="text-[12px] gap-1" onClick={handleCopySample}>
                <Copy className="h-3.5 w-3.5" />샘플 복사
              </Button>
              <Button size="sm" variant="outline" className="text-[12px] gap-1" onClick={handleDownloadSample}>
                <Download className="h-3.5 w-3.5" />템플릿 .json 다운로드
              </Button>
              <span className="text-[11px] text-muted-foreground ml-auto">스키마: 1세트 = sets[0].questions[N과목]</span>
            </div>
            <Textarea
              value={jsonText}
              onChange={e => handleParse(e.target.value)}
              placeholder='{"version":1,"sets":[...],"standalone":[...]}'
              className="font-mono text-[11px] min-h-[300px] flex-1"
            />
            {parseError && (
              <Card className="p-2 border-destructive bg-destructive/5 text-[11px] text-destructive whitespace-pre-wrap font-mono">
                {parseError}
              </Card>
            )}
          </TabsContent>

          {/* 첨부 탭 */}
          <TabsContent value="attach" className="flex-1 min-h-0 mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input ref={attachFileRef} type="file" multiple className="hidden" onChange={handleAttach} />
              <Button size="sm" variant="outline" className="text-[12px] gap-1" onClick={() => attachFileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />파일 추가
              </Button>
              <span className="text-[11px] text-muted-foreground">
                JSON 의 attachment_refs 값과 파일명이 일치해야 매칭됩니다 (대소문자·확장자 구분)
              </span>
            </div>
            <Card className="p-2">
              {files.length === 0 ? (
                <div className="text-center text-[12px] text-muted-foreground py-8">첨부파일 없음</div>
              ) : (
                <ul className="divide-y">
                  {files.map(f => (
                    <li key={f.name} className="flex items-center gap-2 py-1.5 px-1">
                      <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[12px] flex-1 truncate">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeFile(f.name)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>

          {/* 미리보기 탭 */}
          <TabsContent value="preview" className="flex-1 min-h-0 mt-3">
            {payload && (
              <ScrollArea className="h-[420px] pr-2">
                <div className="space-y-3">
                  {payload.sets.map((set, i) => (
                    <Card key={i} className="p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">세트 {i + 1}</Badge>
                        <span className="text-[13px] font-medium">{set.title}</span>
                        {set.category && <Badge variant="outline" className="text-[10px]">{set.category}</Badge>}
                        {set.grade && <Badge variant="outline" className="text-[10px]">{set.grade}</Badge>}
                        <span className="text-[11px] text-muted-foreground ml-auto">
                          {set.questions.length}문항 · {set.questions.reduce((s, q) => s + q.max_score, 0)}점
                        </span>
                      </div>
                      {set.scenario && (
                        <p className="text-[11px] text-muted-foreground whitespace-pre-wrap line-clamp-3">{set.scenario}</p>
                      )}
                      {set.attachment_refs.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {set.attachment_refs.map(n => (
                            <Badge key={n} variant="outline" className="text-[10px] gap-1">
                              <Paperclip className="h-2.5 w-2.5" />{n}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="space-y-1.5 pl-2 border-l-2 border-muted">
                        {set.questions.map((q, qi) => (
                          <div key={qi} className="text-[11px]">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-muted-foreground">과목{q.set_order ?? qi + 1}</span>
                              <Badge variant="outline" className="text-[9px]">{q.type}</Badge>
                              <span>{q.content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60)}</span>
                              <span className="ml-auto text-muted-foreground">{q.max_score}점</span>
                            </div>
                            {q.attachment_refs && q.attachment_refs.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-0.5 pl-4">
                                {q.attachment_refs.map(n => (
                                  <Badge key={n} variant="outline" className="text-[9px] gap-1">
                                    <Paperclip className="h-2.5 w-2.5" />{n}
                                  </Badge>
                                ))}
                              </div>
                            )}
                            {q.submission_slots && q.submission_slots.length > 0 && (
                              <div className="pl-4 mt-0.5 text-[10px] text-muted-foreground space-y-0.5">
                                {q.submission_slots.map(s => (
                                  <div key={s.id}>· [{s.type}] {s.label} ({s.max_score}점)</div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </Card>
                  ))}
                  {payload.standalone.length > 0 && (
                    <Card className="p-3 space-y-1.5">
                      <Badge variant="secondary" className="text-[10px]">독립 문항 {payload.standalone.length}개</Badge>
                      {payload.standalone.map((q, i) => (
                        <div key={i} className="text-[11px] flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[9px]">{q.type}</Badge>
                          <span>{q.content.split('\n')[0].slice(0, 70)}</span>
                          <span className="ml-auto text-muted-foreground">{q.max_score}점</span>
                        </div>
                      ))}
                    </Card>
                  )}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>

        {/* 검증 리포트 */}
        {report && (
          <Card className="p-2 text-[11px] space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              {report.ok ? (
                <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />검증 통과</span>
              ) : (
                <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="h-3.5 w-3.5" />오류 {report.errors.length}개</span>
              )}
              <span className="text-muted-foreground">세트 {report.summary.set_count} · 독립 {report.summary.standalone_count} · 총 문항 {report.summary.total_questions} · 총점 {report.summary.total_score}</span>
              {report.summary.missing_attachments.length > 0 && (
                <span className="text-destructive">누락 첨부: {report.summary.missing_attachments.join(', ')}</span>
              )}
              {report.summary.unused_attachments.length > 0 && (
                <span className="text-amber-600 flex items-center gap-1"><Info className="h-3 w-3" />미참조: {report.summary.unused_attachments.join(', ')}</span>
              )}
            </div>
            {report.errors.length > 0 && (
              <ul className="text-destructive list-disc pl-4">{report.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
            )}
            {report.warnings.length > 0 && (
              <ul className="text-amber-600 list-disc pl-4">{report.warnings.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
            )}
          </Card>
        )}

        <DialogFooter className="gap-2">
          {progress && <span className="text-[11px] text-muted-foreground mr-auto">{progress}</span>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={committing}>취소</Button>
          <Button onClick={handleCommit} disabled={!canCommit} className="gap-1">
            {committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
