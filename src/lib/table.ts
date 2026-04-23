import type { TableCell, TableData, TableRow } from '../types';
import { brToNewline, newlineToBr } from './line';

export function parseTable(html: string): TableData | null {
  const div = document.createElement('div');
  div.innerHTML = html;
  const table = div.querySelector('table');
  if (!table) return null;

  const hasThead = !!table.querySelector('thead');
  const rows: TableRow[] = [];

  const processRow = (tr: HTMLTableRowElement, isHead: boolean): TableRow => {
    const cells: TableCell[] = [];
    tr.querySelectorAll(':scope > th, :scope > td').forEach((el) => {
      const cell = el as HTMLTableCellElement;
      cells.push({
        tag: cell.tagName.toLowerCase() as 'th' | 'td',
        className: cell.getAttribute('class') || '',
        rowspan: parseInt(cell.getAttribute('rowspan') || '1', 10),
        colspan: parseInt(cell.getAttribute('colspan') || '1', 10),
        html: brToNewline(cell.innerHTML),
      });
    });
    return { isHead, className: tr.getAttribute('class') || '', cells };
  };

  if (hasThead) {
    table.querySelectorAll('thead > tr').forEach((tr) => {
      rows.push(processRow(tr as HTMLTableRowElement, true));
    });
  }
  table.querySelectorAll('tbody > tr').forEach((tr) => {
    rows.push(processRow(tr as HTMLTableRowElement, false));
  });

  return {
    className: table.getAttribute('class') || '',
    hasThead,
    rows,
  };
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
