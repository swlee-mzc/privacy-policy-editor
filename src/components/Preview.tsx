import type { Doc } from '../types';
import { escapeHtml, newlineToBr } from '../lib/line';

type Props = { doc: Doc };

export function Preview({ doc }: Props) {
  const headersHtml = (doc.headers || [])
    .map((h) => (h.trim().startsWith('<') ? h : `<p>${newlineToBr(h)}</p>`))
    .join('');

  const contentsHtml = (doc.contents || [])
    .map((section) => {
      const lines = (section.lines || [])
        .map((line) => {
          const t = line.trim();
          if (!t) return '';
          if (t.startsWith('<table')) return `<div>${line}</div>`;
          const withBr = newlineToBr(line);
          if (
            t.startsWith('<b>') ||
            /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(t) ||
            /^[ⅰⅱⅲⅳⅴ]\)/.test(t) ||
            /^\d+[.)]/.test(t)
          ) {
            return `<div>${withBr}</div>`;
          }
          return `<p>${withBr}</p>`;
        })
        .join('');
      return `<section>
  <h2 class="section-title">${escapeHtml(section.title)}</h2>
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
