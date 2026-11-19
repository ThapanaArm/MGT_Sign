import type {
  ConditionOp, EscalationMode, QuorumMode, SettingsDto, StepRule, WorkflowInput, WorkflowType, WorkflowTypeDto,
} from '../api/types';
import type { IconName } from './icons';
import { emailOk, fmtTHB, uid } from './format';

/** Local fallback for the 10 workflow types (the API's /meta/workflow-types wins when available). */
export const WF_TYPES: Record<WorkflowType, { en: string; th: string; icon: IconName; desc: string }> = {
  single: { en: 'Single approval', th: 'อนุมัติคนเดียว', icon: 'user', desc: 'One approver signs off, e.g. a manager approves a document or a customer signs a contract.' },
  sequential: { en: 'Sequential', th: 'อนุมัติตามลำดับ', icon: 'chevr', desc: 'Approver 1 must approve before approver 2 and 3 receive it, e.g. Staff → Manager → CEO.' },
  parallel: { en: 'Parallel', th: 'อนุมัติพร้อมกัน', icon: 'copy', desc: 'Several approvers receive it at the same time and every one must approve, e.g. Finance, Legal and IT.' },
  hybrid: { en: 'Hybrid', th: 'อนุมัติแบบผสม', icon: 'tpl', desc: 'Sequential and parallel steps combined, e.g. Manager → Finance + Legal together → CEO.' },
  quorum: { en: 'Majority / quorum', th: 'อนุมัติตามจำนวนเสียง', icon: 'check', desc: 'A minimum number or percentage must approve, e.g. 3 of 5 approvers or at least 60%.' },
  conditional: { en: 'Conditional', th: 'อนุมัติตามเงื่อนไข', icon: 'key', desc: 'The route is chosen from document data, e.g. up to 1,000,000 THB goes to the Manager, above it to the CMO.' },
  anyOne: { en: 'Any one', th: 'อนุมัติหนึ่งคนจากกลุ่ม', icon: 'user', desc: 'Several authorised people receive it; whoever approves first completes the step, e.g. Manager A or Manager B.' },
  delegated: { en: 'Delegated', th: 'มอบหมายผู้อนุมัติแทน', icon: 'share', desc: 'Approvers may hand the decision to someone else under policy. Every delegation is recorded.' },
  escalation: { en: 'Escalation', th: 'ส่งต่อเมื่อเกินกำหนด', icon: 'clock', desc: 'If nobody decides within the deadline (e.g. 2 days), a backup authority is notified or added. Never approves automatically.' },
  veto: { en: 'Unanimous / veto', th: 'อนุมัติครบทุกคน + สิทธิคัดค้าน', icon: 'shield', desc: 'Everyone must approve, and roles such as Legal or Compliance can veto to stop the whole workflow.' },
};
export const WF_ORDER: WorkflowType[] = ['single', 'sequential', 'parallel', 'hybrid', 'quorum', 'conditional', 'anyOne', 'delegated', 'escalation', 'veto'];
export const RULE_LABEL: Record<StepRule, string> = { all: 'All must approve', any: 'Any one approves', quorum: 'Quorum' };
export const OP_LABEL: Record<ConditionOp, string> = { always: 'Always', lte: '≤', lt: '<', gt: '>', gte: '≥' };

export interface WfTypeInfo { type: WorkflowType; en: string; th: string; desc: string; icon: IconName }
/** Merge API metadata with local icons; falls back to the local list. */
export function wfTypeList(api?: WorkflowTypeDto[] | null): WfTypeInfo[] {
  if (api && api.length) return api.map(t => ({ type: t.type, en: t.nameEn, th: t.nameTh, desc: t.description, icon: WF_TYPES[t.type]?.icon ?? 'approve' }));
  return WF_ORDER.map(k => ({ type: k, ...WF_TYPES[k] }));
}
export const wfName = (t: WorkflowType | null | undefined) => (t && WF_TYPES[t]?.en) || t || '';

/* ---------- builder state ---------- */
export interface WfMember { key: string; name: string; email: string; veto: boolean; hint: string }
export interface WfEscalation { days: number; mode: EscalationMode; name: string; email: string }
export interface WfStep {
  key: string; name: string; rule: StepRule; quorumMode: QuorumMode; quorumValue: string;
  condOp: ConditionOp; condValue: string; escalation: WfEscalation | null; members: WfMember[];
}
export interface WfState { enabled: boolean; type: WorkflowType; allowDelegation: boolean; amount: string; steps: WfStep[] }

export const wfMember = (hint: string, extra: Partial<WfMember> = {}): WfMember => ({ key: uid(), name: '', email: '', veto: false, hint, ...extra });
export const wfStep = (name: string, members: WfMember[], extra: Partial<WfStep> = {}): WfStep => ({
  key: uid(), name, rule: 'all', quorumMode: 'count', quorumValue: '1', condOp: 'always', condValue: '', escalation: null, members, ...extra,
});

/** Starting layouts per type (prototype wfPreset). */
export function wfPreset(type: WorkflowType): { allowDelegation?: boolean; steps: WfStep[] } {
  const m = wfMember, s = wfStep;
  switch (type) {
    case 'sequential': return { steps: [s('Staff review', [m('Staff')]), s('Manager', [m('Manager')]), s('CEO', [m('CEO')])] };
    case 'parallel': return { steps: [s('Department review', [m('Finance'), m('Legal'), m('IT')])] };
    case 'hybrid': return { steps: [s('Manager', [m('Manager')]), s('Finance & Legal', [m('Finance'), m('Legal')]), s('CEO', [m('CEO')])] };
    case 'quorum': return { steps: [s('Committee vote', [1, 2, 3, 4, 5].map(i => m('Committee member ' + i)), { rule: 'quorum', quorumMode: 'count', quorumValue: '3' })] };
    case 'conditional': return {
      steps: [
        s('Manager approval', [m('Manager')], { condOp: 'lte', condValue: '1000000' }),
        s('CMO approval', [m('CMO')], { condOp: 'gt', condValue: '1000000' }),
      ],
    };
    case 'anyOne': return { steps: [s('Authorised manager', [m('Manager A'), m('Manager B')], { rule: 'any' })] };
    case 'delegated': return { allowDelegation: true, steps: [s('Approval', [m('Approver')])] };
    case 'escalation': return { steps: [s('Approval', [m('Approver')], { escalation: { days: 2, mode: 'addBackup', name: '', email: '' } })] };
    case 'veto': return { steps: [s('Unanimous review', [m('Finance'), m('Legal', { veto: true }), m('Compliance', { veto: true })])] };
    default: return { steps: [s('Approval', [m('Approver')])] };
  }
}

/** Initial builder state from settings defaults (prototype wfDefault). */
export function wfDefault(settings?: SettingsDto | null): WfState {
  const type = settings?.defaultWorkflowType || 'single';
  const p = wfPreset(type);
  const st: WfState = { enabled: !!(settings?.requireApproval && settings?.defaultApproverEmail), type, allowDelegation: !!p.allowDelegation, amount: '', steps: p.steps };
  if (settings?.defaultApproverEmail && st.steps[0]?.members[0]) {
    st.steps[0].members[0] = { ...st.steps[0].members[0], name: settings.defaultApproverName || '', email: settings.defaultApproverEmail };
  }
  return st;
}

/** Builder state from a saved workflow definition (templates). */
export function wfFromInput(w: WorkflowInput): WfState {
  return {
    enabled: true, type: w.type, allowDelegation: w.allowDelegation, amount: w.amount != null ? String(w.amount) : '',
    steps: w.steps.map(s => wfStep(s.name, s.approvers.map(a => wfMember('Approver', { name: a.name, email: a.email, veto: a.veto })), {
      rule: s.rule, quorumMode: s.quorumMode, quorumValue: String(s.quorumValue ?? 1), condOp: s.conditionOp || 'always',
      condValue: s.conditionValue != null ? String(s.conditionValue) : '',
      escalation: s.escalationDays ? { days: s.escalationDays, mode: s.escalationMode || 'notify', name: s.escalationName || '', email: s.escalationEmail || '' } : null,
    })),
  };
}

/** Builder state -> API input. */
export function wfToInput(W: WfState): WorkflowInput {
  return {
    type: W.type, allowDelegation: W.allowDelegation, amount: W.amount.trim() === '' ? null : Number(W.amount),
    steps: W.steps.map(s => ({
      name: s.name.trim(), rule: s.rule, quorumMode: s.quorumMode, quorumValue: s.rule === 'quorum' ? Number(s.quorumValue) || 1 : 1,
      conditionOp: s.condOp, conditionValue: s.condOp === 'always' ? null : Number(s.condValue),
      escalationDays: s.escalation ? s.escalation.days : null, escalationMode: s.escalation ? s.escalation.mode : null,
      escalationName: s.escalation?.name.trim() || null, escalationEmail: s.escalation?.email.trim() || null,
      approvers: s.members.map(m => ({ name: m.name.trim(), email: m.email.trim(), veto: m.veto })),
    })),
  };
}

export const wfCondText = (op: ConditionOp, value: string | number | null | undefined) => op === 'always' ? '' : `Value ${OP_LABEL[op]} ${fmtTHB(value)}`;
export function wfCondMet(op: ConditionOp, value: string | number | null | undefined, amount: string | number | null | undefined) {
  if (op === 'always') return true;
  const a = Number(amount), v = Number(value);
  return { lte: a <= v, lt: a < v, gt: a > v, gte: a >= v }[op];
}

/** Short rule summary for the route preview of a builder step. */
export function wfStepShort(s: WfStep) {
  if (s.rule === 'quorum') return s.quorumMode === 'percent' ? `≥ ${s.quorumValue}%` : `${s.quorumValue} of ${s.members.length}`;
  if (s.rule === 'any') return 'Any one';
  return s.members.length > 1 ? 'All' : 'Single';
}

/** Prototype wfValidate. Returns '' when valid. */
export function wfValidate(W: WfState): string {
  if (!W.steps.length) return 'Add at least one approval step.';
  const usesCond = W.steps.some(s => s.condOp !== 'always');
  if (usesCond && (W.amount.trim() === '' || isNaN(Number(W.amount)))) return 'Enter the document value (THB) used by the conditions.';
  for (const [i, st] of W.steps.entries()) {
    const label = `Step ${i + 1} (${st.name || 'unnamed'})`;
    if (!st.name.trim()) return `Step ${i + 1} needs a name.`;
    if (!st.members.length) return `${label} needs at least one approver.`;
    for (const m of st.members) if (!m.name.trim() || !emailOk(m.email.trim())) return `${label}: every approver needs a name and a valid email.`;
    const emails = st.members.map(m => m.email.trim().toLowerCase());
    if (new Set(emails).size !== emails.length) return `${label}: the same email appears twice.`;
    if (st.rule === 'quorum') {
      const v = Number(st.quorumValue);
      if (st.quorumMode === 'percent' ? !(v >= 1 && v <= 100) : !(v >= 1 && v <= st.members.length)) return `${label}: quorum must be between 1 and ${st.quorumMode === 'percent' ? '100%' : st.members.length}.`;
    }
    if (st.condOp !== 'always' && (st.condValue.trim() === '' || isNaN(Number(st.condValue)))) return `${label}: enter a number for the condition.`;
    if (st.escalation) {
      if (!(st.escalation.days >= 1)) return `${label}: escalation needs at least 1 day.`;
      if (st.escalation.mode === 'addBackup' && (!st.escalation.name.trim() || !emailOk(st.escalation.email.trim()))) return `${label}: enter the backup authority's name and email.`;
    }
  }
  if (usesCond && !W.steps.some(s => wfCondMet(s.condOp, s.condValue, W.amount))) return 'No approval step matches this document value. Adjust the conditions or the value.';
  return '';
}
