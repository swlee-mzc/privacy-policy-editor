/**
 * w:document XML → Doc 변환.
 *
 * 파서가 채택한 섹션 각각에 대한 원본 메타를 같이 반환해, 검증 레이어가
 * JSON 구조를 건드리지 않고 품질 경고만 생성할 수 있게 한다.
 *
 * 규칙: `정규식 매칭 + 번호 단조증가` → 섹션으로 채택.
 * 서식(bold 등) 검사는 수행하지 않는다.
 */
import type { Doc } from '../../types';
import type { Node } from './xml';
import { findFirst, getChildren, getTag, loadXml } from './xml';
import type { SectionLang } from './section';
import { formatSectionTitle, isDocTitle, matchSection } from './section';
import type { NumMap } from './numbering';
import { NumberingState } from './numbering';
import {
  paragraphAlign,
  paragraphNumInfo,
  paragraphText,
  stripStrike,
} from './paragraph';
import { tableToHtml } from './table-emit';
import type { NormalizeCounters } from './normalize';
import { normalizeLine } from './normalize';

/** `<w:br/>` 로 인해 텍스트에 `<br>` 이 섞여 들어온 경우 여러 라인으로 분리.
 *  셀 내부가 아닌 본문 단락/sec.rest 용. */
function splitBrToLines(text: string, counters: NormalizeCounters): string[] {
  return text
    .split(/<br\s*\/?>/gi)
    .map((part) => normalizeLine(part, counters))
    .filter((l) => l.length > 0);
}

export type SectionMeta = {
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

export type ConvertResult = {
  doc: Doc;
  sectionMetas: SectionMeta[];
  normalizeCounters: NormalizeCounters;
};

export function convert(docXml: string, numMap: NumMap): ConvertResult {
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
          for (const rest of splitBrToLines(sec.rest, normalizeCounters)) {
            current.lines.push(rest);
          }
        }
        continue;
      }
      // sec && sec.num <= lastSectionNum → Word 번호 템플릿 중복 헤딩. 본문으로 흘려보냄.

      const [nid, ilvl] = paragraphNumInfo(child);
      const prefix = nid ? nstate.prefix(nid, ilvl) : '';
      const lines = splitBrToLines(text, normalizeCounters);
      if (lines.length === 0) continue;
      // 번호 접두사는 첫 라인에만 붙이고 재정규화(접두사 자체에 스마트따옴표 없음).
      if (prefix) lines[0] = normalizeLine(prefix + lines[0], normalizeCounters);

      for (const line of lines) {
        if (inIntro) headers.push(line);
        else if (current) current.lines.push(line);
      }
    } else if (tag === 'w:tbl') {
      const html = tableToHtml(child);
      if (!html) continue;
      if (inIntro) headers.push(html);
      else if (current) current.lines.push(html);
    }
  }

  return { doc: { headers, contents }, sectionMetas, normalizeCounters };
}
