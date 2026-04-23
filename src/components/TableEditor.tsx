import { useCallback } from 'react';
import type { TableData } from '../types';
import { cloneLastBodyRow } from '../lib/table';
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
                const meta: string[] = [];
                if (cell.rowspan > 1) meta.push(`r${cell.rowspan}`);
                if (cell.colspan > 1) meta.push(`c${cell.colspan}`);
                return (
                  <Tag
                    key={cIdx}
                    className={cell.className || undefined}
                    rowSpan={cell.rowspan > 1 ? cell.rowspan : undefined}
                    colSpan={cell.colspan > 1 ? cell.colspan : undefined}
                  >
                    {meta.length > 0 && <span className="cell-meta">{meta.join(' ')}</span>}
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
