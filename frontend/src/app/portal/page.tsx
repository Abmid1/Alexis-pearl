'use client';
import { useEffect, useRef, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { fmtGHS, timeAgo, ChangePasswordModal } from '@/components/Shell';

export default function Portal() {
  const [user, setUser] = useState<any>(undefined);
  const [data, setData] = useState<any>(null);
  const [thread, setThread] = useState<any[]>([]);
  const [chatText, setChatText] = useState('');
  const [tab, setTab] = useState<'plan' | 'docs' | 'chat'>('plan');
  const [paying, setPaying] = useState<string | null>(null);
  const [paidFlash, setPaidFlash] = useState('');
  const [showChangePw, setShowChangePw] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const u = authStore.getUser();
    if (!u) { window.location.href = '/login'; return; }
    if (u.role !== 'client') { window.location.href = '/'; return; }
    setUser(u);
  }, []);

  const load = () => {
    api.portal.home().then(setData).catch(() => {});
    api.portal.thread().then((t) => setThread(t.messages)).catch(() => {});
  };
  useEffect(() => { if (user) load(); }, [user]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread.length, tab]);

  const pay = async (instId: string) => {
    setPaying(instId);
    try {
      const r = await api.portal.pay(instId);
      if (r.redirect) { window.location.href = r.redirect; return; }
      setPaidFlash('Payment received — thank you! Your balance is updated.');
      setTimeout(() => setPaidFlash(''), 4000);
      load();
    } catch (e: any) { alert(e.message); } finally { setPaying(null); }
  };

  const sendChat = async () => {
    if (!chatText.trim()) return;
    const t = chatText; setChatText('');
    setThread((p) => [...p, { direction: 'in', body: t, sender_type: 'contact', created_at: new Date().toISOString() }]);
    await api.portal.chat(t).catch(() => {});
    setTimeout(load, 800); // pick up the AI's reply
  };

  if (!user || !data) return <div style={{ padding: 30 }} className="muted">Loading…</div>;

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '18px 14px 40px' }}>
      {/* Header */}
      <div className="spread" style={{ marginBottom: 18 }}>
        <div className="row">
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#1D9E75,#34D399)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, color: '#fff' }}>AP</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Alexis Pearl</div>
            <div className="muted" style={{ fontSize: 11 }}>Client portal · <span className="id-badge" style={{ fontSize: 9 }}>1k</span></div>
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={() => setShowChangePw(true)}>Change password</button>
          <button className="btn btn-sm" onClick={() => { authStore.clear(); window.location.href = '/login'; }}>Sign out</button>
        </div>
      </div>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}

      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Welcome, {data.client.name.split(' ')[0]} 👋</div>

      {paidFlash && <div className="card" style={{ marginBottom: 12, borderColor: 'var(--green)', color: 'var(--green-bright)', fontWeight: 600 }}>{paidFlash}</div>}

      {/* Tabs */}
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {([['plan', 'My plan'], ['docs', 'Documents'], ['chat', 'Chat with agent']] as const).map(([k, label]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'btn-green' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'plan' && (
        <>
          {data.plans.map((p: any) => {
            const pct = Math.round((p.paidAmount / Number(p.total)) * 100);
            return (
              <div key={p.id} className="card" style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{p.deal?.title || 'My payment plan'}</div>
                <div className="muted" style={{ marginBottom: 12 }}>Installment {Math.min(p.paidCount + 1, p.installment_count)} of {p.installment_count}</div>

                <div className="spread" style={{ marginBottom: 5 }}>
                  <span style={{ fontWeight: 700 }}>{fmtGHS(p.paidAmount)} <span className="muted">of {fmtGHS(p.total)}</span></span>
                  <span style={{ fontWeight: 700, color: 'var(--green-bright)' }}>{pct}%</span>
                </div>
                <div className="progress" style={{ marginBottom: 14 }}><div style={{ width: `${pct}%` }} /></div>

                {p.nextDue && (
                  <div className="card" style={{ background: 'var(--bg-elevated)', padding: 12, marginBottom: 12 }}>
                    <div className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div className="muted">Next installment</div>
                        <div style={{ fontWeight: 700, fontSize: 16 }}>{fmtGHS(p.nextDue.amount)}</div>
                        <div className="muted">due {p.nextDue.due_date}{new Date(p.nextDue.due_date) < new Date() && <span style={{ color: 'var(--red)', fontWeight: 700 }}> · overdue</span>}</div>
                      </div>
                      <button className="btn btn-green" disabled={paying === p.nextDue.id} onClick={() => pay(p.nextDue.id)}>
                        {paying === p.nextDue.id ? 'Processing…' : 'Pay now'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Construction milestone — the other question that floods the phone */}
                {p.unit && (
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 12 }}>
                    <div className="spread" style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>🏗 {p.unit.name} construction</span>
                      <span style={{ fontWeight: 700, color: 'var(--green-bright)' }}>{p.unit.completion_pct}%</span>
                    </div>
                    <div className="progress" style={{ height: 6, marginBottom: 6 }}><div style={{ width: `${p.unit.completion_pct}%` }} /></div>
                    {p.unit.handover_date && <div className="muted">Estimated handover: <strong>{p.unit.handover_date}</strong></div>}
                  </div>
                )}
              </div>
            );
          })}
          {data.plans.length === 0 && <div className="card muted" style={{ textAlign: 'center', padding: 26 }}>No active payment plan.</div>}

          {data.invoices.length > 0 && (
            <>
              <div className="section-title">My invoices</div>
              {data.invoices.map((i: any) => (
                <div key={i.id} className="card spread" style={{ marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{i.number}</div>
                    <div className="muted">{i.items?.[0]?.desc || ''} · due {i.due_date || '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>{fmtGHS(i.amount)}</div>
                    <span className={`tag ${i.status === 'paid' ? 't-green' : i.status === 'overdue' ? 't-red' : 't-amber'}`}>{i.status}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {tab === 'docs' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.documents.map((d: any) => (
            <div key={d.id} className="card spread">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>📄 {d.title}</div>
                <div className="muted">{d.category} · {timeAgo(d.created_at)}</div>
              </div>
              {d.file_url && <a className="btn btn-sm" href={d.file_url} target="_blank">Open</a>}
            </div>
          ))}
          {data.documents.length === 0 && <div className="card muted" style={{ textAlign: 'center', padding: 26 }}>No documents shared yet.</div>}
        </div>
      )}

      {tab === 'chat' && (
        <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', height: '60vh' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {thread.length === 0 && <div className="muted" style={{ textAlign: 'center', marginTop: 30 }}>Ask us anything — payment plans, construction progress, documents. We answer 24/7.</div>}
            {thread.map((m: any, i: number) => (
              <div key={i} style={{
                alignSelf: m.direction === 'in' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                background: m.direction === 'in' ? 'var(--green)' : 'var(--bg-elevated)',
                color: m.direction === 'in' ? '#fff' : 'var(--text-primary)',
                borderRadius: 12, padding: '9px 12px', fontSize: 13.5, lineHeight: 1.55,
              }}>
                {m.body}
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 3 }}>
                  {m.sender_type === 'ai' ? '🤖 Alexis Pearl AI' : m.direction === 'out' ? 'Alexis Pearl' : 'You'} · {timeAgo(m.created_at)}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="row" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
            <input className="form-input" style={{ flex: 1 }} placeholder="Type a message…" value={chatText}
              onChange={(e) => setChatText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendChat()} />
            <button className="btn btn-green" onClick={sendChat}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
