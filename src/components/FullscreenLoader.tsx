import { Loader2 } from 'lucide-react';

interface FullscreenLoaderProps {
  message?: string;
}

export function FullscreenLoader({ message = '로딩 중...' }: FullscreenLoaderProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
