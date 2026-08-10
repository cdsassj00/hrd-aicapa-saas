import { supabase } from '@/integrations/supabase/client';

/**
 * [7] 사용자 행동 로그 — 5초 배치 insert
 *
 * 사용법:
 *   import { trackAction, flushActions } from '@/lib/userActions';
 *   trackAction('exam_start', { sessionId, examId });
 *
 * - 각 호출은 메모리 큐에 쌓이고, 5초마다 또는 큐가 50개 도달 시 flush
 * - 페이지 언로드 시 navigator.sendBeacon 대신 즉시 flush 시도
 * - 실패 시 silent (로깅 실패가 시험을 방해하면 안 됨)
 */

export type UserActionType =
  | 'login'
  | 'logout'
  | 'exam_list_view'
  | 'waiting_room_enter'
  | 'exam_start'
  | 'question_view'
  | 'answer_save'
  | 'submit'
  | 'violation';

interface QueuedAction {
  user_id: string;
  session_id: string | null;
  action_type: UserActionType;
  metadata: Record<string, any>;
  created_at: string;
}

const queue: QueuedAction[] = [];
const BATCH_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 50;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let unloadBound = false;
let cachedUserId: string | null = null;

async function getUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  const { data } = await supabase.auth.getUser();
  cachedUserId = data.user?.id ?? null;
  return cachedUserId;
}

// Auth state 변경 시 캐시 갱신
supabase.auth.onAuthStateChange((_e, session) => {
  cachedUserId = session?.user?.id ?? null;
});

async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await supabase.from('user_actions' as any).insert(batch);
  } catch {
    // silent — 로깅 실패는 무시
  }
}

function ensureFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flush(); }, BATCH_INTERVAL_MS);
  if (!unloadBound && typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => { void flush(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void flush();
    });
    unloadBound = true;
  }
}

/**
 * 행동 기록 — fire-and-forget. await 불필요.
 */
export function trackAction(
  action_type: UserActionType,
  metadata: Record<string, any> = {},
  sessionId?: string | null,
): void {
  ensureFlushLoop();
  void (async () => {
    const user_id = await getUserId();
    if (!user_id) return; // 로그인 안 된 상태면 skip
    queue.push({
      user_id,
      session_id: sessionId ?? null,
      action_type,
      metadata,
      created_at: new Date().toISOString(),
    });
    if (queue.length >= MAX_BATCH_SIZE) void flush();
  })();
}

/**
 * 즉시 flush (제출/로그아웃 등 중요한 시점)
 */
export async function flushActions(): Promise<void> {
  await flush();
}
