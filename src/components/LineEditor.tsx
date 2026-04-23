import { useMemo } from 'react';
import { lineKind } from '../lib/line';
import { parseTable, serializeTable } from '../lib/table';
import {
  getDepth, indent, outdent, unwrapDepth, wrapDepth,
  MAX_DEPTH, DEPTH_REM,
} from '../lib/depth';
import { useAutosize } from '../hooks/useAutosize';
import { IconBtn } from './IconBtn';
import { TableEditor } from './TableEditor';

type Props = {
  sectionIndex: number;
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
  sectionIndex, index, line, isFirst, isLast,
  onChange, onDelete, onMoveUp, onMoveDown,
}: Props) {
  const depth = getDepth(line);
  // 뎁스 래퍼를 벗긴 "편집용 본문". textarea 에는 이 값만 보여주고,
  // 사용자의 타이핑 변경은 동일 뎁스로 다시 래핑해 JSON 에 저장한다.
  const editableContent = unwrapDepth(line);
  const kind = lineKind(editableContent);
  const tableData = useMemo(() => (kind === 'table' ? parseTable(editableContent) : null), [kind, editableContent]);
  const taRef = useAutosize<HTMLTextAreaElement>(editableContent);

  const depthBadge = depth > 0 ? `↳${depth}` : null;
  const canIndent = depth < MAX_DEPTH;
  const canOutdent = depth > 0;
  // 에디터에서도 뎁스만큼 왼쪽 padding 을 주어 사용자가 시각적으로 현재 레벨을
  // 바로 알 수 있게 한다. 미리보기(margin-left) 와 동일한 rem 값.
  const depthIndentRem = depth > 0 ? DEPTH_REM[depth as Exclude<typeof depth, 0>] : 0;

  return (
    <div
      className="ed-line"
      data-section={sectionIndex}
      data-line={index}
      data-depth={depth}
      style={depthIndentRem > 0 ? { paddingLeft: `${depthIndentRem}rem` } : undefined}
    >
      <div className="ed-line-label">
        <span>#{index + 1}</span>
        <span className={`kind-badge kind-${kind}`}>{kind}</span>
        {depthBadge && (
          <span className="kind-badge kind-depth" title={`들여쓰기 레벨 ${depth}`}>{depthBadge}</span>
        )}
        <div className="line-actions">
          <IconBtn
            onClick={() => onChange(outdent(line))}
            disabled={!canOutdent}
            title="내어쓰기 (한 단계 왼쪽)"
          >←</IconBtn>
          <IconBtn
            onClick={() => onChange(indent(line))}
            disabled={!canIndent}
            title="들여쓰기 (한 단계 오른쪽)"
          >→</IconBtn>
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
          value={editableContent}
          rows={kind === 'empty' ? 1 : 2}
          onChange={(e) => onChange(wrapDepth(e.target.value, depth))}
        />
      )}
    </div>
  );
}
