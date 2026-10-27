// 하위 테이블 INSERT 용 — org_id 는 DB 트리거가 부모(회차·세션·문항세트)에서 상속해 덮어쓴다.
//
// 생성 타입은 org_id 가 NOT NULL 이라 "필수"로 표시하지만, 실제로는 앱이 넣어도
// 트리거가 항상 덮어쓴다(0007: 비정규화된 org_id 가 부모와 어긋나면 조용한 유출이므로).
// 그래서 화면은 org_id 를 몰라도 되고, 이 헬퍼로 나머지 컬럼만 타입 검사한다.
import type { Database, TablesInsert } from '@/integrations/supabase/types';

type PublicTable = keyof Database['public']['Tables'];

/** org_id 를 트리거로 상속받는 테이블 (마이그레이션의 *_inherit_org 트리거 목록과 일치). */
export type OrgInheritingTable = Extract<
  PublicTable,
  | 'answers'
  | 'certifications'
  | 'exam_announcements'
  | 'exam_chat_messages'
  | 'exam_invitations'
  | 'exam_questions'
  | 'exam_sessions'
  | 'grading_jobs'
  | 'monitoring_events'
  | 'recording_chunks'
  | 'recording_diagnostics'
>;

export type InheritedInsert<T extends OrgInheritingTable> = Omit<TablesInsert<T>, 'org_id'>;

/** org_id 없이 INSERT 페이로드를 만든다. 단건·배열 모두 받는다. */
export function inheritOrg<T extends OrgInheritingTable>(row: InheritedInsert<T>): TablesInsert<T>;
export function inheritOrg<T extends OrgInheritingTable>(rows: InheritedInsert<T>[]): TablesInsert<T>[];
export function inheritOrg<T extends OrgInheritingTable>(
  rows: InheritedInsert<T> | InheritedInsert<T>[],
): TablesInsert<T> | TablesInsert<T>[] {
  return rows as TablesInsert<T> | TablesInsert<T>[];
}
