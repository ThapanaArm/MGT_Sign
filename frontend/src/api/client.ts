import type * as T from './types';

/** Base URL of the API. In dev, Vite proxies /api to the .NET backend (see vite.config.ts). */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const TOKEN_KEY = 'mgtsign.token';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const auth = {
  get token(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(token: string | null) { try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ } },
};

let accessCode: string | null = null;
/** Access code entered by a signer; sent as X-Access-Code on /api/sign/* calls. */
export function setAccessCode(code: string | null) { accessCode = code; }

async function request<R>(method: string, path: string, body?: unknown, opts: { raw?: boolean } = {}): Promise<R> {
  const headers: Record<string, string> = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (accessCode && path.startsWith('/api/sign/')) headers['X-Access-Code'] = accessCode;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  if (res.status === 401 && !path.startsWith('/api/auth/login')) { auth.set(null); window.dispatchEvent(new Event('mgtsign:unauthorized')); }
  if (!res.ok) {
    let msg = res.statusText || 'Request failed';
    try { const j = await res.json(); msg = j.message || j.title || msg; } catch { /* not json */ }
    throw new ApiError(res.status, msg);
  }
  if (opts.raw) return (await res.blob()) as R;
  if (res.status === 204) return undefined as R;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as R;
}
const get = <R>(p: string) => request<R>('GET', p);
const post = <R>(p: string, b?: unknown) => request<R>('POST', p, b ?? {});
const put = <R>(p: string, b: unknown) => request<R>('PUT', p, b);
const del = <R = void>(p: string) => request<R>('DELETE', p);
const blob = (p: string) => request<Blob>('GET', p, undefined, { raw: true });
const qs = (o: Record<string, unknown>) => { const s = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') s.set(k, String(v)); }); const r = s.toString(); return r ? '?' + r : ''; };
const files = (field: string, list: File[], extra?: (fd: FormData) => void) => { const fd = new FormData(); list.forEach(f => fd.append(field, f)); extra?.(fd); return fd; };

export const api = {
  // auth & profile
  login: (b: T.LoginRequest) => post<T.LoginResponse>('/api/auth/login', b),
  me: () => get<T.UserDto>('/api/auth/me'),
  updateMe: (b: T.ProfileUpdate) => put<T.UserDto>('/api/auth/me', b),
  changePassword: (b: T.PasswordChange) => post<void>('/api/auth/password', b),
  getSignature: () => get<T.SignatureDto>('/api/auth/signature'),
  saveSignature: (b: T.SignatureDto) => put<void>('/api/auth/signature', b),

  // meta & settings
  workflowTypes: () => get<T.WorkflowTypeDto[]>('/api/meta/workflow-types'),
  settings: () => get<T.SettingsDto>('/api/settings'),
  saveSettings: (b: T.SettingsDto) => put<T.SettingsDto>('/api/settings', b),

  // dashboard & envelopes
  dashboard: () => get<T.DashboardDto>('/api/dashboard'),
  envelopes: (q: { folder?: T.Folder; q?: string; status?: string; sender?: 'all' | 'me' | 'received'; days?: string; page?: number; pageSize?: number }) =>
    get<T.EnvelopeListResponse>('/api/envelopes' + qs(q)),
  createEnvelope: (payload: T.CreateEnvelopeRequest, documents: File[], attachments: File[] = []) =>
    post<T.EnvelopeDetail>('/api/envelopes', files('documents', documents, fd => { attachments.forEach(f => fd.append('attachments', f)); fd.append('payload', JSON.stringify(payload)); })),
  envelope: (id: string) => get<T.EnvelopeDetail>(`/api/envelopes/${id}`),
  saveFields: (id: string, b: T.FieldsUpdate) => put<T.EnvelopeDetail>(`/api/envelopes/${id}/fields`, b),
  send: (id: string) => post<T.EnvelopeDetail>(`/api/envelopes/${id}/send`),
  voidEnvelope: (id: string, b: T.VoidRequest) => post<T.EnvelopeDetail>(`/api/envelopes/${id}/void`, b),
  /** Host face-to-face (live) signing for a signer on this device. */
  startLive: (id: string, recipientId: string, b: T.StartLiveRequest) => post<T.LiveSessionResponse>(`/api/envelopes/${id}/live/${recipientId}`, b),
  remind: (id: string) => post<void>(`/api/envelopes/${id}/remind`),
  deleteEnvelope: (id: string) => del(`/api/envelopes/${id}`),
  restoreEnvelope: (id: string) => post<void>(`/api/envelopes/${id}/restore`),
  purgeEnvelope: (id: string) => del(`/api/envelopes/${id}/permanent`),
  document: (id: string, kind: 'original' | 'signed' | 'current' = 'current') => blob(`/api/envelopes/${id}/document?kind=${kind}`),
  audit: (id: string) => get<T.AuditDto[]>(`/api/envelopes/${id}/audit`),
  addAttachments: (id: string, list: File[]) => post<T.AttachmentDto[]>(`/api/envelopes/${id}/attachments`, files('files', list)),
  attachment: (id: string, attId: string) => blob(`/api/envelopes/${id}/attachments/${attId}`),
  exportCsv: () => blob('/api/envelopes/export.csv'),

  // signing link
  signSession: (token: string) => get<T.SignSession>(`/api/sign/${token}`),
  signDocument: (token: string) => blob(`/api/sign/${token}/document`),
  /** Signed copy with Certificate of Completion — available once the envelope is completed. */
  signedDocument: (token: string) => blob(`/api/sign/${token}/signed`),
  completeSigning: (token: string, b: T.CompleteSigningRequest) => post<T.SignSession>(`/api/sign/${token}/complete`, b),
  declineSigning: (token: string, b: T.DeclineRequest) => post<T.SignSession>(`/api/sign/${token}/decline`, b),
  signAttach: (token: string, list: File[]) => post<T.AttachmentDto[]>(`/api/sign/${token}/attachments`, files('files', list)),
  signAttachment: (token: string, attId: string) => blob(`/api/sign/${token}/attachments/${attId}`),

  // approval link
  approvalSession: (token: string) => get<T.ApprovalSession>(`/api/approve/${token}`),
  approvalDocument: (token: string) => blob(`/api/approve/${token}/document`),
  decide: (token: string, b: T.DecisionRequest) => post<T.ApprovalSession>(`/api/approve/${token}/decision`, b),
  delegate: (token: string, b: T.DelegateRequest) => post<T.ApprovalSession>(`/api/approve/${token}/delegate`, b),
  approvalAttach: (token: string, list: File[]) => post<T.AttachmentDto[]>(`/api/approve/${token}/attachments`, files('files', list)),
  approvalAttachment: (token: string, attId: string) => blob(`/api/approve/${token}/attachments/${attId}`),

  // library
  templates: () => get<T.TemplateDto[]>('/api/templates'),
  template: (id: string) => get<T.TemplateDetail>(`/api/templates/${id}`),
  templateDocument: (id: string) => blob(`/api/templates/${id}/document`),
  saveTemplate: (b: T.SaveTemplateRequest) => post<T.TemplateDto>('/api/templates', b),
  deleteTemplate: (id: string) => del(`/api/templates/${id}`),
  contacts: () => get<T.ContactDto[]>('/api/contacts'),
  /** User list: MGT Sign users, saved contacts and active company employees, searched by name/email/username/department. */
  people: (q: string, take = 30) => get<T.PersonDto[]>('/api/directory/people' + qs({ q, take })),
  addContact: (b: T.ContactInput) => post<T.ContactDto>('/api/contacts', b),
  updateContact: (id: string, b: T.ContactInput) => put<T.ContactDto>(`/api/contacts/${id}`, b),
  deleteContact: (id: string) => del(`/api/contacts/${id}`),
  reports: () => get<T.ReportDto>('/api/reports'),

  // admin
  users: () => get<T.AdminUserDto[]>('/api/admin/users'),
  createUser: (b: T.AdminUserInput) => post<T.AdminUserDto>('/api/admin/users', b),
  updateUser: (id: string, b: T.AdminUserInput) => put<T.AdminUserDto>(`/api/admin/users/${id}`, b),
  outbox: (take = 50) => get<T.OutboxDto[]>(`/api/admin/outbox?take=${take}`),
  runEscalations: () => post<{ escalated: number }>('/api/admin/escalations/run'),
  simulateOverdue: (id: string) => post<{ escalated: number }>(`/api/admin/envelopes/${id}/simulate-overdue`),
};

/** Save a Blob as a file in the browser. */
export function saveBlob(b: Blob, filename: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
