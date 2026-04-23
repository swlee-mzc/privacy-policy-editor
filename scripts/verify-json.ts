/**
 * JSON 파일 검증 스크립트 (Node 전용).
 * usage: pnpm tsx scripts/verify-json.ts <input.json> [<input2.json> ...]
 *
 * 편집기의 validateDoc/buildDocInfo 를 그대로 호출해 구조 이슈를 표면화한다.
 * 여러 파일을 받으면 각각 검증하고, 섹션 수가 같으면 마지막에 교차 정합 요약도 출력한다.
 */
import { readFileSync } from 'node:fs';
import type { Doc } from '../src/types';
import { buildDocInfo, validateDoc } from '../src/lib/docxParse';

function report(path: string, doc: Doc) {
  console.log(`\n=== ${path} ===`);
  const info = buildDocInfo(doc);
  console.log('[INFO]');
  info.forEach((s) => console.log('  -', s));
  const issues = validateDoc(doc);
  if (issues.length) {
    console.log('[REVIEW]');
    issues.forEach((iss) => {
      console.log('  !', iss.message);
      if (iss.refs.length) {
        console.log('      →', iss.refs.map((r) => r.label).join(', '));
      }
    });
  } else {
    console.log('✓ 구조 이상 없음');
  }
}

function loadDoc(path: string): Doc {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Doc;
  if (!parsed.headers || !parsed.contents) {
    throw new Error(`${path}: headers/contents 없음`);
  }
  return parsed;
}

function main() {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.error('usage: tsx scripts/verify-json.ts <input.json> [<input2.json> ...]');
    process.exit(1);
  }
  const docs = paths.map((p) => ({ path: p, doc: loadDoc(p) }));
  for (const { path, doc } of docs) report(path, doc);

  if (docs.length >= 2) {
    console.log('\n=== 교차 정합 ===');
    const base = docs[0];
    const baseSecCount = base.doc.contents.length;
    const baseLineCounts = base.doc.contents.map((c) => c.lines.length);
    for (let i = 1; i < docs.length; i++) {
      const other = docs[i];
      const label = `${base.path.split('/').pop()} vs ${other.path.split('/').pop()}`;
      const secDiff = other.doc.contents.length - baseSecCount;
      if (secDiff !== 0) {
        console.log(`! [${label}] 섹션 수 불일치: ${baseSecCount} vs ${other.doc.contents.length}`);
      }
      const diffs: string[] = [];
      const common = Math.min(baseSecCount, other.doc.contents.length);
      for (let s = 0; s < common; s++) {
        const dl = other.doc.contents[s].lines.length - baseLineCounts[s];
        if (dl !== 0) {
          diffs.push(`  제${s + 1}조: lines ${baseLineCounts[s]} vs ${other.doc.contents[s].lines.length} (Δ${dl > 0 ? '+' : ''}${dl})`);
        }
      }
      if (diffs.length) {
        console.log(`! [${label}] 라인 수 차이:`);
        diffs.forEach((d) => console.log(d));
      } else if (secDiff === 0) {
        console.log(`✓ [${label}] 섹션·라인 수 일치`);
      }
    }
  }
}

main();
