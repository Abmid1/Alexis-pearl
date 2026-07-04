'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, fmtGHS, timeAgo } from '@/components/Shell';

const INV_TAG: Record<string, string> = { paid: 't-green', pending: 't-amber', overdue: 't-red' };
const EXP_TAG: Record<string, string> = { approved: 't-green', pending: 't-amber', rejected: 't-red' };

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

export default function Finance() {
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);

  const [data, setData] = useState<any>(null);
  const [mine, setMine] = useState<any[]>([]);
  const [tab, setTab] = useState<'invoices' | 'payments' | 'expenses' | 'commissions'>('expenses');
  const [showExpense, setShowExpense] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [clients, setClients] = useState<any[]>([]);
  const [rejectFor, setRejectFor] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [receiptView, setReceiptView] = useState<string | null>(null);
  const [exp, setExp] = useState({ amount: '', category: 'Fuel', note: '', receipt_url: '' });
  const [inv, setInv] = useState({ client_id: '', amount: '', due_date: '', desc: '' });
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (isManager) api.finance.overview().then(setData).catch(() => {});
    else api.finance.myExpenses().then(setMine).catch(() => {});
    api.misc.clients().then(setClients).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const submitExpense = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.finance.addExpense({ ...exp, amount: Number(exp.amount) });
      setShowExpense(false); setExp({ amount: '', category: 'Fuel', note: '', receipt_url: '' });
      load();
    } finally { setBusy(false); }
  };

  /* ── Staff (non-manager) view: submit + track own expenses ─────── */
  if (!isManager) {
    return (
      <div>
        <ScreenHead id="1f" title="Finance — My Expenses" phase={2}>
          <button className="btn btn-green" onClick={() => setShowExpense(true)}>+ New expense</button>
        </ScreenHead>
        <div className="muted" style={{ marginBottom: 14 }}>Submit on the go — amount, category, receipt photo. Owner/Admin approves from the Command Center.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mine.map((e) => (
            <div key={e.id} className="card spread">
              <div>
                <div style={{ fontWeight: 600 }}>{e.category} — {fmtGHS(e.amount)}</div>
                <div className="muted">{e.note || 'no note'} · {timeAgo(e.created_at)}</div>
                {e.status === 'rejected' && e.reject_reason && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>↩ {e.reject_reason}</div>}
              </div>
              <span className={`tag ${EXP_TAG[e.status]}`}>{e.status}</span>
            </div>
          ))}
          {mine.length === 0 && <div className="card muted" style={{ textAlign: 'center', padding: 26 }}>No expenses submitted yet.</div>}
        </div>
        {showExpense && <ExpenseModal exp={exp} setExp={setExp} busy={busy} onClose={() => setShowExpense(false)} onSubmit={submitExpense} />}
      </div>
    );
  }

  /* ── Owner/Admin full view ──────────────────────────────────────── */
  if (!data) return <div className="muted">Loading…</div>;
  const k = data.kpis;
  const pendingPayments = data.payments.filter((p: any) => p.status === 'pending_approval');

  return (
    <div>
      <ScreenHead id="1f" title="Finance" phase={2}>
        <button className="btn" onClick={() => setShowExpense(true)}>+ Expense</button>
        <button className="btn btn-green" onClick={() => setShowInvoice(true)}>+ Invoice</button>
      </ScreenHead>

      <div className="grid-kpi" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="label">Money in</div><div className="value" style={{ fontSize: 21, color: 'var(--green-bright)' }}>{fmtGHS(k.totalIn)}</div></div>
        <div className="kpi"><div className="label">Money out</div><div className="value" style={{ fontSize: 21 }}>{fmtGHS(k.totalOut)}</div></div>
        <div className="kpi"><div className="label">Commission owed</div><div className="value" style={{ fontSize: 21 }}>{fmtGHS(k.commissionOwed)}</div></div>
        <div className="kpi"><div className="label">Net</div><div className="value" style={{ fontSize: 21, color: k.net >= 0 ? 'var(--green-bright)' : 'var(--red)' }}>{fmtGHS(k.net)}</div></div>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['expenses', 'invoices', 'payments', 'commissions'] as const).map((t) => (
          <button key={t} className={`btn btn-sm ${tab === t ? 'btn-green' : ''}`} onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>
            {t}{t === 'expenses' && data.expenses.some((e: any) => e.status === 'pending') ? ` (${data.expenses.filter((e: any) => e.status === 'pending').length})` : ''}
          </button>
        ))}
      </div>

      {tab === 'expenses' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.expenses.map((e: any) => (
            <div key={e.id} className="card">
              <div className="spread" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{e.category} — {fmtGHS(e.amount)}</div>
                  <div className="muted">{e.note || 'no note'} · by {e.submitter?.name} · {timeAgo(e.created_at)}</div>
                  {e.status === 'rejected' && e.reject_reason && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>↩ {e.reject_reason}</div>}
                </div>
                <div className="row">
                  {e.receipt_url && <button className="btn btn-sm" onClick={() => setReceiptView(e.receipt_url)}>🧾 Receipt</button>}
                  {e.status === 'pending' ? (
                    <>
                      <button className="btn btn-sm btn-green" onClick={async () => { await api.finance.approveExpense(e.id); load(); }}>✓ Approve</button>
                      <button className="btn btn-sm btn-red" onClick={() => { setRejectFor(e); setRejectReason(''); }}>Reject</button>
                    </>
                  ) : <span className={`tag ${EXP_TAG[e.status]}`}>{e.status}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Number</th><th>Client</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.invoices.map((i: any) => (
                <tr key={i.id}>
                  <td style={{ fontWeight: 600 }}>{i.number}</td>
                  <td>{i.client?.name || '—'}</td>
                  <td>{fmtGHS(i.amount)}</td>
                  <td>{i.due_date || '—'}</td>
                  <td><span className={`tag ${INV_TAG[i.status]}`}>{i.status}</span></td>
                  <td>{i.status !== 'paid' && <button className="btn btn-sm btn-green" onClick={async () => { await api.finance.markPaid(i.id); load(); }}>Mark paid</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'payments' && (
        <>
          {pendingPayments.length > 0 && <div className="section-title" style={{ marginTop: 0 }}>Awaiting approval</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {pendingPayments.map((p: any) => (
              <div key={p.id} className="card spread">
                <div>
                  <div style={{ fontWeight: 600 }}>{fmtGHS(p.amount)} · {p.method}</div>
                  <div className="muted">{p.client?.name} · recorded by {p.recorder?.name || 'client (in-app)'} · {timeAgo(p.created_at)}</div>
                </div>
                <div className="row">
                  {p.receipt_url && <button className="btn btn-sm" onClick={() => setReceiptView(p.receipt_url)}>🧾</button>}
                  <button className="btn btn-sm btn-green" onClick={async () => { await api.finance.approvePayment(p.id); load(); }}>✓ Approve</button>
                </div>
              </div>
            ))}
          </div>
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="table">
              <thead><tr><th>Client</th><th>Amount</th><th>Method</th><th>Recorded by</th><th>When</th></tr></thead>
              <tbody>
                {data.payments.filter((p: any) => p.status === 'approved').map((p: any) => (
                  <tr key={p.id}>
                    <td>{p.client?.name || '—'}</td>
                    <td style={{ fontWeight: 600, color: 'var(--green-bright)' }}>{fmtGHS(p.amount)}</td>
                    <td><span className="tag t-blue">{p.method}</span></td>
                    <td>{p.recorder?.name || 'Client (in-app)'}</td>
                    <td className="muted">{timeAgo(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'commissions' && (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Agent</th><th>Deal</th><th>Amount</th><th>Deal status</th></tr></thead>
            <tbody>
              {data.commissions.map((c: any, i: number) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{c.user?.name}</td>
                  <td>{c.deal?.title}</td>
                  <td style={{ fontWeight: 600 }}>{fmtGHS(c.amount)}</td>
                  <td><span className={`tag ${['approved', 'closed'].includes(c.deal?.status) ? 't-green' : 't-amber'}`}>{c.deal?.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showExpense && <ExpenseModal exp={exp} setExp={setExp} busy={busy} onClose={() => setShowExpense(false)} onSubmit={submitExpense} />}

      {showInvoice && (
        <Modal title="Generate invoice" onClose={() => setShowInvoice(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            await api.finance.addInvoice({
              client_id: inv.client_id || undefined, amount: Number(inv.amount),
              due_date: inv.due_date || undefined, items: inv.desc ? [{ desc: inv.desc, amount: Number(inv.amount) }] : [],
            });
            setShowInvoice(false); setInv({ client_id: '', amount: '', due_date: '', desc: '' }); load();
          }}>
            <div className="form-group"><label className="form-label">Client</label>
              <select className="form-select" value={inv.client_id} onChange={(e) => setInv((p) => ({ ...p, client_id: e.target.value }))}>
                <option value="">— select —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Amount (GHS) *</label>
              <input className="form-input" type="number" required value={inv.amount} onChange={(e) => setInv((p) => ({ ...p, amount: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Due date</label>
              <input className="form-input" type="date" value={inv.due_date} onChange={(e) => setInv((p) => ({ ...p, due_date: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Line item description</label>
              <input className="form-input" value={inv.desc} onChange={(e) => setInv((p) => ({ ...p, desc: e.target.value }))} placeholder="e.g. Documentation + legal fees" /></div>
            <button className="btn btn-green btn-block">Create invoice</button>
          </form>
        </Modal>
      )}

      {rejectFor && (
        <Modal title="Reject expense" onClose={() => setRejectFor(null)}>
          <div className="form-group">
            <label className="form-label">Reason (the submitter sees this)</label>
            <textarea className="form-input" rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </div>
          <button className="btn btn-red btn-block" onClick={async () => {
            await api.finance.rejectExpense(rejectFor.id, rejectReason || 'Rejected');
            setRejectFor(null); load();
          }}>Reject expense</button>
        </Modal>
      )}

      {receiptView && (
        <Modal title="Receipt" onClose={() => setReceiptView(null)}>
          <img src={receiptView} alt="receipt" style={{ width: '100%', borderRadius: 10 }} />
        </Modal>
      )}
    </div>
  );
}

function ExpenseModal({ exp, setExp, busy, onClose, onSubmit }: any) {
  return (
    <Modal title="New expense" onClose={onClose}>
      <form onSubmit={onSubmit}>
        <div className="row" style={{ gap: 10 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Amount (GHS) *</label>
            <input className="form-input" type="number" required value={exp.amount} onChange={(e: any) => setExp((p: any) => ({ ...p, amount: e.target.value }))} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Category *</label>
            <select className="form-select" value={exp.category} onChange={(e: any) => setExp((p: any) => ({ ...p, category: e.target.value }))}>
              {['Fuel', 'Marketing', 'Office', 'Maintenance', 'Legal', 'Entertainment', 'Other'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Note</label>
          <input className="form-input" value={exp.note} onChange={(e: any) => setExp((p: any) => ({ ...p, note: e.target.value }))} placeholder="What was it for?" />
        </div>
        <div className="form-group">
          <label className="form-label">Receipt photo</label>
          <input className="form-input" type="file" accept="image/*" capture="environment" onChange={async (e: any) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const url = await fileToDataUrl(f);
            setExp((p: any) => ({ ...p, receipt_url: url }));
          }} />
          {exp.receipt_url && <img src={exp.receipt_url} alt="receipt" style={{ marginTop: 8, maxHeight: 120, borderRadius: 8 }} />}
        </div>
        <div className="muted" style={{ marginBottom: 12 }}>Lands in the Owner/Admin approval queue as Pending.</div>
        <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Submitting…' : 'Submit expense'}</button>
      </form>
    </Modal>
  );
}
