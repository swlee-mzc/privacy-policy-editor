/**
 * 섹션 제목 패턴 (다국어). 제목 뒤에 본문이 같은 단락에 이어져 있어도
 * (DOCX 문단 병합 케이스) 프리픽스가 매칭되면 잡는다.
 *
 * 캡처: [1] 번호(숫자 사이 공백 허용), [2] 제목, [3] 같은 단락의 잔여 본문.
 * 숫자 사이 공백 허용 이유: Word 에서 타이핑 중 실수로 `第 1 1条` 처럼
 * 숫자가 쪼개진 DOCX 가 관찰됨. 정상 파싱 후 lint 로 표면화.
 */
export type SectionLang = 'ko' | 'ja' | 'en';

const SECTION_PATTERNS: { lang: SectionLang; re: RegExp }[] = [
  { lang: 'ko', re: /^제\s*(\d[\d\s]*?)\s*조\s*[（(]\s*([^）)]+?)\s*[）)]\s*(.*)$/ },
  { lang: 'ja', re: /^第\s*(\d[\d\s　]*?)\s*条\s*[（(]\s*([^）)]+?)\s*[）)]\s*(.*)$/ },
  { lang: 'en', re: /^Article\s+(\d[\d\s]*?)\s*[（(]\s*([^）)]+?)\s*[）)]\s*(.*)$/i },
];

export type SectionMatch = {
  lang: SectionLang;
  num: number;
  title: string;
  rest: string;
  /** 원본 숫자 캡처 (공백 포함 가능). 정상화 여부 판정용. */
  rawNum: string;
};

export function matchSection(text: string): SectionMatch | null {
  for (const { lang, re } of SECTION_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const rawNum = m[1];
    const num = parseInt(rawNum.replace(/[\s　]/g, ''), 10);
    if (Number.isNaN(num)) continue;
    return { lang, num, title: m[2].trim(), rest: m[3].trim(), rawNum };
  }
  return null;
}

export function formatSectionTitle(lang: SectionLang, num: number, title: string): string {
  switch (lang) {
    case 'ko':
      return `제${num}조 (${title})`;
    case 'ja':
      return `第${num}条（${title}）`;
    case 'en':
      return `Article ${num} (${title})`;
  }
}

/** 문서 전체 제목 판별 (center 정렬 + 표제어). */
export function isDocTitle(text: string): boolean {
  if (text.includes('개인정보 처리방침')) return true;
  if (text.includes('個人情報処理方針')) return true;
  if (/^privacy\s+policy$/i.test(text.trim())) return true;
  return false;
}
