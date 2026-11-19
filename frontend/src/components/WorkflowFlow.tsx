import type { ReactNode } from 'react';
import type { ApproverStatus, WorkflowDto } from '../api/types';
import { Icon } from '../lib/icons';
import { wfCondMet, wfCondText, wfStepShort, type WfState } from '../lib/workflow';

const MS: Record<ApproverStatus, string> = { pending: 'ms-pending', approved: 'ms-approved', rejected: 'ms-rejected', delegated: 'ms-delegated', notRequired: 'ms-not_required' };

function Ends({ children }: { children: ReactNode }) {
  return (
    <div className="flow">
      <div className="fnode me"><Icon name="send" size={15} /> Sender</div><div className="farrow">→</div>
      {children}
      <div className="farrow">→</div><div className="fnode done"><Icon name="sign" size={15} /> Signing</div>
    </div>
  );
}

/** Route preview for the builder (not started yet). */
export function BuilderFlow({ W }: { W: WfState }) {
  const hasAmt = W.amount.trim() !== '';
  return (
    <Ends>
      {W.steps.map((st, i) => {
        const skip = hasAmt && !wfCondMet(st.condOp, st.condValue, W.amount);
        return (
          <FlowGroup key={st.key} sep={i > 0}>
            <div className="fk">{i + 1}. {st.name || 'Step'}{st.condOp !== 'always' ? ' · ' + wfCondText(st.condOp, st.condValue) : ''}</div>
            <div className={'wf-node st-' + (skip ? 'skipped' : 'waiting')}>
              <small>{wfStepShort(st)}{st.escalation ? ' · ⏱ ' + st.escalation.days + 'd' : ''}{skip ? ' · skipped' : ''}</small>
              {st.members.map(m => <span key={m.key} className="wf-who">{m.name || m.hint || 'Approver'}{m.veto && <em>veto</em>}</span>)}
            </div>
          </FlowGroup>
        );
      })}
    </Ends>
  );
}

/** Route view of a live workflow (details, approval page). */
export function LiveFlow({ w }: { w: WorkflowDto }) {
  return (
    <Ends>
      {[...w.steps].sort((a, b) => a.sequence - b.sequence).map((st, i) => (
        <FlowGroup key={st.id} sep={i > 0}>
          <div className="fk">{i + 1}. {st.name}{st.conditionOp !== 'always' ? ' · ' + wfCondText(st.conditionOp, st.conditionValue) : ''}</div>
          <div className={'wf-node st-' + st.status}>
            <small>{st.ruleText}{st.escalationDays ? ' · ⏱ ' + st.escalationDays + 'd' : ''}{st.status === 'skipped' ? ' · skipped' : ''}</small>
            {st.approvers.map(m => (
              <span key={m.id} className={'wf-who ' + MS[m.status]}>{m.name}{m.veto && <em>veto</em>}{m.isBackup && <em>backup</em>}{m.delegatedFrom && <em>delegate</em>}</span>
            ))}
          </div>
        </FlowGroup>
      ))}
    </Ends>
  );
}

function FlowGroup({ sep, children }: { sep: boolean; children: ReactNode }) {
  return <>{sep && <div className="farrow">→</div>}<div className="fgroup">{children}</div></>;
}
