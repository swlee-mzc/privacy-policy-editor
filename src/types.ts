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
