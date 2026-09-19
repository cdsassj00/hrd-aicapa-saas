import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, FileText, Bot, User, Lock } from 'lucide-react';

/**
 * 공개 응시자 화면 미리보기 (/demo)
 * 로그인·승인 없이 "응시자가 보는 시험 화면"을 그대로 체험. 채점·저장 없음.
 * 실제 도입(승인)은 회원가입·도입 문의 후 진행.
 */
export default function DemoExamPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 상단 바 */}
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Badge variant="secondary" className="gap-1 text-[11px]">
            <Sparkles className="h-3 w-3" /> 응시자 화면 미리보기
          </Badge>
          <span className="hidden text-[12.5px] text-muted-foreground sm:inline">
            실제 시험 화면입니다 · 체험용이라 채점·저장은 되지 않습니다
          </span>
          <div className="ml-auto flex items-center gap-2">
            <a href="https://ai-hrd.com/#contact"><Button variant="outline" size="sm" className="text-[13px]">도입 문의</Button></a>
            <Link to="/login?tab=signup"><Button size="sm" className="text-[13px]">회원가입</Button></Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4">
          <h1 className="text-[18px] font-semibold tracking-tight">AI 활용 역량평가 — 체험 문항</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            지원자는 왼쪽 <b>과제</b>를 읽고, 오른쪽 <b>생성형 AI</b>와 대화하며 실제 산출물을 만들어 제출합니다.
            (예시: 민간 · 데이터 분석)
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* 왼쪽: 과제 */}
          <Card className="flex flex-col p-5">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
              <FileText className="h-4 w-4 text-primary" /> 과제
            </div>
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              당신은 이커머스 회사의 담당자입니다. 아래 주문 데이터에서 <b>‘완료’ 주문만</b> 대상으로
              AI를 활용해 다음을 구하세요. (파이썬을 몰라도 AI에게 물어보며 풀 수 있습니다)
            </p>

            <div className="mt-3 overflow-hidden rounded-lg border text-[12.5px]">
              <table className="w-full">
                <thead className="bg-muted/60 text-left">
                  <tr><th className="px-3 py-1.5">주문</th><th className="px-3 py-1.5">카테고리</th><th className="px-3 py-1.5">금액</th><th className="px-3 py-1.5">상태</th></tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-t"><td className="px-3 py-1.5">1</td><td className="px-3 py-1.5">의류</td><td className="px-3 py-1.5">50,000</td><td className="px-3 py-1.5">완료</td></tr>
                  <tr className="border-t"><td className="px-3 py-1.5">2</td><td className="px-3 py-1.5">가전</td><td className="px-3 py-1.5">300,000</td><td className="px-3 py-1.5">완료</td></tr>
                  <tr className="border-t"><td className="px-3 py-1.5">3</td><td className="px-3 py-1.5">의류</td><td className="px-3 py-1.5">30,000</td><td className="px-3 py-1.5">취소</td></tr>
                  <tr className="border-t"><td className="px-3 py-1.5">4</td><td className="px-3 py-1.5">가전</td><td className="px-3 py-1.5">250,000</td><td className="px-3 py-1.5">완료</td></tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-[12.5px] text-muted-foreground">(1) ‘완료’ 주문의 총 매출 합계</label>
                <input disabled placeholder="예: 600000" className="mt-1 w-full rounded-lg border bg-muted/40 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="text-[12.5px] text-muted-foreground">(2) 매출 1위 카테고리</label>
                <input disabled placeholder="예: 가전" className="mt-1 w-full rounded-lg border bg-muted/40 px-3 py-2 text-[13px]" />
              </div>
              <div>
                <label className="text-[12.5px] text-muted-foreground">(3) 분석 메모 (.md/.csv)</label>
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-[12.5px] text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" /> 체험 미리보기 — 제출은 실제 응시에서
                </div>
              </div>
            </div>
          </Card>

          {/* 오른쪽: AI 대화창 */}
          <Card className="flex flex-col p-5">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-medium">
              <Bot className="h-4 w-4 text-primary" /> 생성형 AI
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3">
              <div className="flex gap-2">
                <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="rounded-lg bg-background px-3 py-2 text-[13px]">
                  이 표에서 상태가 ‘완료’인 주문만 골라서 카테고리별 매출 합계랑 총합을 알려줘.
                </div>
              </div>
              <div className="flex gap-2">
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="rounded-lg bg-primary/10 px-3 py-2 text-[13px] leading-relaxed">
                  완료 주문(1·2·4)만 집계했습니다.<br />
                  · 가전: 550,000원 · 의류: 50,000원<br />
                  <b>총 매출 600,000원, 1위 카테고리는 ‘가전’</b>입니다.
                </div>
              </div>
              <div className="flex gap-2">
                <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="rounded-lg bg-background px-3 py-2 text-[13px]">
                  근거가 되는 계산 과정을 메모로 정리해줘.
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> 실제 응시에서는 여기서 AI와 실시간으로 대화하며 풉니다
            </div>
          </Card>
        </div>

        {/* 하단 CTA */}
        <Card className="mt-6 flex flex-col items-center gap-3 p-6 text-center">
          <div className="text-[15px] font-semibold">이 화면으로 지원자의 <span className="text-primary">AI 활용 역량</span>을 평가합니다</div>
          <p className="max-w-xl text-[13px] text-muted-foreground">
            도입은 회원가입 후 담당자 승인을 거쳐 진행됩니다. 도입 문의를 남겨주시면 대상 인원·직무에 맞춰 설계해 드립니다.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link to="/login?tab=signup"><Button className="text-[13px]">회원가입</Button></Link>
            <a href="https://ai-hrd.com/#contact"><Button variant="outline" className="text-[13px]">도입 문의</Button></a>
            <Link to="/login"><Button variant="ghost" className="text-[13px]">로그인</Button></Link>
          </div>
        </Card>
      </main>
    </div>
  );
}
