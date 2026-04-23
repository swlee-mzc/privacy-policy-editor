import type { Doc } from '../types';
import { getDepth, unwrapDepth } from './depth';

/** JSON 문자열로 직렬화 */
export function toJson(doc: Doc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Markdown 내보내기.
 * 테이블은 GFM 표로 변환. rowspan/colspan은 GFM 미지원이므로 셀에 값을 그대로 전개(중복)한다.
 */
export function toMarkdown(doc: Doc): string {
  const out: string[] = [];
  out.push('# 개인정보 처리방침', '');

  (doc.headers || []).forEach((h) => {
    const clean = stripTags(h);
    if (clean.trim()) out.push(clean, '');
  });

  (doc.contents || []).forEach((section) => {
    out.push(`## ${section.title}`, '');
    (section.lines || []).forEach((line) => {
      const t = line.trim();
      if (!t) return;
      const depth = getDepth(line);
      const inner = depth > 0 ? unwrapDepth(line).trim() : line;
      const pad = depth > 0 ? '  '.repeat(depth) : '';
      if (inner.startsWith('<table')) {
        const md = tableHtmlToMarkdown(inner);
        out.push(pad ? md.split('\n').map((l) => pad + l).join('\n') : md, '');
      } else {
        out.push(pad + stripTags(inner), '');
      }
    });
  });
  return out.join('\n').trim() + '\n';
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?b>/gi, '**')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function tableHtmlToMarkdown(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  const table = div.querySelector('table');
  if (!table) return stripTags(html);

  const headerCells: string[] = [];
  table.querySelectorAll(':scope > thead > tr > th, :scope > thead > tr > td').forEach((c) => {
    headerCells.push(stripTags(c.innerHTML).replace(/\n+/g, ' ').trim());
  });

  const bodyRows: string[][] = [];
  let colCount = headerCells.length;

  const collectBody = (rows: NodeListOf<Element>) => {
    rows.forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll(':scope > th, :scope > td').forEach((c) => {
        cells.push(stripTags(c.innerHTML).replace(/\n+/g, ' ').trim());
      });
      bodyRows.push(cells);
      colCount = Math.max(colCount, cells.length);
    });
  };
  collectBody(table.querySelectorAll(':scope > tbody > tr'));

  // thead 가 없으면 첫 행을 헤더로 승격
  if (headerCells.length === 0 && bodyRows.length > 0) {
    const first = bodyRows.shift();
    if (first) {
      first.forEach((c) => headerCells.push(c));
      colCount = Math.max(colCount, headerCells.length);
    }
  }
  while (headerCells.length < colCount) headerCells.push('');

  const lines: string[] = [];
  lines.push('| ' + headerCells.join(' | ') + ' |');
  lines.push('|' + headerCells.map(() => '---').join('|') + '|');
  bodyRows.forEach((row) => {
    const padded = [...row];
    while (padded.length < colCount) padded.push('');
    lines.push('| ' + padded.join(' | ') + ' |');
  });
  return lines.join('\n');
}
