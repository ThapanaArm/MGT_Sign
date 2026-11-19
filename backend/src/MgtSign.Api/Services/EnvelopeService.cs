using System.Globalization;
using System.Text.Json;
using MgtSign.Api.Contracts;
using MgtSign.Api.Support;
using MgtSign.Domain;
using MgtSign.Infrastructure;
using MgtSign.Infrastructure.Pdf;
using Microsoft.EntityFrameworkCore;

namespace MgtSign.Api.Services;

public sealed class EnvelopeService(AppDbContext db, CurrentUser me, Auditor auditor, Notifier notify, IPdfService pdf)
{
    static readonly string[] Colors = ["#F5C04A", "#6CC6E8", "#B79CF2", "#7CD6A5", "#F29C9C", "#F2B880", "#9FB4F5"];
    static readonly FieldType[] ImageFields = [FieldType.Signature, FieldType.Initial, FieldType.Stamp];
    DateTime Now => DateTime.UtcNow;

    // ---------- loading & access ----------
    public IQueryable<Envelope> Full() => db.Envelopes
        .Include(e => e.Documents).Include(e => e.Recipients).Include(e => e.Fields).Include(e => e.Attachments)
        .Include(e => e.Workflow!).ThenInclude(w => w.Steps).ThenInclude(s => s.Approvers)
        .AsSplitQuery();

    /// <summary>Envelopes the signed-in user may see: sent by them, or where they are a recipient or approver.</summary>
    public IQueryable<Envelope> Visible(IQueryable<Envelope>? src = null)
    {
        var q = src ?? db.Envelopes;
        if (me.IsAdmin) return q;
        Guid uid = me.Id; string email = me.Email;
        return q.Where(e => e.SenderId == uid
            || (e.Status != EnvelopeStatus.Draft && (e.Recipients.Any(r => r.Email == email)
                || (e.Workflow != null && e.Workflow.Steps.Any(s => s.Approvers.Any(a => a.Email == email))))));
    }

    public async Task<Envelope> LoadVisible(Guid id) =>
        await Visible(Full()).FirstOrDefaultAsync(e => e.Id == id) ?? throw ApiException.NotFound("Envelope not found.");

    async Task<Envelope> LoadOwned(Guid id)
    {
        var e = await Full().FirstOrDefaultAsync(x => x.Id == id) ?? throw ApiException.NotFound("Envelope not found.");
        if (e.SenderId != me.Id && !me.IsAdmin) throw ApiException.Forbidden("Only the sender can do this.");
        return e;
    }

    public EnvelopeDetail Detail(Envelope e) => Mapping.ToDetail(e, me.Email, me.Id, me.IsAdmin);

    // ---------- create ----------
    public async Task<EnvelopeDetail> Create(CreateEnvelopeRequest req, IReadOnlyList<IFormFile> documents, IReadOnlyList<IFormFile> attachments)
    {
        var user = await db.Users.FindAsync(me.Id) ?? throw ApiException.Forbidden();
        if (string.IsNullOrWhiteSpace(req.Subject) || req.Subject.Length > 200) throw ApiException.Bad("Enter a subject of up to 200 characters.");
        if (req.Message?.Length > 10_000) throw ApiException.Bad("The message is longer than 10,000 characters.");
        if (attachments.Count > FileRules.MaxAttachments) throw ApiException.Bad($"Attach at most {FileRules.MaxAttachments} files.");

        Template? template = null; TemplateDefinition? def = null;
        if (req.TemplateId is { } tid)
        {
            template = await db.Templates.FindAsync(tid) ?? throw ApiException.NotFound("Template not found.");
            def = JsonSerializer.Deserialize<TemplateDefinition>(template.DefinitionJson, Json.Options);
        }

        // document
        MergedPdf merged;
        if (documents.Count > 0)
        {
            var files = new List<(string, byte[])>();
            foreach (var f in documents) files.Add((FileRules.SafeName(f.FileName), await FileRules.ReadPdf(f)));
            try { merged = pdf.Merge(files); } catch (Exception ex) when (ex is not ApiException) { throw ApiException.Bad("One of the PDF files could not be read: " + ex.Message); }
        }
        else if (template is not null)
        {
            var blob = await db.FileBlobs.FindAsync(template.DocumentBlobId) ?? throw ApiException.Bad("The template document is missing.");
            merged = new MergedPdf(blob.Content, template.PageCount, template.DocumentName);
        }
        else throw ApiException.Bad("Add at least one PDF document.");

        var e = new Envelope
        {
            Code = await NewCode(), Type = req.Type, Subject = req.Subject.Trim(), Message = req.Message?.Trim(),
            SenderId = user.Id, SenderName = user.Name, SenderEmail = user.Email, SigningOrderEnabled = req.SigningOrder,
            ExpiresAt = Now.AddDays(Math.Clamp(req.ExpiryDays <= 0 ? 30 : req.ExpiryDays, 1, 365)), ReminderDays = Math.Clamp(req.ReminderDays, 0, 30)
        };
        var audit = auditor.For(e);
        var docBlob = new FileBlob { Content = merged.Bytes };
        e.Documents.Add(new EnvelopeDocument { EnvelopeId = e.Id, Kind = DocumentKind.Original, FileName = merged.FileName, Size = merged.Bytes.Length,
            PageCount = merged.PageCount, Sha256 = Hashing.Sha256Hex(merged.Bytes), BlobId = docBlob.Id, Blob = docBlob });

        // recipients
        var inputs = req.Type == EnvelopeType.Self
            ? [new RecipientInput(user.Name, user.Email, RecipientRole.Signer, 1, null, null)]
            : req.Recipients;
        if (inputs.Count == 0) throw ApiException.Bad("Add at least one recipient.");
        if (inputs.Count > 50) throw ApiException.Bad("An envelope can have at most 50 recipients.");
        for (var i = 0; i < inputs.Count; i++)
        {
            var r = inputs[i];
            if (string.IsNullOrWhiteSpace(r.Name) || !Emails.IsValid(r.Email)) throw ApiException.Bad("Each recipient needs a name and a valid email.");
            e.Recipients.Add(new Recipient
            {
                EnvelopeId = e.Id, Name = r.Name.Trim(), Email = r.Email.Trim(), Role = r.Role, RoutingOrder = req.SigningOrder ? Math.Max(1, r.RoutingOrder) : 1,
                Color = Colors[i % Colors.Length], AccessCodeHash = string.IsNullOrWhiteSpace(r.AccessCode) ? null : Passwords.Hash(r.AccessCode.Trim()),
                PrivateMessage = string.IsNullOrWhiteSpace(r.PrivateMessage) ? null : r.PrivateMessage.Trim()
            });
        }
        if (!e.Recipients.Any(r => r.IsSigner)) throw ApiException.Bad("Add at least one recipient who needs to sign.");

        // approval workflow
        if (req.Workflow is { } wi && req.Type == EnvelopeType.Request)
        {
            e.Workflow = ToWorkflow(wi, e.Id);
            var err = WorkflowEngine.Validate(e.Workflow);
            if (err is not null) throw ApiException.Bad(err);
        }

        audit("Envelope created", $"Document \"{merged.FileName}\" ({merged.PageCount} pages){(template is null ? "" : " from template " + template.Name)}", user.Name);
        audit("Document fingerprint recorded", "SHA-256 " + e.Original!.Sha256, WorkflowEngine.System);
        if (e.Workflow is not null) audit("Approval workflow configured", $"{e.Workflow.Type} · {string.Join(" → ", e.Workflow.Steps.OrderBy(s => s.Sequence).Select(s => s.Name))}", user.Name);
        if (e.ReminderDays > 0) audit("Automatic reminders on", $"Every {e.ReminderDays} day(s)", user.Name);

        // template fields, mapped by recipient position
        if (def is not null)
            foreach (var tf in def.Fields.Where(f => f.RecipientIndex >= 0 && f.RecipientIndex < e.Recipients.Count && f.Page < merged.PageCount))
            {
                var r = e.Recipients[tf.RecipientIndex]; if (!r.IsSigner) continue;
                e.Fields.Add(new Field { EnvelopeId = e.Id, RecipientId = r.Id, Type = tf.Type, Page = tf.Page, X = tf.X, Y = tf.Y, Width = tf.Width, Height = tf.Height,
                    Required = tf.Required, Label = tf.Label, Tooltip = tf.Tooltip });
            }

        foreach (var f in attachments) await AddAttachment(e, f, user.Name, user.Email, AttachmentRole.Sender, null, audit);
        await RememberContacts(e);
        db.Envelopes.Add(e);
        await db.SaveChangesAsync();
        return Detail(e);
    }

    static ApprovalWorkflow ToWorkflow(WorkflowInput wi, Guid envelopeId)
    {
        var w = new ApprovalWorkflow { EnvelopeId = envelopeId, Type = wi.Type, AllowDelegation = wi.AllowDelegation, Amount = wi.Amount };
        for (var i = 0; i < wi.Steps.Count; i++)
        {
            var si = wi.Steps[i];
            var s = new WorkflowStep
            {
                WorkflowId = w.Id, Sequence = i, Name = si.Name?.Trim() ?? "", Rule = si.Rule, QuorumMode = si.QuorumMode, QuorumValue = si.QuorumValue,
                ConditionOp = si.ConditionOp, ConditionValue = si.ConditionOp == ConditionOp.Always ? null : si.ConditionValue,
                EscalationDays = si.EscalationDays, EscalationMode = si.EscalationDays is null ? null : si.EscalationMode ?? EscalationMode.AddBackup,
                EscalationName = si.EscalationName?.Trim(), EscalationEmail = si.EscalationEmail?.Trim()
            };
            for (var j = 0; j < si.Approvers.Count; j++)
                s.Approvers.Add(new WorkflowApprover { StepId = s.Id, Sequence = j, Name = si.Approvers[j].Name?.Trim() ?? "", Email = si.Approvers[j].Email?.Trim() ?? "", Veto = si.Approvers[j].Veto });
            w.Steps.Add(s);
        }
        return w;
    }

    async Task<string> NewCode()
    {
        const string abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        while (true)
        {
            var code = $"MGT-{Now:yyyyMMdd}-" + new string(Enumerable.Range(0, 5).Select(_ => abc[Random.Shared.Next(abc.Length)]).ToArray());
            if (!await db.Envelopes.AnyAsync(e => e.Code == code)) return code;
        }
    }

    async Task RememberContacts(Envelope e)
    {
        var people = e.Recipients.Select(r => (r.Name, r.Email))
            .Concat(e.Workflow?.Steps.SelectMany(s => s.Approvers.Select(a => (a.Name, a.Email))) ?? [])
            .Concat(e.Workflow?.Steps.Where(s => !string.IsNullOrWhiteSpace(s.EscalationEmail)).Select(s => (s.EscalationName ?? s.EscalationEmail!, s.EscalationEmail!)) ?? [])
            .Where(p => Emails.IsValid(p.Item2)).DistinctBy(p => p.Item2.ToLowerInvariant()).ToList();
        var emails = people.Select(p => p.Item2).ToList();
        var known = await db.Contacts.Where(c => emails.Contains(c.Email)).Select(c => c.Email).ToListAsync();
        var users = await db.Users.Where(u => emails.Contains(u.Email)).Select(u => u.Email).ToListAsync();
        foreach (var p in people.Where(p => !known.Contains(p.Item2, StringComparer.OrdinalIgnoreCase) && !users.Contains(p.Item2, StringComparer.OrdinalIgnoreCase)))
            db.Contacts.Add(new Contact { Name = p.Item1, Email = p.Item2 });
    }

    // ---------- fields & sending ----------
    public async Task<EnvelopeDetail> SaveFields(Guid id, FieldsUpdate req)
    {
        var e = await LoadOwned(id);
        if (e.Status != EnvelopeStatus.Draft) throw ApiException.Bad("Fields can only be changed before the envelope is sent.");
        var pages = e.Original!.PageCount;
        var signers = e.Recipients.Where(r => r.IsSigner).Select(r => r.Id).ToHashSet();
        if (req.Fields.Count > 500) throw ApiException.Bad("Too many fields.");
        db.Fields.RemoveRange(e.Fields); e.Fields.Clear();
        foreach (var f in req.Fields)
        {
            if (!signers.Contains(f.RecipientId)) throw ApiException.Bad("Fields can only be assigned to signers of this envelope.");
            if (f.Page < 0 || f.Page >= pages) throw ApiException.Bad("A field is placed on a page that does not exist.");
            double C(double v) => Math.Clamp(double.IsFinite(v) ? v : 0, 0, 1);
            e.Fields.Add(new Field
            {
                EnvelopeId = e.Id, RecipientId = f.RecipientId, Type = f.Type, Page = f.Page, X = C(f.X), Y = C(f.Y),
                Width = Math.Max(0.005, C(f.Width)), Height = Math.Max(0.005, C(f.Height)), Required = f.Required,
                Label = f.Label?.Trim(), Tooltip = f.Tooltip?.Trim(), Value = f.Type is FieldType.Text or FieldType.Company or FieldType.Title ? f.Value : null
            });
        }
        e.UpdatedAt = Now;
        await db.SaveChangesAsync();
        return Detail(e);
    }

    public async Task<EnvelopeDetail> Send(Guid id)
    {
        var e = await LoadOwned(id);
        if (e.Status != EnvelopeStatus.Draft || e.IsDeleted) throw ApiException.Bad("Only drafts can be sent.");
        var lacking = e.Recipients.Where(r => r.IsSigner && !e.Fields.Any(f => f.RecipientId == r.Id && f.Type == FieldType.Signature)).Select(r => r.Name).ToList();
        if (lacking.Count > 0) throw ApiException.Bad("Add a Signature field for: " + string.Join(", ", lacking));
        var audit = auditor.For(e);
        e.SentAt = Now;
        audit("Envelope sent", $"To {e.Recipients.Count} recipient(s); expires {e.ExpiresAt:dd MMM yyyy}", me.Name);
        if (e.Workflow is not null)
        {
            var t = WorkflowEngine.Start(e, audit, Now);
            await AfterWorkflow(e, t, audit);
        }
        else await StartSigning(e, audit);
        await db.SaveChangesAsync();
        return Detail(e);
    }

    async Task StartSigning(Envelope e, AuditWriter audit)
    {
        var group = Routing.Advance(e, audit, Now);
        if (group.Count > 0) { if (e.Type == EnvelopeType.Request) notify.SigningRequest(e, group); }
        else await Finalize(e, audit);
    }

    async Task AfterWorkflow(Envelope e, WorkflowTransition t, AuditWriter audit)
    {
        if (t.ActivatedStep is { } s) notify.ApprovalRequest(e, s);
        else if (t.WorkflowApproved) await StartSigning(e, audit);
        else if (t.Rejected) notify.Declined(e, "An approver", t.Vetoed ? "Vetoed in the approval workflow." : "Rejected in the approval workflow.");
    }

    /// <summary>Stamps all values and the Certificate of Completion into the signed PDF.</summary>
    async Task Finalize(Envelope e, AuditWriter audit)
    {
        var orig = e.Original!;
        var bytes = (await db.FileBlobs.FindAsync(orig.BlobId))!.Content;
        if (!db.Entry(e).Collection(x => x.AuditEvents).IsLoaded) await db.Entry(e).Collection(x => x.AuditEvents).LoadAsync();
        audit("Signed document generated", "Values stamped and Certificate of Completion attached.", WorkflowEngine.System);
        var signed = pdf.Stamp(bytes, e, withCertificate: true);
        var blob = new FileBlob { Content = signed };
        db.FileBlobs.Add(blob);
        e.Documents.Add(new EnvelopeDocument { EnvelopeId = e.Id, Kind = DocumentKind.Signed, FileName = Path.GetFileNameWithoutExtension(orig.FileName) + "_signed.pdf",
            Size = signed.Length, PageCount = orig.PageCount + 1, Sha256 = Hashing.Sha256Hex(signed), BlobId = blob.Id });
        if (e.Type == EnvelopeType.Request) notify.Completed(e);
    }

    // ---------- signing (link token) ----------
    public async Task<(Envelope E, Recipient R)> BySignToken(string token)
    {
        var r = await db.Recipients.AsNoTracking().FirstOrDefaultAsync(x => x.AccessToken == token) ?? throw ApiException.NotFound("This signing link is not valid.");
        var e = await Full().FirstAsync(x => x.Id == r.EnvelopeId);
        return (e, e.Recipients.First(x => x.Id == r.Id));
    }

    public string SignState(Envelope e, Recipient r, string? accessCode)
    {
        if (e.IsDeleted || e.Status is EnvelopeStatus.Voided) return "closed";
        if (r.Status is RecipientStatus.Signed or RecipientStatus.Viewed or RecipientStatus.Delivered) return "done";
        if (r.Status == RecipientStatus.Declined) return "declined";
        if (e.Status is EnvelopeStatus.Declined or EnvelopeStatus.Completed) return "closed";
        if (e.ExpiresAt < Now) return "expired";
        if (e.Status != EnvelopeStatus.Sent || !Routing.CurrentGroup(e).Contains(r)) return "waiting";
        if (r.AccessCodeHash is not null && !(accessCode is not null && Passwords.Verify(accessCode.Trim(), r.AccessCodeHash))) return "accessCode";
        return "ready";
    }

    public async Task<SignSession> SignSession(string token, string? accessCode, bool record = true)
    {
        var (e, r) = await BySignToken(token);
        var state = SignState(e, r, accessCode);
        if (state == "accessCode" && !string.IsNullOrEmpty(accessCode))
        { auditor.For(e)("Access code failed", $"{r.Name} <{r.Email}>", r.Name); await db.SaveChangesAsync(); }
        if (state == "ready" && record && !await db.AuditEvents.AnyAsync(a => a.EnvelopeId == e.Id && a.Action == "Document viewed" && a.Actor == r.Name))
        {
            var audit = auditor.For(e);
            if (r.AccessCodeHash is not null) audit("Access code verified", $"{r.Name} <{r.Email}>", r.Name);
            audit("Document viewed", $"{r.Name} <{r.Email}>", r.Name);
            await db.SaveChangesAsync();
        }
        var hidden = state is "accessCode" or "expired" or "closed" && r.Status == RecipientStatus.Pending;
        SignatureDto? saved = null;
        if (state == "ready")
        {
            var u = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Email == r.Email);
            if (u?.SignatureImage is not null) saved = new SignatureDto(u.SignatureImage, u.InitialImage);
        }
        return new SignSession(token, e.Id, e.Code, e.Subject, hidden ? null : e.Message, e.SenderName, e.SenderEmail, Mapping.ToDto(r), state,
            e.Original!.PageCount, hidden ? [] : e.Fields.Select(Mapping.ToDto).ToList(), hidden ? [] : e.Attachments.Select(Mapping.ToDto).ToList(),
            saved, state == "ready" && Mapping.CanAddAttachments(e));
    }

    public async Task<SignSession> CompleteSigning(string token, string? accessCode, CompleteSigningRequest req)
    {
        var (e, r) = await BySignToken(token);
        if (SignState(e, r, accessCode) != "ready") throw ApiException.Bad("This document cannot be signed right now.");
        var audit = auditor.For(e);
        var values = req.Fields.ToDictionary(f => f.Id);
        var today = Now.ToLocalTime().ToString("dd MMM yyyy", CultureInfo.GetCultureInfo("en-GB"));
        foreach (var f in e.Fields.Where(f => f.RecipientId == r.Id))
        {
            values.TryGetValue(f.Id, out var v);
            var value = v?.Value?.Trim();
            switch (f.Type)
            {
                case FieldType.Signature or FieldType.Initial or FieldType.Stamp:
                    if (value is not null && (!value.StartsWith("data:image/png;base64,") || value.Length > 3_000_000)) throw ApiException.Bad("Signature images must be PNG and smaller than 2 MB.");
                    f.Value = value; break;
                case FieldType.DateSigned: f.Value = string.IsNullOrEmpty(value) ? today : value; break;
                case FieldType.Name: f.Value = string.IsNullOrEmpty(value) ? r.Name : value; break;
                case FieldType.Email: f.Value = string.IsNullOrEmpty(value) ? r.Email : value; break;
                case FieldType.Checkbox: f.Value = value == "true" ? "true" : "false"; break;
                default: f.Value = value?.Length > 2000 ? value[..2000] : value; break;
            }
            f.RenderedImage = v?.RenderedImage is { Length: < 2_000_000 } img && img.StartsWith("data:image/png;base64,") ? img : null;
            var filled = f.Type == FieldType.Checkbox ? f.Value == "true" : !string.IsNullOrEmpty(f.Value);
            if (f.Required && !filled) throw ApiException.Bad($"Complete the required field: {f.Label ?? f.Type.ToString()}.");
        }
        r.Status = r.Role == RecipientRole.Viewer ? RecipientStatus.Viewed : RecipientStatus.Signed;
        r.CompletedAt = Now;
        audit(r.Role switch { RecipientRole.Viewer => "Document viewed & acknowledged", RecipientRole.InPersonSigner => "Signed in person", _ => "Document signed" },
            $"{r.Name} <{r.Email}>{(r.Role == RecipientRole.InPersonSigner ? " · hosted by " + e.SenderName : "")}", r.Name);

        if (req.AdoptedSignature?.SignatureImage is { } sig)
        {
            var u = await db.Users.FirstOrDefaultAsync(x => x.Email == r.Email);
            if (u is not null && sig.StartsWith("data:image/png;base64,") && sig.Length < 3_000_000) { u.SignatureImage = sig; u.InitialImage = req.AdoptedSignature.InitialImage; audit("Signature adopted", r.Name, r.Name); }
        }
        if (!Routing.CurrentGroup(e).Any(x => x.RoutingOrder == r.RoutingOrder)) await StartSigning(e, audit);
        await db.SaveChangesAsync();
        return await SignSession(token, accessCode, record: false);
    }

    public async Task<SignSession> Decline(string token, string? accessCode, string reason)
    {
        var (e, r) = await BySignToken(token);
        if (SignState(e, r, accessCode) != "ready") throw ApiException.Bad("This document cannot be declined right now.");
        if (string.IsNullOrWhiteSpace(reason)) throw ApiException.Bad("Enter a reason.");
        r.Status = RecipientStatus.Declined; r.DeclineReason = reason.Trim(); r.CompletedAt = Now; e.Status = EnvelopeStatus.Declined;
        auditor.For(e)("Signer declined", $"{r.Name}: {reason.Trim()}", r.Name);
        notify.Declined(e, r.Name, reason.Trim());
        await db.SaveChangesAsync();
        return await SignSession(token, accessCode, record: false);
    }

    // ---------- approval (link token) ----------
    public async Task<(Envelope E, WorkflowApprover A, WorkflowStep S)> ByApproveToken(string token)
    {
        var a0 = await db.WorkflowApprovers.AsNoTracking().FirstOrDefaultAsync(x => x.AccessToken == token) ?? throw ApiException.NotFound("This approval link is not valid.");
        var envelopeId = await (from st in db.WorkflowSteps join w in db.Workflows on st.WorkflowId equals w.Id where st.Id == a0.StepId select w.EnvelopeId).FirstAsync();
        var e = await Full().FirstAsync(x => x.Id == envelopeId);
        var s = e.Workflow!.Steps.First(x => x.Id == a0.StepId);
        return (e, s.Approvers.First(x => x.Id == a0.Id), s);
    }

    static string ApprovalState(Envelope e, WorkflowApprover a, WorkflowStep s)
    {
        if (e.IsDeleted || e.Status is EnvelopeStatus.Voided or EnvelopeStatus.Declined or EnvelopeStatus.Completed) return a.Status == ApproverStatus.Pending ? "closed" : "done";
        if (a.Status != ApproverStatus.Pending) return "done";
        return s.Status == StepStatus.Active && e.Workflow!.Status == WorkflowStatus.Active ? "ready" : "waiting";
    }

    public async Task<ApprovalSession> ApprovalSession(string token, bool record = true)
    {
        var (e, a, s) = await ByApproveToken(token);
        var state = ApprovalState(e, a, s);
        if (state == "ready" && record && !await db.AuditEvents.AnyAsync(x => x.EnvelopeId == e.Id && x.Action == "Approval request opened" && x.Actor == a.Name))
        { auditor.For(e)("Approval request opened", $"{s.Name} · {a.Name} <{a.Email}>", a.Name); await db.SaveChangesAsync(); }
        return new ApprovalSession(token, e.Id, e.Code, e.Subject, e.Message, e.SenderName, e.SenderEmail, Mapping.ToDto(a), state,
            WorkflowEngine.Active(e.Workflow)?.Id, Mapping.ToDto(e.Workflow!), e.Attachments.Select(Mapping.ToDto).ToList(), e.Original!.PageCount,
            e.Fields.Select(Mapping.ToDto).ToList(), state == "ready" && Mapping.CanAddAttachments(e));
    }

    public async Task<ApprovalSession> Decide(string token, DecisionRequest req)
    {
        var (e, a, s) = await ByApproveToken(token);
        if (ApprovalState(e, a, s) != "ready") throw ApiException.Bad("There is no decision waiting for you on this envelope.");
        var audit = auditor.For(e);
        var t = WorkflowEngine.Act(e, a, req.Decision, req.Comment?.Trim(), audit, Now);
        await AfterWorkflow(e, t, audit);
        await db.SaveChangesAsync();
        return await ApprovalSession(token, record: false);
    }

    public async Task<ApprovalSession> Delegate(string token, DelegateRequest req)
    {
        var (e, a, s) = await ByApproveToken(token);
        if (ApprovalState(e, a, s) != "ready") throw ApiException.Bad("There is no decision waiting for you on this envelope.");
        if (string.IsNullOrWhiteSpace(req.Name) || !Emails.IsValid(req.Email)) throw ApiException.Bad("Enter the delegate's name and a valid email.");
        var d = WorkflowEngine.Delegate(e, a, req.Name.Trim(), req.Email.Trim(), req.Reason?.Trim() ?? "", auditor.For(e), Now);
        db.WorkflowApprovers.Add(d);
        notify.ApprovalRequest(e, s, [d]);
        await db.SaveChangesAsync();
        return await ApprovalSession(token, record: false);
    }

    // ---------- escalation ----------
    public async Task<int> RunEscalations(Guid? onlyEnvelope = null, bool forceOverdue = false)
    {
        var q = Full().Where(e => e.Status == EnvelopeStatus.PendingApproval && !e.IsDeleted && e.Workflow != null);
        if (onlyEnvelope is { } id) q = q.Where(e => e.Id == id);
        var list = await q.ToListAsync();
        var n = 0;
        foreach (var e in list)
        {
            var s = WorkflowEngine.Active(e.Workflow);
            if (s is null || s.EscalationDays is null) continue;
            if (forceOverdue && s.StartedAt is not null && s.EscalatedAt is null) s.StartedAt = Now.AddDays(-s.EscalationDays.Value).AddMinutes(-1);
            var before = s.Approvers.Count;
            if (!WorkflowEngine.CheckEscalation(e, auditor.For(e), Now)) continue;
            foreach (var added in s.Approvers.Skip(before)) db.WorkflowApprovers.Add(added);
            notify.Escalated(e, s); n++;
        }
        await db.SaveChangesAsync();
        return n;
    }

    // ---------- sender actions ----------
    public async Task<EnvelopeDetail> Void(Guid id, string reason)
    {
        var e = await LoadOwned(id);
        if (string.IsNullOrWhiteSpace(reason)) throw ApiException.Bad("Enter a reason.");
        if (e.Status is not (EnvelopeStatus.Draft or EnvelopeStatus.Sent or EnvelopeStatus.PendingApproval)) throw ApiException.Bad("This envelope can no longer be voided.");
        var wasSent = e.Status != EnvelopeStatus.Draft;
        e.Status = EnvelopeStatus.Voided; e.VoidReason = reason.Trim();
        auditor.For(e)("Envelope voided", reason.Trim(), me.Name);
        if (wasSent)
            notify.Voided(e, Routing.CurrentGroup(e).Select(r => r.Email).Concat(WorkflowEngine.Pending(e.Workflow).Select(a => a.Email)), reason.Trim());
        await db.SaveChangesAsync();
        return Detail(e);
    }

    public async Task Remind(Guid id)
    {
        var e = await LoadOwned(id);
        var audit = auditor.For(e);
        if (e.Status == EnvelopeStatus.PendingApproval && WorkflowEngine.Active(e.Workflow) is { } s)
        { notify.ApprovalRequest(e, s); audit("Reminder sent", string.Join(", ", WorkflowEngine.Pending(e.Workflow).Select(a => a.Email)), me.Name); }
        else if (e.Status == EnvelopeStatus.Sent)
        { var g = Routing.CurrentGroup(e); notify.SigningRequest(e, g); audit("Reminder sent", string.Join(", ", g.Select(r => r.Email)), me.Name); }
        else throw ApiException.Bad("Only envelopes in progress can be reminded.");
        await db.SaveChangesAsync();
    }

    public async Task SetDeleted(Guid id, bool deleted)
    {
        var e = await LoadOwned(id);
        e.IsDeleted = deleted;
        auditor.For(e)(deleted ? "Moved to Deleted" : "Restored from Deleted", null, me.Name);
        await db.SaveChangesAsync();
    }

    public async Task Purge(Guid id)
    {
        var e = await LoadOwned(id);
        if (!e.IsDeleted) throw ApiException.Bad("Move the envelope to Deleted first.");
        var blobs = e.Documents.Select(d => d.BlobId).Concat(e.Attachments.Select(a => a.BlobId)).ToList();
        db.Envelopes.Remove(e);
        await db.SaveChangesAsync();
        await db.FileBlobs.Where(b => blobs.Contains(b.Id)).ExecuteDeleteAsync();
    }

    // ---------- documents & attachments ----------
    public async Task<(byte[] Bytes, string Name)> Document(Envelope e, string kind)
    {
        var signed = e.Documents.FirstOrDefault(d => d.Kind == DocumentKind.Signed);
        var orig = e.Original!;
        if (kind == "signed" || (kind == "current" && signed is not null))
        {
            if (signed is null) throw ApiException.NotFound("The signed document is not ready yet.");
            return ((await db.FileBlobs.FindAsync(signed.BlobId))!.Content, signed.FileName);
        }
        var bytes = (await db.FileBlobs.FindAsync(orig.BlobId))!.Content;
        if (kind == "original") return (bytes, orig.FileName);
        return (pdf.Stamp(bytes, e, withCertificate: false), Path.GetFileNameWithoutExtension(orig.FileName) + "_" + e.Status.ToString().ToLowerInvariant() + ".pdf");
    }

    public async Task<List<AttachmentDto>> AddAttachments(Envelope e, IReadOnlyList<IFormFile> files, string name, string email, AttachmentRole role, string? context)
    {
        if (!Mapping.CanAddAttachments(e)) throw ApiException.Bad("Attachments can no longer be added to this envelope.");
        if (files.Count == 0) throw ApiException.Bad("Choose at least one file.");
        if (e.Attachments.Count + files.Count > FileRules.MaxAttachments) throw ApiException.Bad($"An envelope can have at most {FileRules.MaxAttachments} attachments.");
        var audit = auditor.For(e); var added = new List<Attachment>();
        foreach (var f in files) added.Add(await AddAttachment(e, f, name, email, role, context, audit));
        await db.SaveChangesAsync();
        return added.Select(Mapping.ToDto).ToList();
    }

    async Task<Attachment> AddAttachment(Envelope e, IFormFile f, string name, string email, AttachmentRole role, string? context, AuditWriter audit)
    {
        var bytes = await FileRules.ReadAttachment(f);
        var blob = new FileBlob { Content = bytes };
        var a = new Attachment { EnvelopeId = e.Id, FileName = FileRules.SafeName(f.FileName), ContentType = string.IsNullOrEmpty(f.ContentType) ? "application/octet-stream" : f.ContentType,
            Size = bytes.Length, Sha256 = Hashing.Sha256Hex(bytes), AddedByName = name, AddedByEmail = email, Role = role, Context = context, BlobId = blob.Id, Blob = blob };
        e.Attachments.Add(a);
        if (db.Entry(e).State != EntityState.Detached) db.Attachments.Add(a);
        audit("Attachment added", $"{a.FileName} ({a.Size:N0} bytes) · {role}{(context is null ? "" : " · " + context)} · SHA-256 {a.Sha256}", name);
        return a;
    }

    public async Task<(byte[] Bytes, Attachment A)> AttachmentFile(Envelope e, Guid attId, string actor)
    {
        var a = e.Attachments.FirstOrDefault(x => x.Id == attId) ?? throw ApiException.NotFound("Attachment not found.");
        var blob = await db.FileBlobs.FindAsync(a.BlobId) ?? throw ApiException.NotFound("The attachment content is missing.");
        auditor.For(e)("Attachment downloaded", a.FileName, actor);
        await db.SaveChangesAsync();
        return (blob.Content, a);
    }
}
