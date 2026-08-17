// 조직 스코프 역할. DB public.app_role enum 과 1:1로 맞춘다.
// 원본의 전역 'admin' 은 계승하지 않는다 — 'org_admin' 과 의미가 겹쳐
// "정책은 org_admin 을 보는데 부여는 admin 으로 된" 사각지대를 만든다.
// 플랫폼 전역 권한은 역할이 아니라 platform_admins 테이블로 판정한다.
export type UserRole = 'org_owner' | 'org_admin' | 'examiner' | 'applicant' | 'viewer';

/** 사용자 × 조직 × 역할. 화면에서 조직 전환에 쓴다. */
export interface OrgMembership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgStatus: string;
  role: UserRole;
  department?: string;
  position?: string;
}
export type ExamGrade = 'green' | 'blue' | 'black' | '전문인재';
export type ExamStatus = 'draft' | 'open' | 'closed';
export type SessionStatus = 'waiting' | 'in_progress' | 'submitted' | 'passed' | 'failed';
export type QuestionCategory = '생성형AI활용' | '데이터분석' | '서비스구현';
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type MonitoringEventType = 'face_missing' | 'multiple_faces' | 'tab_switch' | 'screen_share_off' | 'voice_detected';
export type CertStatus = 'valid' | 'revoked';

// 전역 사용자 프로필. 조직별 정보(부서·직급)는 여기가 아니라
// OrgMembership 에 있다 — 한 사람이 여러 조직에 속할 수 있기 때문.
export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
}

export interface Exam {
  id: string;
  title: string;
  grade: ExamGrade;
  exam_date: string;
  duration_minutes: number;
  max_participants: number;
  status: ExamStatus;
  instructions: string;
  created_at: string;
  current_participants?: number;
}

export type QuestionType = 'multiple_choice' | 'short_answer' | 'essay' | 'file_upload' | 'work_based';

export interface McOption {
  id: string;
  text: string;
  is_correct: boolean;
}

export interface Question {
  id: string;
  exam_id?: string | null;
  category: QuestionCategory;
  content: string;
  type: QuestionType;
  max_score: number;
  order_num: number;
  grade?: ExamGrade | null;
  difficulty: QuestionDifficulty;
  tags: string[];
  attachments?: any[];
  options?: McOption[] | null;
  correct_answer?: string | null;
  allow_file_upload: boolean;
}

export interface ExamSession {
  id: string;
  exam_id: string;
  applicant_id: string;
  applicant_name: string;
  applicant_org: string;
  status: SessionStatus;
  start_time?: string;
  submit_time?: string;
  score_total?: number;
  is_flagged: boolean;
  monitoring_notes?: string;
  current_question?: number;
  total_questions?: number;
}

export interface Answer {
  id: string;
  session_id: string;
  question_id: string;
  content: string;
  file_url?: string;
  submitted_at?: string;
  score?: number;
  feedback?: string;
}

export interface MonitoringEvent {
  id: string;
  session_id: string;
  applicant_name: string;
  event_type: MonitoringEventType;
  detected_at: string;
  screenshot_url?: string;
  is_reviewed: boolean;
  reviewer_note?: string;
}

export interface Certification {
  id: string;
  applicant_id: string;
  applicant_name: string;
  organization: string;
  exam_id: string;
  session_id: string;
  grade: ExamGrade;
  issued_at: string;
  cert_number: string;
  status: CertStatus;
}
