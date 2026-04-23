import { useCallback } from 'react';
import type { TableData } from '../types';
import { cloneLastBodyRow, setCellSpan, toggleCellHeader } from '../lib/table';
import { useAutosize } from '../hooks/useAutosize';
import { IconBtn } from './IconBtn';

type Props = {
  data: TableData;
  onChange: (next: TableData) => void;
};

export function TableEditor({ data, onChange }: Props) {
  const bodyCount = data.rows.filter((r) => !r.isHead).length;

  const updateCell = useCallback(
    (rowIdx: number, cellIdx: number, html: string) => {
      const rows = data.rows.map((r, i) => {
        if (i !== rowIdx) return r;
        const cells = r.cells.map((c, j) => (j === cellIdx ? { ...c, html } : c));
        return { ...r, cells };
      });
      onChange({ ...data, rows });
    },
    [data, onChange],
  );

  const changeSpan = useCallback(
    (rowIdx: number, cellIdx: number, nextR: number, nextC: number) => {
      const next = setCellSpan(data, rowIdx, cellIdx, nextR, nextC);
      if (!next) {
        alert(
          '해당 span 변경은 격자 일관성을 해칠 수 있어 적용할 수 없습니다.\n' +
            '(예: 표 범위 초과, 다른 병합 셀과 부분 겹침)',
        );
        return;
      }
      onChange(next);
    },
    [data, onChange],
  );

  const toggleHeader = useCallback(
    (rowIdx: number, cellIdx: number) => {
      onChange(toggleCellHeader(data, rowIdx, cellIdx));
    },
    [data, onChange],
  );

  const addRow = () => {
    const clone = cloneLastBodyRow(data);
    if (!clone) return;
    onChange({ ...data, rows: [...data.rows, clone] });
  };

  const delLastRow = () => {
    let lastIdx = -1;
    for (let i = data.rows.length - 1; i >= 0; i--) {
      if (!data.rows[i].isHead) {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx === -1) return;
    if (!confirm('마지막 행을 삭제하시겠습니까?')) return;
    const rows = data.rows.slice(0, lastIdx).concat(data.rows.slice(lastIdx + 1));
    onChange({ ...data, rows });
  };

  return (
    <div className="ed-tablewrap">
      <table className="ed-table">
        <tbody>
          {data.rows.map((row, rIdx) => (
            <tr key={rIdx} className={row.className || undefined}>
              {row.cells.map((cell, cIdx) => {
                const Tag = cell.tag;
                return (
                  <Tag
                    key={cIdx}
                    className={cell.className || undefined}
                    rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                    colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                  >
                    <SpanControls
                      rowspan={cell.rowspan}
                      colspan={cell.colspan}
                      isHeader={cell.tag === 'th'}
                      canToggleHeader={!row.isHead}
                      onToggleHeader={() => toggleHeader(rIdx, cIdx)}
                      onChange={(nr, nc) => changeSpan(rIdx, cIdx, nr, nc)}
                    />
                    <CellTextarea
                      value={cell.html}
                      onChange={(v) => updateCell(rIdx, cIdx, v)}
                    />
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-actions">
        <IconBtn variant="ghost" onClick={addRow} title="마지막 tbody 행을 복제">+ 행 추가</IconBtn>
        <IconBtn variant="ghost" onClick={delLastRow}>- 마지막 행 삭제</IconBtn>
        <span className="spacer" />
        <span className="text-muted">{bodyCount} rows</span>
      </div>
    </div>
  );
}

function SpanControls({
  rowspan,
  colspan,
  isHeader,
  canToggleHeader,
  onToggleHeader,
  onChange,
}: {
  rowspan: number;
  colspan: number;
  isHeader: boolean;
  canToggleHeader: boolean;
  onToggleHeader: () => void;
  onChange: (rowspan: number, colspan: number) => void;
}) {
  const merged = rowspan > 1 || colspan > 1;
  return (
    <div className="cell-span" onClick={(e) => e.stopPropagation()}>
      {canToggleHeader && (
        <button
          type="button"
          className={`cell-header-toggle${isHeader ? ' is-header' : ''}`}
          title={isHeader ? '라벨 셀 해제 (th → td)' : '라벨 셀로 지정 (td → th, table-secondary)'}
          onClick={onToggleHeader}
        >
          L
        </button>
      )}
      <label title="row span">
        r
        <input
          type="number"
          min={1}
          value={rowspan}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v) && v >= 1 && v !== rowspan) onChange(v, colspan);
          }}
        />
      </label>
      <label title="column span">
        c
        <input
          type="number"
          min={1}
          value={colspan}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (Number.isFinite(v) && v >= 1 && v !== colspan) onChange(rowspan, v);
          }}
        />
      </label>
      {merged && (
        <button
          type="button"
          className="cell-span-reset"
          title="병합 해제 (1×1)"
          onClick={() => onChange(1, 1)}
        >
          ×
        </button>
      )}
    </div>
  );
}

function CellTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useAutosize<HTMLTextAreaElement>(value);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
