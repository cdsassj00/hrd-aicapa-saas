# AI Champion Certification System

Build a full-stack CBT (Computer-Based Testing) platform for Korean public sector AI Champion certification exams. Use React + TypeScript frontend with Supabase as the backend (auth, database, storage, realtime). All UI text should be in Korean. Design language: clean government-grade UI — neutral gray tones (#1a1a1a, #3A3A3A, #F5F5F5), Noto Sans KR font, professional and minimal.

---

## 1. USER ROLES

Define 4 roles in Supabase auth with role-based access control:

- **admin**: 시스템 전체 관리자 (NIA 운영자)

- **examiner**: 시험 감독관 (실시간 모니터링)

- **applicant**: 응시자 (시험 응시)

- **viewer**: 결과 조회자 (기관 담당자)

---

## 2. DATABASE SCHEMA (Supabase)

Tables to create:

**exams** — 시험 정보

- id, title, grade (green/blue/black), exam_date, duration_minutes, max_participants, status (draft/open/closed), instructions, created_at

**questions** — 문제은행

- id, exam_id, category (생성형AI활용/데이터분석/서비스구현), content, type (work_based), max_score, order_num, attachments (jsonb)

**exam_sessions** — 응시 세션

- id, exam_id, applicant_id, status (waiting/in_progress/submitted/passed/failed), start_time, submit_time, score_total, is_flagged, monitoring_notes

**answers** — 답안 제출

- id, session_id, question_id, content (text), file_url, submitted_at, score, feedback

**monitoring_events** — 모니터링 이벤트 로그

- id, session_id, event_type (face_missing/multiple_faces/tab_switch/screen_share_off), detected_at, screenshot_url, is_reviewed, reviewer_note

**certifications** — 인증서

- id, applicant_id, exam_id, session_id, grade, issued_at, cert_number, status (valid/revoked)

**applicants** — 응시자 정보

- id (fk to auth.users), name, organization, department, position, phone, applied_at, id_verified

---

## 3. PAGES & FEATURES

### [공통] Layout

- Left sidebar navigation with role-based menu

- Top bar: 로고 "AI챔피언 역량인증 시스템", user info, logout

- Responsive (desktop-first, min 1280px)

---

### [응시자] 페이지

**① 마이페이지 / 응시 신청**

- 응시 가능한 시험 목록 조회 (등급별: 그린/블루/블랙)

- 응시 신청 버튼 → 신청서 작성 모달 (소속기관, 부서, 직위, 연락처)

- 내 응시 이력 테이블 (시험명, 날짜, 등급, 점수, 합격여부, 인증서 다운로드)

**② 시험 대기실**

- 시험 입장 전 환경 점검 화면

  - 웹캠 연결 상태 확인 (초록/빨강 indicator)

  - 마이크 연결 확인

  - 화면 공유 허용 확인

  - 신분증 촬영 업로드 (Supabase Storage)

  - 유의사항 동의 체크박스 (사용 가능 도구 명시)

- 모든 항목 완료 시 "시험 시작" 버튼 활성화

**③ 시험 응시 화면** ← 핵심 화면

Layout: 

- 상단 고정 바: 시험명, 남은 시간 (카운트다운 타이머, 빨강 경고 10분 이하), 문제 번호

- 좌측 (70%): 문제 영역

  - 문제 카테고리 배지 (생성형AI활용 / 데이터분석 / 서비스구현)

  - 문제 본문 (마크다운 렌더링)

  - 답안 입력: 텍스트 에디터 (rich text) + 파일 첨부 (PDF, PNG, xlsx 허용, max 10MB)

  - 이전/다음 문제 이동 버튼

- 우측 (30%): 

  - 웹캠 미리보기 (본인 얼굴 확인용, 항상 표시)

  - 문제 목록 네비게이션 (1, 2, 3 번호 클릭 이동, 제출 여부 색상 표시)

  - 최종 제출 버튼 (확인 모달 포함)

탭 전환 감지: document.visibilitychange 이벤트 → monitoring_events에 tab_switch 기록 + 응시자에게 경고 토스트

시간 초과 시 자동 제출 처리

**④ 제출 완료 화면**

- 제출 확인 메시지

- 채점 결과 공개 예정일 안내

- 마이페이지로 이동 버튼

**⑤ 결과 확인 / 인증서 발급**

- 점수 상세 (카테고리별 점수, 총점, 합격 여부)

- 합격 시: 인증서 다운로드 버튼 (PDF 생성)

  - 인증서 양식: A4 세로, 인증번호, 이름, 소속기관, 등급, 발급일, 행정안전부 인장

- 불합격 시: 재응시 신청 안내

---

### [감독관] 페이지

**① 실시간 모니터링 대시보드** ← 핵심 화면

- 현재 진행 중인 시험 선택 드롭다운

- 응시자 카드 그리드 (회당 최대 80명)

  - 각 카드: 응시자명, 소속, 현재 문제번호/전체, 경과시간, 이상징후 뱃지

  - 이상징후 감지 시 카드 테두리 빨간색 + 알림

- 이상징후 유형 필터 버튼 (전체 / 얼굴없음 / 탭전환 / 화면공유해제)

- 특정 응시자 클릭 → 상세 모달

  - 웹캠 스크린샷 타임라인

  - 이벤트 로그 목록

  - 메모 입력 + 저장

  - "부정행위 의심" 플래그 버튼

**② 이벤트 로그 관리**

- 전체 모니터링 이벤트 테이블

- 필터: 시험별, 응시자별, 이벤트 유형별, 검토 여부

- 검토 완료 체크, 리뷰 메모 입력

---

### [관리자] 페이지

**① 시험 관리**

- 시험 목록 (CRUD)

- 시험 생성 폼: 제목, 등급 선택, 일정, 최대인원, 응시 시간, 유의사항, 상태

- 시험별 응시자 명단 확인 및 승인/거부

**② 문제은행 관리**

- 카테고리별 문제 목록

- 문제 추가/편집 (마크다운 에디터, 첨부파일, 배점 설정)

- 시험별 문제 배정

**③ 채점 관리**

- 제출된 답안 목록 (시험별)

- 답안 상세 보기 + 점수 입력 + 피드백 텍스트

- 카테고리별 점수 합산 자동 계산

- 합격 여부 자동 판정 (75점 이상)

- 일괄 결과 발송 버튼

**④ 인증자 DB (AI챔피언 인재 명부)**

- 전체 인증자 테이블 (이름, 소속, 등급, 인증일, 인증번호, 상태)

- 검색 (이름/기관/등급)

- 엑셀 다운로드

- 인증 취소 처리

**⑤ 통계 대시보드**

- 등급별 응시자 수 / 합격률 차트 (recharts)

- 월별 인증자 추이 그래프

- 기관별 인증자 현황 테이블

- 카테고리별 평균 점수 비교

---

## 4. REALTIME FEATURES (Supabase Realtime)

- 감독관 대시보드: monitoring_events 테이블 실시간 구독 → 이상징후 즉시 반영

- 응시자 화면: 시험 상태 변경 실시간 감지 (관리자가 시험 강제 종료 시 즉시 반영)

- 관리자: 응시자 입장/제출 현황 실시간 업데이트

---

## 5. WEBCAM MONITORING

Use browser MediaDevices API:

- getUserMedia로 웹캠 스트림 취득

- 10초마다 canvas.toDataURL()로 스크린샷 캡처

- Supabase Storage에 업로드 (경로: monitoring/{session_id}/{timestamp}.jpg)

- 얼굴 감지는 현재 구현하지 않고, 스크린샷 저장만 수행 (감독관이 수동 확인)

- 웹캠 스트림 중단 감지 시 face_missing 이벤트 기록

---

## 6. PDF CERTIFICATE GENERATION

Use react-pdf or jsPDF:

인증서 내용:

- 상단: "AI챔피언 역량인증서" 제목

- 인증번호: CERT-{year}-{grade}-{4자리 순번}

- 성명, 소속기관

- "위 사람은 행정안전부가 운영하는 AI챔피언 역량인증 평가를 통과하여 {등급} 등급 AI챔피언으로 인증합니다"

- 발급일, 행정안전부장관 (인)

- QR코드: 인증번호 검증 URL

---

## 7. UI DESIGN SYSTEM

Colors:

- Background: #FFFFFF, #F5F5F5, #EEEEEE

- Primary text: #1a1a1a

- Secondary text: #555555

- Border: #D8D8D8

- Header/sidebar: #2E2E2E

- Accent (active/selected): #3A3A3A

- Success: #2E7D32

- Warning: #E65100  

- Error: #C62828

- Green grade badge: #1E8449 on #E8F5E9

- Blue grade badge: #1565C0 on #E3F2FD

- Black grade badge: #212121 on #F5F5F5

Typography: Noto Sans KR (import from Google Fonts)

- Page title: 20px 800

- Section title: 14px 700

- Body: 13px 400

- Caption: 11px 400

Components to use: shadcn/ui (Button, Card, Table, Dialog, Badge, Input, Select, Tabs, Progress)

---

## 8. SECURITY RULES (Supabase RLS)

- applicants: 본인 데이터만 read/write

- exam_sessions: 본인 세션만 read, insert; 감독관은 전체 read

- answers: 본인 답안만 read/write; 관리자·감독관은 read

- monitoring_events: 응시자는 insert만; 감독관·관리자는 read/update

- certifications: 본인 인증서 read; 관리자만 write

- exams, questions: 관리자만 write; 응시자는 read (공개된 것만)

---

Start by building the Supabase schema and authentication system first, then build the applicant exam flow (대기실 → 응시 → 제출), then the examiner monitoring dashboard, then the admin panel.

모니터링 이상징후 감지(얼굴 인식)를 추가하려면 나중에 TensorFlow.js + face-api.js 연동 프롬프트를 별도로 넣으면 됩니다.

인증서 PDF는 react-pdf 가 Lovable에서 더 안정적으로 작동합니다.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://champion-monito.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/be042b8f-1bac-4f37-b6fa-7b7f34ce1642).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
