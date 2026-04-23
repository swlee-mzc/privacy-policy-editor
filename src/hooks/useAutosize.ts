import { useEffect, useRef } from 'react';

/** textarea 내용에 맞춰 높이 자동 조정 */
export function useAutosize<T extends HTMLTextAreaElement>(value: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }, [value]);
  return ref;
}
