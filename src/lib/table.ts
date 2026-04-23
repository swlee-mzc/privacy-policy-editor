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

/**
 * 격자 좌표계 빌드. HTML 테이블의 `rowspan`/`colspan` 때문에
 * (배열 인덱스 → 시각적 격자) 매핑이 1:1 이 아니라는 문제를 흡수한다.
 *
 * - `grid[gr][gc]` 는 시각적 격자 위치 (gr, gc) 에 실제로 렌더되는 origin 셀의
 *   (rowIdx, cellIdx) 를 가리킨다. 즉 병합으로 흡수된 위치도 조회 가능.
 * - `isOrigin` 은 origin 셀의 좌상단 격자 위치일 때만 true.
 * - `width` 는 각 row 의 콜 합 중 최대값 (비일관 격자라면 가장 넓은 행 기준).
 */
type GridCell = { rowIdx: number; cellIdx: number; isOrigin: boolean };
type Grid = {
  cells: (GridCell | null)[][];
  width: number;
  rowWidths: number[];
};

export function buildTableGrid(rows: TableRow[]): Grid {
  const cells: (GridCell | null)[][] = rows.map(() => []);
  const occupied: boolean[][] = rows.map(() => []);
  const rowWidths = new Array<number>(rows.length).fill(0);

  for (let r = 0; r < rows.length; r++) {
    let c = 0;
    for (let i = 0; i < rows[r].cells.length; i++) {
      const cell = rows[r].cells[i];
      while (occupied[r][c]) c++;
      for (let dr = 0; dr < cell.rowspan; dr++) {
        for (let dc = 0; dc < cell.colspan; dc++) {
          const gr = r + dr;
          const gc = c + dc;
          if (gr >= rows.length) continue;
          cells[gr][gc] = { rowIdx: r, cellIdx: i, isOrigin: dr === 0 && dc === 0 };
          occupied[gr][gc] = true;
        }
      }
      c += cell.colspan;
      if (c > rowWidths[r]) rowWidths[r] = c;
    }
  }
  return { cells, width: Math.max(0, ...rowWidths), rowWidths };
}

function findOriginGridPos(
  grid: Grid,
  rowIdx: number,
  cellIdx: number,
): { gr: number; gc: number } | null {
  for (let r = 0; r < grid.cells.length; r++) {
    for (let c = 0; c < grid.cells[r].length; c++) {
      const g = grid.cells[r][c];
      if (g && g.isOrigin && g.rowIdx === rowIdx && g.cellIdx === cellIdx) {
        return { gr: r, gc: c };
      }
    }
  }
  return null;
}

function gridColumnToInsertIdx(grid: Grid, rowIdx: number, targetGc: number): number {
  let count = 0;
  const row = grid.cells[rowIdx] || [];
  for (let c = 0; c < targetGc; c++) {
    const g = row[c];
    if (g && g.isOrigin && g.rowIdx === rowIdx) count++;
  }
  return count;
}

function emptyCellLike(tag: 'th' | 'td'): TableCell {
  return { tag, className: '', rowspan: 1, colspan: 1, html: '' };
}

/**
 * 셀의 rowspan/colspan 을 `newR x newC` 로 변경. 격자 일관성 자동 유지.
 *
 * - 확장: 새 사각 영역에 들어가는 다른 origin 셀들을 제거 (흡수).
 *   해당 셀들의 span 이 새 사각 영역을 **완전히 벗어나면** 변경 불가 → null.
 *   표 경계 초과도 null.
 * - 축소: 비워지는 격자 위치마다 빈 셀을 해당 행의 적절한 배열 인덱스에 삽입.
 *   빈 셀의 tag 는 해당 행의 기존 셀 tag 를 따른다 (thead 면 th, 아니면 td).
 *
 * 반환값이 null 이면 호출 측은 변경을 적용하지 않아야 한다.
 */
export function setCellSpan(
  data: TableData,
  rowIdx: number,
  cellIdx: number,
  newR: number,
  newC: number,
): TableData | null {
  if (newR < 1 || newC < 1) return null;
  const grid = buildTableGrid(data.rows);
  const origin = findOriginGridPos(grid, rowIdx, cellIdx);
  if (!origin) return null;
  const { gr, gc } = origin;

  const target = data.rows[rowIdx].cells[cellIdx];
  const oldR = target.rowspan;
  const oldC = target.colspan;

  if (gr + newR > data.rows.length) return null;
  if (gc + newC > grid.width) return null;

  const absorbed = new Map<string, { r: number; i: number }>();
  for (let r = gr; r < gr + newR; r++) {
    for (let c = gc; c < gc + newC; c++) {
      const g = grid.cells[r]?.[c];
      if (!g) continue;
      if (g.rowIdx === rowIdx && g.cellIdx === cellIdx) continue;
      const key = `${g.rowIdx}:${g.cellIdx}`;
      if (!absorbed.has(key)) absorbed.set(key, { r: g.rowIdx, i: g.cellIdx });
    }
  }

  for (const { r, i } of absorbed.values()) {
    const pos = findOriginGridPos(grid, r, i);
    if (!pos) return null;
    const oc = data.rows[r].cells[i];
    if (pos.gr < gr || pos.gr + oc.rowspan > gr + newR) return null;
    if (pos.gc < gc || pos.gc + oc.colspan > gc + newC) return null;
  }

  const newRows: TableRow[] = data.rows.map((row) => ({
    ...row,
    cells: [...row.cells],
  }));

  const removalsByRow = new Map<number, number[]>();
  for (const { r, i } of absorbed.values()) {
    if (!removalsByRow.has(r)) removalsByRow.set(r, []);
    removalsByRow.get(r)!.push(i);
  }
  for (const [r, idxs] of removalsByRow) {
    idxs.sort((a, b) => b - a).forEach((i) => newRows[r].cells.splice(i, 1));
  }

  newRows[rowIdx].cells[cellIdx] = { ...target, rowspan: newR, colspan: newC };

  if (oldR > newR || oldC > newC) {
    const gridAfterRemoval = buildTableGrid(newRows);
    type Insert = { r: number; gc: number; tag: 'th' | 'td' };
    const inserts: Insert[] = [];
    for (let dr = 0; dr < oldR; dr++) {
      const r = gr + dr;
      const rowTag: 'th' | 'td' = newRows[r].isHead ? 'th' : 'td';
      for (let dc = 0; dc < oldC; dc++) {
        const c = gc + dc;
        const insideNew = dr < newR && dc < newC;
        if (insideNew) continue;
        inserts.push({ r, gc: c, tag: rowTag });
      }
    }
    const groupedByRow = new Map<number, Insert[]>();
    for (const ins of inserts) {
      if (!groupedByRow.has(ins.r)) groupedByRow.set(ins.r, []);
      groupedByRow.get(ins.r)!.push(ins);
    }
    for (const [r, list] of groupedByRow) {
      list.sort((a, b) => a.gc - b.gc);
      let insertAt = gridColumnToInsertIdx(gridAfterRemoval, r, list[0].gc);
      for (const ins of list) {
        newRows[r].cells.splice(insertAt, 0, emptyCellLike(ins.tag));
        insertAt++;
      }
    }
  }

  return { ...data, rows: newRows };
}

/**
 * 격자 일관성 검사. 비어 있는 위치(구멍)가 있거나 행별 너비가 불일치하는 경우를 탐지.
 * 반환: 문제 설명 배열. 비어 있으면 일관된 격자.
 */
export function validateTableGrid(data: TableData): string[] {
  const grid = buildTableGrid(data.rows);
  const issues: string[] = [];
  if (data.rows.length === 0) return issues;

  const width = grid.width;
  for (let r = 0; r < data.rows.length; r++) {
    if (grid.rowWidths[r] !== width) {
      issues.push(`행 ${r + 1}: 너비 ${grid.rowWidths[r]} (기대 ${width})`);
    }
    for (let c = 0; c < width; c++) {
      if (!grid.cells[r][c]) {
        issues.push(`행 ${r + 1} 열 ${c + 1}: 빈 격자 (span 누락)`);
      }
    }
  }
  return issues;
}

export function cloneLastBodyRow(data: TableData): TableRow | null {
  for (let i = data.rows.length - 1; i >= 0; i--) {
    const r = data.rows[i];
    if (!r.isHead) {
      return {
        isHead: false,
        className: r.className,
        cells: r.cells.map((c) => ({
          tag: c.tag,
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

/**
 * 셀의 `<td>` ↔ `<th>` 전환. tbody 셀 한정으로 `table-secondary` 클래스를 동기화한다.
 * - td → th (tbody): tag=th, class 에 `table-secondary` 추가
 * - th → td (tbody): tag=td, class 에서 `table-secondary` 제거
 * - thead 셀은 구조상 th 가 강제되므로 호출 측에서 방어 (아무 동작 안 함 권장)
 */
export function toggleCellHeader(
  data: TableData,
  rowIdx: number,
  cellIdx: number,
): TableData {
  const row = data.rows[rowIdx];
  if (!row) return data;
  if (row.isHead) return data;

  const rows = data.rows.map((r, i) => {
    if (i !== rowIdx) return r;
    const cells = r.cells.map((c, j) => {
      if (j !== cellIdx) return c;
      const nextTag: 'th' | 'td' = c.tag === 'th' ? 'td' : 'th';
      const classes = c.className.split(/\s+/).filter(Boolean);
      let nextClasses: string[];
      if (nextTag === 'th') {
        nextClasses = classes.includes('table-secondary')
          ? classes
          : [...classes, 'table-secondary'];
      } else {
        nextClasses = classes.filter((cls) => cls !== 'table-secondary');
      }
      return { ...c, tag: nextTag, className: nextClasses.join(' ') };
    });
    return { ...r, cells };
  });
  return { ...data, rows };
}
