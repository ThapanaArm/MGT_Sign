using System.Text;
using System.Text.Json;
using MgtSign.Api.Contracts;
using MgtSign.Api.Services;
using MgtSign.Api.Support;
using MgtSign.Domain;
using MgtSign.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace MgtSign.Api.Controllers;

[ApiController, Route("api/envelopes"), Authorize]
public class EnvelopesController(EnvelopeService svc, AppDbContext db, CurrentUser me) : ControllerBase
{
    static IQueryable<Envelope> Folder(IQueryable<Envelope> q, string? folder) => folder switch
    {
        "drafts" => q.Where(e => !e.IsDeleted && e.Status == EnvelopeStatus.Draft),
        "progress" => q.Where(e => !e.IsDeleted && (e.Status == EnvelopeStatus.Sent || e.Status == EnvelopeStatus.PendingApproval)),
        "approval" => q.Where(e => !e.IsDeleted && e.Status == EnvelopeStatus.PendingApproval),
        "completed" => q.Where(e => !e.IsDeleted && e.Status == EnvelopeStatus.Completed),
        "voided" => q.Where(e => !e.IsDeleted && (e.Status == EnvelopeStatus.Voided || e.Status == EnvelopeStatus.Declined)),
        "deleted" => q.Where(e => e.IsDeleted),
        _ => q.Where(e => !e.IsDeleted)
    };

    [HttpGet]
    public async Task<EnvelopeListResponse> List(string? folder, string? q, string? status, string? sender, string? days, int page = 1, int pageSize = 25)
    {
        pageSize = Math.Clamp(pageSize, 5, 100); page = Math.Max(1, page);
        var visible = svc.Visible();
        var counts = new Dictionary<string, int>();
        foreach (var f in new[] { "all", "drafts", "progress", "approval", "completed", "voided", "deleted" })
            counts[f] = await Folder(f == "drafts" || f == "deleted" ? visible.Where(e => e.SenderId == me.Id) : visible, f).CountAsync();

        var query = Folder(svc.Visible(svc.Full()), folder);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var s = q.Trim();
            query = query.Where(e => e.Subject.Contains(s) || e.Code.Contains(s) || e.Recipients.Any(r => r.Name.Contains(s) || r.Email.Contains(s)));
        }
        if (Enum.TryParse<EnvelopeStatus>(status, true, out var st)) query = query.Where(e => e.Status == st);
        if (sender == "me") query = query.Where(e => e.SenderId == me.Id);
        else if (sender == "received") query = query.Where(e => e.SenderId != me.Id);
        if (int.TryParse(days, out var d) && d > 0) { var since = DateTime.UtcNow.AddDays(-d); query = query.Where(e => e.UpdatedAt >= since); }
        var total = await query.CountAsync();
        var items = await query.OrderByDescending(e => e.UpdatedAt).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new EnvelopeListResponse(items.Select(e => Mapping.ToListItem(e, me.Email, me.Id)).ToList(), total, page, pageSize, counts);
    }

    /// <summary>multipart/form-data: "payload" (JSON CreateEnvelopeRequest), "documents" (PDFs), "attachments" (optional).</summary>
    [HttpPost, RequestSizeLimit(200 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 200 * 1024 * 1024)]
    public async Task<EnvelopeDetail> Create([FromForm] string payload)
    {
        CreateEnvelopeRequest? req;
        try { req = JsonSerializer.Deserialize<CreateEnvelopeRequest>(payload, Json.Options); }
        catch (JsonException ex) { throw ApiException.Bad("The envelope data is not valid: " + ex.Message); }
        if (req is null) throw ApiException.Bad("The envelope data is missing.");
        var form = Request.Form;
        return await svc.Create(req, form.Files.GetFiles("documents"), form.Files.GetFiles("attachments"));
    }

    [HttpGet("{id:guid}")] public async Task<EnvelopeDetail> Get(Guid id) => svc.Detail(await svc.LoadVisible(id));
    [HttpPut("{id:guid}/fields")] public Task<EnvelopeDetail> Fields(Guid id, FieldsUpdate req) => svc.SaveFields(id, req);
    [HttpPost("{id:guid}/send")] public Task<EnvelopeDetail> Send(Guid id) => svc.Send(id);
    [HttpPost("{id:guid}/void")] public Task<EnvelopeDetail> Void(Guid id, VoidRequest req) => svc.Void(id, req.Reason);
    /// <summary>Host face-to-face signing on this device. Returns the signer's link token for the live session.</summary>
    [HttpPost("{id:guid}/live/{recipientId:guid}")]
    public Task<LiveSessionResponse> StartLive(Guid id, Guid recipientId, StartLiveRequest req) => svc.StartLive(id, recipientId, req.IdentityCheck);
    [HttpPost("{id:guid}/remind")] public async Task<IActionResult> Remind(Guid id) { await svc.Remind(id); return NoContent(); }
    [HttpDelete("{id:guid}")] public async Task<IActionResult> Delete(Guid id) { await svc.SetDeleted(id, true); return NoContent(); }
    [HttpPost("{id:guid}/restore")] public async Task<IActionResult> Restore(Guid id) { await svc.SetDeleted(id, false); return NoContent(); }
    [HttpDelete("{id:guid}/permanent")] public async Task<IActionResult> Purge(Guid id) { await svc.Purge(id); return NoContent(); }

    [HttpGet("{id:guid}/document")]
    public async Task<IActionResult> Document(Guid id, string kind = "current")
    {
        var e = await svc.LoadVisible(id);
        var (bytes, name) = await svc.Document(e, kind);
        return File(bytes, "application/pdf", name);
    }

    [HttpGet("{id:guid}/audit")]
    public async Task<List<AuditDto>> Audit(Guid id)
    {
        await svc.LoadVisible(id);
        return await db.AuditEvents.Where(a => a.EnvelopeId == id).OrderBy(a => a.At).ThenBy(a => a.Id).Select(a => Mapping.ToDto(a)).ToListAsync();
    }

    [HttpPost("{id:guid}/attachments"), RequestSizeLimit(200 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 200 * 1024 * 1024)]
    public async Task<List<AttachmentDto>> AddAttachments(Guid id)
    {
        var e = await svc.LoadVisible(id);
        if (e.SenderId != me.Id) throw ApiException.Forbidden("Only the sender can add attachments here. Recipients add files from their signing or approval link.");
        return await svc.AddAttachments(e, Request.Form.Files.GetFiles("files"), me.Name, me.Email, AttachmentRole.Sender, null);
    }

    [HttpGet("{id:guid}/attachments/{attId:guid}")]
    public async Task<IActionResult> Attachment(Guid id, Guid attId)
    {
        var e = await svc.LoadVisible(id);
        var (bytes, a) = await svc.AttachmentFile(e, attId, me.Name);
        return File(bytes, a.ContentType, a.FileName);
    }

    [HttpGet("export.csv")]
    public async Task<IActionResult> Export()
    {
        var list = await svc.Visible(svc.Full()).Where(e => !e.IsDeleted).OrderByDescending(e => e.UpdatedAt).ToListAsync();
        static string Q(object? v) => "\"" + (v?.ToString() ?? "").Replace("\"", "\"\"") + "\"";
        var sb = new StringBuilder("﻿Envelope ID,Subject,Document,Status,Workflow,Sender,Recipients,Created,Completed,SHA-256\n");
        foreach (var e in list)
            sb.AppendLine(string.Join(",", Q(e.Code), Q(e.Subject), Q(e.Original?.FileName), Q(Mapping.StatusLabel(e, null)), Q(e.Workflow?.Type), Q(e.SenderEmail),
                Q(string.Join("; ", e.Recipients.Select(r => $"{r.Name} <{r.Email}> [{r.Role}:{r.Status}]"))), Q(e.CreatedAt.ToString("u")), Q(e.CompletedAt?.ToString("u")), Q(e.Original?.Sha256)));
        return File(Encoding.UTF8.GetBytes(sb.ToString()), "text/csv", "mgt-sign-report.csv");
    }
}

[ApiController, Route("api/dashboard"), Authorize]
public class DashboardController(EnvelopeService svc, CurrentUser me) : ControllerBase
{
    [HttpGet]
    public async Task<DashboardDto> Get()
    {
        var active = await svc.Visible(svc.Full()).Where(e => !e.IsDeleted && (e.Status == EnvelopeStatus.Sent || e.Status == EnvelopeStatus.PendingApproval)).ToListAsync();
        var items = active.Select(e => (E: e, I: Mapping.ToListItem(e, me.Email, me.Id))).ToList();
        var recent = await svc.Visible(svc.Full()).Where(e => !e.IsDeleted).OrderByDescending(e => e.UpdatedAt).Take(6).ToListAsync();
        var completed = await svc.Visible().CountAsync(e => !e.IsDeleted && e.Status == EnvelopeStatus.Completed);
        var soon = DateTime.UtcNow.AddDays(3);
        return new DashboardDto(
            items.Count(x => x.I.MyTurn), items.Count(x => !x.I.MyTurn), items.Count(x => x.E.Status == EnvelopeStatus.PendingApproval),
            items.Count(x => x.E.ExpiresAt < soon), completed,
            items.Where(x => x.I.MyTurn).OrderByDescending(x => x.E.UpdatedAt).Select(x => x.I).ToList(),
            recent.Select(e => Mapping.ToListItem(e, me.Email, me.Id)).ToList());
    }
}

[ApiController, Route("api/reports"), Authorize]
public class ReportsController(EnvelopeService svc, AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ReportDto> Get()
    {
        var q = svc.Visible().Where(e => !e.IsDeleted);
        var byStatus = await q.GroupBy(e => e.Status).Select(g => new { g.Key, N = g.Count() }).ToListAsync();
        var byType = await q.Where(e => e.Workflow != null).GroupBy(e => e.Workflow!.Type).Select(g => new { g.Key, N = g.Count() }).ToListAsync();
        var done = await q.Where(e => e.CompletedAt != null && e.SentAt != null).Select(e => new { e.SentAt, e.CompletedAt }).ToListAsync();
        var ids = q.Select(e => e.Id);
        var events = await db.AuditEvents.Where(a => ids.Contains(a.EnvelopeId)).OrderByDescending(a => a.At).Take(20).ToListAsync();
        return new ReportDto(byStatus.Sum(x => x.N),
            byStatus.ToDictionary(x => JsonNamingPolicy.CamelCase.ConvertName(x.Key.ToString()), x => x.N),
            byType.ToDictionary(x => JsonNamingPolicy.CamelCase.ConvertName(x.Key.ToString()), x => x.N),
            done.Count == 0 ? null : done.Average(x => (x.CompletedAt!.Value - x.SentAt!.Value).TotalHours),
            events.Select(Mapping.ToDto).ToList());
    }
}
