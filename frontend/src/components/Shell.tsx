'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { authStore, api } from '@/lib/api';
import { I } from '@/components/Icons';

/* Role-aware navigation — mirrors the permission grid in the blueprint. */
const NAV = [
  { href: '/',          id: '1a', label: 'Command Center', icon: 'home',      roles: ['owner', 'admin', 'agent', 'marketing'] },
  { href: '/pipeline',  id: '1b', label: 'Pipeline',       icon: 'kanban',    roles: ['owner', 'admin', 'agent'] },
  { href: '/deals',     id: '1c', label: 'Deals',          icon: 'briefcase', roles: ['owner', 'admin', 'agent'] },
  { href: '/inbox',     id: '1d', label: 'Inbox',          icon: 'chat',      roles: ['owner', 'admin', 'agent', 'marketing'] },
  { href: '/viewings',  id: '',   label: 'Viewings',       icon: 'clock',     roles: ['owner', 'admin', 'agent'] },
  { href: '/applications', id: '', label: 'Applications',  icon: 'doc',       roles: ['owner', 'admin', 'agent'] },
  { href: '/requests',  id: '',   label: 'Requests',       icon: 'paperclip', roles: ['owner', 'admin', 'agent'] },
  { href: '/marketing', id: '1e', label: 'Marketing',      icon: 'megaphone', roles: ['owner', 'admin', 'marketing', 'agent'] },
  { href: '/finance',   id: '1f', label: 'Finance',        icon: 'dollar',    roles: ['owner', 'admin', 'agent', 'marketing'] }, // staff can submit expenses; full view guards inside
  { href: '/plans',     id: '1g', label: 'Payment Plans',  icon: 'calendar',  roles: ['owner', 'admin', 'agent'] },
  { href: '/reports',   id: '1h', label: 'Reports',        icon: 'chart',     roles: ['owner', 'admin', 'agent', 'marketing'] },
  { href: '/kb',        id: '1i', label: 'Knowledge Base', icon: 'book',      roles: ['owner', 'admin', 'agent', 'marketing'] },
  { href: '/pm',        id: '1j', label: 'Property Mgmt',  icon: 'building',  roles: ['owner', 'admin'] },
  { href: '/website',   id: '',   label: 'Website',        icon: 'globe',     roles: ['owner', 'admin', 'marketing'] },
  { href: '/clients',   id: '',   label: 'Clients',        icon: 'users',     roles: ['owner', 'admin'] },
  { href: '/team',      id: '',   label: 'Team',           icon: 'user',      roles: ['owner', 'admin'] },
  { href: '/audit',     id: '',   label: 'Audit Log',      icon: 'list',      roles: ['owner', 'admin'] },
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
  const [alerts, setAlerts] = useState<{ inbox: number; approvals: number; website: number }>({ inbox: 0, approvals: 0, website: 0 });
  const [showChangePw, setShowChangePw] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.dashboard().then((d) => setAlerts({
      inbox: d.departments?.inbox?.alert || 0,
      approvals: d.approvals?.length || 0,
      website: d.departments?.website?.alert || 0,
    })).catch(() => {});
  }, [user, path]);

  if (!user) return null;
  const companyName: string = user.company?.name || 'Bilt Africa';
  const initials = companyName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const go = (href: string) => router.push(href);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.12)', display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--orange)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, color: '#fff' }}>{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{companyName}</div>
            <div style={{ fontSize: 10.5, color: '#A9BDD1' }}>Bilt Africa · Real Estate OS</div>
          </div>
        </div>

        <nav style={{ padding: '10px 0', flex: 1 }}>
          {items.map((n) => (
            <button key={n.href} className={`nav-item${path === n.href ? ' active' : ''}`} onClick={() => go(n.href)}>
              <I name={n.icon} size={16} />
              {n.label}
              {n.href === '/inbox' && alerts.inbox > 0 && <span className="nav-badge">{alerts.inbox}</span>}
              {n.href === '/' && alerts.approvals > 0 && <span className="nav-badge">{alerts.approvals}</span>}
              {n.href === '/viewings' && alerts.website > 0 && <span className="nav-badge">{alerts.website}</span>}
            </button>
          ))}
        </nav>

        <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <div className="spread">
            <div className="row" style={{ minWidth: 0 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--navy-hover)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                {user.name?.split(' ').map((p: string) => p[0]).slice(0, 2).join('')}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.name}</div>
                <div style={{ fontSize: 10, color: '#A9BDD1', textTransform: 'capitalize' }}>{user.role}</div>
              </div>
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button className="nav-item" style={{ width: 'auto', margin: 0, padding: 7 }} onClick={() => setShowChangePw(true)} title="Change password"><I name="key" size={14} /></button>
              <button className="nav-item" style={{ width: 'auto', margin: 0, padding: 7 }} onClick={() => { authStore.clear(); window.location.href = '/login'; }} title="Sign out"><I name="logout" size={14} /></button>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">{children}</main>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}

      {/* Mobile bottom tabs — the team works from phones */}
      <nav className="bottom-nav">
        {items.filter((n) => MOBILE_NAV.includes(n.href)).map((n) => (
          <button key={n.href} className={path === n.href ? 'active' : ''} onClick={() => go(n.href)}>
            <I name={n.icon} size={18} />
            {n.label.split(' ')[0]}
            {n.href === '/inbox' && alerts.inbox > 0 && <span className="nav-badge">{alerts.inbox}</span>}
          </button>
        ))}
        <button onClick={() => go(items.some((i) => i.href === '/kb') ? '/kb' : '/reports')}>
          <I name="more" size={18} />
          More
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

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (newPassword !== confirm) { setErr('New passwords do not match'); return; }
    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      onClose();
    } catch (e: any) { setErr(e.message || 'Failed to update password'); } finally { setBusy(false); }
  };

  return (
    <Modal title="Change password" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-group"><label className="form-label">Current password</label>
          <input className="form-input" type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">New password</label>
          <input className="form-input" type="password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Confirm new password</label>
          <input className="form-input" type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        {err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
      </form>
    </Modal>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <button className="btn btn-sm" onClick={onClose}><I name="x" size={13} /></button>
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
