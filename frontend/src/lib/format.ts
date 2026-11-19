import type { EnvelopeStatus, RecipientRole, RecipientStatus, AttachmentRole, Folder } from '../api/types';
import type { IconName } from './icons';

/** Date + time in en-US, like the prototype's fmt(). */
export const fmt = (t?: string | number | null) => {
  if (!t) return '-';
  const d = new Date(t);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-US') + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).toLowerCase();
};
export const fmtDate = (t: string | number | Date) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const ago = (t: string | number) => {
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' minutes ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hours ago';
  return Math.floor(s / 86400) + ' days ago';
};
export const fmtTHB = (v: number | string | null | undefined) => (Number(v) || 0).toLocaleString('en-US') + ' THB';
export const fmtSize = (b: number) => b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
export const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const initials = (n?: string | null) => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const uid = () => Math.random().toString(36).slice(2, 10);

export const STATUS_CLASS: Record<EnvelopeStatus, string> = {
  draft: 'draft', pendingApproval: 'pending_approval', sent: 'sent', completed: 'completed', declined: 'declined', voided: 'voided',
};
export const STATUS_LABEL: Record<EnvelopeStatus, string> = {
  draft: 'Draft', pendingApproval: 'Awaiting approval', sent: 'Waiting for signature', completed: 'Completed', declined: 'Declined', voided: 'Voided',
};
export const FOLDER_TITLE: Record<Folder, string> = {
  all: 'All agreements', drafts: 'Drafts', progress: 'In progress', approval: 'Awaiting approval', completed: 'Completed', voided: 'Voided & declined', deleted: 'Deleted',
};
export const FOLDERS: Folder[] = ['all', 'drafts', 'progress', 'approval', 'completed', 'voided', 'deleted'];
export const FOLDER_ICON: Record<Folder, IconName> = {
  all: 'folder', drafts: 'pages', progress: 'send', approval: 'approve', completed: 'check', voided: 'ban', deleted: 'trash',
};

export const ROLE_LABEL: Record<RecipientRole, string> = {
  signer: 'Needs to Sign', inPersonSigner: 'In Person Signer', viewer: 'Needs to View', carbonCopy: 'Receives a Copy',
};
export const ROLE_ICON: Record<RecipientRole, IconName> = { signer: 'sign', inPersonSigner: 'user', viewer: 'eye', carbonCopy: 'copy' };
export const isSignerRole = (r: RecipientRole) => r === 'signer' || r === 'inPersonSigner';
export const RECIPIENT_STATUS_CLASS: Partial<Record<RecipientStatus, string>> = { signed: 'completed', viewed: 'completed', declined: 'declined', delivered: 'sent' };
export const ATT_ROLE: Record<AttachmentRole, string> = { sender: 'Sender', approver: 'Approver', signer: 'Signer', viewer: 'Viewer' };
export const REMINDERS: Record<string, string> = { '0': 'Never', '1': 'Every day', '2': 'Every 2 days', '3': 'Every 3 days', '7': 'Every week' };
/** Fallback recipient colors (the server normally assigns RecipientDto.color). */
export const COLORS = ['#F5C04A', '#6CC6E8', '#B79CF2', '#7CD6A5', '#F29C9C', '#F2B880', '#9FB4F5'];

export function attKind(name: string): [string, string] {
  const x = (name.split('.').pop() || '').toLowerCase();
  if (x === 'pdf') return ['PDF', 'tone-red'];
  if (/^(xlsx?|csv)$/.test(x)) return [x.toUpperCase(), 'tone-green'];
  if (/^docx?$/.test(x)) return ['DOC', 'tone-blue'];
  if (/^pptx?$/.test(x)) return ['PPT', 'tone-amber'];
  if (/^(png|jpe?g|gif|webp)$/.test(x)) return ['IMG', 'tone-blue'];
  return [x.toUpperCase().slice(0, 4) || 'FILE', 'tone-amber'];
}
export const ATT_OK = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|png|jpe?g|gif|webp|zip|msg|eml)$/i;
export const ATT_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp,.zip,.msg,.eml';
export const ATT_MAX = 25 * 1024 * 1024;
export const ATT_MAX_COUNT = 20;

/** Validate supporting attachments like the prototype. Returns accepted files and an error summary (or ''). */
export function checkAttachments(list: File[], already = 0): { ok: File[]; error: string } {
  const ok: File[] = [], bad: string[] = [];
  for (const f of list) {
    if (already + ok.length >= ATT_MAX_COUNT) { bad.push(`${f.name}: limit of ${ATT_MAX_COUNT} attachments reached`); continue; }
    if (!ATT_OK.test(f.name)) { bad.push(`${f.name}: file type not allowed`); continue; }
    if (f.size > ATT_MAX) { bad.push(`${f.name}: larger than ${fmtSize(ATT_MAX)}`); continue; }
    if (!f.size) { bad.push(`${f.name}: file is empty`); continue; }
    ok.push(f);
  }
  return { ok, error: bad.length === 0 ? '' : bad.length === 1 ? bad[0] : `${bad.length} files were not added — ${bad[0]}` };
}

/** Open a native file picker without a persistent <input>. */
export function pickFiles(cb: (files: File[]) => void, accept = ATT_ACCEPT, multiple = true) {
  const i = document.createElement('input');
  i.type = 'file'; i.multiple = multiple; i.accept = accept;
  i.onchange = () => cb(i.files ? Array.from(i.files) : []);
  i.click();
}

export const errMsg = (e: unknown) => e instanceof Error ? e.message : String(e);
