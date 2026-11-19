namespace MgtSign.Domain;

/// <summary>Starting layouts for the 10 workflow types. Senders can edit every step afterwards.</summary>
public static class WorkflowPresets
{
    public sealed record TypeInfo(WorkflowType Type, string NameEn, string NameTh, string Description);

    public static readonly IReadOnlyList<TypeInfo> Types =
    [
        new(WorkflowType.Single, "Single approval", "อนุมัติคนเดียว", "One approver signs off, e.g. a manager approves a document or a customer signs a contract."),
        new(WorkflowType.Sequential, "Sequential", "อนุมัติตามลำดับ", "Approver 1 must approve before approver 2 and 3 receive it, e.g. Staff → Manager → CEO."),
        new(WorkflowType.Parallel, "Parallel", "อนุมัติพร้อมกัน", "Several approvers receive it at the same time and every one must approve, e.g. Finance, Legal and IT."),
        new(WorkflowType.Hybrid, "Hybrid", "อนุมัติแบบผสม", "Sequential and parallel steps combined, e.g. Manager → Finance + Legal together → CEO."),
        new(WorkflowType.Quorum, "Majority / quorum", "อนุมัติตามจำนวนเสียง", "A minimum number or percentage must approve, e.g. 3 of 5 approvers or at least 60%."),
        new(WorkflowType.Conditional, "Conditional", "อนุมัติตามเงื่อนไข", "The route is chosen from document data, e.g. up to 1,000,000 THB goes to the Manager, above it to the CMO."),
        new(WorkflowType.AnyOne, "Any one", "อนุมัติหนึ่งคนจากกลุ่ม", "Several authorised people receive it; whoever approves first completes the step."),
        new(WorkflowType.Delegated, "Delegated", "มอบหมายผู้อนุมัติแทน", "Approvers may hand the decision to someone else under policy. Every delegation is recorded."),
        new(WorkflowType.Escalation, "Escalation", "ส่งต่อเมื่อเกินกำหนด", "If nobody decides within the deadline, a backup authority is notified or added. Never approves automatically."),
        new(WorkflowType.Veto, "Unanimous / veto", "อนุมัติครบทุกคน + สิทธิคัดค้าน", "Everyone must approve; roles such as Legal or Compliance can veto and stop the whole workflow."),
    ];

    /// <summary>Builds a workflow with placeholder approver names (the "hint" is put in Name, email left empty).</summary>
    public static ApprovalWorkflow Create(WorkflowType type)
    {
        var w = new ApprovalWorkflow { Type = type, AllowDelegation = type == WorkflowType.Delegated };
        void Step(string name, string[] approvers, Action<WorkflowStep>? cfg = null)
        {
            var s = new WorkflowStep { Name = name, Sequence = w.Steps.Count, WorkflowId = w.Id };
            for (var i = 0; i < approvers.Length; i++) s.Approvers.Add(new WorkflowApprover { Name = approvers[i], Sequence = i, StepId = s.Id });
            cfg?.Invoke(s); w.Steps.Add(s);
        }
        switch (type)
        {
            case WorkflowType.Sequential: Step("Staff review", ["Staff"]); Step("Manager", ["Manager"]); Step("CEO", ["CEO"]); break;
            case WorkflowType.Parallel: Step("Department review", ["Finance", "Legal", "IT"]); break;
            case WorkflowType.Hybrid: Step("Manager", ["Manager"]); Step("Finance & Legal", ["Finance", "Legal"]); Step("CEO", ["CEO"]); break;
            case WorkflowType.Quorum: Step("Committee vote", ["Member 1", "Member 2", "Member 3", "Member 4", "Member 5"], s => { s.Rule = StepRule.Quorum; s.QuorumValue = 3; }); break;
            case WorkflowType.Conditional:
                Step("Manager approval", ["Manager"], s => { s.ConditionOp = ConditionOp.Lte; s.ConditionValue = 1_000_000; });
                Step("CMO approval", ["CMO"], s => { s.ConditionOp = ConditionOp.Gt; s.ConditionValue = 1_000_000; });
                break;
            case WorkflowType.AnyOne: Step("Authorised manager", ["Manager A", "Manager B"], s => s.Rule = StepRule.Any); break;
            case WorkflowType.Escalation: Step("Approval", ["Approver"], s => { s.EscalationDays = 2; s.EscalationMode = EscalationMode.AddBackup; }); break;
            case WorkflowType.Veto: Step("Unanimous review", ["Finance", "Legal", "Compliance"], s => { s.Approvers[1].Veto = true; s.Approvers[2].Veto = true; }); break;
            default: Step("Approval", ["Approver"]); break;
        }
        return w;
    }
}
