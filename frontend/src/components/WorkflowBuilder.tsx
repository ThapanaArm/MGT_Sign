import type { ConditionOp, ContactDto, EscalationMode, QuorumMode, StepRule } from '../api/types';
import { Icon } from '../lib/icons';
import { OP_LABEL, RULE_LABEL, wfMember, wfPreset, wfStep, type WfTypeInfo, type WfMember, type WfState, type WfStep } from '../lib/workflow';
import { BuilderFlow } from './WorkflowFlow';
import { PersonInput } from './PeoplePicker';

/** Approval workflow builder (prototype wfBuilderHtml + wireWfBuilder). `W` is immutable state; `set` replaces it. */
export function WorkflowBuilder({ W, set, types, contacts }: { W: WfState; set: (w: WfState) => void; types: WfTypeInfo[]; contacts: ContactDto[] }) {
  const toggle = (
    <label className="chk"><input type="checkbox" checked={W.enabled} onChange={e => set({ ...W, enabled: e.target.checked })} /> Require approval before the document goes out for signature</label>
  );
  if (!W.enabled) return <>{toggle}<p className="hint">Approvers review the document first. Signers receive it only after the workflow is approved.</p></>;

  const T = types.find(t => t.type === W.type) || types[0];
  const showCond = W.type === 'conditional' || W.steps.some(s => s.condOp !== 'always');
  const setStep = (i: number, patch: Partial<WfStep>) => set({ ...W, steps: W.steps.map((s, k) => k === i ? { ...s, ...patch } : s) });
  const setMember = (i: number, j: number, patch: Partial<WfMember>) =>
    setStep(i, { members: W.steps[i].members.map((m, k) => k === j ? { ...m, ...patch } : m) });

  const pickType = (type: WfState['type']) => {
    const keep = W.steps.flatMap(s => s.members).filter(m => m.name || m.email);
    const p = wfPreset(type);
    let n = 0;
    const steps = p.steps.map(s => ({ ...s, members: s.members.map(m => { const k = keep[n++]; return k ? { ...m, name: k.name, email: k.email } : m; }) }));
    set({ ...W, type, allowDelegation: !!p.allowDelegation, steps });
  };
  const half = (n: number) => String(Math.ceil(n / 2 + 0.01));

  return <>
    {toggle}
    <div className="wf-types" role="radiogroup" aria-label="Approval workflow type">
      {types.map((t, i) => (
        <button key={t.type} className={'wft ' + (W.type === t.type ? 'on' : '')} role="radio" aria-checked={W.type === t.type} onClick={() => pickType(t.type)}>
          <span className="wft-n">{i + 1}</span><Icon name={t.icon} size={18} /><b>{t.en}</b><small>{t.th}</small>
        </button>
      ))}
    </div>
    {T && <div className="wf-desc"><Icon name="info" size={16} /><div><b>{T.en} · {T.th}</b><br />{T.desc}</div>
      <button className="btn sm" title="Replace the steps below with this type's starting layout" onClick={() => { const p = wfPreset(W.type); set({ ...W, steps: p.steps, allowDelegation: !!p.allowDelegation || W.allowDelegation }); }}>Reset steps</button></div>}
    <div className="wf-opts">
      {showCond && <div><label className="l">Document value (THB) <span className="req">*</span></label>
        <input className="inp" type="number" min={0} step={1} value={W.amount} placeholder="e.g. 1500000" style={{ width: 220 }} onChange={e => set({ ...W, amount: e.target.value })} /></div>}
      <label className="chk"><input type="checkbox" checked={W.allowDelegation} onChange={e => set({ ...W, allowDelegation: e.target.checked })} /> Allow approvers to delegate to someone else (recorded in the audit trail)</label>
    </div>
    <div id="wfSteps">
      {W.steps.map((st, i) => {
        const n = st.members.length;
        return (
          <div key={st.key}>
            {i > 0 && <div className="wf-arrow"><Icon name="chev" size={18} /></div>}
            <div className="wfs">
              <div className="wfs-h"><span className="wfs-n">Step {i + 1}</span>
                <input className="inp" value={st.name} placeholder="Step name, e.g. Manager approval" style={{ flex: 1, minWidth: 160 }} onChange={e => setStep(i, { name: e.target.value })} />
                <select className="inp" style={{ width: 180 }} value={st.rule} onChange={e => {
                  const rule = e.target.value as StepRule;
                  setStep(i, rule === 'quorum' ? { rule, quorumMode: 'count', quorumValue: half(n) } : { rule });
                }}>
                  {(Object.keys(RULE_LABEL) as StepRule[]).map(k => <option key={k} value={k}>{RULE_LABEL[k]}</option>)}
                </select>
                {st.rule === 'quorum' && <span className="wfq">at least
                  <input className="inp" type="number" min={1} value={st.quorumValue} style={{ width: 74 }} onChange={e => setStep(i, { quorumValue: e.target.value })} />
                  <select className="inp" style={{ width: 110 }} value={st.quorumMode} onChange={e => {
                    const mode = e.target.value as QuorumMode;
                    setStep(i, { quorumMode: mode, quorumValue: mode === 'percent' ? '60' : half(n) });
                  }}><option value="count">of {n} people</option><option value="percent">% of {n}</option></select></span>}
                <button className="icon-btn" title="Remove step" disabled={W.steps.length < 2} onClick={() => set({ ...W, steps: W.steps.filter((_, k) => k !== i) })}><Icon name="trash" /></button>
              </div>
              {showCond && <div className="wfs-row"><Icon name="key" size={15} /> Use this step when document value
                <select className="inp" style={{ width: 100 }} value={st.condOp} onChange={e => {
                  const op = e.target.value as ConditionOp;
                  setStep(i, { condOp: op, condValue: op === 'always' ? '' : (st.condValue || '1000000') });
                }}>{(Object.keys(OP_LABEL) as ConditionOp[]).map(k => <option key={k} value={k}>{OP_LABEL[k]}</option>)}</select>
                {st.condOp !== 'always' && <><input className="inp" type="number" value={st.condValue} style={{ width: 160 }} onChange={e => setStep(i, { condValue: e.target.value })} /> THB</>}
              </div>}
              <div className="wfm-list">
                {st.members.map((m, j) => (
                  <div className="wfm" key={m.key}>
                    <PersonInput value={m.name} placeholder={(m.hint || 'Approver') + ' name'} ariaLabel="Approver name"
                      onChange={v => setMember(i, j, { name: v })} onPick={p => setMember(i, j, { name: p.name, email: p.email })} />
                    <PersonInput type="email" value={m.email} placeholder="Email" ariaLabel="Approver email"
                      onChange={v => { const p = contacts.find(d => d.email === v); setMember(i, j, p && !m.name ? { email: v, name: p.name } : { email: v }); }}
                      onPick={p => setMember(i, j, { name: p.name, email: p.email })} />
                    <label className="chk veto" title="A veto stops the whole workflow, whatever the rule"><input type="checkbox" checked={m.veto} onChange={e => setMember(i, j, { veto: e.target.checked })} /> Veto</label>
                    <button className="icon-btn" title="Remove approver" disabled={n < 2} onClick={() => {
                      const members = st.members.filter((_, k) => k !== j);
                      setStep(i, { members, quorumValue: st.rule === 'quorum' && st.quorumMode === 'count' ? String(Math.min(Number(st.quorumValue) || 1, members.length)) : st.quorumValue });
                    }}><Icon name="x" size={16} /></button>
                  </div>
                ))}
              </div>
              <div className="wfs-foot">
                <button className="btn sm ghost" onClick={() => setStep(i, { members: [...st.members, wfMember('Approver')] })}><Icon name="plus" size={14} /> Add approver</button>
                <label className="chk"><input type="checkbox" checked={!!st.escalation} onChange={e => setStep(i, { escalation: e.target.checked ? { days: 2, mode: 'addBackup', name: '', email: '' } : null })} /> Escalate if no decision</label>
              </div>
              {st.escalation && <div className="wfs-row esc"><Icon name="clock" size={15} /> After
                <input className="inp" type="number" min={1} value={st.escalation.days} style={{ width: 70 }} onChange={e => setStep(i, { escalation: { ...st.escalation!, days: Number(e.target.value) } })} /> day(s)
                <select className="inp" style={{ width: 230 }} value={st.escalation.mode} onChange={e => setStep(i, { escalation: { ...st.escalation!, mode: e.target.value as EscalationMode } })}>
                  <option value="addBackup">Add a backup authority</option><option value="notify">Remind approvers and notify backup</option>
                </select>
                <PersonInput value={st.escalation.name} placeholder="Backup name" ariaLabel="Backup authority name" style={{ width: 190 }}
                  onChange={v => setStep(i, { escalation: { ...st.escalation!, name: v } })}
                  onPick={p => setStep(i, { escalation: { ...st.escalation!, name: p.name, email: p.email } })} />
                <PersonInput type="email" value={st.escalation.email} placeholder="Backup email" ariaLabel="Backup authority email" style={{ width: 230 }}
                  onChange={v => { const p = contacts.find(d => d.email === v); const esc = st.escalation!; setStep(i, { escalation: { ...esc, email: v, name: p && !esc.name ? p.name : esc.name } }); }}
                  onPick={p => setStep(i, { escalation: { ...st.escalation!, name: p.name, email: p.email } })} />
                <span className="hint" style={{ flexBasis: '100%', margin: 0 }}>Escalation never approves automatically.</span>
              </div>}
            </div>
          </div>
        );
      })}
    </div>
    <button className="btn" onClick={() => set({ ...W, steps: [...W.steps, wfStep('', [wfMember('Approver')])] })}><Icon name="plus" size={16} /> Add step</button>
    <div className="sec" style={{ marginTop: 22 }}>Route preview</div>
    <BuilderFlow W={W} />
  </>;
}
