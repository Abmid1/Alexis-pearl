'use client';
import { useState } from 'react';
import { api, authStore } from '@/lib/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { token, user } = await api.login(email, password);
      authStore.set(token, user);
      window.location.href = user.role === 'client' ? '/portal' : '/';
    } catch (e: any) {
      setErr(e.message || 'Login failed');
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: '0 auto 12px',
            background: 'linear-gradient(135deg, #1D9E75, #34D399)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 800, color: '#fff',
            boxShadow: '0 8px 24px rgba(29,158,117,0.35)',
          }}>AP</div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Alexis Pearl</h1>
          <div className="muted">One system for the whole company</div>
        </div>

        <form onSubmit={submit} className="card" style={{ padding: 20 }}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@alexispearl.com" />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
          <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>

        <div className="muted" style={{ textAlign: 'center', marginTop: 14, lineHeight: 1.8 }}>
          Staff sign in above · Clients use the same login<br />and land in their personal portal
        </div>
      </div>
    </div>
  );
}
