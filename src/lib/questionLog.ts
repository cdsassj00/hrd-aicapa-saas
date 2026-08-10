import { supabase } from '@/integrations/supabase/client';

export async function logQuestionChange(
  questionId: string,
  action: 'created' | 'updated' | 'deleted',
  changes?: Record<string, { before: any; after: any }>,
) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('question_logs' as any).insert({
    question_id: questionId,
    action,
    actor_id: user.id,
    changes: changes || {},
  });
}

export async function logQuestionChanges(
  questionIds: string[],
  action: 'created' | 'updated' | 'deleted',
  changes?: Record<string, { before: any; after: any }>,
) {
  if (questionIds.length === 0) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('question_logs' as any).insert(
    questionIds.map(questionId => ({
      question_id: questionId,
      action,
      actor_id: user.id,
      changes: changes || {},
    })),
  );
}

export function diffChanges(
  before: Record<string, any>,
  after: Record<string, any>,
  keys: string[],
): Record<string, { before: any; after: any }> | null {
  const diff: Record<string, { before: any; after: any }> = {};
  for (const key of keys) {
    const b = JSON.stringify(before[key] ?? null);
    const a = JSON.stringify(after[key] ?? null);
    if (b !== a) {
      diff[key] = { before: before[key] ?? null, after: after[key] ?? null };
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}
