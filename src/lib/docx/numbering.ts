/**
 * w:numbering.xml 파싱 및 런타임 카운터.
 * 번호 매기기 스타일(`%1.`, `%1)`) 을 상위 convert 단계가 실제 번호로 치환해
 * JSON 라인 prefix 로 반영한다.
 */
import {
  findAll,
  findFirst,
  getChildren,
  getAttrs,
  loadXml,
} from './xml';

export type NumMap = Record<string, Record<string, string>>;

export function parseNumbering(xml: string): NumMap {
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

export class NumberingState {
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
