import type { TableCell, TableData, TableRow } from '../types';
import { brToNewline, newlineToBr } from './line';

/**
 * DOM-free 테이블 파서. 브라우저(`document`)·Node 모두에서 동작한다.
 * 에디터 JSON 의 표 구조가 매우 제한적이라는 전제에서 동작:
 * - 중첩 `<table>` 없음
 * - 셀(`<th>/<td>`) 안에 다른 셀 없음 (HTML 시맨틱상도 금지)
 * - 어트리뷰트는 `class`, `rowspan`, `colspan` 만 사용
 * - 셀 본문은 `<b>/<s>/<span>/<br>` 인라인만, `</th|td>` 를 닫는 것은 단 하나
 *
 * 이 가정이 깨지면 파서를 교체해야 한다 (e.g. htmlparser2).
 */
export function parseTable(html: string): TableData | null {
  const tableOpen = /<table\b([^>]*)>/i.exec(html);
  if (!tableOpen) return null;
  const tableCloseIdx = html.lastIndexOf('</table>');
  if (tableCloseIdx < 0) return null;

  const tableAttrs = parseAttrs(tableOpen[1]);
  const inner = html.slice(tableOpen.index + tableOpen[0].length, tableCloseIdx);

  const theadMatch = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(inner);
  const hasThead = theadMatch !== null;

  const rows: TableRow[] = [];
  if (theadMatch) {
    rows.push(...extractRows(theadMatch[1], true));
  }
  const tbodyMatch = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(inner);
  const bodySrc = tbodyMatch
    ? tbodyMatch[1]
    : inner.replace(/<thead\b[^>]*>[\s\S]*?<\/thead>/i, '');
  rows.push(...extractRows(bodySrc, false));

  return {
    className: tableAttrs.class ?? '',
    hasThead,
    rows,
  };
}

function extractRows(src: string, isHead: boolean): TableRow[] {
  const out: TableRow[] = [];
  const TR = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = TR.exec(src)) !== null) {
    const attrs = parseAttrs(m[1]);
    out.push({
      isHead,
      className: attrs.class ?? '',
      cells: extractCells(m[2]),
    });
  }
  return out;
}

function extractCells(rowInner: string): TableCell[] {
  const out: TableCell[] = [];
  const CELL = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = CELL.exec(rowInner)) !== null) {
    const attrs = parseAttrs(m[2]);
    out.push({
      tag: m[1].toLowerCase() as 'th' | 'td',
      className: attrs.class ?? '',
      rowspan: parseInt(attrs.rowspan ?? '1', 10) || 1,
      colspan: parseInt(attrs.colspan ?? '1', 10) || 1,
      html: brToNewline(m[3]),
    });
  }
  return out;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const RE = /([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(s)) !== null) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

export function serializeTable(data: TableData): string {
  const parts: string[] = [`<table class='${data.className}'>`];
  const theadRows = data.rows.filter((r) => r.isHead);
  const tbodyRows = data.rows.filter((r) => !r.isHead);

  const renderCell = (c: TableCell): string => {
    const attrs: string[] = [];
    if (c.rowspan > 1) attrs.push(`rowspan='${c.rowspan}'`);
    if (c.colspan > 1) attrs.push(`colspan='${c.colspan}'`);
    if (c.className) attrs.push(`class='${c.className}'`);
    const attr = attrs.length ? ' ' + attrs.join(' ') : '';
    return `<${c.tag}${attr}>${newlineToBr(c.html)}</${c.tag}>`;
  };

  const renderRow = (row: TableRow): string => {
    const cls = row.className ? ` class='${row.className}'` : '';
    return `<tr${cls}>${row.cells.map(renderCell).join('')}</tr>`;
  };

  if (theadRows.length) {
    parts.push('<thead>' + theadRows.map(renderRow).join('') + '</thead>');
  }
  parts.push('<tbody>' + tbodyRows.map(renderRow).join('') + '</tbody>');
  parts.push('</table>');
  return parts.join('');
}

export function cloneLastBodyRow(data: TableData): TableRow | null {
  for (let i = data.rows.length - 1; i >= 0; i--) {
    const r = data.rows[i];
    if (!r.isHead) {
      return {
        isHead: false,
        className: r.className,
        cells: r.cells.map((c) => ({
          tag: c.tag === 'th' ? 'td' : c.tag,
          className: c.className,
          rowspan: 1,
          colspan: c.colspan,
          html: '',
        })),
      };
    }
  }
  return null;
}
