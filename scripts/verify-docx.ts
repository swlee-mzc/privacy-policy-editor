/**
 * DOCX 파서 검증 스크립트 (Node 전용).
 * usage: pnpm tsx scripts/verify-docx.ts <input.docx> [out.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDocx } from '../src/lib/docxParse';

async function main() {
  const [, , src, out] = process.argv;
  if (!src) {
    console.error('usage: tsx scripts/verify-docx.ts <input.docx> [out.json]');
    process.exit(1);
  }
  const buf = readFileSync(src);
  const { doc, info, autoFixes, issues } = await parseDocx(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  );
  console.log('[INFO]');
  info.forEach((s) => console.log('  -', s));
  if (autoFixes.length) {
    console.log('[AUTO-FIX]');
    autoFixes.forEach((s) => console.log('  ✓', s));
  }
  if (issues.length) {
    console.log('[REVIEW]');
    issues.forEach((iss) => {
      console.log('  !', iss.message);
      if (iss.refs.length) {
        const labels = iss.refs.map((r) => r.label).join(', ');
        console.log('      →', labels);
      }
    });
  } else if (!autoFixes.length) {
    console.log('✓ 구조 이상 없음');
  }
  const json = JSON.stringify(doc, null, 2);
  if (out) {
    writeFileSync(out, json + '\n', 'utf8');
    console.log('✓ wrote', out);
  } else {
    console.log('--- preview (first section) ---');
    console.log(JSON.stringify(doc.contents[0], null, 2).slice(0, 500));
  }
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
