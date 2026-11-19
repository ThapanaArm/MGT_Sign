using System.Globalization;

namespace MgtSign.Domain;

/// <summary>Writes one audit trail entry.</summary>
public delegate void AuditWriter(string action, string? detail, string actor);

public enum StepOutcome { Open, Approved, Rejected, Vetoed }

/// <summary>What changed after an engine call, so the caller can notify the right people.</summary>
public sealed record WorkflowTransition(
    WorkflowStep? ActivatedStep = null,
    bool WorkflowApproved = false,
    bool Rejected = false,
    bool Vetoed = false,
    bool StepStillOpen = false);

/// <summary>
/// Approval workflow engine. A workflow is an ordered list of steps that must finish before signing starts.
/// Each step has a rule (all / any / quorum), an optional value condition, optional escalation and
/// approvers with optional veto rights. All 10 workflow types are presets of this one model.
/// Escalation never approves anything automatically.
/// </summary>
public static class WorkflowEngine
{
    public const string System = "System";
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static IEnumerable<WorkflowApprover> Voters(WorkflowStep s) =>
        s.Approvers.Where(a => a.Status != ApproverStatus.Delegated && !a.IsBackup);

    public static int Need(WorkflowStep s)
    {
        var n = Voters(s).Count();
        return s.Rule switch
        {
            StepRule.Any => Math.Min(1, n),
            StepRule.Quorum when s.QuorumMode == QuorumMode.Percent => Math.Max(1, (int)Math.Ceiling(n * s.QuorumValue / 100m)),
            StepRule.Quorum => Math.Min(n, Math.Max(1, s.QuorumValue)),
            _ => n
        };
    }

    public static (int Approved, int Rejected, int Total, int Need) Tally(WorkflowStep s)
    {
        var v = Voters(s).ToList();
        return (v.Count(a => a.Status == ApproverStatus.Approved), v.Count(a => a.Status == ApproverStatus.Rejected), v.Count, Need(s));
    }

    public static StepOutcome Evaluate(WorkflowStep s)
    {
        if (s.Approvers.Any(a => a.Veto && a.Status == ApproverStatus.Rejected)) return StepOutcome.Vetoed;
        var t = Tally(s);
        if (t.Approved >= t.Need) return StepOutcome.Approved;
        if (t.Total - t.Rejected < t.Need) return StepOutcome.Rejected;
        return StepOutcome.Open;
    }

    public static bool ConditionMet(WorkflowStep s, decimal? amount)
    {
        if (s.ConditionOp == ConditionOp.Always || s.ConditionValue is null) return true;
        if (amount is null) return false;
        var a = amount.Value; var v = s.ConditionValue.Value;
        return s.ConditionOp switch
        {
            ConditionOp.Lte => a <= v, ConditionOp.Lt => a < v, ConditionOp.Gt => a > v, ConditionOp.Gte => a >= v, _ => true
        };
    }

    public static string ConditionText(WorkflowStep s) => s.ConditionOp == ConditionOp.Always || s.ConditionValue is null ? "" :
        $"value {s.ConditionOp switch { ConditionOp.Lte => "≤", ConditionOp.Lt => "<", ConditionOp.Gt => ">", _ => "≥" }} {Thb(s.ConditionValue)}";

    public static string Thb(decimal? v) => (v ?? 0).ToString("#,0.##", Inv) + " THB";

    public static string RuleText(WorkflowStep s)
    {
        var n = Voters(s).Count();
        return s.Rule switch
        {
            StepRule.Any => $"Any one of {n}",
            StepRule.Quorum when s.QuorumMode == QuorumMode.Percent => $"At least {s.QuorumValue}% ({Need(s)} of {n})",
            StepRule.Quorum => $"At least {Need(s)} of {n}",
            _ => n > 1 ? $"All {n} must approve" : "Approval required"
        };
    }

    public static WorkflowStep? Active(ApprovalWorkflow? w) =>
        w is { Status: WorkflowStatus.Active } ? w.Steps.OrderBy(s => s.Sequence).FirstOrDefault(s => s.Status == StepStatus.Active) : null;

    public static IEnumerable<WorkflowApprover> Pending(ApprovalWorkflow? w) =>
        Active(w)?.Approvers.Where(a => a.Status == ApproverStatus.Pending) ?? [];

    public static WorkflowTransition Start(Envelope e, AuditWriter audit, DateTime now)
    {
        var w = e.Workflow ?? throw new InvalidOperationException("Envelope has no workflow.");
        w.Status = WorkflowStatus.Active;
        audit("Approval workflow started",
            $"{w.Type} · {w.Steps.Count} step(s){(w.Amount is null ? "" : " · document value " + Thb(w.Amount))}", System);
        return Next(e, audit, now);
    }

    /// <summary>Activates the next step whose condition matches. When none is left the workflow is approved.</summary>
    public static WorkflowTransition Next(Envelope e, AuditWriter audit, DateTime now)
    {
        var w = e.Workflow!;
        foreach (var s in w.Steps.OrderBy(s => s.Sequence).Where(s => s.Status == StepStatus.Waiting))
        {
            if (!ConditionMet(s, w.Amount))
            {
                s.Status = StepStatus.Skipped;
                audit("Approval step skipped", $"{s.Name}: condition not met ({ConditionText(s)}; document value {Thb(w.Amount)})", System);
                continue;
            }
            s.Status = StepStatus.Active; s.StartedAt = now; e.Status = EnvelopeStatus.PendingApproval;
            audit("Approval requested", $"{s.Name} · {RuleText(s)} · {string.Join(", ", s.Approvers.Select(a => $"{a.Name} <{a.Email}>"))}", System);
            return new WorkflowTransition(ActivatedStep: s);
        }
        w.Status = WorkflowStatus.Approved;
        audit("Approval workflow approved", "All required approval steps are complete.", System);
        return new WorkflowTransition(WorkflowApproved: true);
    }

    /// <summary>Records one approver's decision and moves the workflow on when the step is decided.</summary>
    public static WorkflowTransition Act(Envelope e, WorkflowApprover a, Decision d, string? comment, AuditWriter audit, DateTime now)
    {
        var s = Active(e.Workflow) ?? throw new DomainException("There is no approval step waiting for a decision.");
        if (a.StepId != s.Id || a.Status != ApproverStatus.Pending) throw new DomainException("This approver has no pending decision in the current step.");
        if (d == Decision.Reject && string.IsNullOrWhiteSpace(comment)) throw new DomainException("A reason is required to reject.");

        var status = d == Decision.Approve ? ApproverStatus.Approved : ApproverStatus.Rejected;
        a.Status = status; a.ActedAt = now; a.Comment = comment;
        if (a.IsBackup)
            foreach (var m in s.Approvers.Where(m => a.OnBehalfOfIds.Contains(m.Id) && m.Status == ApproverStatus.Pending))
            { m.Status = status; m.ActedAt = now; m.ActedBy = a.Name; }

        audit(d == Decision.Approve ? "Approved" : a.Veto ? "Vetoed" : "Rejected",
            $"{s.Name} · {a.Name}{(a.IsBackup ? " (backup authority, on behalf of overdue approvers)" : "")}{(a.DelegatedFrom is null ? "" : $" (delegate of {a.DelegatedFrom})")}{(string.IsNullOrWhiteSpace(comment) ? "" : ": " + comment)}", a.Name);

        var r = Evaluate(s);
        if (r == StepOutcome.Open) return new WorkflowTransition(StepStillOpen: true);
        s.DecidedAt = now;
        foreach (var m in s.Approvers.Where(m => m.Status == ApproverStatus.Pending)) m.Status = ApproverStatus.NotRequired;
        if (r == StepOutcome.Approved)
        {
            s.Status = StepStatus.Approved;
            var t = Tally(s);
            audit("Approval step completed", $"{s.Name} · {t.Approved} of {t.Total} approved (needed {t.Need})", System);
            return Next(e, audit, now);
        }
        s.Status = StepStatus.Rejected; e.Workflow!.Status = WorkflowStatus.Rejected; e.Status = EnvelopeStatus.Declined;
        audit(r == StepOutcome.Vetoed ? "Workflow stopped by veto" : "Approval step rejected",
            r == StepOutcome.Vetoed ? $"{a.Name} used veto rights in {s.Name}." : $"{s.Name} can no longer reach the required approvals.", System);
        return new WorkflowTransition(Rejected: true, Vetoed: r == StepOutcome.Vetoed);
    }

    public static WorkflowApprover Delegate(Envelope e, WorkflowApprover a, string name, string email, string reason, AuditWriter audit, DateTime now)
    {
        var s = Active(e.Workflow) ?? throw new DomainException("There is no approval step waiting for a decision.");
        if (!e.Workflow!.AllowDelegation) throw new DomainException("Delegation is not allowed in this workflow.");
        if (a.StepId != s.Id || a.Status != ApproverStatus.Pending) throw new DomainException("This approver has no pending decision in the current step.");
        if (string.IsNullOrWhiteSpace(reason)) throw new DomainException("A reason is required to delegate.");
        if (string.Equals(email, e.SenderEmail, StringComparison.OrdinalIgnoreCase)) throw new DomainException("The sender cannot approve their own envelope.");
        if (s.Approvers.Any(x => x.Status != ApproverStatus.Delegated && string.Equals(x.Email, email, StringComparison.OrdinalIgnoreCase)))
            throw new DomainException("That person is already an approver in this step.");

        a.Status = ApproverStatus.Delegated; a.DelegatedToEmail = email; a.ActedAt = now; a.Comment = reason;
        var d = new WorkflowApprover
        {
            StepId = s.Id, Name = name, Email = email, Veto = a.Veto, DelegatedFrom = a.Name,
            Sequence = s.Approvers.Count == 0 ? 0 : s.Approvers.Max(x => x.Sequence) + 1
        };
        s.Approvers.Add(d);
        audit("Approval delegated", $"{s.Name} · {a.Name} → {name} <{email}> · {reason}", a.Name);
        return d;
    }

    /// <summary>Escalates an overdue step: reminds, or adds a backup authority. Never approves.</summary>
    public static bool CheckEscalation(Envelope e, AuditWriter audit, DateTime now)
    {
        if (e.Status != EnvelopeStatus.PendingApproval) return false;
        var s = Active(e.Workflow);
        if (s is null || s.EscalationDays is null || s.EscalatedAt is not null || s.StartedAt is null) return false;
        if (now - s.StartedAt.Value < TimeSpan.FromDays(s.EscalationDays.Value)) return false;

        s.EscalatedAt = now;
        var overdue = s.Approvers.Where(a => a.Status == ApproverStatus.Pending && !a.IsBackup).ToList();
        audit("Approval overdue — escalated", $"{s.Name} · no decision within {s.EscalationDays} day(s) from {string.Join(", ", overdue.Select(a => a.Name))}", System);
        if (s.EscalationMode == EscalationMode.AddBackup && !string.IsNullOrWhiteSpace(s.EscalationEmail))
        {
            s.Approvers.Add(new WorkflowApprover
            {
                StepId = s.Id, Name = s.EscalationName ?? s.EscalationEmail!, Email = s.EscalationEmail!, IsBackup = true,
                OnBehalfOf = string.Join(',', overdue.Select(a => a.Id)), Sequence = s.Approvers.Max(x => x.Sequence) + 1
            });
            audit("Backup authority added", $"{s.EscalationName} <{s.EscalationEmail}> may decide on behalf of the overdue approvers. Nothing was approved automatically.", System);
        }
        else
        {
            audit("Escalation notice sent", $"Reminder to {string.Join(", ", overdue.Select(a => a.Email))}{(string.IsNullOrWhiteSpace(s.EscalationEmail) ? "" : "; backup authority " + s.EscalationEmail + " notified")}. Nothing was approved automatically.", System);
        }
        return true;
    }

    /// <summary>Validates a workflow definition before sending. Returns null when valid.</summary>
    public static string? Validate(ApprovalWorkflow w)
    {
        if (w.Steps.Count == 0) return "Add at least one approval step.";
        var usesCondition = w.Steps.Any(s => s.ConditionOp != ConditionOp.Always);
        if (usesCondition && w.Amount is null) return "Enter the document value (THB) used by the conditions.";
        foreach (var (s, i) in w.Steps.OrderBy(s => s.Sequence).Select((s, i) => (s, i)))
        {
            var label = $"Step {i + 1} ({s.Name})";
            if (string.IsNullOrWhiteSpace(s.Name)) return $"Step {i + 1} needs a name.";
            if (s.Approvers.Count == 0) return $"{label} needs at least one approver.";
            if (s.Approvers.Any(a => string.IsNullOrWhiteSpace(a.Name) || !Emails.IsValid(a.Email))) return $"{label}: every approver needs a name and a valid email.";
            if (s.Approvers.Select(a => a.Email.ToLowerInvariant()).Distinct().Count() != s.Approvers.Count) return $"{label}: the same email appears twice.";
            if (s.Rule == StepRule.Quorum && (s.QuorumMode == QuorumMode.Percent ? s.QuorumValue is < 1 or > 100 : s.QuorumValue < 1 || s.QuorumValue > s.Approvers.Count))
                return $"{label}: quorum must be between 1 and {(s.QuorumMode == QuorumMode.Percent ? "100%" : s.Approvers.Count)}.";
            if (s.ConditionOp != ConditionOp.Always && s.ConditionValue is null) return $"{label}: enter a number for the condition.";
            if (s.EscalationDays is not null)
            {
                if (s.EscalationDays < 1) return $"{label}: escalation needs at least 1 day.";
                if (s.EscalationMode == EscalationMode.AddBackup && (string.IsNullOrWhiteSpace(s.EscalationName) || !Emails.IsValid(s.EscalationEmail)))
                    return $"{label}: enter the backup authority's name and email.";
            }
        }
        if (usesCondition && !w.Steps.Any(s => ConditionMet(s, w.Amount))) return "No approval step matches this document value.";
        return null;
    }
}

/// <summary>Signing order: everyone pending in the lowest routing order acts at the same time.</summary>
public static class Routing
{
    public static List<Recipient> CurrentGroup(Envelope e)
    {
        var pending = e.Recipients.Where(r => r.Acts && r.Status == RecipientStatus.Pending).ToList();
        if (pending.Count == 0) return [];
        var min = pending.Min(r => r.RoutingOrder);
        return pending.Where(r => r.RoutingOrder == min).ToList();
    }

    /// <summary>Moves the envelope to the next signing group, or completes it. Returns the group to notify.</summary>
    public static List<Recipient> Advance(Envelope e, AuditWriter audit, DateTime now)
    {
        var group = CurrentGroup(e);
        if (group.Count == 0)
        {
            e.Status = EnvelopeStatus.Completed; e.CompletedAt = now;
            audit("Envelope completed", "All recipients have completed their actions.", WorkflowEngine.System);
            var cc = e.Recipients.Where(r => r.Role == RecipientRole.CarbonCopy).ToList();
            foreach (var r in cc) r.Status = RecipientStatus.Delivered;
            if (cc.Count > 0) audit("Completed copy delivered", "Sent to " + string.Join(", ", cc.Select(r => r.Email)), WorkflowEngine.System);
            return [];
        }
        e.Status = EnvelopeStatus.Sent;
        audit(group[0].Role == RecipientRole.Viewer ? "View request sent" : "Signature request sent",
            string.Join(", ", group.Select(r => $"{r.Name} <{r.Email}>")), WorkflowEngine.System);
        return group;
    }
}

public class DomainException(string message) : Exception(message);

public static class Emails
{
    public static bool IsValid(string? email) =>
        !string.IsNullOrWhiteSpace(email) && System.Text.RegularExpressions.Regex.IsMatch(email.Trim(), @"^[^\s@]+@[^\s@]+\.[^\s@]+$");
}
