'use client';
import { useEffect, useState } from 'react';
import { I } from '@/components/Icons';
import { accountApi } from './session';

const STATE_TONE: Record<string, string> = { done: 'ok', in_progress: 'warn', blocked: 'bad', pending: '' };

/** Where a purchase or tenancy has reached, as ticked off by the agency. */
export default function CustomerProgress({ slug, companyName, onError }: { slug: string; companyName: string; onError: (t: string) => void }) {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { accountApi(slug, '/transactions').then((r) => setItems(r.transactions)).catch((e: any) => onError(e.message)); }, [slug]);
  if (!items) return <p className="s-hint">Loading…</p>;
  if (!items.length) return <div className="s-empty"><p>Nothing in progress yet. Once {companyName} starts a purchase or tenancy with you, the steps appear here.</p></div>;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {items.map((t) => (
        <div key={t.id} className="s-panel" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 650, fontSize: 17 }}>{t.property?.title || (t.kind === 'rental' ? 'Your tenancy' : 'Your purchase')}</div>
              <span className="s-hint">Ref {t.reference} · {t.progress.done} of {t.progress.total} steps done</span>
            </div>
            <span className={`s-badge ${t.status === 'completed' ? 's-badge-ok' : t.status === 'cancelled' ? 's-badge-bad' : ''}`}>
              {t.status === 'completed' ? 'Completed' : t.status === 'cancelled' ? 'Cancelled' : t.current_step || 'In progress'}
            </span>
          </div>

          <div style={{ height: 8, background: 'var(--s-sunk)', borderRadius: 999, overflow: 'hidden' }} role="img"
            aria-label={`${t.progress.done} of ${t.progress.total} steps complete`}>
            <div style={{ height: '100%', width: `${t.progress.total ? (t.progress.done / t.progress.total) * 100 : 0}%`, background: 'var(--s-accent)' }} />
          </div>

          {t.customer_message && <div className="s-note">{t.customer_message}</div>}

          <ol style={{ listStyle: 'none', display: 'grid', gap: 10 }}>
            {t.milestones.map((m: any) => (
              <li key={m.key} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10, alignItems: 'start' }}>
                <span style={{ marginTop: 2, color: m.state === 'done' ? 'var(--s-ok)' : 'var(--s-faint)' }}>
                  <I name={m.state === 'done' ? 'check' : m.state === 'blocked' ? 'alert' : 'clock'} size={18} />
                </span>
                <span>
                  <b style={{ fontWeight: m.state === 'pending' ? 500 : 650, color: m.state === 'pending' ? 'var(--s-muted)' : 'var(--s-text)' }}>{m.label}</b>
                  <span className="s-status" style={{ fontSize: 13.5 }}>
                    <span className={`s-dot ${STATE_TONE[m.state] === 'ok' ? '' : STATE_TONE[m.state]}`} style={m.state === 'pending' ? { background: 'var(--s-line-strong)' } : undefined} />
                    {m.state_label}{m.completed_at ? ` · ${new Date(m.completed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Accra' })}` : ''}
                  </span>
                  {m.note && <span className="s-hint" style={{ display: 'block' }}>{m.note}</span>}
                </span>
              </li>
            ))}
          </ol>
          <p className="s-hint" style={{ fontSize: 13 }}>Steps are updated by {companyName} as work is completed. Contact them if something looks out of date.</p>
        </div>
      ))}
    </div>
  );
}
