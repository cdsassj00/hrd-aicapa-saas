// 감독관에게 토스트 알림 가능한 부정행위/이상 이벤트 정의
// exams.alert_event_types(text[]) 에 저장됨. 기본값 빈 배열 = 알림 OFF.

export interface AlertEventDef {
  key: string;
  label: string;
  description: string;
}

export const ALERT_EVENT_DEFS: AlertEventDef[] = [
  { key: 'tab_switch',         label: '탭 전환',        description: '응시자가 다른 탭/창으로 이동' },
  { key: 'window_blur',        label: '창 이탈',        description: '시험 창에서 포커스 이탈' },
  { key: 'screen_share_off',   label: '화면공유 해제',  description: '화면 공유 중단' },
  { key: 'screen_share_picker',label: '공유 선택창',    description: '브라우저 화면공유 선택창 노출' },
  { key: 'face_missing',       label: '얼굴 이탈',      description: '웹캠에서 얼굴 미감지' },
  { key: 'multiple_faces',     label: '복수 인원',      description: '웹캠에서 2명 이상 감지' },
  { key: 'voice_detected',     label: '음성 감지',      description: '대화로 의심되는 음성 감지' },
];

export const ALERT_EVENT_LABEL_MAP: Record<string, string> = Object.fromEntries(
  ALERT_EVENT_DEFS.map(d => [d.key, d.label])
);
