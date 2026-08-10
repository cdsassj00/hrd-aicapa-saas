import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'aicapa.theme';

/** 다크가 기본이다(랜딩과 같은 톤). 다만 응시 화면처럼 30~90분을 들여다보는
 *  곳은 밝기 선호가 갈리므로 사용자가 직접 고를 수 있어야 한다.
 *
 *  첫 페인트 전 적용은 index.html 의 인라인 스크립트가 담당한다 —
 *  여기서만 처리하면 흰 화면이 한 번 번쩍인다. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // 저장 실패는 무시 — 다음 로드에서 기본값(다크)으로 돌아갈 뿐이다
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState(t => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme: setThemeState, toggle };
}
