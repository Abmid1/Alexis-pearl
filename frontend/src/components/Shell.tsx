'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { authStore, api } from '@/lib/api';

/* Role-aware navigation — mirrors the permission grid in the blueprint. */
const NAV = [
  { href: '/',          id: '1a', label: 'Command Center', icon: '⌂',  roles: ['owner', 'admin', 'agent', 'marketing'] },
  { href: '/pipeline',  id: '1b', label: 'Pipeline',       icon: '◧',  roles: ['owner', 'admin', 'agent'] },
  { href: '/deals',     id: '1c', label: 'Deals',          icon: '✓',  roles: ['owner', 'admin', 'agent'] },
  { href: '/inbox',     id: '1d', label: 'Inbox',          icon: '💬', roles: ['owner', 'admin', 'agent', 'marketing'] },
  { href: '/marketing', id: '1e', label: 'Marketing',      icon: '📣', roles: ['owner', 'admin', 'marketing', 'agent'] },
  { href: '/finance',   id: '1f', label: 'Finance',        icon: '₵',  roles: ['owner', 'admin', 'agent', 'marketing'] }, // staff can submit expenses; full view guards inside
  { href: '/plans',     id: '1g', label: 'Payment Plans',  icon: '▤',  roles: ['owner', 'admin', 'agent'] },
  { href: '/reports',   id: '1h', label: 'Reports',        icon: '📈', roles: ['owner', 'admin', 'agent', 'marketing'] },
  { href: '/kb',        id: '1i', label: 'Knowledge Base', icon: '🧠', roles: ['owner', 'admin', 'agent', 'marketing'] },
  { href: '/pm',        id: '1j', label: 'Property Mgmt',  icon: '🏢', roles: ['owner', 'admin'] },
  { href: '/audit',     id: '',   label: 'Audit Log',      icon: '☰',  roles: ['owner', 'admin'] },
];

const MOBILE_NAV = ['/', '/pipeline', '/inbox', '/plans', '/finance'];

export function useUser() {
  const [user, setUser] = useState<any>(undefined);
  useEffect(() => {
    const u = authStore.getUser();
    if (!u) { window.location.href = '/login'; return; }
    if (u.role === 'client' && !window.location.pathname.startsWith('/portal')) {
      window.location.href = '/portal'; return;
    }
    setUser(u);
  }, []);
  return user;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const user = useUser();
  const path = usePathname();
  const router = useRouter();
  const [alerts, setAlerts] = useState<{ inbox: number; approvals: number }>({ inbox: 0, approvals: 0 });

  useEffect(() => {
    if (!user) return;
    api.dashboard().then((d) => setAlerts({
      inbox: d.departments?.inbox?.alert || 0,
      approvals: d.approvals?.length || 0,
    })).catch(() => {});
  }, [user, path]);

  if (!user) return null;
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const go = (href: string) => router.push(href);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#1D9E75,#34D399)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: '#fff' }}>AP</div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>Alexis Pearl</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Real Estate OS</div>
          </div>
        </div>

        <nav style={{ padding: '10px 0', flex: 1 }}>
          {items.map((n) => (
            <button key={n.href} className={`nav-item${path === n.href ? ' active' : ''}`} onClick={() => go(n.href)}>
              <span style={{ width: 18, textAlign: 'center' }}>{n.icon}</span>
              {n.label}
              {n.href === '/inbox' && alerts.inbox > 0 && <span className="nav-badge">{alerts.inbox}</span>}
              {n.href === '/' && alerts.approvals > 0 && <span className="nav-badge">{alerts.approvals}</span>}
            </button>
          ))}
        </nav>

        <div style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          <div className="spread">
            <div className="row" style={{ minWidth: 0 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {user.name?.split(' ').map((p: string) => p[0]).slice(0, 2).join('')}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{user.role}</div>
              </div>
            </div>
            <button className="btn btn-sm" onClick={() => { authStore.clear(); window.location.href = '/login'; }}>Out</button>
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>

      {/* Mobile bottom tabs — the team works from phones */}
      <nav className="bottom-nav">
        {items.filter((n) => MOBILE_NAV.includes(n.href)).map((n) => (
          <button key={n.href} className={path === n.href ? 'active' : ''} onClick={() => go(n.href)}>
            <span style={{ fontSize: 17 }}>{n.icon}</span>
            {n.label.split(' ')[0]}
            {n.href === '/inbox' && alerts.inbox > 0 && <span className="nav-badge">{alerts.inbox}</span>}
          </button>
        ))}
        <button onClick={() => go(items.some((i) => i.href === '/kb') ? '/kb' : '/reports')}>
          <span style={{ fontSize: 17 }}>⋯</span>More
        </button>
      </nav>
    </div>
  );
}

/** Screen header with the blueprint ID badge (1a–1k). */
export function ScreenHead({ id, title, phase, children }: { id: string; title: string; phase?: number; children?: React.ReactNode }) {
  return (
    <div className="screen-head">
      {id && <span className="id-badge">{id}</span>}
      <h1>{title}</h1>
      {phase && <span className="phase-chip">Phase {phase}</span>}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <button className="btn btn-sm" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const fmtGHS = (n: number | string) => `GHS ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
export const timeAgo = (d: string) => {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
