/**
 * DOCX `w:tbl` → 간이 HTML `<table>` 방출.
 *
 * `<w:gridSpan>` → colspan, `<w:vMerge w:val="restart">` 시작 + 후속 행의
 * `continue` 들이 같은 열에 있으면 rowspan 으로 묶는다.
 *
 * 헤더 시맨틱 복원 전략:
 *   1) **시맨틱 모드** — DOCX 에 우리가 심은 단서(또는 호환되는 단서) 가 있을 때:
 *      - row 의 `w:trPr > w:tblHeader/` → `<thead>` 의 `<tr class='table-secondary'>`
 *      - cell 의 `w:tcPr > w:shd w:fill='<회색톤>'` → `<th class='table-secondary'>`
 *      export.ts 는 `<th class='table-secondary'>` 을 `w:shd w:fill='E9ECEF'` 로,
 *      `<thead>` 행을 `w:tblHeader/` 로 심는다. round-trip 일관성의 핵심.
 *   2) **휴리스틱 모드** — 시맨틱 단서가 하나도 없을 때(외부/원본 DOCX):
 *      - 2행 이상 AND 첫 행 2셀 이상 AND 첫 행 모든 셀 짧음(≤30자, br 없음) → thead
 *      - 모든 행이 2셀이고 "라벨:값" 패턴(첫 셀 짧고 둘째 셀이 1.5× 이상 긴) → skip
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
  /** `<th class='table-secondary'>` 복원 단서. `w:shd` 가 비어있지 않은 회색톤 채움이면 true. */
  isSecondary: boolean;
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

/**
 * cell 의 shading 이 `<th class='table-secondary'>` 로 복원할 단서인지 판정.
 * export.ts 는 `E9ECEF` 로 심으므로 그 값 근처의 회색톤(채도 낮고 밝은)만 허용.
 */
function cellIsSecondary(cell: Node): boolean {
  const tcpr = findFirst(getChildren(cell), 'w:tcPr');
  if (!tcpr) return false;
  const shd = findFirst(getChildren(tcpr), 'w:shd');
  if (!shd) return false;
  const fill = (getAttrs(shd)['w:fill'] || '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(fill)) return false;
  if (fill === 'ffffff' || fill === '000000') return false;
  const r = parseInt(fill.slice(0, 2), 16);
  const g = parseInt(fill.slice(2, 4), 16);
  const b = parseInt(fill.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // 밝은 회색톤(채도 낮음, 중간~높은 명도). E9ECEF 는 (233,236,239) 로 여기 해당.
  return max - min <= 32 && min >= 160;
}

/** row 의 `w:trPr > w:tblHeader/` 존재 여부. export.ts 의 `tableHeader: true` 와 대칭. */
function rowIsHeader(tr: Node): boolean {
  const trpr = findFirst(getChildren(tr), 'w:trPr');
  if (!trpr) return false;
  return !!findFirst(getChildren(trpr), 'w:tblHeader');
}

export function tableToHtml(tbl: Node): string {
  const rowsXml = findAll(getChildren(tbl), 'w:tr');
  if (!rowsXml.length) return '';

  const grid: GridCell[][] = [];
  const rowHeads: boolean[] = [];
  for (const tr of rowsXml) {
    rowHeads.push(rowIsHeader(tr));
    const row: GridCell[] = [];
    let col = 0;
    for (const tc of findAll(getChildren(tr), 'w:tc')) {
      const { vm, gs } = cellMerge(tc);
      row.push({
        text: cellText(tc),
        vm,
        gs,
        col,
        rowspan: 1,
        isSecondary: cellIsSecondary(tc),
      });
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

  return emitTable(grid, rowHeads);
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

function cellAttr(c: GridCell, extra?: string): string {
  const parts: string[] = [];
  if (c.gs > 1) parts.push(`colspan='${c.gs}'`);
  if (c.rowspan > 1) parts.push(`rowspan='${c.rowspan}'`);
  if (extra) parts.push(extra);
  return parts.length ? ' ' + parts.join(' ') : '';
}

export function emitTable(grid: GridCell[][], rowHeads: boolean[] = []): string {
  const hasSemantic =
    rowHeads.some(Boolean) || grid.some((row) => row.some((c) => c.isSecondary));
  return hasSemantic ? emitSemantic(grid, rowHeads) : emitHeuristic(grid);
}

function emitSemantic(grid: GridCell[][], rowHeads: boolean[]): string {
  const parts: string[] = ["<table class='table table-bordered table-sm'>"];
  // thead 로 승격하는 기준은 `w:tblHeader` 만으로 부족하다. docx 라이브러리/Word 가
  // `tableHeader: true` 를 후속 행까지 전파하는 경우가 있어, 실제 shading 단서까지
  // 모두 갖춘 행만 thead 로 인정한다(= row 의 모든(non-continue) 셀이 isSecondary).
  let theadEnd = 0;
  while (
    theadEnd < grid.length &&
    rowHeads[theadEnd] &&
    grid[theadEnd].filter((c) => c.vm !== 'continue').every((c) => c.isSecondary)
  ) theadEnd++;

  if (theadEnd > 0) {
    parts.push('<thead>');
    for (let ri = 0; ri < theadEnd; ri++) {
      parts.push("<tr class='table-secondary'>");
      for (const c of grid[ri]) {
        if (c.vm === 'continue') continue;
        // thead 내부의 th 는 tr 쪽에 class 가 있으므로 th 자체에는 class 를 붙이지 않음.
        parts.push(`<th${cellAttr(c)}>${c.text}</th>`);
      }
      parts.push('</tr>');
    }
    parts.push('</thead>');
  }

  parts.push('<tbody>');
  for (let ri = theadEnd; ri < grid.length; ri++) {
    parts.push('<tr>');
    for (const c of grid[ri]) {
      if (c.vm === 'continue') continue;
      if (c.isSecondary) {
        parts.push(`<th${cellAttr(c, "class='table-secondary'")}>${c.text}</th>`);
      } else {
        parts.push(`<td${cellAttr(c)}>${c.text}</td>`);
      }
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');
  return parts.join('');
}

function emitHeuristic(grid: GridCell[][]): string {
  const promote = shouldPromoteThead(grid);
  const parts = ["<table class='table table-bordered table-sm'>"];

  if (promote) {
    parts.push('<thead>');
    parts.push("<tr class='table-secondary'>");
    for (const c of grid[0]) {
      if (c.vm === 'continue') continue;
      parts.push(`<th${cellAttr(c)}>${c.text}</th>`);
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
      parts.push(`<td${cellAttr(c)}>${c.text}</td>`);
    }
    parts.push('</tr>');
  }
  parts.push('</tbody></table>');
  return parts.join('');
}
