'use client';
import { useEffect, useRef } from 'react';

/** Filters: collapsed on phones (results first), always open on desktop. */
export default function FilterPanel({ children, startOpen }: { children: React.ReactNode; startOpen: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => { if (ref.current && mq.matches) ref.current.open = true; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return <details ref={ref} className="s-filters" open={startOpen || undefined}>{children}</details>;
}
