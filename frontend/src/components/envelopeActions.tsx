import { useNavigate } from 'react-router-dom';
import { api, saveBlob } from '../api/client';
import type { EnvelopeDetail, EnvelopeListItem } from '../api/types';
import { errMsg } from '../lib/format';
import type { MenuItem } from './ui';
import { useUi } from './ui';

export const isActive = (s: EnvelopeListItem['status']) => s === 'sent' || s === 'pendingApproval';
export const isVoidable = (s: EnvelopeListItem['status']) => s === 'sent' || s === 'pendingApproval' || s === 'draft';

/** File name and kind to download: the signed PDF when one exists, otherwise the current document. */
export function downloadTarget(e: EnvelopeDetail): { kind: 'signed' | 'current'; name: string } {
  const signed = e.documents.find(d => d.kind === 'signed');
  const doc = signed || e.documents.find(d => d.kind === 'original') || e.documents[0];
  return { kind: signed ? 'signed' : 'current', name: doc?.fileName || e.code + '.pdf' };
}

/** Shared envelope actions for Home, Agreements and Details. `after` runs once an action changed something. */
export function useEnvelopeActions(after: () => void) {
  const ui = useUi();
  const nav = useNavigate();

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) ui.toast(ok); after(); return true; } catch (e) { ui.toast(errMsg(e)); return false; }
  };

  const download = async (id: string, detail?: EnvelopeDetail) => {
    try {
      const e = detail || await api.envelope(id);
      const t = downloadTarget(e);
      saveBlob(await api.document(id, t.kind), t.name);
    } catch (err) { ui.toast(errMsg(err)); }
  };

  const openSign = async (id: string) => {
    try {
      const e = await api.envelope(id);
      if (e.actions.signToken) nav('/sign/' + e.actions.signToken);
      else if (e.actions.approveToken) nav('/approve/' + e.actions.approveToken);
      else { ui.toast('There is nothing for you to sign right now.'); nav('/envelopes/' + id); }
    } catch (err) { ui.toast(errMsg(err)); }
  };
  const openApprove = async (id: string) => {
    try {
      const e = await api.envelope(id);
      if (e.actions.approveToken) nav('/approve/' + e.actions.approveToken);
      else { ui.toast('There is nothing for you to approve right now.'); nav('/envelopes/' + id); }
    } catch (err) { ui.toast(errMsg(err)); }
  };

  const voidOne = async (id: string) => {
    const reason = await ui.confirm({ title: 'Void this envelope?', text: 'Recipients will no longer be able to view or sign it. This cannot be undone.', okLabel: 'Void', withReason: true });
    if (reason === null) return false;
    return run(() => api.voidEnvelope(id, { reason }), 'Envelope voided.');
  };
  const remind = (id: string) => run(() => api.remind(id), 'Reminder sent.');
  const del = async (id: string) => {
    if (await ui.confirm({ title: 'Delete agreement?', text: 'It moves to the Deleted folder. You can restore it from there.', okLabel: 'Delete' }) === null) return false;
    return run(() => api.deleteEnvelope(id), 'Moved to Deleted.');
  };
  const restore = (id: string) => run(() => api.restoreEnvelope(id), 'Restored.');
  const purge = async (id: string) => {
    if (await ui.confirm({ title: 'Delete permanently?', text: 'This removes the document, its attachments and its audit trail from MGT Sign. This cannot be undone.', okLabel: 'Delete permanently' }) === null) return false;
    return run(() => api.purgeEnvelope(id), 'Deleted permanently.');
  };
  const saveTemplate = async (id: string, suggested: string) => {
    const name = await ui.prompt({ title: 'Save as template', text: 'Saves the document, recipient roles, signing order, approval workflow and field placements so you can reuse them.', label: 'Template name', value: suggested, maxLength: 200 });
    if (name === null) return;
    try { await api.saveTemplate({ envelopeId: id, name }); ui.toast('Template saved.'); nav('/templates'); } catch (e) { ui.toast(errMsg(e)); }
  };

  /** Main row button for a list item. */
  const primary = (e: EnvelopeListItem): { label: string; cls: string; run: () => void } => {
    if (e.isDeleted) return { label: 'Restore', cls: '', run: () => void restore(e.id) };
    switch (e.myAction) {
      case 'sign': return { label: 'Sign', cls: 'primary', run: () => void openSign(e.id) };
      case 'host': return { label: 'Host signing', cls: 'primary', run: () => void openSign(e.id) };
      case 'view': return { label: 'View', cls: 'primary', run: () => void openSign(e.id) };
      case 'approve': return { label: 'Approve', cls: 'primary', run: () => void openApprove(e.id) };
    }
    if (e.status === 'draft') return { label: 'Continue', cls: '', run: () => nav(`/envelopes/${e.id}/prepare`) };
    if (e.status === 'completed') return { label: 'Download', cls: '', run: () => void download(e.id) };
    return { label: 'View', cls: '', run: () => nav('/envelopes/' + e.id) };
  };

  /** Kebab menu items for a list item. */
  const menuItems = (e: EnvelopeListItem): MenuItem[] => {
    const items: MenuItem[] = [
      { label: 'View details & audit trail', icon: 'hist', run: () => nav('/envelopes/' + e.id) },
      { label: 'Download', icon: 'down', run: () => void download(e.id) },
    ];
    if (!e.isDeleted) {
      if (e.status === 'draft') items.push({ label: 'Continue editing', icon: 'edit', run: () => nav(`/envelopes/${e.id}/prepare`) });
      if (e.status !== 'draft') items.push({ label: 'Save as template', icon: 'tpl', run: () => void saveTemplate(e.id, e.subject) });
      if (isActive(e.status)) items.push({ label: 'Resend reminder', icon: 'mail', run: () => void remind(e.id) });
      if (isVoidable(e.status)) items.push({ label: 'Void', icon: 'ban', bad: true, run: () => void voidOne(e.id) });
      items.push({ label: 'Delete', icon: 'trash', bad: true, run: () => void del(e.id) });
    } else {
      items.push({ label: 'Restore', icon: 'hist', run: () => void restore(e.id) });
      items.push({ label: 'Delete permanently', icon: 'trash', bad: true, run: () => void purge(e.id) });
    }
    return items;
  };

  return { primary, menuItems, download, voidOne, remind, del, restore, purge, saveTemplate, openSign, openApprove };
}
