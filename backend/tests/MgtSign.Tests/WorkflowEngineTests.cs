using MgtSign.Domain;

namespace MgtSign.Tests;

public class WorkflowEngineTests
{
    static readonly DateTime T0 = new(2026, 11, 19, 9, 0, 0, DateTimeKind.Utc);
    readonly List<string> _audit = [];
    void Audit(string action, string? detail, string actor) => _audit.Add(action);
    int _n;

    Envelope Make(WorkflowType type, decimal? amount = null, Action<ApprovalWorkflow>? cfg = null)
    {
        var w = WorkflowPresets.Create(type);
        w.Amount = amount;
        foreach (var a in w.Steps.SelectMany(s => s.Approvers)) { _n++; a.Name += _n; a.Email = $"u{_n}@example.com"; }
        cfg?.Invoke(w);
        Assert.Null(WorkflowEngine.Validate(w));
        var e = new Envelope { SenderEmail = "sender@example.com", Workflow = w };
        e.Recipients.Add(new Recipient { Name = "Signer", Email = "signer@example.com" });
        WorkflowEngine.Start(e, Audit, T0);
        return e;
    }

    WorkflowTransition Act(Envelope e, int pendingIndex, Decision d) =>
        WorkflowEngine.Act(e, WorkflowEngine.Pending(e.Workflow).ElementAt(pendingIndex), d, d == Decision.Reject ? "no" : null, Audit, T0);

    int StepNo(Envelope e) => WorkflowEngine.Active(e.Workflow) is { } s ? s.Sequence + 1 : 0;

    [Fact] public void Single_approval_completes_workflow()
    {
        var e = Make(WorkflowType.Single);
        var t = Act(e, 0, Decision.Approve);
        Assert.True(t.WorkflowApproved);
        Assert.Equal(WorkflowStatus.Approved, e.Workflow!.Status);
    }

    [Fact] public void Sequential_moves_one_step_at_a_time()
    {
        var e = Make(WorkflowType.Sequential);
        Assert.Equal(1, StepNo(e)); Act(e, 0, Decision.Approve);
        Assert.Equal(2, StepNo(e)); Act(e, 0, Decision.Approve);
        Assert.Equal(3, StepNo(e)); Assert.True(Act(e, 0, Decision.Approve).WorkflowApproved);
    }

    [Fact] public void Parallel_needs_everyone()
    {
        var e = Make(WorkflowType.Parallel);
        Assert.True(Act(e, 0, Decision.Approve).StepStillOpen);
        Assert.True(Act(e, 0, Decision.Approve).StepStillOpen);
        Assert.True(Act(e, 0, Decision.Approve).WorkflowApproved);
    }

    [Fact] public void Hybrid_runs_parallel_step_between_single_steps()
    {
        var e = Make(WorkflowType.Hybrid);
        Act(e, 0, Decision.Approve);
        Assert.Equal(2, WorkflowEngine.Pending(e.Workflow).Count());
        Act(e, 0, Decision.Approve); Assert.Equal(2, StepNo(e));
        Act(e, 0, Decision.Approve); Assert.Equal(3, StepNo(e));
        Assert.True(Act(e, 0, Decision.Approve).WorkflowApproved);
    }

    [Fact] public void Quorum_three_of_five_tolerates_two_rejections()
    {
        var e = Make(WorkflowType.Quorum);
        Act(e, 0, Decision.Reject); Act(e, 0, Decision.Reject); Act(e, 0, Decision.Approve); Act(e, 0, Decision.Approve);
        Assert.Equal(WorkflowStatus.Active, e.Workflow!.Status);
        Assert.True(Act(e, 0, Decision.Approve).WorkflowApproved);
    }

    [Fact] public void Quorum_fails_once_it_cannot_be_reached()
    {
        var e = Make(WorkflowType.Quorum);
        Act(e, 0, Decision.Reject); Act(e, 0, Decision.Reject);
        Assert.True(Act(e, 0, Decision.Reject).Rejected);
        Assert.Equal(EnvelopeStatus.Declined, e.Status);
    }

    [Fact] public void Quorum_percent_rounds_up()
    {
        var e = Make(WorkflowType.Quorum, cfg: w => { w.Steps[0].QuorumMode = QuorumMode.Percent; w.Steps[0].QuorumValue = 60; });
        Assert.Equal(3, WorkflowEngine.Need(WorkflowEngine.Active(e.Workflow)!));
    }

    [Theory]
    [InlineData(500_000, "Manager approval", StepStatus.Waiting)]
    [InlineData(2_000_000, "CMO approval", StepStatus.Active)]
    public void Conditional_routes_by_document_value(decimal amount, string activeStep, StepStatus cmoStatus)
    {
        var e = Make(WorkflowType.Conditional, amount);
        Assert.Equal(activeStep, WorkflowEngine.Active(e.Workflow)!.Name);
        Assert.Equal(cmoStatus, e.Workflow!.Steps[1].Status);
    }

    [Fact] public void Conditional_requires_document_value()
    {
        var w = WorkflowPresets.Create(WorkflowType.Conditional);
        foreach (var a in w.Steps.SelectMany(s => s.Approvers)) a.Email = a.Name.Replace(" ", "") + "@example.com";
        Assert.Contains("document value", WorkflowEngine.Validate(w));
    }

    [Fact] public void AnyOne_first_approval_wins()
    {
        var e = Make(WorkflowType.AnyOne);
        Assert.True(Act(e, 0, Decision.Approve).WorkflowApproved);
        Assert.Equal(ApproverStatus.NotRequired, e.Workflow!.Steps[0].Approvers[1].Status);
    }

    [Fact] public void AnyOne_fails_only_when_everyone_rejects()
    {
        var e = Make(WorkflowType.AnyOne);
        Assert.True(Act(e, 0, Decision.Reject).StepStillOpen);
        Assert.True(Act(e, 0, Decision.Reject).Rejected);
    }

    [Fact] public void Delegate_takes_over_the_decision_and_is_audited()
    {
        var e = Make(WorkflowType.Delegated);
        var orig = WorkflowEngine.Pending(e.Workflow).Single();
        var d = WorkflowEngine.Delegate(e, orig, "Deputy", "deputy@example.com", "On leave", Audit, T0);
        Assert.Equal(ApproverStatus.Delegated, orig.Status);
        Assert.True(WorkflowEngine.Act(e, d, Decision.Approve, null, Audit, T0).WorkflowApproved);
        Assert.Contains("Approval delegated", _audit);
    }

    [Fact] public void Delegation_is_refused_when_not_allowed()
    {
        var e = Make(WorkflowType.Single);
        Assert.Throws<DomainException>(() => WorkflowEngine.Delegate(e, WorkflowEngine.Pending(e.Workflow).Single(), "X", "x@example.com", "r", Audit, T0));
    }

    [Fact] public void Escalation_adds_backup_after_deadline_and_never_auto_approves()
    {
        var e = Make(WorkflowType.Escalation, cfg: w => { w.Steps[0].EscalationName = "Backup"; w.Steps[0].EscalationEmail = "backup@example.com"; });
        Assert.False(WorkflowEngine.CheckEscalation(e, Audit, T0.AddDays(1)));
        Assert.True(WorkflowEngine.CheckEscalation(e, Audit, T0.AddDays(2).AddSeconds(1)));
        Assert.Equal(WorkflowStatus.Active, e.Workflow!.Status);
        var backup = WorkflowEngine.Pending(e.Workflow).Single(a => a.IsBackup);
        Assert.True(WorkflowEngine.Act(e, backup, Decision.Approve, null, Audit, T0.AddDays(3)).WorkflowApproved);
        Assert.Equal("Backup", e.Workflow.Steps[0].Approvers[0].ActedBy);
    }

    [Fact] public void Escalation_notify_mode_only_reminds()
    {
        var e = Make(WorkflowType.Escalation, cfg: w => { w.Steps[0].EscalationMode = EscalationMode.Notify; w.Steps[0].EscalationEmail = "boss@example.com"; });
        Assert.True(WorkflowEngine.CheckEscalation(e, Audit, T0.AddDays(3)));
        Assert.Single(WorkflowEngine.Active(e.Workflow)!.Approvers);
        Assert.Contains("Escalation notice sent", _audit);
    }

    [Fact] public void Veto_stops_the_workflow()
    {
        var e = Make(WorkflowType.Veto);
        Act(e, 0, Decision.Approve);
        var legal = WorkflowEngine.Pending(e.Workflow).First(a => a.Veto);
        var t = WorkflowEngine.Act(e, legal, Decision.Reject, "contract risk", Audit, T0);
        Assert.True(t.Vetoed);
        Assert.Equal(EnvelopeStatus.Declined, e.Status);
    }

    [Fact] public void Veto_overrides_a_reachable_quorum()
    {
        var e = Make(WorkflowType.Quorum, cfg: w => w.Steps[0].Approvers[4].Veto = true);
        var t = WorkflowEngine.Act(e, WorkflowEngine.Pending(e.Workflow).ElementAt(4), Decision.Reject, "veto", Audit, T0);
        Assert.True(t.Vetoed);
    }

    [Fact] public void Reject_requires_a_reason()
    {
        var e = Make(WorkflowType.Single);
        Assert.Throws<DomainException>(() => WorkflowEngine.Act(e, WorkflowEngine.Pending(e.Workflow).Single(), Decision.Reject, " ", Audit, T0));
    }

    [Fact] public void Routing_groups_by_order_and_completes()
    {
        var e = new Envelope();
        e.Recipients.AddRange([
            new Recipient { Name = "A", RoutingOrder = 1 }, new Recipient { Name = "B", RoutingOrder = 1 },
            new Recipient { Name = "C", RoutingOrder = 2 }, new Recipient { Name = "CC", Role = RecipientRole.CarbonCopy, RoutingOrder = 3 }]);
        Assert.Equal(2, Routing.Advance(e, Audit, T0).Count);
        foreach (var r in e.Recipients.Take(2)) r.Status = RecipientStatus.Signed;
        Assert.Equal("C", Routing.Advance(e, Audit, T0).Single().Name);
        e.Recipients[2].Status = RecipientStatus.Signed;
        Assert.Empty(Routing.Advance(e, Audit, T0));
        Assert.Equal(EnvelopeStatus.Completed, e.Status);
        Assert.Equal(RecipientStatus.Delivered, e.Recipients[3].Status);
    }
}
