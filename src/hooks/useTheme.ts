import { useCallback, useEffect, useState } from 'react';
import { storageKey } from '@/lib/brand';

export type Theme = 'dark' | 'light';

/** index.html 의 인라인 FOUC 스크립트와 반드시 같은 키여야 한다. */
const KEY = storageKey('theme.v2');

/** 라이트가 기본이다 — 기업 HRD 담당자·응시자가 오래 보는 업무 화면이라 일반적인 밝은 톤이 맞다.
 *  다크는 사용자가 직접 고른 경우에만 쓴다.
 *  (키 v2: 예전 다크 기본값이 매 방문 저장돼 있어, 같은 키를 쓰면 기존 방문자가 다크에 묶인다.)
 *
 *  첫 페인트 전 적용은 index.html 의 인라인 스크립트가 담당한다 —
 *  여기서만 처리하면 흰 화면이 한 번 번쩍인다. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // 저장 실패는 무시 — 다음 로드에서 기본값(라이트)으로 돌아갈 뿐이다
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme: setThemeState, toggle };
}
