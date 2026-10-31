import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, Download, ExternalLink } from 'lucide-react';
import { downloadSebFile, SEB_DOWNLOAD_URL } from '@/lib/seb';

/** SEB 필수 시험을 일반 브라우저로 열었을 때 안내. */
export default function SebRequiredNotice({ onBack, verifyFailed = false }: { onBack?: () => void; verifyFailed?: boolean }) {
  return (
    <div className="flex items-center justify-center p-6" data-testid="seb-required">
      <Card className="w-full max-w-[560px]">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <h1 className="text-base font-bold">Safe Exam Browser에서만 응시할 수 있는 시험입니다</h1>
          </div>
          {verifyFailed ? (
            <p className="text-sm text-destructive">
              SEB 설정 확인에 실패했습니다. 이 시험에서 받은 설정 파일(.seb)로 SEB를 다시 실행해 주세요.
              계속 실패하면 감독관에게 문의하세요.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              시험 중 다른 프로그램·사이트를 쓸 수 없도록 잠금 브라우저(Safe Exam Browser)로 응시합니다.
            </p>
          )}
          <ol className="list-decimal pl-5 text-sm space-y-1.5">
            <li>
              Safe Exam Browser 설치 (Windows · macOS · iPad, 무료)
              <a href={SEB_DOWNLOAD_URL} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary underline">
                내려받기 <ExternalLink className="h-3 w-3" />
              </a>
            </li>
            <li>아래 버튼으로 시험 설정 파일(.seb)을 받아 더블클릭합니다.</li>
            <li>SEB가 열리면 같은 계정으로 로그인하고 <b>내 평가</b>에서 입실합니다.</li>
          </ol>
          <div className="flex gap-2">
            <Button className="gap-1" onClick={() => downloadSebFile(window.location.origin)}>
              <Download className="h-4 w-4" /> 시험 설정 파일(.seb) 받기
            </Button>
            {onBack && <Button variant="outline" onClick={onBack}>내 평가 목록</Button>}
          </div>
          <p className="text-[11px] text-muted-foreground">
            SEB는 웹캠·마이크 감독을 허용하고, 모니터 1대만 쓰도록 설정됩니다. 시험을 마치면 SEB가 자동으로 종료됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
