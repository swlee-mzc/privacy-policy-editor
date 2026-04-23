/**
 * fast-xml-parser (preserveOrder 모드) 출력에 대한 저레벨 탐색 유틸.
 * 이 모듈만 `XMLParser` 의 출력 구조(`{':@': attrs, [tag]: children[]}`) 를
 * 직접 다루고, 상위 모듈은 이 함수들만 사용한다.
 */
import { XMLParser } from 'fast-xml-parser';

export type Node = Record<string, unknown>;

export function getTag(node: Node): string | null {
  for (const k of Object.keys(node)) if (k !== ':@') return k;
  return null;
}

export function getChildren(node: Node): Node[] {
  const tag = getTag(node);
  if (!tag) return [];
  const val = (node as Record<string, unknown>)[tag];
  return Array.isArray(val) ? (val as Node[]) : [];
}

export function getAttrs(node: Node): Record<string, string> {
  return ((node as Record<string, unknown>)[':@'] as Record<string, string>) || {};
}

export function findAll(nodes: Node[] | undefined, tagName: string): Node[] {
  return (nodes || []).filter((n) => getTag(n) === tagName);
}

export function findFirst(nodes: Node[] | undefined, tagName: string): Node | null {
  return (nodes || []).find((n) => getTag(n) === tagName) || null;
}

export function findDeep(nodes: Node[] | undefined, tagName: string): Node | null {
  for (const n of nodes || []) {
    if (getTag(n) === tagName) return n;
    const found = findDeep(getChildren(n), tagName);
    if (found) return found;
  }
  return null;
}

export function collectText(nodes: Node[] | undefined): string {
  let out = '';
  for (const n of nodes || []) {
    const tag = getTag(n);
    if (tag === 'w:t' || tag === 'w:delText') {
      for (const c of getChildren(n)) {
        if ('#text' in c) out += String(c['#text']);
      }
    } else if (tag) {
      out += collectText(getChildren(n));
    }
  }
  return out;
}

export function loadXml(xmlStr: string): Node[] {
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
