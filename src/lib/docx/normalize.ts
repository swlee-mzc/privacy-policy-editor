/**
 * convert 과정에서 발생한 결정적 정규화 카운터.
 * validator 에서 경고 생성에 사용.
 */
export type NormalizeCounters = {
  smartQuotesReplaced: number;
};

export function normalizeSmartQuotes(s: string, counters?: NormalizeCounters): string {
  const count = (s.match(/[“”‘’]/g) || []).length;
  if (count && counters) counters.smartQuotesReplaced += count;
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

export function normalizeLine(s: string, counters?: NormalizeCounters): string {
  return normalizeSmartQuotes(
    s.replace(/(?<=[.!?]) {2,}(?=[가-힣A-Za-z])/g, ' '),
    counters,
  ).trim();
}
