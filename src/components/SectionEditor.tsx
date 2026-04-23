import type { Section } from '../types';
import { IconBtn } from './IconBtn';
import { LineEditor } from './LineEditor';

type Props = {
  index: number;
  section: Section;
  isFirst: boolean;
  isLast: boolean;
  onChange: (next: Section) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

const EMPTY_TABLE_TOP_HEADER =
  "<table class='table table-bordered table-sm'>" +
  "<thead><tr class='table-secondary'><th>구분</th><th>내용</th></tr></thead>" +
  "<tbody><tr><td></td><td></td></tr></tbody>" +
  "</table>";

const EMPTY_TABLE_LEFT_LABEL =
  "<table class='table table-bordered table-sm'>" +
  "<tbody>" +
  "<tr><th class='table-secondary'>구분</th><td></td></tr>" +
  "<tr><th class='table-secondary'>구분</th><td></td></tr>" +
  "</tbody>" +
  "</table>";

export function SectionEditor({
  index, section, isFirst, isLast,
  onChange, onDelete, onDuplicate, onMoveUp, onMoveDown,
}: Props) {
  const updateTitle = (v: string) => onChange({ ...section, title: v });

  const updateLine = (idx: number, next: string) => {
    const lines = section.lines.map((l, i) => (i === idx ? next : l));
    onChange({ ...section, lines });
  };

  const deleteLine = (idx: number) => {
    if (!confirm(`라인 #${idx + 1}을 삭제하시겠습니까?`)) return;
    onChange({ ...section, lines: section.lines.filter((_, i) => i !== idx) });
  };

  const moveLine = (from: number, to: number) => {
    if (to < 0 || to >= section.lines.length) return;
    const lines = [...section.lines];
    const [x] = lines.splice(from, 1);
    lines.splice(to, 0, x);
    onChange({ ...section, lines });
  };

  const addLine = (kind: 'text' | 'html' | 'table-top' | 'table-left') => {
    let v = '';
    if (kind === 'html') v = '<b></b>';
    else if (kind === 'table-top') v = EMPTY_TABLE_TOP_HEADER;
    else if (kind === 'table-left') v = EMPTY_TABLE_LEFT_LABEL;
    onChange({ ...section, lines: [...section.lines, v] });
  };

  return (
    <div className="ed-section" data-section={index}>
      <div className="ed-section-head" data-section-head={index}>
        <input
          className="title-input"
          value={section.title}
          onChange={(e) => updateTitle(e.target.value)}
        />
        <div className="section-actions">
          <IconBtn onClick={onMoveUp} disabled={isFirst} title="섹션 위로">↑</IconBtn>
          <IconBtn onClick={onMoveDown} disabled={isLast} title="섹션 아래로">↓</IconBtn>
          <IconBtn onClick={onDuplicate} title="섹션 복제">⎘</IconBtn>
          <IconBtn variant="danger" onClick={onDelete} title="섹션 삭제">✕</IconBtn>
        </div>
      </div>
      <div className="ed-section-body">
        {section.lines.map((line, lIdx) => (
          <LineEditor
            key={lIdx}
            sectionIndex={index}
            index={lIdx}
            line={line}
            isFirst={lIdx === 0}
            isLast={lIdx === section.lines.length - 1}
            onChange={(v) => updateLine(lIdx, v)}
            onDelete={() => deleteLine(lIdx)}
            onMoveUp={() => moveLine(lIdx, lIdx - 1)}
            onMoveDown={() => moveLine(lIdx, lIdx + 1)}
          />
        ))}
        <div className="add-line-row">
          <IconBtn variant="ghost" onClick={() => addLine('text')}>+ 텍스트</IconBtn>
          <IconBtn variant="ghost" onClick={() => addLine('html')}>+ HTML/강조</IconBtn>
          <IconBtn variant="ghost" onClick={() => addLine('table-top')} title="첫 행이 헤더인 표">+ 표(상단 헤더)</IconBtn>
          <IconBtn variant="ghost" onClick={() => addLine('table-left')} title="좌측 열이 라벨인 표">+ 표(좌측 라벨)</IconBtn>
        </div>
      </div>
    </div>
  );
}
