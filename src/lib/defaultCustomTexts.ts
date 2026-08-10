/** Default custom texts for exams. When a field is empty/missing, these values are used. */

export interface ExamCustomTexts {
  waiting_room?: {
    monitor_desc?: string;
    webcam_desc?: string;
    mic_desc?: string;
    screen_desc?: string;
    email_desc?: string;
    id_card_desc?: string;
  };
  security_pledge?: {
    intro?: string;
    items?: string[];
  };
  policy_banner?: {
    restricted_title?: string;
    restricted_lines?: string[];
    allowed_title?: string;
    allowed_lines?: string[];
  };
  submitted?: {
    title?: string;
  };
}

export const DEFAULT_CUSTOM_TEXTS: Required<{
  waiting_room: Required<NonNullable<ExamCustomTexts['waiting_room']>>;
  security_pledge: Required<NonNullable<ExamCustomTexts['security_pledge']>>;
  policy_banner: Required<NonNullable<ExamCustomTexts['policy_banner']>>;
  submitted: Required<NonNullable<ExamCustomTexts['submitted']>>;
}> = {
  waiting_room: {
    monitor_desc: '모니터는 1개만 사용해야 합니다. 듀얼 모니터 사용 시 응시가 제한됩니다.',
    webcam_desc: '웹캠이 정상적으로 연결되어 있어야 하며, 얼굴 전체가 화면에 보여야 합니다.',
    mic_desc: '마이크 허용 안내가 뜰 경우 \'허용\'을 클릭해 주세요',
    screen_desc: '오른쪽 확인하기 버튼을 누른 후 \'전체 화면\'을 선택해 주세요',
    email_desc: '인증코드 발송 버튼을 누르면 접수 시 기재한 이메일로 인증코드를 발송합니다',
    id_card_desc: '본인 확인을 위해 신분증(주민등록증, 운전면허증 등) 사진을 업로드해 주세요',
  },
  security_pledge: {
    intro: '다음 부정행위 예시를 확인하고, 각 항목에 동의해 주세요. 위반 시 평가가 무효 처리되며 자격 박탈될 수 있습니다.',
    items: [
      '평가 중 허용되지 않은 외부 프로그램, 웹사이트, 메신저 등을 사용하는 행위',
      '타인과 답안을 공유하거나, 타인의 도움을 받아 답안을 작성하는 행위',
      '시험 문제를 촬영, 캡처, 녹화하거나 외부로 유출하는 행위',
      '대리 평가 또는 본인이 아닌 다른 사람이 응시하는 행위',
      '객관식, 단답형, 서술형 문제에서 AI 도구(ChatGPT 등)를 사용하여 답안을 생성하는 행위 (작업형 문제는 AI 활용 가능)',
      '화상 감독 기능을 고의로 비활성화하거나 방해하는 행위',
      '평가 전/중/후 평가 내용에 대해 타인과 소통하는 행위',
      '기타 공정한 평가 운영을 저해하는 일체의 부정 행위',
    ],
  },
  policy_banner: {
    restricted_title: '외부 도구 사용 금지',
    restricted_lines: [
      '이 문제에서는 AI 활용이 금지됩니다.',
      '탭 전환 시 화면이 잠금되며, 부정행위로 기록됩니다.',
    ],
    allowed_title: 'AI 활용 가능',
    allowed_lines: [
      '이 문제에서는 AI 활용이 허용됩니다.',
      'AI가 제시한 결과물을 수정 없이 그대로 제출하면 오답 처리됩니다.',
      '반드시 개인의 검증과 의견을 반영하여 제출하십시오.',
    ],
  },
  submitted: {
    title: '시험이 제출되었습니다',
  },
};

/** Merge custom texts with defaults, filling in missing fields */
export function mergeCustomTexts(custom?: ExamCustomTexts | null): typeof DEFAULT_CUSTOM_TEXTS {
  if (!custom) return DEFAULT_CUSTOM_TEXTS;
  return {
    waiting_room: { ...DEFAULT_CUSTOM_TEXTS.waiting_room, ...custom.waiting_room },
    security_pledge: {
      intro: custom.security_pledge?.intro || DEFAULT_CUSTOM_TEXTS.security_pledge.intro,
      items: custom.security_pledge?.items?.length ? custom.security_pledge.items : DEFAULT_CUSTOM_TEXTS.security_pledge.items,
    },
    policy_banner: { ...DEFAULT_CUSTOM_TEXTS.policy_banner, ...custom.policy_banner },
    submitted: { ...DEFAULT_CUSTOM_TEXTS.submitted, ...custom.submitted },
  };
}
