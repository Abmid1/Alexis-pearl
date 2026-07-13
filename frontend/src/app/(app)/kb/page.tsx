'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, timeAgo } from '@/components/Shell';
import { I } from '@/components/Icons';

const CAT_TAG: Record<string, string> = { policy: 't-blue', sop: 't-purple', brochure: 't-green', faq: 't-amber', contract: 't-red', training: 't-gray', lease: 't-blue', id: 't-gray', property: 't-green' };

export default function KB() {
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);
  const [docs, setDocs] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<any>(null);
  const [asking, setAsking] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'policy', content_text: '' });
  const [busy, setBusy] = useState(false);

  const load = () => api.kb.list().then(setDocs).catch(() => {});
  useEffect(() => { load(); }, []);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setAsking(true); setAnswer(null);
    try { setAnswer(await api.kb.ask(q)); } finally { setAsking(false); }
  };

  return (
    <div>
      <ScreenHead id="1i" title="AI Knowledge Base" phase={3}>
        <button className="btn btn-green" onClick={() => setShowAdd(true)}>+ Upload document</button>
      </ScreenHead>
      <div className="muted" style={{ marginBottom: 14 }}>
        One brain, three surfaces: this search, AI reply drafts in the Inbox, and the public website chatbot. Upload once — every channel knows it.
      </div>

      {/* Ask anything */}
      <form onSubmit={ask} className="row" style={{ marginBottom: 12 }}>
        <input className="form-input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder='Ask anything… e.g. "What is our refund policy on reservations?"' />
        <button className="btn btn-green" disabled={asking}>{asking ? 'Thinking…' : 'Ask'}</button>
      </form>

      {answer && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'rgba(52,211,153,0.3)' }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, marginBottom: 10 }}>{answer.answer}</div>
          {answer.sources?.length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="muted">Sources:</span>
              {answer.sources.map((s: any) => <span key={s.id} className={`tag ${CAT_TAG[s.category] || 't-gray'}`}><I name="paperclip" size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />{s.title}</span>)}
            </div>
          )}
        </div>
      )}

      <div className="section-title">Documents ({docs.length})</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {docs.map((d) => (
          <div key={d.id} className="card">
            <div className="spread" style={{ marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{d.title}</div>
              <span className={`tag ${CAT_TAG[d.category] || 't-gray'}`}>{d.category}</span>
            </div>
            {d.excerpt && <div className="muted" style={{ lineHeight: 1.6, marginBottom: 8 }}>{d.excerpt}…</div>}
            <div className="spread">
              <span className="muted" style={{ fontSize: 11 }}>{d.uploader?.name} · {timeAgo(d.created_at)}</span>
              {isManager && <button className="btn btn-sm btn-red" onClick={async () => { await api.kb.remove(d.id); load(); }}>Delete</button>}
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <Modal title="Upload document" onClose={() => setShowAdd(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try {
              await api.kb.add(form);
              setShowAdd(false); setForm({ title: '', category: 'policy', content_text: '' }); load();
            } finally { setBusy(false); }
          }}>
            <div className="form-group"><label className="form-label">Title *</label>
              <input className="form-input" required value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Category *</label>
              <select className="form-select" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}>
                {['policy', 'sop', 'faq', 'brochure', 'contract', 'training', 'lease', 'property'].map((c) => <option key={c}>{c}</option>)}
              </select></div>
            <div className="form-group">
              <label className="form-label">Content * <span className="muted">(paste the document text — this is what the AI reads)</span></label>
              <textarea className="form-input" required rows={7} value={form.content_text} onChange={(e) => setForm((p) => ({ ...p, content_text: e.target.value }))} />
            </div>
            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Uploading…' : 'Add to the brain'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
