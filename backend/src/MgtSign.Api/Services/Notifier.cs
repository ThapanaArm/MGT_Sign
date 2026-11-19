using System.Net;
using MgtSign.Domain;
using MgtSign.Infrastructure;
using Microsoft.Extensions.Options;

namespace MgtSign.Api.Services;

public sealed class AppOptions
{
    /// <summary>Public URL of the web app, used in email links (e.g. https://sign.mgt-group.com).</summary>
    public string PublicUrl { get; set; } = "http://localhost:5173";
}

/// <summary>Queues notification emails in the outbox. Links carry per-person tokens.</summary>
public sealed class Notifier(AppDbContext db, IOptions<AppOptions> app)
{
    string Url => app.Value.PublicUrl.TrimEnd('/');
    static string H(string? s) => WebUtility.HtmlEncode(s ?? "");

    void Queue(Envelope e, IEnumerable<string> to, string subject, string heading, string bodyHtml, string? cta, string? link)
    {
        var list = to.Where(Emails.IsValid).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (list.Count == 0) return;
        var attach = e.Attachments.Count == 0 ? "" :
            $"<p style=\"margin:18px 0 0;padding:10px 12px;border:1px solid #e1e7ef;border-radius:8px;font-size:12px;color:#64748b\"><b style=\"color:#12263f\">{e.Attachments.Count} attachment(s)</b> available in MGT Sign: {H(string.Join(", ", e.Attachments.Select(a => a.FileName)))}</p>";
        var button = link is null ? "" : $"<a href=\"{H(link)}\" style=\"display:inline-block;background:#78b83e;color:#0b2038;padding:11px 20px;border-radius:8px;font-weight:800;text-decoration:none;margin-top:10px\">{H(cta)}</a>";
        var html = $"""
            <div style="background:#eef3f9;padding:24px;font-family:'Segoe UI','Leelawadee UI',Tahoma,sans-serif;color:#12263f">
              <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden">
                <div style="padding:16px 26px;display:flex;align-items:center;gap:12px"><img src="{Url}/mgt-logo.png" alt="MGT Group" height="38"><b style="padding-left:12px;border-left:1px solid #e1e7ef">MGT Sign</b></div>
                <div style="background:#0b2038;color:#f6f9fd;padding:30px 32px">
                  <h1 style="font-size:22px;margin:0 0 18px;line-height:1.3">{H(heading)}</h1>
                  <div style="font-size:14px;line-height:1.7;color:#dbe6f2">{bodyHtml}</div>
                  {button}
                </div>
                <div style="padding:0 26px">{attach}</div>
                <p style="padding:16px 26px;font-size:11px;color:#64748b;line-height:1.7;margin:0"><b>Do not share this email.</b> It contains a personal link to MGT Sign. Envelope {H(e.Code)} · Expires {e.ExpiresAt:dd MMM yyyy}<br>MGT Sign — MGT Electronic Signature Management System</p>
              </div>
            </div>
            """;
        db.OutboxEmails.Add(new OutboxEmail { EnvelopeId = e.Id, To = string.Join(",", list), Subject = subject, BodyHtml = html });
    }

    string Msg(Envelope e) => string.IsNullOrWhiteSpace(e.Message) ? "" : $"<p>{H(e.Message).Replace("\n", "<br>")}</p>";

    public void SigningRequest(Envelope e, IEnumerable<Recipient> group)
    {
        foreach (var r in group)
        {
            if (r.Role == RecipientRole.InPersonSigner)
            { Queue(e, [e.SenderEmail], "Host in-person signing: " + e.Subject, $"{r.Name} is ready to sign in person", $"<p>Open the link on your device and hand it to {H(r.Name)}.</p>", "START IN-PERSON SIGNING", $"{Url}/sign/{r.AccessToken}"); continue; }
            var viewer = r.Role == RecipientRole.Viewer;
            var pm = string.IsNullOrWhiteSpace(r.PrivateMessage) ? "" : $"<p style=\"background:rgba(255,255,255,.08);padding:10px 14px;border-left:3px solid #78b83e\"><b>Private message for you:</b><br>{H(r.PrivateMessage)}</p>";
            var code = r.AccessCodeHash is null ? "" : "<p style=\"font-size:13px;opacity:.85\">You will need an access code from the sender to open this document.</p>";
            Queue(e, [r.Email], e.Subject, viewer ? $"{e.SenderName} sent you a document to view" : $"{e.SenderName} sent you a document to review and sign",
                $"<p>Hi {H(r.Name)},</p>{Msg(e)}<p>{(viewer ? "Please review the document. No signature is needed." : "Please review and sign the document.")}</p>{pm}{code}",
                viewer ? "VIEW DOCUMENT" : "REVIEW DOCUMENT", $"{Url}/sign/{r.AccessToken}");
        }
    }

    public void ApprovalRequest(Envelope e, WorkflowStep s, IEnumerable<WorkflowApprover>? only = null)
    {
        foreach (var a in only ?? s.Approvers.Where(x => x.Status == ApproverStatus.Pending))
            Queue(e, [a.Email], "Approval required: " + e.Subject, $"{e.SenderName} requests your approval",
                $"<p>Hi {H(a.Name)},</p>{Msg(e)}<p>Step: <b>{H(s.Name)}</b> · {H(WorkflowEngine.RuleText(s))}{(e.Workflow?.Amount is null ? "" : " · document value " + WorkflowEngine.Thb(e.Workflow.Amount))}</p>" +
                (a.DelegatedFrom is null ? "" : $"<p>{H(a.DelegatedFrom)} delegated this decision to you.</p>") +
                (a.IsBackup ? "<p>You were added as backup authority because the approvers did not decide in time. Nothing was approved automatically.</p>" : "") +
                "<p>This document needs your approval before it is sent for signature.</p>",
                "REVIEW & APPROVE", $"{Url}/approve/{a.AccessToken}");
    }

    public void Escalated(Envelope e, WorkflowStep s)
    {
        var overdue = s.Approvers.Where(a => a.Status == ApproverStatus.Pending && !a.IsBackup).ToList();
        foreach (var a in overdue)
            Queue(e, [a.Email], "Reminder — approval overdue: " + e.Subject, "Your approval is overdue",
                $"<p>Hi {H(a.Name)},</p><p>The step <b>{H(s.Name)}</b> has waited more than {s.EscalationDays} day(s).</p>", "REVIEW & APPROVE", $"{Url}/approve/{a.AccessToken}");
        var backup = s.Approvers.FirstOrDefault(a => a.IsBackup && a.Status == ApproverStatus.Pending);
        if (backup is not null) ApprovalRequest(e, s, [backup]);
        else if (!string.IsNullOrWhiteSpace(s.EscalationEmail))
            Queue(e, [s.EscalationEmail!], "Escalation notice: " + e.Subject, "An approval is overdue",
                $"<p>The step <b>{H(s.Name)}</b> has had no decision for {s.EscalationDays} day(s) from {H(string.Join(", ", overdue.Select(a => a.Name)))}. For your information.</p>", null, null);
    }

    public void Completed(Envelope e)
    {
        var to = e.Recipients.Select(r => r.Email).Append(e.SenderEmail);
        foreach (var r in e.Recipients)
            Queue(e, [r.Email], "Completed: " + e.Subject, "All parties have completed the document",
                $"<p>Hi {H(r.Name)},</p><p>The document is now fully signed. Open it to download the signed copy with its Certificate of Completion.</p>", "VIEW COMPLETED DOCUMENT", $"{Url}/sign/{r.AccessToken}");
        Queue(e, [e.SenderEmail], "Completed: " + e.Subject, "Your envelope is complete", "<p>All recipients have completed their actions.</p>", "OPEN IN MGT SIGN", $"{Url}/envelopes/{e.Id}");
        _ = to;
    }

    public void Declined(Envelope e, string who, string reason) =>
        Queue(e, [e.SenderEmail], "Declined: " + e.Subject, $"{who} declined", $"<p>Reason: {H(reason)}</p>", "OPEN IN MGT SIGN", $"{Url}/envelopes/{e.Id}");

    public void Voided(Envelope e, IEnumerable<string> to, string reason) =>
        Queue(e, to, "Voided: " + e.Subject, $"{e.SenderName} voided this envelope", $"<p>You no longer need to act on this document.</p><p>Reason: {H(reason)}</p>", null, null);
}
