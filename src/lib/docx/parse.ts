/**
 * DOCX → Doc 파서 (브라우저/Node 공용).
 *
 * 원본: ~/.claude/skills/privacy-convert/scripts/docx2json.mjs (Node).
 * 브라우저 이식:
 *   - unzip(execFileSync) → JSZip
 *   - fs read → File/Blob
 * 그 외 XML 파싱·섹션 분할·표 병합 로직은 동일.
 */
import JSZip from 'jszip';
import type { Doc } from '../../types';
import { convert } from './convert';
import { parseNumbering } from './numbering';
import type { Issue } from './validate';
import { validate } from './validate';

export type DocxParseResult = {
  doc: Doc;
  info: string[];
  /** 파서/정규화 단계에서 이미 JSON 에 반영되었거나, 내보내기 시 에디터의
   *  일관된 포맷으로 자동 정상화되는 관찰 항목. 사용자 조치 불필요. */
  autoFixes: string[];
  /** JSON 본문에 원본 그대로 남아있어 사용자 검토가 필요한 항목. */
  issues: Issue[];
};

export async function parseDocx(
  source: File | Blob | ArrayBuffer,
): Promise<DocxParseResult> {
  const zip = await JSZip.loadAsync(source);
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) throw new Error('word/document.xml 을 찾을 수 없습니다.');
  const docXml = await docEntry.async('string');

  const numEntry = zip.file('word/numbering.xml');
  const numMap = numEntry ? parseNumbering(await numEntry.async('string')) : {};

  const { doc, sectionMetas, normalizeCounters } = convert(docXml, numMap);
  const { info, autoFixes, issues } = validate(doc, sectionMetas, normalizeCounters);
  return { doc, info, autoFixes, issues };
}
