using MgtSign.Api.Contracts;
using MgtSign.Domain;

namespace MgtSign.Api.Services;

public static class Mapping
{
    static bool Same(string? a, string? b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>What the given person can do right now: approve, sign, view, host (in-person) — or null.</summary>
    public static (string? Action, Recipient? Recipient, WorkflowApprover? Approver) Turn(Envelope e, string? email, bool isSender)
    {
        if (e.IsDeleted) return (null, null, null);
        if (e.Status == EnvelopeStatus.PendingApproval && e.Workflow is not null)
        {
            var a = WorkflowEngine.Pending(e.Workflow).FirstOrDefault(x => Same(x.Email, email));
            return a is null ? (null, null, null) : ("approve", null, a);
        }
        if (e.Status == EnvelopeStatus.Sent)
        {
            var group = Routing.CurrentGroup(e);
            var r = group.FirstOrDefault(x => Same(x.Email, email) && x.Role != RecipientRole.InPersonSigner);
            if (r is not null) return (r.Role == RecipientRole.Viewer ? "view" : "sign", r, null);
            if (isSender) { var host = group.FirstOrDefault(x => x.Role == RecipientRole.InPersonSigner); if (host is not null) return ("host", host, null); }
        }
        return (null, null, null);
    }

    public static string StatusLabel(Envelope e, string? myAction)
    {
        if (e.IsDeleted) return "Deleted";
        return e.Status switch
        {
            EnvelopeStatus.Draft => "Draft",
            EnvelopeStatus.Completed => "Completed",
            EnvelopeStatus.Voided => "Voided",
            EnvelopeStatus.Declined => "Declined",
            EnvelopeStatus.PendingApproval => (myAction == "approve" ? "Need to approve" : "Awaiting approval") + StepSuffix(e),
            _ => myAction switch { "sign" => "Need to sign", "view" => "Need to view", "host" => "Host in-person signing", _ => "Waiting for others" }
        };
    }

    static string StepSuffix(Envelope e)
    {
        if (e.Workflow is null || e.Workflow.Steps.Count < 2) return "";
        var a = WorkflowEngine.Active(e.Workflow);
        return a is null ? "" : $" · step {a.Sequence + 1}/{e.Workflow.Steps.Count}";
    }

    public static (int Done, int Total) Progress(Envelope e)
    {
        var acts = e.Recipients.Where(r => r.Acts).ToList();
        var steps = e.Workflow?.Steps ?? [];
        return (acts.Count(r => r.Status != RecipientStatus.Pending) + steps.Count(s => s.Status is StepStatus.Approved or StepStatus.Skipped),
                Math.Max(1, acts.Count + steps.Count));
    }

    public static EnvelopeListItem ToListItem(Envelope e, string? email, Guid userId)
    {
        var (action, _, _) = Turn(e, email, e.SenderId == userId);
        var (done, total) = Progress(e);
        var active = WorkflowEngine.Active(e.Workflow);
        return new EnvelopeListItem(e.Id, e.Code, e.Subject, e.Status, StatusLabel(e, action), action is not null, action, done, total,
            e.Recipients.OrderBy(r => r.RoutingOrder).Select(r => r.Name).ToList(), e.Attachments.Count, e.UpdatedAt, e.IsDeleted,
            e.Workflow?.Type, active is null ? null : active.Sequence + 1, e.Workflow?.Steps.Count);
    }

    public static RecipientDto ToDto(Recipient r) => new(r.Id, r.Name, r.Email, r.Role, r.RoutingOrder, r.Status, r.Color,
        r.AccessCodeHash is not null, r.PrivateMessage, r.CompletedAt);

    public static FieldDto ToDto(Field f) => new(f.Id, f.RecipientId, f.Type, f.Page, f.X, f.Y, f.Width, f.Height, f.Required, f.Label, f.Tooltip, f.Value);

    public static ApproverDto ToDto(WorkflowApprover a) => new(a.Id, a.Name, a.Email, a.Veto, a.Status, a.IsBackup, a.DelegatedFrom,
        a.DelegatedToEmail, a.Comment, a.ActedAt, a.ActedBy);

    public static WorkflowDto ToDto(ApprovalWorkflow w) => new(w.Type, w.AllowDelegation, w.Amount, w.Status,
        w.Steps.OrderBy(s => s.Sequence).Select(s =>
        {
            var t = WorkflowEngine.Tally(s);
            return new StepDto(s.Id, s.Sequence, s.Name, s.Rule, s.QuorumMode, s.QuorumValue, s.ConditionOp, s.ConditionValue, s.EscalationDays,
                s.EscalationMode, s.EscalationName, s.EscalationEmail, s.Status, s.StartedAt, s.EscalatedAt, WorkflowEngine.RuleText(s), t.Approved, t.Need,
                s.Approvers.OrderBy(a => a.Sequence).Select(ToDto).ToList());
        }).ToList());

    public static AttachmentDto ToDto(Attachment a) => new(a.Id, a.FileName, a.ContentType, a.Size, a.Sha256, a.AddedByName, a.Role, a.Context, a.CreatedAt);
    public static DocumentDto ToDto(EnvelopeDocument d) => new(d.Id, d.Kind, d.FileName, d.Size, d.PageCount, d.Sha256);
    public static AuditDto ToDto(AuditEvent a) => new(a.Id, a.At, a.Action, a.Actor, a.Detail, a.IpAddress);

    public static bool CanAddAttachments(Envelope e) => !e.IsDeleted && e.Status is EnvelopeStatus.Draft or EnvelopeStatus.Sent or EnvelopeStatus.PendingApproval;

    public static EnvelopeDetail ToDetail(Envelope e, string? email, Guid userId, bool isAdmin)
    {
        var isSender = e.SenderId == userId;
        var (action, r, a) = Turn(e, email, isSender);
        var active = e.Status is EnvelopeStatus.Sent or EnvelopeStatus.PendingApproval;
        var actions = new EnvelopeActions(
            CanEditFields: isSender && e.Status == EnvelopeStatus.Draft && !e.IsDeleted,
            CanSend: isSender && e.Status == EnvelopeStatus.Draft && !e.IsDeleted,
            CanVoid: (isSender || isAdmin) && !e.IsDeleted && (active || e.Status == EnvelopeStatus.Draft),
            CanDelete: isSender || isAdmin,
            CanAddAttachments: isSender && CanAddAttachments(e),
            CanRemind: isSender && active && !e.IsDeleted,
            CanSaveTemplate: isSender && e.Type == EnvelopeType.Request,
            SignToken: r?.AccessToken, ApproveToken: a?.AccessToken);
        return new EnvelopeDetail(e.Id, e.Code, e.Type, e.Status, StatusLabel(e, action), e.Subject, e.Message, e.SenderName, e.SenderEmail,
            e.CreatedAt, e.SentAt, e.CompletedAt, e.ExpiresAt, e.ReminderDays, e.SigningOrderEnabled, e.VoidReason, e.IsDeleted,
            e.Documents.OrderBy(d => d.Kind).Select(ToDto).ToList(), e.Recipients.OrderBy(x => x.RoutingOrder).ThenBy(x => x.Name).Select(ToDto).ToList(),
            e.Fields.Select(ToDto).ToList(), e.Workflow is null ? null : ToDto(e.Workflow),
            e.Attachments.OrderBy(x => x.CreatedAt).Select(ToDto).ToList(), actions);
    }
}
