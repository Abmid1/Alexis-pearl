'use client';
import { useEffect, useState } from 'react';
import { I } from '@/components/Icons';
import { saved } from './store';
import { accountApi, session } from './session';

/** Save a listing on this device (no account needed). */
export default function SaveButton({ slug, id, title, variant = 'icon' }: { slug: string; id: string; title: string; variant?: 'icon' | 'button' }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(saved.has(slug, id));
    sync();
    window.addEventListener('bilt:saved', sync);
    return () => window.removeEventListener('bilt:saved', sync);
  }, [slug, id]);
  const click = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const now = saved.toggle(slug, id);
    setOn(now);
    // signed in → keep the account's saved list in step (device list stays the fallback)
    if (session.get(slug)) {
      (now ? accountApi(slug, '/saved', { method: 'POST', body: { property_id: id } }) : accountApi(slug, `/saved/${id}`, { method: 'DELETE' })).catch(() => {});
    }
  };
  const text = on ? `Remove ${title} from saved` : `Save ${title}`;
  if (variant === 'button') {
    return (
      <button type="button" className="s-btn s-btn-ghost s-btn-block" aria-pressed={on} onClick={click}>
        <I name="heart" size={17} style={on ? { fill: '#C2410C', color: '#C2410C' } : undefined} /> {on ? 'Saved' : 'Save'}
      </button>
    );
  }
  return (
    <button type="button" className="s-save" aria-pressed={on} aria-label={text} title={text} onClick={click}>
      <I name="heart" size={19} style={on ? { fill: 'currentColor' } : undefined} />
    </button>
  );
}
