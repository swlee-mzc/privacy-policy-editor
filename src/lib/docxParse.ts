/**
 * DOCX → Doc 파서 (브라우저).
 *
 * 원본: ~/.claude/skills/privacy-convert/scripts/docx2json.mjs (Node).
 * 브라우저 이식:
 *   - unzip(execFileSync) → JSZip
 *   - fs read → File/Blob
 * 그 외 XML 파싱·섹션 분할·표 병합 로직은 동일.
 *
 * Phase 2 후처리:
 *   - 스마트따옴표 → 일반따옴표
 *   - 첫 행 thead 승격 (2+ 셀 & 셀 짧음 휴리스틱)
 *   - lint 경고 수집
 */
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { Doc } from '../types';
import { parseTable, validateTableGrid } from './table';

/**
 * 섹션 제목 패턴 (다국어). 제목 뒤에 본문이 같은 단락에 이어져 있어도
 * (DOCX 문단 병합 케이스) 프리픽스가 매칭되면 잡는다.
 *
 * 캡처: [1] 번호(숫자 사이 공백 허용), [2] 제목, [3] 같은 단락의 잔여 본문.
 * 숫자 사이 공백 허용 이유: Word 에서 타이핑 중 실수로 `第 1 1条` 처럼
 * 숫자가 쪼개진 DOCX 가 관찰됨. 정상 파싱 후 lint 로 표면화.
 */
type SectionLang = 'ko' | 'ja' | 'en';
const SECTION_PATTERNS: { lang: SectionLang; re: RegExp }[] = [
  { lang: 'ko', re: /^제\s*(\d[\d\s]*?)\s*조\s*[（(]\s*([^）)]+?)\s*[）)]\s*(.*)$/ },
  { lang: 'ja', re: /^第\s*(\d[\d\s　]*?)\s*条\s*[（(]\s*([^）)]+?)\s*[）)]\s*(.*)$/ },
  { lang: 'en', re: /^Article\s+(\d[\d\s]*?)\s*[（(]\s*([^）)]+?)\s*[）)]\s*(.*)$/i },
];

type SectionMatch = {
  lang: SectionLang;
  num: number;
  title: string;
  rest: string;
  /** 원본 숫자 캡처 (공백 포함 가능). 정상화 여부 판정용. */
  rawNum: string;
};

function matchSection(text: string): SectionMatch | null {
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

function formatSectionTitle(lang: SectionLang, num: number, title: string): string {
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
function isDocTitle(text: string): boolean {
  if (text.includes('개인정보 처리방침')) return true;
  if (text.includes('個人情報処理方針')) return true;
  if (/^privacy\s+policy$/i.test(text.trim())) return true;
  return false;
}


type Node = Record<string, unknown>;

function getTag(node: Node): string | null {
  for (const k of Object.keys(node)) if (k !== ':@') return k;
  return null;
}
function getChildren(node: Node): Node[] {
  const tag = getTag(node);
  if (!tag) return [];
  const val = (node as Record<string, unknown>)[tag];
  return Array.isArray(val) ? (val as Node[]) : [];
}
function getAttrs(node: Node): Record<string, string> {
  return ((node as Record<string, unknown>)[':@'] as Record<string, string>) || {};
}
function findAll(nodes: Node[] | undefined, tagName: string): Node[] {
  return (nodes || []).filter((n) => getTag(n) === tagName);
}
function findFirst(nodes: Node[] | undefined, tagName: string): Node | null {
  return (nodes || []).find((n) => getTag(n) === tagName) || null;
}
function findDeep(nodes: Node[] | undefined, tagName: string): Node | null {
  for (const n of nodes || []) {
    if (getTag(n) === tagName) return n;
    const found = findDeep(getChildren(n), tagName);
    if (found) return found;
  }
  return null;
}
function collectText(nodes: Node[] | undefined): string {
  let out = '';
  for (const n of nodes || []) {
    const tag = getTag(n);
    if (tag === 'w:t' || tag === 'w:delText') {
      // w:delText: <w:del> 내부의 텍스트. 데이터 손실 방지 위해 포함.
      for (const c of getChildren(n)) {
        if ('#text' in c) out += String(c['#text']);
      }
    } else if (tag) {
      out += collectText(getChildren(n));
    }
  }
  return out;
}

/** run 내부 텍스트만 추출 (w:t + w:delText).
 *  `<w:br>`/`<w:tab>` 은 의도적으로 무시 — 기존 `collectText` 동작과 호환성 유지.
 *  헤딩+본문이 br 로 합쳐진 단락(JA 第6条 케이스)에서 섹션 매칭이 실패하지
 *  않도록 br 은 빈 문자로 취급한다. 시각적 줄바꿈 손실은 수용 가능.
 */
function runText(r: Node): string {
  let out = '';
  for (const c of getChildren(r)) {
    const tag = getTag(c);
    if (tag === 'w:t' || tag === 'w:delText') {
      for (const cc of getChildren(c)) {
        if ('#text' in cc) out += String(cc['#text']);
      }
    }
  }
  return out;
}

/**
 * 단락을 인라인 표현(일부 HTML 포함)으로 렌더링.
 * - 일반 run → 텍스트 그대로
 * - `<w:strike/>` 또는 `<w:dstrike/>` 서식 run → `<s>...</s>` 로 감쌈
 * - `<w:del>` 내부 run → `<s>...</s>` 로 감쌈 (변경 추적 삭제 보존)
 *
 * 기존 "삭제 취급" 동작을 없애고, 취소선을 있는 그대로 보여 에디터에서
 * 사용자가 수동 정리할 수 있도록 한다.
 */
function paragraphInline(p: Node): string {
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
function stripStrike(s: string): string {
  return s.replace(/<\/?s>/g, '');
}

function loadXml(xmlStr: string): Node[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    preserveOrder: true,
    trimValues: false,
    parseAttributeValue: false,
    parseTagValue: false,
  });
  return parser.parse(xmlStr) as Node[];
}

// --- Numbering ------------------------------------------------------------

type NumMap = Record<string, Record<string, string>>;

function parseNumbering(xml: string): NumMap {
  const parsed = loadXml(xml);
  const numbering = findFirst(parsed, 'w:numbering');
  if (!numbering) return {};
  const kids = getChildren(numbering);

  const abstracts: Record<string, Record<string, string>> = {};
  for (const an of findAll(kids, 'w:abstractNum')) {
    const aid = getAttrs(an)['w:abstractNumId'];
    const lvls: Record<string, string> = {};
    for (const lvl of findAll(getChildren(an), 'w:lvl')) {
      const ilvl = getAttrs(lvl)['w:ilvl'];
      const lt = findFirst(getChildren(lvl), 'w:lvlText');
      lvls[ilvl] = (lt && getAttrs(lt)['w:val']) || '%1.';
    }
    abstracts[aid] = lvls;
  }
  const map: NumMap = {};
  for (const n of findAll(kids, 'w:num')) {
    const nid = getAttrs(n)['w:numId'];
    const aref = findFirst(getChildren(n), 'w:abstractNumId');
    if (aref) {
      const aval = getAttrs(aref)['w:val'];
      map[nid] = abstracts[aval] || {};
    }
  }
  return map;
}

class NumberingState {
  map: NumMap;
  counters: Record<string, Record<string, number>> = {};
  constructor(map: NumMap) {
    this.map = map;
  }
  prefix(numId: string | null, ilvl: string | null): string {
    if (!numId) return '';
    const lvl = ilvl || '0';
    this.counters[numId] ??= {};
    this.counters[numId][lvl] = (this.counters[numId][lvl] || 0) + 1;
    const tmpl = (this.map[numId] && this.map[numId][lvl]) || '%1.';
    return tmpl.replace('%1', String(this.counters[numId][lvl])) + ' ';
  }
}

// --- Paragraph / Table ----------------------------------------------------

/**
 * 단락 표시용 텍스트. 취소선은 `<s>...</s>` 로 래핑되어 보존됨.
 * 섹션 헤딩 패턴 매칭처럼 plain text 가 필요한 곳에서는 `stripStrike()` 로 벗겨 사용.
 */
function paragraphText(p: Node): string {
  return paragraphInline(p);
}

function paragraphNumInfo(p: Node): [string | null, string | null] {
  const npr = findDeep(getChildren(p), 'w:numPr');
  if (!npr) return [null, null];
  const ni = findFirst(getChildren(npr), 'w:numId');
  const il = findFirst(getChildren(npr), 'w:ilvl');
  return [
    ni ? getAttrs(ni)['w:val'] : null,
    il ? getAttrs(il)['w:val'] : null,
  ];
}

function paragraphAlign(p: Node): string | null {
  const jc = findDeep(getChildren(p), 'w:jc');
  return jc ? getAttrs(jc)['w:val'] : null;
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
function paragraphHeadingBold(p: Node, headingLen: number): boolean {
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

function cellText(cell: Node): string {
  const parts: string[] = [];
  for (const p of findAll(getChildren(cell), 'w:p')) {
    const t = paragraphText(p).trim();
    if (t || parts.length) parts.push(t);
  }
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  return parts.join('<br>');
}

function cellMerge(cell: Node): { vm: string | null; gs: number } {
  const tcpr = findFirst(getChildren(cell), 'w:tcPr');
  if (!tcpr) return { vm: null, gs: 1 };
  const vmEl = findFirst(getChildren(tcpr), 'w:vMerge');
  const gsEl = findFirst(getChildren(tcpr), 'w:gridSpan');
  const vm = vmEl ? getAttrs(vmEl)['w:val'] || 'continue' : null;
  const gs = gsEl ? parseInt(getAttrs(gsEl)['w:val'] || '1', 10) : 1;
  return { vm, gs };
}

type GridCell = {
  text: string;
  vm: string | null;
  gs: number;
  col: number;
  rowspan: number;
};

function tableToHtml(tbl: Node): string {
  const rowsXml = findAll(getChildren(tbl), 'w:tr');
  if (!rowsXml.length) return '';

  const grid: GridCell[][] = [];
  for (const tr of rowsXml) {
    const row: GridCell[] = [];
    let col = 0;
    for (const tc of findAll(getChildren(tr), 'w:tc')) {
      const { vm, gs } = cellMerge(tc);
      row.push({ text: cellText(tc), vm, gs, col, rowspan: 1 });
      col += gs;
    }
    grid.push(row);
  }

  for (let ri = 0; ri < grid.length; ri++) {
    for (const cell of grid[ri]) {
      if (cell.vm === 'restart') {
        let span = 1;
        for (let rj = ri + 1; rj < grid.length; rj++) {
          if (grid[rj].some((c) => c.vm === 'continue' && c.col === cell.col)) span++;
          else break;
        }
        cell.rowspan = span;
      }
    }
  }

  return emitTable(grid);
}

/** Phase 2: 첫 행 thead 승격 휴리스틱.
 *  - 2행 이상 AND 첫 행이 2셀 이상 AND 첫 행 모든 셀이 짧음(≤30자) → thead 승격
 *  - 라벨 표(모든 행이 정확히 2셀이고 첫 셀이 일관되게 짧음) → skip (LLM이 `<th class='table-secondary'>` 로 수동 변환)
 */
function shouldPromoteThead(grid: GridCell[][]): boolean {
  if (grid.length < 2) return false;
  const first = grid[0].filter((c) => c.vm !== 'continue');
  if (first.length < 2) return false;
  const allShort = first.every((c) => c.text.length <= 30 && !c.text.includes('<br>'));
  if (!allShort) return false;

  // 라벨 표 판별: 전체 행이 2셀이고 첫 셀 < 20자, 둘째 셀 ≥ 첫 셀 길이면 라벨 표
  const allTwoCell = grid.every((row) => row.filter((c) => c.vm !== 'continue').length === 2);
  if (allTwoCell) {
    const avgFirst = grid.reduce((a, r) => a + r[0].text.length, 0) / grid.length;
    const avgSecond = grid.reduce((a, r) => a + r[1].text.length, 0) / grid.length;
    if (avgFirst < 20 && avgSecond > avgFirst * 1.5) return false;
  }
  return true;
}

function emitTable(grid: GridCell[][]): string {
  const promote = shouldPromoteThead(grid);
  const parts = ["<table class='table table-bordered table-sm'>"];

  if (promote) {
    parts.push('<thead>');
    parts.push("<tr class='table-secondary'>");
    for (const c of grid[0]) {
      if (c.vm === 'continue') continue;
      const attr: string[] = [];
      if (c.gs > 1) attr.push(`colspan='${c.gs}'`);
      if (c.rowspan > 1) attr.push(`rowspan='${c.rowspan}'`);
      parts.push(`<th${attr.length ? ' ' + attr.join(' ') : ''}>${c.text}</th>`);
    }
    parts.push('</tr>');
    parts.push('</thead>');
  }

  parts.push('<tbody>');
  const bodyStart = promote ? 1 : 0;
  for (let ri = bodyStart; ri < grid.length; ri++) {
    parts.push('<tr>');
    for (const c of grid[ri]) {
      if (c.vm === 'continue') continue;
      const attr: string[] = [];
      if (c.gs > 1) attr.push(`colspan='${c.gs}'`);
      if (c.rowspan > 1) attr.push(`rowspan='${c.rowspan}'`);
      parts.push(`<td${attr.length ? ' ' + attr.join(' ') : ''}>${c.text}</td>`);
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');
  return parts.join('');
}

// --- Normalize ------------------------------------------------------------

/** convert 과정에서 발생한 결정적 정규화 카운터. validator 에서 경고 생성에 사용. */
type NormalizeCounters = {
  smartQuotesReplaced: number;
};

function normalizeSmartQuotes(s: string, counters?: NormalizeCounters): string {
  const count = (s.match(/[“”‘’]/g) || []).length;
  if (count && counters) counters.smartQuotesReplaced += count;
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function normalizeLine(s: string, counters?: NormalizeCounters): string {
  return normalizeSmartQuotes(
    s.replace(/(?<=[.!?]) {2,}(?=[가-힣A-Za-z])/g, ' '),
    counters,
  ).trim();
}


// --- Convert --------------------------------------------------------------

/**
 * 파서가 채택한 섹션 각각에 대한 원본 메타.
 * 검증 레이어(validate)가 JSON 구조를 건드리지 않고 품질 경고만 생성하도록
 * 헤딩 단락 노드와 파생 정보를 같이 보관한다.
 */
type SectionMeta = {
  num: number;
  title: string;
  lang: SectionLang;
  /** 원본 번호 캡처(공백 포함 가능). 숫자 정규화 감지용. */
  rawNum: string;
  /** 원본 헤딩 단락 노드. 서식(bold 등) 검사용. */
  paragraph: Node;
  /** 헤딩이 단락 텍스트에서 차지하는 prefix 길이. */
  headingLen: number;
};

type ConvertResult = {
  doc: Doc;
  sectionMetas: SectionMeta[];
  normalizeCounters: NormalizeCounters;
};

/**
 * 파서: 단일 규칙만 적용.
 *   규칙: `정규식 매칭 + 번호 단조증가` → 섹션으로 채택.
 *
 * 서식(bold 등) 검사는 수행하지 않는다. 서식 품질은 별도 레이어(validate)가
 * 판단하며 JSON 구조에 영향 주지 않는다.
 */
function convert(docXml: string, numMap: NumMap): ConvertResult {
  const parsed = loadXml(docXml);
  const doc = findFirst(parsed, 'w:document');
  if (!doc) throw new Error('w:document 요소 없음');
  const body = findFirst(getChildren(doc), 'w:body');
  if (!body) throw new Error('w:body 요소 없음');

  let container = getChildren(body);
  const wrapper = findFirst(container, 'w:tbl');
  if (wrapper) {
    const findBigCell = (nodes: Node[]): Node | null => {
      for (const n of nodes || []) {
        if (getTag(n) === 'w:tc' && getChildren(n).length > 10) return n;
        const found = findBigCell(getChildren(n));
        if (found) return found;
      }
      return null;
    };
    const inner = findBigCell(getChildren(wrapper));
    if (inner) container = getChildren(inner);
  }

  const headers: string[] = [];
  const contents: Doc['contents'] = [];
  const sectionMetas: SectionMeta[] = [];
  const normalizeCounters: NormalizeCounters = { smartQuotesReplaced: 0 };
  let current: Doc['contents'][number] | null = null;
  const nstate = new NumberingState(numMap);
  let seenDocTitle = false;
  let inIntro = true;
  let lastSectionNum = 0;

  for (const child of container) {
    const tag = getTag(child);
    if (tag === 'w:p') {
      // text: `<s>` 포함된 표시용. textPlain: 정규식 매칭용.
      const text = paragraphText(child).trim();
      if (!text) continue;
      const textPlain = stripStrike(text).trim();

      const align = paragraphAlign(child);
      if (!seenDocTitle && align === 'center' && isDocTitle(textPlain)) {
        seenDocTitle = true;
        continue;
      }

      const sec = matchSection(textPlain);
      if (sec && sec.num > lastSectionNum) {
        const title = formatSectionTitle(sec.lang, sec.num, sec.title);
        const headingLen = sec.rest
          ? Math.max(1, textPlain.length - sec.rest.length)
          : textPlain.length;
        inIntro = false;
        lastSectionNum = sec.num;
        current = { title, lines: [] };
        contents.push(current);
        sectionMetas.push({
          num: sec.num,
          title,
          lang: sec.lang,
          rawNum: sec.rawNum,
          paragraph: child,
          headingLen,
        });
        if (sec.rest) {
          const rest = normalizeLine(sec.rest, normalizeCounters);
          if (rest) current.lines.push(rest);
        }
        continue;
      }
      // sec && sec.num <= lastSectionNum → Word 번호 템플릿 중복 헤딩. 본문으로 흘려보냄.

      const [nid, ilvl] = paragraphNumInfo(child);
      let line = text;
      if (nid) line = nstate.prefix(nid, ilvl) + text;
      line = normalizeLine(line, normalizeCounters);
      if (!line) continue;

      if (inIntro) headers.push(line);
      else if (current) current.lines.push(line);
    } else if (tag === 'w:tbl') {
      const html = tableToHtml(child);
      if (!html) continue;
      if (inIntro) headers.push(html);
      else if (current) current.lines.push(html);
    }
  }

  return { doc: { headers, contents }, sectionMetas, normalizeCounters };
}

// --- Public API -----------------------------------------------------------

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

export type DocxParseResult = {
  doc: Doc;
  info: string[];
  /** 파서/정규화 단계에서 이미 JSON 에 반영되었거나, 내보내기 시 에디터의
   *  일관된 포맷으로 자동 정상화되는 관찰 항목. 사용자 조치 불필요. */
  autoFixes: string[];
  /** JSON 본문에 원본 그대로 남아있어 사용자 검토가 필요한 항목. */
  issues: Issue[];
};

export async function parseDocx(
  source: File | Blob | ArrayBuffer,
): Promise<DocxParseResult> {
  const zip = await JSZip.loadAsync(source);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) throw new Error('word/document.xml 을 찾을 수 없습니다.');
  const docXml = await docEntry.async('string');

  const numEntry = zip.file('word/numbering.xml');
  const numMap = numEntry ? parseNumbering(await numEntry.async('string')) : {};

  const { doc, sectionMetas, normalizeCounters } = convert(docXml, numMap);
  const { info, autoFixes, issues } = validate(doc, sectionMetas, normalizeCounters);
  return { doc, info, autoFixes, issues };
}

/**
 * 검증 레이어.
 * 파서 출력(JSON)과 원본 메타를 대조해 품질 경고만 생성한다.
 * JSON 구조는 건드리지 않으며, 경고 유무는 JSON 내용에 영향 없음.
 *
 * 경고 기준은 "절대 규칙 위반" 이 아니라 **"같은 문서 내 다른 헤딩과의 일관성"**.
 * 예: 14개 헤딩 중 5개가 bold, 9개가 non-bold 라면 "스타일이 혼재"가 문제이며,
 *     어느 쪽이 '정답'인지 파서가 판정하지 않는다(다수 쪽을 기준으로 소수 outlier 만 표시).
 *
 * 결과는 `autoFixes` 와 `issues` 두 갈래로 분리한다.
 *
 *   - `autoFixes` : JSON 에 이미 반영되었거나, 에디터에서 수정 없이 그대로
 *     다시 내보내도 일관된 포맷으로 정상화되는 관찰 항목. 사용자 조치 불필요.
 *     예) 헤딩 bold 불일치(내보내기 시 에디터 헤딩 포맷으로 통일),
 *         번호 공백 정상화(`第1 1条` → `11`, JSON 에 반영됨),
 *         스마트따옴표 치환(JSON 에 반영됨).
 *
 *   - `issues` : JSON 본문에 원본 그대로 남아있어 의미 수정이 필요한 항목.
 *     예) 섹션 번호 누락/중복, 빈 섹션, 본문 번호 스타일/도트 문자 혼재,
 *         취소선 잔존.
 */
/** 본문 줄 앞머리에 쓰인 번호 스타일 패턴. 문서 내 혼재 감지용. */
const NUMBER_STYLES: { name: string; re: RegExp }[] = [
  { name: '①②③ (원문자)', re: /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/ },
  { name: '(1) (전괄호)', re: /^\(\d+\)\s/ },
  { name: '1) (반괄호)', re: /^\d+\)\s/ },
  { name: '1. (마침표)', re: /^\d+\.\s/ },
  { name: '가. (한글)', re: /^[가-힣]\.\s/ },
  { name: 'ⅰ) (로마소)', re: /^[ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]\)/ },
  { name: 'Ⅰ) (로마대)', re: /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\)/ },
];

function detectNumberStyle(line: string): string | null {
  const probe = stripStrike(line).trimStart();
  for (const { name, re } of NUMBER_STYLES) {
    if (re.test(probe)) return name;
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

  // (6) 번호 스타일 혼재
  const styleUse = new Map<string, number>();
  for (const o of origins) {
    if (o.text.startsWith('<table')) continue;
    const s = detectNumberStyle(o.text);
    if (s) styleUse.set(s, (styleUse.get(s) || 0) + 1);
  }
  if (styleUse.size >= 2) {
    const sortedStyles = [...styleUse.entries()].sort((a, b) => b[1] - a[1]);
    const [majorityStyle] = sortedStyles[0];
    const styleRefs: IssueRef[] = [];
    for (const o of origins) {
      if (o.text.startsWith('<table')) continue;
      const s = detectNumberStyle(o.text);
      if (s && s !== majorityStyle) styleRefs.push(refForLine(o));
    }
    const list = sortedStyles.map(([s, n]) => `${s} ${n}건`).join(', ');
    issues.push({
      message: `번호 스타일이 일관되지 않습니다: ${list}. 다수(${majorityStyle}) 외 outlier 위치를 표시.`,
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
  //      (파서 autoFix 의 "N개 치환됨" 카운터와는 별개. 그쪽은 히스토리,
  //       이쪽은 "지금 JSON 에 있나" 를 본다.)
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

function validate(
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

