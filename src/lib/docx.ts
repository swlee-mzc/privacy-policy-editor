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
import type { Doc, Section, TableData } from '../types';
import { parseTable } from './table';

/**
 * DOCX 내보내기. rowspan/colspan, 인라인 <b>, <br> 지원.
 * docx 라이브러리를 사용해 완전한 .docx 파일 Blob 을 생성한다.
 */
export async function toDocxBlob(doc: Doc): Promise<Blob> {
  const children: (Paragraph | Table)[] = [];

  // 문서 제목
  children.push(
    new Paragraph({
      children: [new TextRun({ text: '개인정보 처리방침', bold: true, size: 32 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  );

  // headers
  for (const h of doc.headers || []) {
    if (!h.trim()) continue;
    children.push(paragraphFromLine(h));
  }

  // contents
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
    if (t.startsWith('<table')) {
      const parsed = parseTable(line);
      if (parsed) {
        out.push(tableDataToDocx(parsed));
      } else {
        out.push(paragraphFromLine(line));
      }
    } else {
      out.push(paragraphFromLine(line));
    }
  }

  return out;
}

function paragraphFromLine(line: string): Paragraph {
  const runs = htmlToRuns(line);
  return new Paragraph({
    children: runs.length > 0 ? runs : [new TextRun('')],
    spacing: { after: 120 },
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

function tableDataToDocx(data: TableData): Table {
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
    return new TableRow({ children: cells });
  });

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
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
