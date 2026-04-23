export type Section = {
  title: string;
  lines: string[];
};

export type Doc = {
  headers: string[];
  contents: Section[];
};

export type LineKind = 'empty' | 'table' | 'html' | 'text';

export type TableCell = {
  tag: 'th' | 'td';
  className: string;
  rowspan: number;
  colspan: number;
  html: string;
};

export type TableRow = {
  isHead: boolean;
  className: string;
  cells: TableCell[];
};

export type TableData = {
  className: string;
  hasThead: boolean;
  rows: TableRow[];
};

import type { Issue } from './lib/docxParse';

export type DocMeta = {
  source: 'docx' | 'json';
  fileName: string;
  info: string[];
  /** 파서/정규화 단계에서 이미 JSON 에 반영되었거나, 내보내기 시 에디터의
   *  일관된 포맷으로 자동 정상화되는 관찰 항목. 사용자 조치 불필요. */
  autoFixes: string[];
  /** JSON 본문에 원본 그대로 남아있어 사용자 검토가 필요한 항목. 위치 앵커 포함. */
  issues: Issue[];
};
