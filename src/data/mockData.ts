import { Exam, ExamSession, Question, Answer, MonitoringEvent, Certification, User } from '@/types';

export const mockUser: User = {
  id: 'u1',
  email: 'hong@gov.kr',
  name: '홍길동',
  phone: '010-1234-5678',
};

export const mockExams: Exam[] = [
  {
    id: 'e1', title: '2026년 상반기 AI챔피언 역량인증 (그린)', grade: 'green',
    exam_date: '2026-04-15T09:00:00', duration_minutes: 90, max_participants: 80,
    status: 'open', instructions: '• 시험 중 외부 프로그램 사용 금지\n• 생성형 AI 도구(ChatGPT 등)는 허용\n• 웹캠은 시험 종료 시까지 켜둘 것',
    created_at: '2026-03-01', current_participants: 42,
  },
  {
    id: 'e2', title: '2026년 상반기 AI챔피언 역량인증 (블루)', grade: 'blue',
    exam_date: '2026-04-22T09:00:00', duration_minutes: 120, max_participants: 60,
    status: 'open', instructions: '• 시험 중 외부 프로그램 사용 금지\n• 데이터 분석 도구 사용 허용',
    created_at: '2026-03-01', current_participants: 28,
  },
  {
    id: 'e3', title: '2026년 상반기 AI챔피언 역량인증 (블랙)', grade: 'black',
    exam_date: '2026-05-10T09:00:00', duration_minutes: 150, max_participants: 30,
    status: 'draft', instructions: '• 최고 난이도 실무형 평가',
    created_at: '2026-03-05', current_participants: 0,
  },
];

export const mockQuestions: Question[] = [
  { id: 'q1', exam_id: 'e1', category: '생성형AI활용', content: '## 문제 1\n\n아래 업무 시나리오를 읽고, 적절한 프롬프트를 작성하여 생성형 AI를 활용한 정책 보고서 초안을 작성하시오.\n\n### 시나리오\n\n귀하는 지방자치단체의 디지털전환 담당자입니다. 최근 지역 내 노인 인구를 대상으로 한 디지털 문해력 교육 프로그램을 기획해야 합니다.\n\n### 요구사항\n1. 프롬프트를 작성하고 실행 결과를 붙여넣으시오\n2. 결과물에 대한 비판적 검토 내용을 서술하시오\n3. 개선된 최종 보고서 초안을 제출하시오', type: 'work_based', max_score: 40, order_num: 1, difficulty: 'medium', tags: [], allow_file_upload: false },
  { id: 'q2', exam_id: 'e1', category: '데이터분석', content: '## 문제 2\n\n첨부된 CSV 데이터를 분석하여 다음 질문에 답하시오.', type: 'work_based', max_score: 30, order_num: 2, difficulty: 'medium', tags: [], allow_file_upload: false },
  { id: 'q3', exam_id: 'e1', category: '서비스구현', content: '## 문제 3\n\n다음 요구사항에 맞는 간단한 챗봇 서비스 프로토타입을 설계하시오.', type: 'work_based', max_score: 30, order_num: 3, difficulty: 'medium', tags: [], allow_file_upload: false },
];

export const mockSessions: ExamSession[] = [
  { id: 's1', exam_id: 'e1', applicant_id: 'u1', applicant_name: '홍길동', applicant_org: '행정안전부', status: 'in_progress', start_time: '2026-04-15T09:00:00', is_flagged: false, current_question: 2, total_questions: 3 },
  { id: 's2', exam_id: 'e1', applicant_id: 'u2', applicant_name: '김영희', applicant_org: '과학기술정보통신부', status: 'in_progress', start_time: '2026-04-15T09:00:00', is_flagged: true, current_question: 1, total_questions: 3 },
  { id: 's3', exam_id: 'e1', applicant_id: 'u3', applicant_name: '이철수', applicant_org: '서울특별시', status: 'in_progress', start_time: '2026-04-15T09:01:00', is_flagged: false, current_question: 3, total_questions: 3 },
  { id: 's4', exam_id: 'e1', applicant_id: 'u4', applicant_name: '박지영', applicant_org: '부산광역시', status: 'submitted', start_time: '2026-04-15T09:00:00', submit_time: '2026-04-15T10:15:00', score_total: 82, is_flagged: false, current_question: 3, total_questions: 3 },
  { id: 's5', exam_id: 'e1', applicant_id: 'u5', applicant_name: '최민수', applicant_org: '인천광역시', status: 'in_progress', start_time: '2026-04-15T09:02:00', is_flagged: true, current_question: 1, total_questions: 3 },
  { id: 's6', exam_id: 'e1', applicant_id: 'u6', applicant_name: '정수진', applicant_org: '경기도', status: 'in_progress', start_time: '2026-04-15T09:00:00', is_flagged: false, current_question: 2, total_questions: 3 },
  { id: 's7', exam_id: 'e1', applicant_id: 'u7', applicant_name: '강동원', applicant_org: '대전광역시', status: 'waiting', is_flagged: false, current_question: 0, total_questions: 3 },
  { id: 's8', exam_id: 'e1', applicant_id: 'u8', applicant_name: '윤서연', applicant_org: '광주광역시', status: 'in_progress', start_time: '2026-04-15T09:03:00', is_flagged: false, current_question: 2, total_questions: 3 },
];

export const mockAnswers: Answer[] = [
  { id: 'a1', session_id: 's4', question_id: 'q1', content: '프롬프트 및 결과물 작성 완료...', submitted_at: '2026-04-15T09:45:00', score: 35, feedback: '프롬프트 구성이 우수하나 비판적 검토가 다소 부족합니다.' },
  { id: 'a2', session_id: 's4', question_id: 'q2', content: '데이터 분석 결과...', submitted_at: '2026-04-15T10:00:00', score: 25, feedback: '시각화 부분이 미흡합니다.' },
  { id: 'a3', session_id: 's4', question_id: 'q3', content: '챗봇 설계 문서...', submitted_at: '2026-04-15T10:12:00', score: 22, feedback: '예외 처리 시나리오가 잘 설계되었습니다.' },
];

export const mockMonitoringEvents: MonitoringEvent[] = [
  { id: 'me1', session_id: 's2', applicant_name: '김영희', event_type: 'tab_switch', detected_at: '2026-04-15T09:15:00', is_reviewed: false },
  { id: 'me2', session_id: 's2', applicant_name: '김영희', event_type: 'face_missing', detected_at: '2026-04-15T09:20:00', screenshot_url: '/placeholder.svg', is_reviewed: false },
  { id: 'me3', session_id: 's5', applicant_name: '최민수', event_type: 'tab_switch', detected_at: '2026-04-15T09:18:00', is_reviewed: true, reviewer_note: '확인 완료 - 계산기 사용' },
  { id: 'me4', session_id: 's5', applicant_name: '최민수', event_type: 'screen_share_off', detected_at: '2026-04-15T09:25:00', is_reviewed: false },
  { id: 'me5', session_id: 's1', applicant_name: '홍길동', event_type: 'tab_switch', detected_at: '2026-04-15T09:30:00', is_reviewed: true, reviewer_note: '정상 - 허용된 도구 사용' },
];

export const mockCertifications: Certification[] = [
  { id: 'c1', applicant_id: 'u10', applicant_name: '한지민', organization: '행정안전부', exam_id: 'e0', session_id: 's0', grade: 'green', issued_at: '2025-12-15', cert_number: 'CERT-2025-GREEN-0001', status: 'valid' },
  { id: 'c2', applicant_id: 'u11', applicant_name: '송중기', organization: '과학기술정보통신부', exam_id: 'e0', session_id: 's0b', grade: 'blue', issued_at: '2025-12-15', cert_number: 'CERT-2025-BLUE-0001', status: 'valid' },
  { id: 'c3', applicant_id: 'u12', applicant_name: '전지현', organization: '서울특별시', exam_id: 'e0', session_id: 's0c', grade: 'black', issued_at: '2025-12-20', cert_number: 'CERT-2025-BLACK-0001', status: 'valid' },
  { id: 'c4', applicant_id: 'u13', applicant_name: '공유', organization: '경기도', exam_id: 'e0', session_id: 's0d', grade: 'green', issued_at: '2025-11-10', cert_number: 'CERT-2025-GREEN-0002', status: 'revoked' },
  { id: 'c5', applicant_id: 'u14', applicant_name: '이병헌', organization: '부산광역시', exam_id: 'e0', session_id: 's0e', grade: 'blue', issued_at: '2026-01-20', cert_number: 'CERT-2026-BLUE-0001', status: 'valid' },
];

export const mockStatsData = {
  gradeStats: [
    { grade: '그린', applicants: 120, passed: 96, rate: 80 },
    { grade: '블루', applicants: 85, passed: 51, rate: 60 },
    { grade: '블랙', applicants: 30, passed: 12, rate: 40 },
  ],
  monthlyTrend: [
    { month: '2025-07', count: 15 },
    { month: '2025-08', count: 22 },
    { month: '2025-09', count: 18 },
    { month: '2025-10', count: 30 },
    { month: '2025-11', count: 25 },
    { month: '2025-12', count: 35 },
    { month: '2026-01', count: 28 },
    { month: '2026-02', count: 32 },
  ],
  orgStats: [
    { org: '행정안전부', green: 12, blue: 8, black: 3 },
    { org: '과학기술정보통신부', green: 10, blue: 6, black: 2 },
    { org: '서울특별시', green: 15, blue: 5, black: 1 },
    { org: '경기도', green: 8, blue: 4, black: 0 },
    { org: '부산광역시', green: 6, blue: 3, black: 1 },
  ],
  categoryAvg: [
    { category: '생성형AI활용', avg: 32.5, max: 40 },
    { category: '데이터분석', avg: 21.8, max: 30 },
    { category: '서비스구현', avg: 19.2, max: 30 },
  ],
};
