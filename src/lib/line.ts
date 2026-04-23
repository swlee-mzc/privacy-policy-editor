import type { LineKind } from '../types';

export function lineKind(line: string): LineKind {
  const t = (line || '').trim();
  if (!t) return 'empty';
  if (t.startsWith('<table')) return 'table';
  if (/<[a-zA-Z!][^>]*>/.test(t)) return 'html';
  return 'text';
}

export function brToNewline(html: string): string {
  return (html || '').replace(/<br\s*\/?>/gi, '\n');
}

export function newlineToBr(s: string): string {
  return (s || '').replace(/\n/g, '<br>');
}

export function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  return String(s).replace(/[&<>]/g, (c) => map[c]);
}
