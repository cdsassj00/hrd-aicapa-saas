# AI CAPA 인프라 및 처리 용량

_최종 갱신: 2026-07-22_

NIA 제출 자료용 인프라 구성 및 동시 응시 규모 산정 자료입니다. 모든 수치는 현재 운영 중인 계약/플랜 기준이며, 변경 시 이 문서를 함께 갱신합니다.

---

## 1. 서비스 스택 개요

| 계층 | 서비스 | 역할 | 계약/플랜 |
|---|---|---|---|
| 프론트엔드 배포 | Lovable Hosting (Cloudflare 엣지 CDN) | React SPA 정적 자산 배포, `aicapa.kr` 커스텀 도메인 | Lovable Pro |
| 백엔드 (DB/Auth/Functions) | Lovable Cloud (Supabase 관리형) | PostgreSQL 15, Auth, Edge Functions, Realtime | Lovable Cloud (Supabase Pro 상당) |
| 첨부/녹화 스토리지 | Cloudflare R2 | 웹캠·화면공유 청크, 응시자 제출 파일 | R2 유료 (사용량 과금) |
| 신분증/답안 스토리지 | Supabase Storage (`id-cards`, `answer-files`, `question-attachments`) | 검증 이미지·문제 첨부 | Lovable Cloud 포함 |
| 화상 감독 | Daily.co | WebRTC 갤러리 감독, 자동 방 생성/분할 | Daily 유료 플랜 |
| 이메일 발송 | Resend (Lovable Connector) | 초대장, OTP | 사용량 과금 |
| SMS OTP | Twilio (Lovable Connector) | 응시자 본인 확인 | 사용량 과금 |
| AI 채점 | Lovable AI Gateway (Gemini Flash) | 단독 문항 자동 채점 (세트 문항은 외부 에이전트 채점) | Credit 기반 |
| 안면 인식 | AWS Rekognition + Face++ | 신분증 대조 | 사용량 과금 |

---

## 2. 처리 용량 및 한도 (계층별)

### 2.1 데이터베이스 / API (Lovable Cloud - Supabase)

| 항목 | 수치 | 비고 |
|---|---|---|
| Postgres 버전 | 15 | |
| 컴퓨트 | Small~Medium (`supabase--resize_compute` 로 조정 가능) | 대규모 시험 전 상향 권장 |
| 최대 DB 커넥션 | ~200 (풀러 경유 시 실질 수천) | PgBouncer 트랜잭션 풀 사용 |
| REST/RPC 요청 | 무제한(플랜 내) | Edge → PostgREST |
| Realtime 채널 | 채널당 수천 구독, 프로젝트 전체 fan-out 대역 제한 존재 | 감독 대시보드는 3개 채널로 축소 운영 |
| RLS | 전 테이블 활성화 | `has_role()`, `protect_exam_session_columns()` 트리거 등 다층 방어 |

### 2.2 스토리지

| 항목 | 서비스 | 한도/정책 |
|---|---|---|
| 녹화 청크 | Cloudflare R2 | 파일당 최대 25 MB(edge 함수에서 강제), 30초 청크 회전, 객체수 무제한 |
| 응시자 제출 파일 | Supabase Storage `answer-files` | 파일당 10 MB, 확장자 화이트리스트, RLS로 본인만 upsert |
| 신분증 이미지 | Supabase Storage `id-cards` | private, signed URL 300초 |
| 문제 첨부 | Supabase Storage `question-attachments` | public 읽기, 관리자만 쓰기 |

### 2.3 화상 감독 (Daily.co)

| 항목 | 수치 |
|---|---|
| 방당 최대 참가자 | 200명 (플랜 기준) |
| 자동 방 분할 | 100명 초과 시 앱에서 자동 생성 (구현 완료) |
| 녹화 | Daily 자체 녹화 미사용 (별도 R2 파이프라인) |
| 대역폭 최적화 | 웹캠 640x360@10fps · 화면 1280x720@5fps 로 다운스케일 |

### 2.4 프론트/CDN

Lovable Hosting은 Cloudflare 엣지에서 정적 자산을 서빙하므로 프론트 트래픽 상한은 실질적으로 없습니다. 응시자당 초기 페이지 로드 ~1.5 MB, 이후는 API/WebRTC 트래픽이 대부분을 차지합니다.

---

## 3. 동시 응시 규모 산정

### 3.1 응시자 1명당 리소스 소모 (평균 기준)

| 항목 | 값 |
|---|---|
| DB 실질 커넥션 | 풀러 경유로 지속 0 (요청 순간에만 점유) |
| Realtime 구독 | 채팅 1 + 공지 1 (감독 대시보드에서 aggregation) |
| R2 업로드 대역폭 | 웹캠 ~250 kbps + 화면 ~400 kbps ≒ **~650 kbps up** |
| Daily 대역폭 | 웹캠 up ~250 kbps, 감독관 down ~250 kbps × N |
| API 호출 빈도 | 답안 저장 (debounce 3s), 서버시간 sync (5분), 하트비트 이벤트 |

### 3.2 규모별 권장 구성

| 동시 응시자 | 구성 |
|---|---|
| ~100명 | 현재 컴퓨트 그대로 운영 가능 |
| 100~300명 | Daily 방 자동 분할(100명 단위) + 컴퓨트 Medium 이상 |
| 300~500명 | 컴퓨트 Large, 시험 시작 시각 slot 분산(5분 간격) 권장 |
| 500명+ | R2 업로드용 edge 함수 스케일 확인, DB 쿼리 인덱스 재검토 필요 |

### 3.3 예상 병목 지점

1. **R2 업로드 edge function**: 응시자 × 초당 25 KB 상시 트래픽. 500명 = ~12.5 MB/s → 여유 있음 (Cloudflare edge 처리량 기준).
2. **Daily 방당 인원**: 200명 상한. 자동 분할 로직으로 회피.
3. **Realtime fan-out**: 감독 대시보드가 응시자 세션 UPDATE를 실시간 수신. 응시자 1000명 이상 시 이벤트 압축(디바운스) 필요.

---

## 4. 대규모 시험 운영 체크리스트

- [ ] 시험 시작 D-1: `supabase--db_health` 로 컴퓨트/커넥션 여유 확인
- [ ] 시험 시작 D-1: 필요 시 `supabase--resize_compute` 로 사전 상향
- [ ] 시험 시작 D-1: 응시자 초대장 재발송 및 대기실 접속 사전 안내
- [ ] 시험 시작 30분 전: 감독관 모니터링 대시보드 접속, `MonitorPerfPanel` 로 지연시간 확인 (Ctrl+Shift+P)
- [ ] 시험 진행 중: 채팅/공지/이상징후 알림 실시간 모니터링
- [ ] 시험 종료 후 24시간: R2 녹화 청크 재생 검증 (`r2-playback` edge function)

---

## 5. 문의

인프라 상세 스펙 갱신이나 계약 문서가 필요하면 운영팀으로 요청 바랍니다.
