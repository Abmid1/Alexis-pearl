const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export const authStore = {
  getToken: () => (typeof window !== 'undefined' ? localStorage.getItem('ap_token') : null),
  getUser:  () => { try { return JSON.parse(localStorage.getItem('ap_user') || 'null'); } catch { return null; } },
  set: (token: string, user: any) => { localStorage.setItem('ap_token', token); localStorage.setItem('ap_user', JSON.stringify(user)); },
  clear: () => { localStorage.removeItem('ap_token'); localStorage.removeItem('ap_user'); },
};

async function req<T = any>(path: string, options?: RequestInit): Promise<T> {
  const token = authStore.getToken();
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...options,
  });
  if (res.status === 401 && typeof window !== 'undefined' && !path.includes('/auth/')) {
    authStore.clear();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `API error ${res.status}`);
  return body;
}

const post = (path: string, body?: any) => req(path, { method: 'POST', body: JSON.stringify(body || {}) });
const patch = (path: string, body: any) => req(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = (path: string) => req(path, { method: 'DELETE' });

export const api = {
  login: (email: string, password: string) => post('/api/auth/login', { email, password }),

  dashboard: () => req('/api/dashboard'),

  leads: {
    list: () => req('/api/leads'),
    create: (b: any) => post('/api/leads', b),
    update: (id: string, b: any) => patch(`/api/leads/${id}`, b),
    followedUp: (id: string, days = 3) => post(`/api/leads/${id}/followed-up`, { next_in_days: days }),
  },
  deals: {
    list: () => req('/api/deals'),
    create: (b: any) => post('/api/deals', b),
    update: (id: string, b: any) => patch(`/api/deals/${id}`, b),
    approve: (id: string) => post(`/api/deals/${id}/approve`),
    requestChanges: (id: string, note: string) => post(`/api/deals/${id}/request-changes`, { note }),
  },
  inbox: {
    list: () => req('/api/inbox'),
    get: (id: string) => req(`/api/inbox/${id}`),
    send: (id: string, text: string) => post(`/api/inbox/${id}/send`, { text }),
    approveDraft: (id: string, draftId: string, text?: string) => post(`/api/inbox/${id}/drafts/${draftId}/approve`, { text }),
    discardDraft: (id: string, draftId: string) => del(`/api/inbox/${id}/drafts/${draftId}`),
    setMode: (id: string, mode: 'auto' | 'suggest') => post(`/api/inbox/${id}/mode`, { mode }),
    assign: (id: string, user_id?: string) => post(`/api/inbox/${id}/assign`, { user_id }),
    simulate: (b: any) => post('/api/inbox/simulate-inbound', b),
  },
  marketing: {
    attribution: () => req('/api/marketing/attribution'),
    addCampaign: (b: any) => post('/api/marketing/campaigns', b),
    listings: () => req('/api/marketing/listings'),
    addListing: (b: any) => post('/api/marketing/listings', b),
    genCopy: (id: string) => post(`/api/marketing/listings/${id}/generate-copy`),
    useCopy: (id: string, copy: string) => post(`/api/marketing/listings/${id}/use-copy`, { copy }),
    approveListing: (id: string) => post(`/api/marketing/listings/${id}/approve`),
    rejectListing: (id: string) => post(`/api/marketing/listings/${id}/reject`),
    broadcast: (b: any) => post('/api/marketing/broadcast', b),
  },
  finance: {
    overview: () => req('/api/finance'),
    addInvoice: (b: any) => post('/api/finance/invoices', b),
    markPaid: (id: string) => post(`/api/finance/invoices/${id}/mark-paid`),
    addExpense: (b: any) => post('/api/finance/expenses', b),
    myExpenses: () => req('/api/finance/expenses/mine'),
    approveExpense: (id: string) => post(`/api/finance/expenses/${id}/approve`),
    rejectExpense: (id: string, reason: string) => post(`/api/finance/expenses/${id}/reject`, { reason }),
    approvePayment: (id: string) => post(`/api/finance/payments/${id}/approve`),
  },
  plans: {
    list: () => req('/api/plans'),
    create: (b: any) => post('/api/plans', b),
    recordPayment: (id: string, b: any) => post(`/api/plans/${id}/record-payment`, b),
    updateUnit: (unitId: string, b: any) => patch(`/api/plans/units/${unitId}`, b),
    sendReminders: () => post('/api/plans/send-reminders', { days: 3 }),
  },
  reports: {
    get: () => req('/api/reports'),
    history: () => req('/api/reports/history'),
    sendNow: () => post('/api/reports/send-now'),
  },
  kb: {
    list: () => req('/api/kb'),
    add: (b: any) => post('/api/kb', b),
    remove: (id: string) => del(`/api/kb/${id}`),
    ask: (question: string) => post('/api/kb/ask', { question }),
  },
  pm: {
    overview: () => req('/api/pm'),
    addLease: (b: any) => post('/api/pm/leases', b),
    recordRent: (id: string, b: any) => post(`/api/pm/leases/${id}/record-rent`, b),
    addTicket: (b: any) => post('/api/pm/tickets', b),
    updateTicket: (id: string, b: any) => patch(`/api/pm/tickets/${id}`, b),
  },
  portal: {
    home: () => req('/api/portal'),
    pay: (installmentId: string) => post(`/api/portal/pay/${installmentId}`),
    chat: (body: string) => post('/api/portal/chat', { body }),
    thread: () => req('/api/portal/chat'),
  },
  misc: {
    audit: () => req('/api/audit'),
    outbox: () => req('/api/outbox'),
    clients: () => req('/api/clients'),
    addClient: (b: any) => post('/api/clients', b),
    invite: (id: string) => post(`/api/clients/${id}/invite`),
    team: () => req('/api/team'),
    units: () => req('/api/units'),
    addUnit: (b: any) => post('/api/units', b),
  },
};
