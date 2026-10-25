export const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

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
  changePassword: (currentPassword: string, newPassword: string) => post('/api/auth/change-password', { currentPassword, newPassword }),

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
    updateListing: (id: string, b: any) => patch(`/api/marketing/listings/${id}`, b),
    submitListing: (id: string) => post(`/api/marketing/listings/${id}/submit`),
    unpublishListing: (id: string) => post(`/api/marketing/listings/${id}/unpublish`),
    archiveListing: (id: string) => post(`/api/marketing/listings/${id}/archive`),
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
    setPublic: (id: string, is_public: boolean) => patch(`/api/kb/${id}/visibility`, { is_public }),
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
  viewings: {
    list: (status = 'all') => req(`/api/viewings?status=${encodeURIComponent(status)}`),
    confirm: (id: string, b: any = {}) => post(`/api/viewings/${id}/confirm`, b),
    decline: (id: string, reason: string, notify = true) => post(`/api/viewings/${id}/decline`, { reason, notify }),
    reschedule: (id: string, b: any) => post(`/api/viewings/${id}/reschedule`, b),
    cancel: (id: string, reason?: string) => post(`/api/viewings/${id}/cancel`, { reason }),
    outcome: (id: string, status: 'completed' | 'no_show', outcome?: string) => post(`/api/viewings/${id}/outcome`, { status, outcome }),
    update: (id: string, b: any) => patch(`/api/viewings/${id}`, b),
  },
  enquiries: {
    list: (status = 'all') => req(`/api/enquiries?status=${encodeURIComponent(status)}`),
    setStatus: (id: string, status: string) => patch(`/api/enquiries/${id}`, { status }),
  },
  applications: {
    list: (status = 'all') => req(`/api/applications?status=${encodeURIComponent(status)}`),
    get: (id: string) => req(`/api/applications/${id}`),
    setStatus: (id: string, b: { status: string; message?: string; requested_documents?: string[]; notify?: boolean }) => post(`/api/applications/${id}/status`, b),
    note: (id: string, staff_note: string) => patch(`/api/applications/${id}`, { staff_note }),
    documentUrl: (id: string, docId: string) => req(`/api/applications/${id}/documents/${docId}`),
  },
  docRequests: {
    list: (status = 'all') => req(`/api/document-requests?status=${encodeURIComponent(status)}`),
    get: (id: string) => req(`/api/document-requests/${id}`),
    setStatus: (id: string, b: any) => post(`/api/document-requests/${id}/status`, b),
    upload: (id: string, b: any) => post(`/api/document-requests/${id}/files`, b),
    fileUrl: (id: string, fileId: string) => req(`/api/document-requests/${id}/files/${fileId}`),
    note: (id: string, staff_note: string) => patch(`/api/document-requests/${id}`, { staff_note }),
  },
  serviceRequests: {
    list: (status = 'all') => req(`/api/service-requests?status=${encodeURIComponent(status)}`),
    setStatus: (id: string, b: any) => post(`/api/service-requests/${id}/status`, b),
    convert: (id: string, b: any = {}) => post(`/api/service-requests/${id}/convert`, b),
    note: (id: string, staff_note: string) => patch(`/api/service-requests/${id}`, { staff_note }),
  },
  offers: {
    list: () => req('/api/offers'),
    create: (b: any) => post('/api/offers', b),
    update: (id: string, b: any) => patch(`/api/offers/${id}`, b),
    send: (id: string, notify = true) => post(`/api/offers/${id}/send`, { notify }),
    withdraw: (id: string, notify = true) => post(`/api/offers/${id}/withdraw`, { notify }),
  },
  transactions: {
    list: () => req('/api/transactions'),
    create: (b: any) => post('/api/transactions', b),
    update: (id: string, b: any) => patch(`/api/transactions/${id}`, b),
  },
  company: {
    get: () => req('/api/company'),
    update: (b: any) => patch('/api/company', b),
  },
  misc: {
    audit: () => req('/api/audit'),
    outbox: () => req('/api/outbox'),
    clients: () => req('/api/clients'),
    addClient: (b: any) => post('/api/clients', b),
    invite: (id: string) => post(`/api/clients/${id}/invite`),
    team: () => req('/api/team'),
    addTeamMember: (b: any) => post('/api/team', b),
    units: () => req('/api/units'),
    addUnit: (b: any) => post('/api/units', b),
  },
};
