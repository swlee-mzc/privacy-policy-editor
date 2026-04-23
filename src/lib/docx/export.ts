/**
 * Doc → DOCX 내보내기.
 * `docx` 라이브러리로 완전한 .docx 파일 Blob 을 생성한다.
 * rowspan/colspan, 인라인 `<b>`, `<br>` 지원.
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  BorderStyle,
  ShadingType,
} from 'docx';
import type { Doc, Section, TableData } from '../../types';
import { parseTable } from '../table';
import { getDepth, unwrapDepth, DEPTH_REM } from '../depth';

/**
 * @param title 문서 최상단 센터 정렬 제목. 생략 시 KO/JA/EN 첫 섹션 제목 패턴을
 *   보고 자동 결정 (`제` → '개인정보 처리방침', `第` → '個人情報処理方針',
 *   `Article` → 'Privacy Policy'). UI 는 title 인자 없이 호출해도 KO 로 폴백.
 */
export async function toDocxBlob(doc: Doc, title?: string): Promise<Blob> {
  const resolvedTitle = title ?? detectTitle(doc);
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      children: [new TextRun({ text: resolvedTitle, bold: true, size: 32 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  );

  for (const h of doc.headers || []) {
    if (!h.trim()) continue;
    children.push(paragraphFromLine(h));
  }

  for (const section of doc.contents || []) {
    children.push(...sectionToDocx(section));
  }

  const document = new Document({
    sections: [{ properties: {}, children }],
    styles: {
      default: {
        document: {
          run: { font: 'Malgun Gothic', size: 22 },
        },
      },
    },
  });

  return await Packer.toBlob(document);
}

function detectTitle(doc: Doc): string {
  const firstTitle = doc.contents?.[0]?.title ?? '';
  if (/^第/.test(firstTitle)) return '個人情報処理方針';
  if (/^Article\b/i.test(firstTitle)) return 'Privacy Policy';
  return '개인정보 처리방침';
}

function sectionToDocx(section: Section): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  out.push(
    new Paragraph({
      children: [new TextRun({ text: section.title, bold: true, size: 26 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
    }),
  );

  for (const line of section.lines || []) {
    const t = line.trim();
    if (!t) continue;
    const depth = getDepth(line);
    const inner = depth > 0 ? unwrapDepth(line).trim() : line;
    const indentLeft = depth > 0 ? remToTwips(DEPTH_REM[depth as Exclude<typeof depth, 0>]) : undefined;
    if (inner.startsWith('<table')) {
      const parsed = parseTable(inner);
      if (parsed) {
        out.push(tableDataToDocx(parsed, indentLeft));
      } else {
        out.push(paragraphFromLine(inner, indentLeft));
      }
    } else {
      out.push(paragraphFromLine(inner, indentLeft));
    }
  }

  return out;
}

/** BS4 rem → DOCX twips. (1rem ≈ 240 twips, 1 inch = 1440 twips) */
function remToTwips(rem: number): number {
  return Math.round(rem * 240);
}

function paragraphFromLine(line: string, indentLeft?: number): Paragraph {
  const runs = htmlToRuns(line);
  return new Paragraph({
    children: runs.length > 0 ? runs : [new TextRun('')],
    spacing: { after: 120 },
    indent: indentLeft !== undefined ? { left: indentLeft } : undefined,
  });
}

/**
 * 간이 HTML 인라인 → TextRun[] 변환.
 * 지원 태그: <b>, </b>, <br>, <br/>, <br />
 * 그 외 태그는 스트립.
 */
function htmlToRuns(html: string, baseBold = false): TextRun[] {
  const runs: TextRun[] = [];
  let inlineBold = false;
  let buffer = '';

  const flush = () => {
    if (buffer.length === 0) return;
    const bold = baseBold || inlineBold;
    const parts = buffer.split('\n');
    parts.forEach((part, idx) => {
      if (part.length > 0) {
        runs.push(new TextRun({ text: part, bold }));
      }
      if (idx < parts.length - 1) {
        runs.push(new TextRun({ text: '', break: 1 }));
      }
    });
    buffer = '';
  };

  const tagRegex = /<\/?[a-zA-Z][^>]*>/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(html)) !== null) {
    buffer += decodeEntities(html.slice(lastIdx, match.index));
    const tag = match[0].toLowerCase();

    if (/^<br\s*\/?>$/.test(tag)) {
      flush();
      runs.push(new TextRun({ text: '', break: 1 }));
    } else if (tag === '<b>' || tag === '<strong>') {
      flush();
      inlineBold = true;
    } else if (tag === '</b>' || tag === '</strong>') {
      flush();
      inlineBold = false;
    }
    lastIdx = tagRegex.lastIndex;
  }
  buffer += decodeEntities(html.slice(lastIdx));
  flush();

  return runs;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };
const SECONDARY_SHADING = { type: ShadingType.CLEAR, color: 'auto', fill: 'E9ECEF' };

function tableDataToDocx(data: TableData, indentLeft?: number): Table {
  const rows: TableRow[] = data.rows.map((row) => {
    const cells: TableCell[] = row.cells.map((c) => {
      const isSecondary =
        row.className.includes('table-secondary') ||
        c.className.includes('table-secondary') ||
        c.tag === 'th';

      return new TableCell({
        rowSpan: c.rowspan > 1 ? c.rowspan : undefined,
        columnSpan: c.colspan > 1 ? c.colspan : undefined,
        shading: isSecondary ? SECONDARY_SHADING : undefined,
        children: cellHtmlToParagraphs(c.html, c.tag === 'th'),
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
      });
    });
    return new TableRow({ children: cells, tableHeader: row.isHead });
  });

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    indent: indentLeft !== undefined ? { size: indentLeft, type: WidthType.DXA } : undefined,
    borders: {
      top: BORDER,
      bottom: BORDER,
      left: BORDER,
      right: BORDER,
      insideHorizontal: BORDER,
      insideVertical: BORDER,
    },
  });
}

function cellHtmlToParagraphs(html: string, isHeader: boolean): Paragraph[] {
  const runs = htmlToRuns(html, isHeader);
  return [
    new Paragraph({
      children: runs.length > 0 ? runs : [new TextRun('')],
    }),
  ];
}
