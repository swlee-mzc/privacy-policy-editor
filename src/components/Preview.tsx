import type { Doc } from '../types';
import { escapeHtml, newlineToBr } from '../lib/line';

type Props = { doc: Doc };

/**
 * 이슈 앵커 점프를 위해 헤더/섹션/라인에 `data-section` / `data-line` 를 심는다.
 *   - `data-section="-1"`           : headers (intro)
 *   - `data-section="{i}"` + no line : 섹션 헤딩 앵커
 *   - `data-section="{i}" data-line="{l}"` : 섹션 내 라인
 */
export function Preview({ doc }: Props) {
  const headersHtml = (doc.headers || [])
    .map((h, i) => {
      const attrs = `data-section="-1" data-line="${i}"`;
      if (h.trim().startsWith('<')) return `<div ${attrs}>${h}</div>`;
      return `<p ${attrs}>${newlineToBr(h)}</p>`;
    })
    .join('');

  const contentsHtml = (doc.contents || [])
    .map((section, sIdx) => {
      const lines = (section.lines || [])
        .map((line, lIdx) => {
          const t = line.trim();
          const attrs = `data-section="${sIdx}" data-line="${lIdx}"`;
          if (!t) return `<div ${attrs} class="empty-line"></div>`;
          if (t.startsWith('<table')) return `<div ${attrs}>${line}</div>`;
          const withBr = newlineToBr(line);
          // 뎁스 래퍼(`<p class='ml-4'>…</p>`) 또는 이미 블록태그로 시작하는 라인은
          // `<p>` 중첩을 피하기 위해 `<div>` 래퍼로 감싼다.
          if (
            t.startsWith('<p ') ||
            t.startsWith('<p>') ||
            t.startsWith('<div') ||
            t.startsWith('<b>') ||
            /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(t) ||
            /^[ⅰⅱⅲⅳⅴ]\)/.test(t) ||
            /^\d+[.)]/.test(t)
          ) {
            return `<div ${attrs}>${withBr}</div>`;
          }
          return `<p ${attrs}>${withBr}</p>`;
        })
        .join('');
      return `<section data-section="${sIdx}">
  <h2 class="section-title" data-section-head="${sIdx}">${escapeHtml(section.title)}</h2>
  <div class="section-body">${lines}</div>
</section>`;
    })
    .join('');

  return (
    <div className="preview">
      <div className="headers" dangerouslySetInnerHTML={{ __html: headersHtml }} />
      <div dangerouslySetInnerHTML={{ __html: contentsHtml }} />
    </div>
  );
}
