import type { Doc, Section } from '../types';
import { lineKind } from '../lib/line';
import { useAutosize } from '../hooks/useAutosize';
import { IconBtn } from './IconBtn';
import { SectionEditor } from './SectionEditor';

type Props = {
  doc: Doc;
  onChange: (next: Doc) => void;
};

export function Editor({ doc, onChange }: Props) {
  const updateHeader = (idx: number, v: string) => {
    onChange({ ...doc, headers: doc.headers.map((h, i) => (i === idx ? v : h)) });
  };
  const deleteHeader = (idx: number) => {
    if (!confirm(`헤더 #${idx + 1}을 삭제하시겠습니까?`)) return;
    onChange({ ...doc, headers: doc.headers.filter((_, i) => i !== idx) });
  };
  const addHeader = () => onChange({ ...doc, headers: [...doc.headers, ''] });

  const updateSection = (idx: number, next: Section) => {
    onChange({ ...doc, contents: doc.contents.map((s, i) => (i === idx ? next : s)) });
  };
  const deleteSection = (idx: number) => {
    if (!confirm(`「${doc.contents[idx].title}」 섹션 전체를 삭제하시겠습니까?`)) return;
    onChange({ ...doc, contents: doc.contents.filter((_, i) => i !== idx) });
  };
  const duplicateSection = (idx: number) => {
    const copy = JSON.parse(JSON.stringify(doc.contents[idx])) as Section;
    const contents = [...doc.contents];
    contents.splice(idx + 1, 0, copy);
    onChange({ ...doc, contents });
  };
  const moveSection = (from: number, to: number) => {
    if (to < 0 || to >= doc.contents.length) return;
    const contents = [...doc.contents];
    const [x] = contents.splice(from, 1);
    contents.splice(to, 0, x);
    onChange({ ...doc, contents });
  };
  const addSection = () => {
    const n = doc.contents.length + 1;
    onChange({
      ...doc,
      contents: [...doc.contents, { title: `제${n}조 (새 섹션)`, lines: [''] }],
    });
  };

  return (
    <div>
      <div className="ed-section">
        <div className="ed-section-head">
          <strong style={{ flex: 1, fontSize: '.9rem' }}>헤더</strong>
        </div>
        <div className="ed-section-body">
          {doc.headers.map((h, i) => (
            <HeaderRow
              key={i}
              index={i}
              value={h}
              onChange={(v) => updateHeader(i, v)}
              onDelete={() => deleteHeader(i)}
            />
          ))}
          <div className="add-line-row">
            <IconBtn variant="ghost" onClick={addHeader}>+ 헤더 추가</IconBtn>
          </div>
        </div>
      </div>

      {doc.contents.map((section, sIdx) => (
        <SectionEditor
          key={sIdx}
          index={sIdx}
          section={section}
          isFirst={sIdx === 0}
          isLast={sIdx === doc.contents.length - 1}
          onChange={(v) => updateSection(sIdx, v)}
          onDelete={() => deleteSection(sIdx)}
          onDuplicate={() => duplicateSection(sIdx)}
          onMoveUp={() => moveSection(sIdx, sIdx - 1)}
          onMoveDown={() => moveSection(sIdx, sIdx + 1)}
        />
      ))}

      <div className="add-section-wrap">
        <IconBtn variant="ghost" onClick={addSection}>+ 섹션 추가</IconBtn>
      </div>
    </div>
  );
}

function HeaderRow({
  index, value, onChange, onDelete,
}: {
  index: number;
  value: string;
  onChange: (v: string) => void;
  onDelete: () => void;
}) {
  const kind = lineKind(value);
  const ref = useAutosize<HTMLTextAreaElement>(value);
  return (
    <div className="ed-line" data-section="-1" data-line={index}>
      <div className="ed-line-label">
        <span>#{index + 1}</span>
        <span className={`kind-badge kind-${kind}`}>{kind}</span>
        <div className="line-actions">
          <IconBtn variant="danger" onClick={onDelete} title="헤더 삭제">✕</IconBtn>
        </div>
      </div>
      <textarea
        ref={ref}
        className="plain"
        value={value}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
