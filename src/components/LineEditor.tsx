import { useMemo } from 'react';
import { lineKind } from '../lib/line';
import { parseTable, serializeTable } from '../lib/table';
import { useAutosize } from '../hooks/useAutosize';
import { IconBtn } from './IconBtn';
import { TableEditor } from './TableEditor';

type Props = {
  index: number;
  line: string;
  isFirst: boolean;
  isLast: boolean;
  onChange: (next: string) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
};

export function LineEditor({
  index, line, isFirst, isLast,
  onChange, onDelete, onMoveUp, onMoveDown,
}: Props) {
  const kind = lineKind(line);
  const tableData = useMemo(() => (kind === 'table' ? parseTable(line) : null), [kind, line]);
  const taRef = useAutosize<HTMLTextAreaElement>(line);

  return (
    <div className="ed-line">
      <div className="ed-line-label">
        <span>#{index + 1}</span>
        <span className={`kind-badge kind-${kind}`}>{kind}</span>
        <div className="line-actions">
          <IconBtn onClick={onMoveUp} disabled={isFirst} title="위로">↑</IconBtn>
          <IconBtn onClick={onMoveDown} disabled={isLast} title="아래로">↓</IconBtn>
          <IconBtn variant="danger" onClick={onDelete} title="이 라인 삭제">✕</IconBtn>
        </div>
      </div>

      {kind === 'table' && tableData ? (
        <TableEditor
          data={tableData}
          onChange={(next) => onChange(serializeTable(next))}
        />
      ) : (
        <textarea
          ref={taRef}
          className="plain"
          value={line}
          rows={kind === 'empty' ? 1 : 2}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
