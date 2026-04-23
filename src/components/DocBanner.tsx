import type { DocMeta } from '../types';
import type { IssueRef } from '../lib/docx';

type Props = {
  meta: DocMeta;
  onDismiss: () => void;
};

/**
 * 이슈 ref 를 에디터·미리보기 양쪽 패널에서 스크롤·하이라이트.
 *
 * 선택 전략:
 *   - section-only ref (lineIndex undefined) → `[data-section-head="{i}"]`
 *   - line ref                               → `[data-section="{s}"][data-line="{l}"]`
 *
 * `scrollIntoView({block:'center'})` 는 가장 가까운 스크롤 가능한 조상을
 * 기준으로 동작. 본 앱에서는 `.panel-body` 가 각 패널의 스크롤 컨테이너.
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

export function DocBanner({ meta, onDismiss }: Props) {
  const hasIssues = meta.issues.length > 0;
  const hasAutoFixes = meta.autoFixes.length > 0;
  return (
    <div className={'doc-banner' + (hasIssues ? ' warn' : ' ok')}>
      <div className="doc-banner-body">
        <div className="doc-banner-title">
          {meta.source === 'docx' ? 'DOCX 변환' : 'JSON 로드'}
          <span className="doc-banner-file">· {meta.fileName}</span>
        </div>
        <div className="doc-banner-info">{meta.info.join(' · ')}</div>

        {hasIssues && (
          <div className="doc-banner-section">
            <div className="doc-banner-section-title">
              검토 필요 ({meta.issues.length}건)
            </div>
            <ul className="doc-banner-issues">
              {meta.issues.map((iss, i) => (
                <li key={i}>
                  <div>{iss.message}</div>
                  {iss.refs.length > 0 && (
                    <div className="doc-banner-refs">
                      {iss.refs.map((ref, ri) => (
                        <button
                          key={ri}
                          type="button"
                          className="doc-banner-ref"
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
          <div className="doc-banner-section doc-banner-autofix">
            <div className="doc-banner-section-title">
              자동 정리됨 ({meta.autoFixes.length}건)
            </div>
            <ul className="doc-banner-issues">
              {meta.autoFixes.map((af, i) => (
                <li key={i}>{af}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <button
        type="button"
        className="doc-banner-close"
        onClick={onDismiss}
        title="닫기"
        aria-label="닫기"
      >
        ✕
      </button>
    </div>
  );
}
