/**
 * DOCX ↔ Doc 파서/내보내기 공개 API.
 * 상위 모듈은 반드시 이 인덱스만 임포트한다.
 */
export { parseDocx } from './parse';
export type { DocxParseResult } from './parse';
export { buildDocInfo, validateDoc } from './validate';
export type { Issue, IssueRef } from './validate';
export { toDocxBlob } from './export';
