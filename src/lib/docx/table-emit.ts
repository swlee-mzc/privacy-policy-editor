/**
 * DOCX `w:tbl` → 간이 HTML `<table>` 방출.
 *
 * `<w:gridSpan>` → colspan, `<w:vMerge w:val="restart">` 시작 + 후속 행의
 * `continue` 들이 같은 열에 있으면 rowspan 으로 묶는다.
 *
 * thead 승격 휴리스틱 (`shouldPromoteThead`):
 *   - 2행 이상 AND 첫 행 2셀 이상 AND 첫 행 모든 셀 짧음(≤30자, br 없음) → thead
 *   - 모든 행이 2셀이고 "라벨:값" 패턴(첫 셀 짧고 둘째 셀이 1.5× 이상 긴) → skip
 *     (LLM/사용자가 `<th class='table-secondary'>` 라벨 표로 수동 변환)
 */
import type { Node } from './xml';
import { findAll, findFirst, getAttrs, getChildren } from './xml';
import { paragraphText } from './paragraph';

export type GridCell = {
  text: string;
  vm: string | null;
  gs: number;
  col: number;
  rowspan: number;
};

export function cellText(cell: Node): string {
  const parts: string[] = [];
  for (const p of findAll(getChildren(cell), 'w:p')) {
    const t = paragraphText(p).trim();
    if (t || parts.length) parts.push(t);
  }
  while (parts.length && !parts[parts.length - 1]) parts.pop();
  return parts.join('<br>');
}

export function cellMerge(cell: Node): { vm: string | null; gs: number } {
  const tcpr = findFirst(getChildren(cell), 'w:tcPr');
  if (!tcpr) return { vm: null, gs: 1 };
  const vmEl = findFirst(getChildren(tcpr), 'w:vMerge');
  const gsEl = findFirst(getChildren(tcpr), 'w:gridSpan');
  const vm = vmEl ? getAttrs(vmEl)['w:val'] || 'continue' : null;
  const gs = gsEl ? parseInt(getAttrs(gsEl)['w:val'] || '1', 10) : 1;
  return { vm, gs };
}

export function tableToHtml(tbl: Node): string {
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

export function shouldPromoteThead(grid: GridCell[][]): boolean {
  if (grid.length < 2) return false;
  const first = grid[0].filter((c) => c.vm !== 'continue');
  if (first.length < 2) return false;
  const allShort = first.every((c) => c.text.length <= 30 && !c.text.includes('<br>'));
  if (!allShort) return false;

  const allTwoCell = grid.every((row) => row.filter((c) => c.vm !== 'continue').length === 2);
  if (allTwoCell) {
    const avgFirst = grid.reduce((a, r) => a + r[0].text.length, 0) / grid.length;
    const avgSecond = grid.reduce((a, r) => a + r[1].text.length, 0) / grid.length;
    if (avgFirst < 20 && avgSecond > avgFirst * 1.5) return false;
  }
  return true;
}

export function emitTable(grid: GridCell[][]): string {
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
