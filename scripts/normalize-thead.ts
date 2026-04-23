/**
 * JSON 내 모든 표에 대해 thead 승격 일관성을 맞춘다.
 * 규칙:
 *   - 이미 thead 가 있으면 건드리지 않는다.
 *   - 첫 행에 `<th>` 가 있고 rowspan>1 이면 좌측 라벨(rowheader) 패턴 → 건드리지 않는다.
 *   - 2행 이상이고 첫 행이 전부 `<td>` 또는 (rowspan=1 의) `<th>` 로만 구성되어 있으면
 *     첫 행을 thead 로 승격 + `<tr class='table-secondary'>` + 셀을 `<th>` 로.
 *   - thead 로 올라간 셀 안의 `<br>` 는 한 줄로 결합.
 *
 * usage: pnpm tsx scripts/normalize-thead.ts <json...>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Doc } from '../src/types';
import { parseTable, serializeTable } from '../src/lib/table';

function promoteTable(html: string): { html: string; changed: boolean } {
  const data = parseTable(html);
  if (!data) return { html, changed: false };
  if (data.hasThead) return { html, changed: false };

  const first = data.rows[0];
  if (!first) return { html, changed: false };

  // (1) 1행 2셀 "label(단일 라인) + value(멀티 라인)" 패턴 → 수직 스택으로 재구성.
  //   원문 기준(KO/JA) 1열 2행 thead+tbody 구조에 맞춘다.
  if (
    data.rows.length === 1 &&
    first.cells.length === 2 &&
    !first.cells[0].html.includes('\n') &&
    first.cells[1].html.includes('\n')
  ) {
    const labelCell = { ...first.cells[0], tag: 'th' as const, className: '' };
    const dataCell = { ...first.cells[1], tag: 'td' as const, className: '' };
    data.rows = [
      { isHead: true, className: 'table-secondary', cells: [labelCell] },
      { isHead: false, className: '', cells: [dataCell] },
    ];
    return { html: serializeTable(data), changed: true };
  }

  // (2) 2행 이상 일반 상단 헤더 패턴 → 첫 행 thead 승격.
  if (data.rows.length < 2) return { html, changed: false };
  const isLeftLabel = first.cells.some((c) => c.tag === 'th' && c.rowspan > 1);
  if (isLeftLabel) return { html, changed: false };

  first.isHead = true;
  const classes = first.className.split(/\s+/).filter(Boolean);
  if (!classes.includes('table-secondary')) classes.push('table-secondary');
  first.className = classes.join(' ');

  for (const c of first.cells) {
    c.tag = 'th';
    c.html = c.html.replace(/\n+/g, '');
    c.className = c.className
      .split(/\s+/)
      .filter((x) => x && x !== 'table-secondary')
      .join(' ');
  }

  return { html: serializeTable(data), changed: true };
}

function processDoc(doc: Doc): { doc: Doc; changes: number } {
  let changes = 0;
  const contents = doc.contents.map((s) => ({
    ...s,
    lines: s.lines.map((line) => {
      if (!line.includes('<table')) return line;
      const { html, changed } = promoteTable(line);
      if (changed) changes++;
      return html;
    }),
  }));
  return { doc: { ...doc, contents }, changes };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: tsx scripts/normalize-thead.ts <json...>');
  process.exit(1);
}

for (const f of files) {
  const doc = JSON.parse(readFileSync(f, 'utf8')) as Doc;
  const { doc: out, changes } = processDoc(doc);
  writeFileSync(f, JSON.stringify(out, null, 2) + '\n');
  console.log(`✓ ${f} (${changes} tables promoted)`);
}
