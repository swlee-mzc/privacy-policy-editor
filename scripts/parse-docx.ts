/**
 * DOCX → JSON 임시 변환 스크립트 (round-trip 검증용).
 * 웹 업로드 경로(`parseDocx`) 와 동일한 파서를 씀.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDocx } from '../src/lib/docx';

async function main() {
  const [, , src, outArg] = process.argv;
  if (!src) {
    console.error('usage: tsx scripts/parse-docx.ts <input.docx> [<output.json>]');
    process.exit(1);
  }
  const out = outArg ?? src.replace(/\.docx$/i, '.roundtrip.json');
  const buf = readFileSync(src);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const { doc } = await parseDocx(ab);
  writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log('✓ wrote', out);
}

main().catch((e) => { console.error(e); process.exit(1); });
