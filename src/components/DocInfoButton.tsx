import { useEffect, useRef, useState } from 'react';
import type { DocMeta } from '../types';
import type { IssueRef } from '../lib/docx';

/**
 * 이슈 ref 를 에디터·미리보기 양쪽 패널에서 스크롤·하이라이트.
 * selector 전략:
 *   - section-only ref (lineIndex undefined) → `[data-section-head="{i}"]`
 *   - line ref                               → `[data-section="{s}"][data-line="{l}"]`
 * 스크롤 컨테이너는 각 패널의 `.panel-body`.
 */
function scrollToRef(ref: IssueRef) {
  const selector =
    ref.lineIndex === undefined
      ? `[data-section-head="${ref.sectionIndex}"]`
      : `[data-section="${ref.sectionIndex}"][data-line="${ref.lineIndex}"]`;
  for (const panelId of ['editorPanel', 'previewPanel']) {
    const panel = document.getElementById(panelId);
    if (!panel) continue;
    const el = panel.querySelector<HTMLElement>(selector);
    if (!el) continue;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash-highlight');
    // 애니메이션 재시작을 위한 reflow.
    void el.offsetWidth;
    el.classList.add('flash-highlight');
    window.setTimeout(() => el.classList.remove('flash-highlight'), 1800);
  }
}

type Props = {
  meta: DocMeta;
};

/**
 * 툴바 우측 배지 + 클릭 팝오버.
 *
 * - 초기 마운트 시 `issues` 가 있으면 팝오버 자동 오픈 (새 파일 로드마다 키 리셋 → 재오픈).
 * - 팝오버 닫기(X, 배경 클릭, Esc)는 팝오버만 접고 아이콘은 유지. 아이콘은 docMeta 가
 *   존재하는 동안 알림처럼 상주.
 * - issues 0 건이면 ✓ 체크(초록), 있으면 ⚠ 경고(주황).
 */
export function DocInfoButton({ meta }: Props) {
  const hasIssues = meta.issues.length > 0;
  const hasAutoFixes = meta.autoFixes.length > 0;
  const [open, setOpen] = useState<boolean>(hasIssues);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const icon = hasIssues ? '⚠' : '✓';
  const btnClass = hasIssues ? 'warn' : 'ok';
  const popClass = hasIssues ? 'warn' : 'ok';
  const label = hasIssues
    ? `검토 필요 ${meta.issues.length}건${hasAutoFixes ? ` · 자동 정리 ${meta.autoFixes.length}건` : ''}`
    : hasAutoFixes
      ? `자동 정리 ${meta.autoFixes.length}건 (검토 필요 없음)`
      : '검토 필요 없음';

  return (
    <div className="doc-info" ref={rootRef}>
      <button
        type="button"
        className={`doc-info-btn ${btnClass}`}
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="doc-info-icon">{icon}</span>
        {hasIssues && <span className="doc-info-badge">{meta.issues.length}</span>}
      </button>

      {open && (
        <div className={`doc-info-pop ${popClass}`} role="dialog">
          <div className="doc-info-pop-head">
            <div className="doc-info-pop-title">
              {meta.source === 'docx' ? 'DOCX 변환' : 'JSON 로드'}
              <span className="doc-info-pop-file">· {meta.fileName}</span>
            </div>
            <button
              type="button"
              className="doc-info-pop-close"
              onClick={() => setOpen(false)}
              title="팝오버 닫기 (아이콘은 유지)"
              aria-label="팝오버 닫기"
            >
              ✕
            </button>
          </div>
          <div className="doc-info-pop-info">{meta.info.join(' · ')}</div>

          {!hasIssues && !hasAutoFixes && (
            <div className="doc-info-pop-section doc-info-pop-empty">
              검토가 필요한 항목이 없습니다.
            </div>
          )}

          {hasIssues && (
            <div className="doc-info-pop-section">
              <div className="doc-info-pop-section-title">
                검토 필요 ({meta.issues.length}건)
              </div>
              <ul className="doc-info-pop-issues">
                {meta.issues.map((iss, i) => (
                  <li key={i}>
                    <div>{iss.message}</div>
                    {iss.refs.length > 0 && (
                      <div className="doc-info-pop-refs">
                        {iss.refs.map((ref, ri) => (
                          <button
                            key={ri}
                            type="button"
                            className="doc-info-pop-ref"
                            onClick={() => scrollToRef(ref)}
                            title="에디터/미리보기로 이동"
                          >
                            {ref.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasAutoFixes && (
            <div className="doc-info-pop-section doc-info-pop-autofix">
              <div className="doc-info-pop-section-title">
                자동 정리됨 ({meta.autoFixes.length}건)
              </div>
              <ul className="doc-info-pop-issues">
                {meta.autoFixes.map((af, i) => (
                  <li key={i}>{af}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
