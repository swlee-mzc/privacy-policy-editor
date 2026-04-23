/**
 * JSON → DOCX 내보내기 스크립트 (Node 전용).
 * usage: pnpm tsx scripts/export-docx.ts <input.json> [<output.docx>]
 *
 * 편집기 UI 의 "DOCX..." 내보내기와 동일 함수(`toDocxBlob`) 를 사용한다.
 * 문서 제목은 첫 섹션 제목 패턴으로 언어 감지 (KO/JA/EN).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Doc } from '../src/types';
import { toDocxBlob } from '../src/lib/docx';

async function main() {
  const [, , src, outArg] = process.argv;
  if (!src) {
    console.error('usage: tsx scripts/export-docx.ts <input.json> [<output.docx>]');
    process.exit(1);
  }
  const out = outArg ?? src.replace(/\.json$/i, '.docx');

  const doc = JSON.parse(readFileSync(src, 'utf8')) as Doc;
  if (!doc.headers || !doc.contents) {
    throw new Error(`${src}: headers/contents 없음`);
  }

  const blob = await toDocxBlob(doc);
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync(out, buf);
  console.log('✓ wrote', out, `(${buf.length.toLocaleString()} bytes)`);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
