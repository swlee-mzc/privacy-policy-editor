/**
 * 검증 레이어.
 * 파서 출력(JSON)과 원본 메타를 대조해 품질 경고만 생성한다.
 * JSON 구조는 건드리지 않으며, 경고 유무는 JSON 내용에 영향 없음.
 *
 * 경고 기준은 "절대 규칙 위반" 이 아니라 **"같은 문서 내 다른 헤딩과의 일관성"**.
 *
 * 결과는 `autoFixes` 와 `issues` 두 갈래로 분리한다.
 *   - `autoFixes` : JSON 에 이미 반영되었거나, 에디터에서 수정 없이 그대로
 *     다시 내보내도 일관된 포맷으로 정상화되는 관찰 항목. 사용자 조치 불필요.
 *   - `issues` : JSON 본문에 원본 그대로 남아있어 의미 수정이 필요한 항목.
 */
import type { Doc } from '../../types';
import { parseTable, validateTableGrid } from '../table';
import { matchSection } from './section';
import { stripStrike, paragraphHeadingBold } from './paragraph';
import type { NormalizeCounters } from './normalize';
import type { SectionMeta } from './convert';

/**
 * 검증 이슈의 위치 참조. UI 에서 클릭 시 에디터·미리보기 양쪽 패널을 스크롤.
 *
 * - `sectionIndex = -1` : headers (intro)
 * - `sectionIndex >= 0` : doc.contents[sectionIndex]
 * - `lineIndex` 미지정  : 섹션 헤딩 앵커로 스크롤
 */
export type IssueRef = {
  sectionIndex: number;
  lineIndex?: number;
  /** 클릭 칩에 표시할 짧은 레이블. 예: "제1조", "제1조 L3", "헤더 #2". */
  label: string;
};

export type Issue = {
  message: string;
  refs: IssueRef[];
};

/**
 * 본문 줄 앞머리에 쓰인 번호 스타일 패턴. 문서 내 혼재 감지용.
 *
 * 혼재 판정은 **구조적 들여쓰기 깊이(`ml-N` 래퍼)** 가 같은 줄들 사이에서만 수행된다.
 * 깊이가 다르면 스타일이 달라도 계층 분리가 자연스러운 상황이라 정상으로 본다.
 * 예: ml-2 에 `1./2./3.`, ml-3 에 `①②` 또는 `1)2)3)`, ml-4 에 `ⅰ)ⅱ)` 가 섞여도
 * 같은 ml-N 안에서만 일관되면 OK.
 */
const NUMBER_STYLES: { name: string; re: RegExp }[] = [
  { name: '①②③ (원문자)', re: /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/ },
  { name: '1. (마침표)', re: /^\d+\.\s/ },
  { name: '가. (한글)', re: /^[가-힣]\.\s/ },
  { name: 'Ⅰ. (로마대마침표)', re: /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\./ },
  { name: '(1) (전괄호)', re: /^\(\d+\)\s/ },
  { name: '1) (반괄호)', re: /^\d+\)\s/ },
  { name: '가) (한글반괄)', re: /^[가-힣]\)/ },
  { name: 'ⅰ) (로마소)', re: /^[ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]\)/ },
  { name: 'Ⅰ) (로마대)', re: /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\)/ },
];

/**
 * 뎁스 래퍼(`<p|div class='ml-1..5'>…</p|div>`) 의 내부 텍스트를 벗겨낸다.
 * 번호 스타일은 "래퍼를 벗긴 원문" 기준으로 감지되어야 한다.
 */
const DEPTH_WRAPPER_RE = /^<(p|div)\s+class=['"]ml-[1-5]['"]\s*>([\s\S]*)<\/\1>$/;
const DEPTH_CLASS_RE = /class=['"]ml-([1-5])['"]/;

/**
 * 번호 스타일과 **구조적 들여쓰기 깊이** (`ml-N` 의 N, 래퍼 없으면 0)를 반환.
 * 혼재 검사는 동일 depth 내에서만 수행되므로 여기서 depth 도 함께 내보낸다.
 */
function detectNumberStyle(line: string): { name: string; depth: number } | null {
  let probe = stripStrike(line).trim();
  let depth = 0;
  const wrap = DEPTH_WRAPPER_RE.exec(probe);
  if (wrap) {
    const m = DEPTH_CLASS_RE.exec(probe);
    if (m) depth = parseInt(m[1], 10);
    probe = wrap[2].trimStart();
  }
  for (const entry of NUMBER_STYLES) {
    if (entry.re.test(probe)) return { name: entry.name, depth };
  }
  return null;
}

/** 도트 문자 5종 — 어느 하나로 통일되는 것이 이상적. */
const DOT_CHARS = ['·', '⋅', '․', '∙', '・'] as const;

type LineOrigin = {
  sectionIndex: number;
  lineIndex: number;
  sectionTitle: string;
  text: string;
};

function collectLineOrigins(doc: Doc): LineOrigin[] {
  const out: LineOrigin[] = [];
  doc.headers.forEach((h, i) =>
    out.push({ sectionIndex: -1, lineIndex: i, sectionTitle: '헤더', text: h }),
  );
  doc.contents.forEach((s, si) =>
    s.lines.forEach((l, li) =>
      out.push({ sectionIndex: si, lineIndex: li, sectionTitle: s.title, text: l }),
    ),
  );
  return out;
}

function shortTitle(s: string, max = 24): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function refForLine(o: LineOrigin): IssueRef {
  if (o.sectionIndex === -1) {
    return { sectionIndex: -1, lineIndex: o.lineIndex, label: `헤더 #${o.lineIndex + 1}` };
  }
  return {
    sectionIndex: o.sectionIndex,
    lineIndex: o.lineIndex,
    label: `${shortTitle(o.sectionTitle, 16)} L${o.lineIndex + 1}`,
  };
}

function refForSection(sectionIndex: number, title: string): IssueRef {
  return { sectionIndex, label: shortTitle(title, 24) };
}

/**
 * Doc 구조만으로 계산 가능한 요약 정보. DOCX/JSON 공통으로 사용.
 */
export function buildDocInfo(doc: Doc): string[] {
  const allLines = [...doc.headers, ...doc.contents.flatMap((c) => c.lines)];
  const tableCount = allLines.filter((l) => l.startsWith('<table')).length;
  return [
    `headers: ${doc.headers.length}개`,
    `sections: ${doc.contents.length}개`,
    `tables: ${tableCount}개`,
  ];
}

/**
 * Doc 구조만으로 수행하는 검증. DOCX XML 없이도 호출 가능하므로
 * 에디터 실시간(디바운스) 재검증에 사용.
 *
 * 이 함수가 **커버하지 못하는** 검사:
 *   - (1) 헤딩 서식 bold 혼재   — DOCX run 서식 필요
 *   - (2) 섹션 번호 공백 정상화 — DOCX 원본 rawNum 필요
 *   - 스마트따옴표 "치환 개수"  — parser 가 수행한 정상화의 기록
 * 이들은 파싱 시점에만 의미가 있으므로 autoFixes 로만 취급되며 live 에서는 재계산하지 않는다.
 * 단, 스마트따옴표가 현재 JSON 에 **남아있는지** 는 live 로 검사한다((8') 참조).
 */
export function validateDoc(doc: Doc): Issue[] {
  const issues: Issue[] = [];

  if (doc.contents.length === 0) {
    issues.push({
      message:
        '섹션을 하나도 인식하지 못했습니다. 조 제목 패턴(제N조 / 第N条 / Article N)을 확인하세요.',
      refs: [],
    });
    return issues;
  }

  // 섹션 제목에서 번호 복원 (matchSection 은 DOCX paragraph text 용이지만
  // JSON title("제1조 (…)") 도 동일 패턴이라 그대로 통과).
  const sectionNums: { idx: number; num: number; title: string }[] = [];
  doc.contents.forEach((c, i) => {
    const m = matchSection(c.title);
    if (m) sectionNums.push({ idx: i, num: m.num, title: c.title });
  });

  // (3)(4) 번호 연속성/중복
  if (sectionNums.length > 0) {
    const nums = sectionNums.map((s) => s.num);
    const sorted = [...nums].sort((a, b) => a - b);
    const maxNum = sorted[sorted.length - 1];
    const set = new Set(sorted);
    const missing: number[] = [];
    for (let i = 1; i <= maxNum; i++) if (!set.has(i)) missing.push(i);
    if (missing.length) {
      issues.push({
        message: `섹션 번호 누락: ${missing.map((n) => 'N=' + n).join(', ')} (인식된 최대 번호 N=${maxNum}). 원문 DOCX 확인 필요.`,
        refs: [],
      });
    }
    const seen = new Set<number>();
    const dup = new Set<number>();
    for (const n of sorted) {
      if (seen.has(n)) dup.add(n);
      seen.add(n);
    }
    if (dup.size) {
      const dupRefs: IssueRef[] = [];
      for (const s of sectionNums) {
        if (dup.has(s.num)) dupRefs.push(refForSection(s.idx, s.title));
      }
      issues.push({
        message: `섹션 번호 중복: ${[...dup].map((n) => 'N=' + n).join(', ')}`,
        refs: dupRefs,
      });
    }
  }

  // (5) 빈 섹션
  const emptyRefs: IssueRef[] = [];
  doc.contents.forEach((c, i) => {
    if (c.lines.length === 0) emptyRefs.push(refForSection(i, c.title));
  });
  if (emptyRefs.length) {
    issues.push({
      message: `빈 섹션 ${emptyRefs.length}건`,
      refs: emptyRefs,
    });
  }

  const origins = collectLineOrigins(doc);

  // (6) 번호 스타일 혼재 — **같은 구조적 들여쓰기 깊이(ml-N)** 내에서만 체크.
  //   서로 다른 깊이의 스타일이 한 문서에 공존하는 것은 정상 (하위 트리 번호매김).
  //   예: ml-2 `1.` / ml-3 `①②` 또는 `1)` / ml-4 `ⅰ)` 는 정상.
  //   같은 ml-N 안에서 `1.` 과 `①` 이 섞이면 outlier 로 표시.
  const stylesByDepth = new Map<number, Map<string, number>>();
  for (const o of origins) {
    if (o.text.startsWith('<table')) continue;
    const s = detectNumberStyle(o.text);
    if (!s) continue;
    if (!stylesByDepth.has(s.depth)) stylesByDepth.set(s.depth, new Map());
    const m = stylesByDepth.get(s.depth)!;
    m.set(s.name, (m.get(s.name) || 0) + 1);
  }
  for (const [depth, styles] of stylesByDepth) {
    if (styles.size < 2) continue;
    const sortedStyles = [...styles.entries()].sort((a, b) => b[1] - a[1]);
    const [majorityStyle] = sortedStyles[0];
    const styleRefs: IssueRef[] = [];
    for (const o of origins) {
      if (o.text.startsWith('<table')) continue;
      const s = detectNumberStyle(o.text);
      if (s && s.depth === depth && s.name !== majorityStyle) styleRefs.push(refForLine(o));
    }
    const list = sortedStyles.map(([s, n]) => `${s} ${n}건`).join(', ');
    const depthLabel = depth === 0 ? '최상위(래퍼 없음)' : `ml-${depth}`;
    issues.push({
      message: `${depthLabel} 깊이의 번호 스타일이 일관되지 않습니다: ${list}. 다수(${majorityStyle}) 외 outlier 위치를 표시.`,
      refs: styleRefs,
    });
  }

  // (7) 도트 문자 혼재
  const allText = [
    ...doc.headers,
    ...doc.contents.flatMap((c) => [c.title, ...c.lines]),
  ].join('\n');
  const dotCounts = DOT_CHARS
    .map((ch) => ({ ch, n: (allText.match(new RegExp(ch, 'g')) || []).length }))
    .filter((d) => d.n > 0);
  if (dotCounts.length >= 2) {
    const sortedDots = [...dotCounts].sort((a, b) => b.n - a.n);
    const majorityDot = sortedDots[0].ch;
    const minorityDots = sortedDots.slice(1).map((d) => d.ch);
    const dotRefs: IssueRef[] = [];
    for (const o of origins) {
      if (minorityDots.some((ch) => o.text.includes(ch))) dotRefs.push(refForLine(o));
    }
    issues.push({
      message: `도트 문자가 혼재합니다: ${dotCounts.map((d) => `'${d.ch}' ${d.n}개`).join(', ')}. 다수('${majorityDot}') 외 문자가 포함된 줄을 표시.`,
      refs: dotRefs,
    });
  }

  // (8') 스마트따옴표 잔존 — 현재 JSON 에 남아있는 스마트따옴표를 live 검출.
  const smartQuoteRefs: IssueRef[] = [];
  let smartQuoteTotal = 0;
  for (const o of origins) {
    const matches = o.text.match(/[“”‘’]/g);
    if (matches) {
      smartQuoteTotal += matches.length;
      smartQuoteRefs.push(refForLine(o));
    }
  }
  if (smartQuoteTotal > 0) {
    issues.push({
      message: `스마트따옴표(" " ' ') ${smartQuoteTotal}개가 현재 JSON 에 남아있습니다. 일반 따옴표로 수정 권장.`,
      refs: smartQuoteRefs,
    });
  }

  // (10) 표 격자 불일치 — rowspan/colspan 합이 행 너비와 어긋나거나 구멍이 있는 경우.
  const gridRefs: IssueRef[] = [];
  const gridDetails: string[] = [];
  for (const o of origins) {
    if (!o.text.startsWith('<table')) continue;
    const td = parseTable(o.text);
    if (!td) continue;
    const g = validateTableGrid(td);
    if (g.length) {
      gridRefs.push(refForLine(o));
      gridDetails.push(`${refForLine(o).label}: ${g[0]}${g.length > 1 ? ` 외 ${g.length - 1}건` : ''}`);
    }
  }
  if (gridRefs.length) {
    issues.push({
      message: `표 격자 일관성 오류 ${gridRefs.length}건 (rowspan/colspan 합 불일치 또는 빈 격자). ${gridDetails.slice(0, 3).join(' / ')}${gridDetails.length > 3 ? ' …' : ''}`,
      refs: gridRefs,
    });
  }

  // (9) 취소선/변경 추적 삭제 잔존
  const strikeRefs: IssueRef[] = [];
  for (const o of origins) {
    if (/<s>/.test(o.text)) strikeRefs.push(refForLine(o));
  }
  if (strikeRefs.length) {
    const strikeInTables = origins.filter(
      (o) => o.text.startsWith('<table') && /<s>/.test(o.text),
    ).length;
    issues.push({
      message: `취소선/삭제 표시 ${strikeRefs.length}건이 보존되어 있습니다(표 내부 ${strikeInTables}건 포함). 에디터에서 수동으로 정리 필요.`,
      refs: strikeRefs,
    });
  }

  return issues;
}

/**
 * DOCX 원본 메타까지 활용하는 검증. 파싱 직후에만 호출된다.
 * `validateDoc` 의 결과에 (1) 헤딩 서식 bold 혼재, (2) 번호 공백 정상화,
 * (8) 스마트따옴표 치환 히스토리 를 autoFixes 로 추가한다.
 */
export function validate(
  doc: Doc,
  metas: SectionMeta[],
  normalizeCounters: NormalizeCounters,
): { info: string[]; autoFixes: string[]; issues: Issue[] } {
  const info = buildDocInfo(doc);
  const autoFixes: string[] = [];
  const issues = validateDoc(doc);

  if (doc.contents.length === 0) return { info, autoFixes, issues };

  // (1) 헤딩 서식 일관성 — DOCX 원본 서식 기반. 내보내기 시 자동 정상화.
  const sigs = metas.map((m) => ({
    meta: m,
    bold: paragraphHeadingBold(m.paragraph, m.headingLen),
  }));
  const boldGroup = sigs.filter((s) => s.bold);
  const plainGroup = sigs.filter((s) => !s.bold);
  if (boldGroup.length > 0 && plainGroup.length > 0) {
    const [majority, minority, majLabel, minLabel] =
      boldGroup.length >= plainGroup.length
        ? [boldGroup, plainGroup, '굵기 적용', '굵기 미적용']
        : [plainGroup, boldGroup, '굵기 미적용', '굵기 적용'];
    autoFixes.push(
      `원본 헤딩 서식 혼재: 다수 ${majority.length}개는 ${majLabel}, 소수 ${minority.length}개는 ${minLabel} (${minority.map((s) => s.meta.title).join(' / ')}). 내보내기 시 일관된 포맷으로 자동 정상화.`,
    );
  }

  // (2) 번호 공백 정상화 — parser 가 이미 JSON 에 반영.
  for (const m of metas) {
    if (/[\s　]/.test(m.rawNum)) {
      autoFixes.push(
        `번호 공백 정상화: '${m.rawNum.trim()}' → ${m.num} (${m.title}). JSON 에 반영됨.`,
      );
    }
  }

  // (8) 스마트따옴표 치환 히스토리 — parser normalize 로 얼마나 치환했는지.
  if (normalizeCounters.smartQuotesReplaced > 0) {
    autoFixes.push(
      `스마트따옴표 ${normalizeCounters.smartQuotesReplaced}개를 일반 따옴표로 자동 치환. JSON 에 반영됨.`,
    );
  }

  return { info, autoFixes, issues };
}
