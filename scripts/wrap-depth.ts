/**
 * 번호 스타일 레벨을 기준으로 하위 뎁스 라인을 Bootstrap `ml-*` 래퍼로 감싼다.
 * **초기 마이그레이션** 전용 도구 — 이후 뎁스 조작은 에디터의 `←` `→` 화살표로 한다.
 *
 * 래핑 매핑 (한국 법무 문서 관행 기반의 보수적 자동 판정):
 *   level 0 - `1.` `가.` `Ⅰ.` `①②③`       → 래핑 없음 (최상위로 간주)
 *   level 1 - `1)` `(1)` `가)`             → `<p class='ml-4'>…</p>`
 *   level 2 - `ⅰ)` `Ⅰ)`                   → `<p class='ml-5'>…</p>`
 *
 * - 이보다 깊은 레벨(3·4·5) 은 스크립트가 자동 판정하지 않는다.
 *   사용자가 에디터에서 직접 `→` 화살표로 내려간다.
 * - `①②` 가 하위 뎁스로 쓰이는 문서는 사용자가 에디터에서 `→` 로 직접 지정.
 * - 이미 동일 래퍼가 있으면 스킵 (idempotent). 표·빈 라인 무시.
 * - 인라인 HTML(`<b>` 등) 은 래퍼 내부에 그대로 보존.
 *
 * usage: pnpm tsx scripts/wrap-depth.ts <json...>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Doc } from '../src/types';
import { getDepth, wrapDepth, type Depth } from '../src/lib/depth';

const NUMBER_STYLES: { re: RegExp; level: Depth }[] = [
  { re: /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/, level: 0 },
  { re: /^\d+\.\s/, level: 0 },
  { re: /^[가-힣]\.\s/, level: 0 },
  { re: /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\./, level: 0 },
  { re: /^\(\d+\)\s/, level: 4 },
  { re: /^\d+\)\s/, level: 4 },
  { re: /^[가-힣]\)/, level: 4 },
  { re: /^[ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]\)/, level: 5 },
  { re: /^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]\)/, level: 5 },
];

function detectLevel(line: string): Depth | null {
  for (const { re, level } of NUMBER_STYLES) {
    if (re.test(line)) return level;
  }
  return null;
}

function wrapIfSub(line: string): { line: string; changed: boolean } {
  const t = line.trim();
  if (!t) return { line, changed: false };
  if (t.startsWith('<table')) return { line, changed: false };
  if (getDepth(line) > 0) return { line, changed: false };

  const level = detectLevel(t);
  if (level === null || level === 0) return { line, changed: false };

  return { line: wrapDepth(line, level), changed: true };
}

function processDoc(doc: Doc): { doc: Doc; changes: number } {
  let changes = 0;
  const contents = doc.contents.map((s) => ({
    ...s,
    lines: s.lines.map((line) => {
      const r = wrapIfSub(line);
      if (r.changed) changes++;
      return r.line;
    }),
  }));
  const headers = doc.headers.map((h) => {
    const r = wrapIfSub(h);
    if (r.changed) changes++;
    return r.line;
  });
  return { doc: { ...doc, headers, contents }, changes };
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: tsx scripts/wrap-depth.ts <json...>');
  process.exit(1);
}

for (const f of files) {
  const doc = JSON.parse(readFileSync(f, 'utf8')) as Doc;
  const { doc: out, changes } = processDoc(doc);
  writeFileSync(f, JSON.stringify(out, null, 2) + '\n');
  console.log(`✓ ${f} (${changes} lines wrapped)`);
}
