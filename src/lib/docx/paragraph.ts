/**
 * `w:p` 단락 노드에 대한 고수준 유틸.
 *   - runText: 단일 run 텍스트
 *   - paragraphInline: 변경추적(`w:del`)·취소선(`w:strike`/`w:dstrike`) 을 `<s>` 로 보존한 표시용 텍스트
 *   - paragraphText: paragraphInline 별칭 (의미 강조)
 *   - paragraphNumInfo / paragraphAlign / paragraphHeadingBold: 속성 조회
 *   - stripStrike: 규칙 매칭용 plain 변환
 */
import type { Node } from './xml';
import { collectText, findDeep, findFirst, getAttrs, getChildren, getTag } from './xml';

/**
 * run 내부 텍스트 + `<w:br/>` 을 `<br>` 로 보존.
 * 상위에서 맥락에 따라 처리한다:
 *   - 셀: `<br>` 그대로 HTML 에 둠 (셀 내 줄바꿈)
 *   - 본문 단락 / sec.rest: `<br>` 로 split 해서 여러 라인으로 분리 (`splitBrToLines`)
 *   - 섹션 헤딩 매칭: 정규식이 `<br>` 가 prefix 에 있어도 매칭되도록 설계되어 있으므로
 *     rest 쪽만 split 하면 됨.
 * `<w:tab>` 은 여전히 무시.
 */
export function runText(r: Node): string {
  let out = '';
  for (const c of getChildren(r)) {
    const tag = getTag(c);
    if (tag === 'w:t' || tag === 'w:delText') {
      for (const cc of getChildren(c)) {
        if ('#text' in cc) out += String(cc['#text']);
      }
    } else if (tag === 'w:br') {
      out += '<br>';
    }
  }
  return out;
}

/**
 * 단락을 인라인 표현(일부 HTML 포함)으로 렌더링.
 * - 일반 run → 텍스트 그대로
 * - `<w:strike/>` 또는 `<w:dstrike/>` 서식 run → `<s>...</s>` 로 감쌈
 * - `<w:del>` 내부 run → `<s>...</s>` 로 감쌈 (변경 추적 삭제 보존)
 */
export function paragraphInline(p: Node): string {
  let out = '';
  function walk(nodes: Node[], inDel: boolean) {
    for (const n of nodes) {
      const tag = getTag(n);
      if (tag === 'w:del') {
        walk(getChildren(n), true);
      } else if (tag === 'w:r') {
        const rpr = findFirst(getChildren(n), 'w:rPr');
        const hasStrike = !!rpr && (
          !!findFirst(getChildren(rpr), 'w:strike') ||
          !!findFirst(getChildren(rpr), 'w:dstrike')
        );
        const txt = runText(n);
        if (!txt) continue;
        if (inDel || hasStrike) out += '<s>' + txt + '</s>';
        else out += txt;
      } else if (tag) {
        walk(getChildren(n), inDel);
      }
    }
  }
  walk(getChildren(p), false);
  return out;
}

/** 규칙 매칭용 — `<s>` 태그 제거해 plain text 로. */
export function stripStrike(s: string): string {
  return s.replace(/<\/?s>/g, '');
}

/**
 * 단락 표시용 텍스트. 취소선은 `<s>...</s>` 로 래핑되어 보존됨.
 * 섹션 헤딩 패턴 매칭처럼 plain text 가 필요한 곳에서는 `stripStrike()` 로 벗겨 사용.
 */
export function paragraphText(p: Node): string {
  return paragraphInline(p);
}

export function paragraphNumInfo(p: Node): [string | null, string | null] {
  const npr = findDeep(getChildren(p), 'w:numPr');
  if (!npr) return [null, null];
  const ni = findFirst(getChildren(npr), 'w:numId');
  const il = findFirst(getChildren(npr), 'w:ilvl');
  return [
    ni ? getAttrs(ni)['w:val'] : null,
    il ? getAttrs(il)['w:val'] : null,
  ];
}

export function paragraphAlign(p: Node): string | null {
  const jc = findDeep(getChildren(p), 'w:jc');
  return jc ? getAttrs(jc)['w:val'] : null;
}

/**
 * 단락 좌측 들여쓰기(twips). `w:pPr > w:ind w:left`(또는 RTL 문서의 `w:start`).
 * 값이 없거나 파싱 실패 시 0. export.ts 가 `w:ind w:left` 로 쓰므로 대칭.
 */
export function paragraphIndentTwips(p: Node): number {
  const ppr = findFirst(getChildren(p), 'w:pPr');
  if (!ppr) return 0;
  const ind = findFirst(getChildren(ppr), 'w:ind');
  if (!ind) return 0;
  const a = getAttrs(ind);
  const raw = a['w:left'] ?? a['w:start'];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/** `w:tbl > w:tblPr > w:tblInd w:w` 의 twips. table 단위 들여쓰기. */
export function tableIndentTwips(tbl: Node): number {
  const tblPr = findFirst(getChildren(tbl), 'w:tblPr');
  if (!tblPr) return 0;
  const tblInd = findFirst(getChildren(tblPr), 'w:tblInd');
  if (!tblInd) return 0;
  const raw = getAttrs(tblInd)['w:w'];
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 단락 내 헤딩 부분이 bold 인지 판정.
 * 시맨틱 헤딩(조 제목) 판정용 — 텍스트 패턴은 맞지만 굵기가 빠진 단락은
 * 본문으로 강등하고 lint 로 표면화한다.
 *
 * `headingLen`: 단락 텍스트 중 헤딩이 차지하는 선행 길이.
 *   - `sec.rest` 가 비어있으면 헤딩이 단락 전체 → 전체 길이
 *   - `sec.rest` 가 있으면(병합된 heading+body 단락) → 헤딩 prefix 길이만
 *
 * 기준: 선행 `headingLen` 문자를 커버하는 모든 텍스트 run 이
 *   `<w:rPr><w:b/>` 를 포함해야 함. `<w:b w:val="false"/>` 는 명시적 off.
 */
export function paragraphHeadingBold(p: Node, headingLen: number): boolean {
  const runs: Node[] = [];
  function collect(nodes: Node[]) {
    for (const n of nodes) {
      if (getTag(n) === 'w:r') runs.push(n);
      else collect(getChildren(n));
    }
  }
  collect(getChildren(p));

  let covered = 0;
  let hasTextRun = false;
  for (const r of runs) {
    const txt = collectText(getChildren(r));
    if (!txt) continue;
    hasTextRun = true;
    const rpr = findFirst(getChildren(r), 'w:rPr');
    const b = rpr ? findFirst(getChildren(rpr), 'w:b') : null;
    const val = b ? getAttrs(b)['w:val'] : undefined;
    const isBold = !!b && val !== 'false' && val !== '0';
    if (!isBold && txt.trim()) return false;
    covered += txt.length;
    if (covered >= headingLen) return true;
  }
  return hasTextRun && covered >= headingLen;
}
