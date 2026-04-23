/**
 * 뎁스 래퍼 (`<p class='ml-1'>…</p>` ~ `<p class='ml-5'>…</p>`) 조작 헬퍼.
 *
 * 에디터에서 `←` `→` 화살표로 사용자가 직접 들여쓰기 / 내어쓰기 하며,
 * 이 모듈은 래퍼 태그만 조작한다. 내부 **번호 스타일·텍스트는 건드리지 않는다**.
 *
 * 레벨 ↔ Bootstrap 4 `.ml-*` 매핑 (BS4 spacing scale — BS5 에서도 동일 값):
 *   0 → 래퍼 없음 (plain)
 *   1 → `<p class='ml-1'>…</p>` (0.25rem)
 *   2 → `<p class='ml-2'>…</p>` (0.5rem)
 *   3 → `<p class='ml-3'>…</p>` (1rem)
 *   4 → `<p class='ml-4'>…</p>` (1.5rem)
 *   5 → `<p class='ml-5'>…</p>` (3rem)
 *
 * BS4 는 ml-5 가 최대치. 프로덕션 HB1 은 BS4 이고, 에디터 미리보기는 BS5 지만
 * preview CSS shim (`styles.css`) 에서 동일 spacing 을 보장한다.
 */
export type Depth = 0 | 1 | 2 | 3 | 4 | 5;

/** 최대 뎁스. Bootstrap 4 `.ml-*` 스케일 상한. */
export const MAX_DEPTH: Depth = 5;

/**
 * 래퍼 라인 전체를 매칭하는 정규식. `trim` 된 상태를 가정.
 * 텍스트는 `<p>`, 테이블은 `<div>` 로 래핑되므로 두 태그 모두 허용.
 * (`<p><table>` 은 HTML 표준 위반이라 테이블은 `<div>` 래퍼를 쓴다)
 */
const WRAPPER_RE = /^<(p|div)\s+class=['"](ml-[1-5])['"]\s*>([\s\S]*)<\/\1>$/;

/** 래퍼만 매칭 (prefix 확인용). `trim` 후 사용. */
const WRAPPER_PREFIX_RE = /^<(?:p|div)\s+class=['"]ml-[1-5]['"]\s*>/;

const CLASS_TO_LEVEL: Record<string, Depth> = {
  'ml-1': 1, 'ml-2': 2, 'ml-3': 3, 'ml-4': 4, 'ml-5': 5,
};
const LEVEL_TO_CLASS: Record<Exclude<Depth, 0>, string> = {
  1: 'ml-1', 2: 'ml-2', 3: 'ml-3', 4: 'ml-4', 5: 'ml-5',
};

/**
 * BS4 `.ml-*` 실제 spacing 값 (rem). 미리보기 · DOCX · Markdown 출력에서
 * 같은 값을 각자의 단위로 변환해 사용한다 (px / twips / 공백 칸수).
 */
export const DEPTH_REM: Record<Exclude<Depth, 0>, number> = {
  1: 0.25,
  2: 0.5,
  3: 1,
  4: 1.5,
  5: 3,
};

/**
 * DOCX `w:ind w:left` 의 twips 값 → Depth 역변환.
 * export 가 쓰는 `rem * 240` 과 대칭. round-trip 일관성 목적.
 *
 * 매핑 (twips → depth):
 *   ml-1 = 60, ml-2 = 120, ml-3 = 240, ml-4 = 360, ml-5 = 720
 * 경계는 인접 지점의 중간값으로 잡아 Word 가 원본 편집한 DOCX 도 관대하게 수용.
 */
export function twipsToDepth(twips: number): Depth {
  if (!Number.isFinite(twips) || twips <= 30) return 0;
  if (twips < 90) return 1;   // 60 근방
  if (twips < 180) return 2;  // 120 근방
  if (twips < 300) return 3;  // 240 근방
  if (twips < 540) return 4;  // 360 근방
  return 5;                   // 720 이상
}

/** 현재 라인의 뎁스 레벨 반환. 래퍼가 없으면 0. */
export function getDepth(line: string): Depth {
  const m = WRAPPER_RE.exec(line.trim());
  if (!m) return 0;
  return CLASS_TO_LEVEL[m[2]] ?? 0;
}

/**
 * 래퍼를 벗긴 내부 컨텐츠 반환. 래퍼가 없으면 원본 그대로.
 * 편집 UI 에서 textarea 에 보여줄 "사용자 시점 라인" 을 얻을 때 사용.
 */
export function unwrapDepth(line: string): string {
  const m = WRAPPER_RE.exec(line.trim());
  return m ? m[3] : line;
}

/**
 * `level` 깊이로 내부 컨텐츠를 감싼다. `level === 0` 이면 래퍼 없이 그대로.
 * `content` 에 이미 래퍼가 있어도 먼저 벗기고 재래핑한다 (idempotent).
 * `<table>` 로 시작하는 컨텐츠는 `<div>` 로, 그 외는 `<p>` 로 감싼다.
 */
export function wrapDepth(content: string, level: Depth): string {
  const inner = unwrapDepth(content);
  if (level === 0) return inner;
  const tag = /^\s*<table\b/i.test(inner) ? 'div' : 'p';
  return `<${tag} class='${LEVEL_TO_CLASS[level]}'>${inner}</${tag}>`;
}

/** 뎁스 한 단계 증가 (최대 MAX_DEPTH). */
export function indent(line: string): string {
  const d = getDepth(line);
  if (d >= MAX_DEPTH) return line;
  return wrapDepth(unwrapDepth(line), (d + 1) as Depth);
}

/** 뎁스 한 단계 감소 (최소 0). */
export function outdent(line: string): string {
  const d = getDepth(line);
  if (d <= 0) return line;
  return wrapDepth(unwrapDepth(line), (d - 1) as Depth);
}

/** 라인에 뎁스 래퍼가 씌워져 있는지. validator 등에서 "뎁스가 명시됨" 판단용. */
export function hasDepthWrapper(line: string): boolean {
  return WRAPPER_PREFIX_RE.test(line.trim());
}
