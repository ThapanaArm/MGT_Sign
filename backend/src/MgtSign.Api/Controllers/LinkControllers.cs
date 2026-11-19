using MgtSign.Api.Contracts;
using MgtSign.Api.Services;
using MgtSign.Api.Support;
using MgtSign.Domain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace MgtSign.Api.Controllers;

/// <summary>Signing by personal link. The token in the URL identifies the recipient; an access code may be required (header X-Access-Code).</summary>
[ApiController, Route("api/sign/{token}"), AllowAnonymous, EnableRateLimiting("links")]
public class SignController(EnvelopeService svc) : ControllerBase
{
    string? Code => Request.Headers.TryGetValue("X-Access-Code", out var v) ? v.ToString() : null;

    async Task<(Envelope E, Recipient R)> Ready()
    {
        var (e, r) = await svc.BySignToken(Token);
        var st = svc.SignState(e, r, Code);
        if (st == "accessCode") throw ApiException.Forbidden("Enter the access code first.");
        if (st is "closed" or "expired" && r.Status == RecipientStatus.Pending) throw ApiException.Forbidden("This envelope is no longer available.");
        return (e, r);
    }
    string Token => (string)RouteData.Values["token"]!;

    [HttpGet] public Task<SignSession> Get() => svc.SignSession(Token, Code);

    [HttpGet("document")]
    public async Task<IActionResult> Document()
    {
        var (e, _) = await Ready();
        var (bytes, name) = await svc.Document(e, "original");
        return File(bytes, "application/pdf", name);
    }

    /// <summary>The signed copy with certificate, once the envelope is completed.</summary>
    [HttpGet("signed")]
    public async Task<IActionResult> Signed()
    {
        var (e, _) = await Ready();
        var (bytes, name) = await svc.Document(e, "signed");
        return File(bytes, "application/pdf", name);
    }

    [HttpPost("complete")] public Task<SignSession> Complete(CompleteSigningRequest req) => svc.CompleteSigning(Token, Code, req);
    [HttpPost("decline")] public Task<SignSession> Decline(DeclineRequest req) => svc.Decline(Token, Code, req.Reason);

    [HttpPost("attachments"), RequestSizeLimit(200 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 200 * 1024 * 1024)]
    public async Task<List<AttachmentDto>> Attach()
    {
        var (e, r) = await Ready();
        if (svc.SignState(e, r, Code) != "ready") throw ApiException.Bad("Attachments can only be added while it is your turn.");
        return await svc.AddAttachments(e, Request.Form.Files.GetFiles("files"), r.Name, r.Email, r.Role == RecipientRole.Viewer ? AttachmentRole.Viewer : AttachmentRole.Signer, null);
    }

    [HttpGet("attachments/{attId:guid}")]
    public async Task<IActionResult> Attachment(Guid attId)
    {
        var (e, r) = await Ready();
        var (bytes, a) = await svc.AttachmentFile(e, attId, r.Name);
        return File(bytes, a.ContentType, a.FileName);
    }
}

/// <summary>Approval by personal link.</summary>
[ApiController, Route("api/approve/{token}"), AllowAnonymous, EnableRateLimiting("links")]
public class ApproveController(EnvelopeService svc) : ControllerBase
{
    string Token => (string)RouteData.Values["token"]!;

    [HttpGet] public Task<ApprovalSession> Get() => svc.ApprovalSession(Token);

    [HttpGet("document")]
    public async Task<IActionResult> Document()
    {
        var (e, _, _) = await svc.ByApproveToken(Token);
        var (bytes, name) = await svc.Document(e, "current");
        return File(bytes, "application/pdf", name);
    }

    [HttpPost("decision")] public Task<ApprovalSession> Decide(DecisionRequest req) => svc.Decide(Token, req);
    [HttpPost("delegate")] public Task<ApprovalSession> Delegate(DelegateRequest req) => svc.Delegate(Token, req);

    [HttpPost("attachments"), RequestSizeLimit(200 * 1024 * 1024), RequestFormLimits(MultipartBodyLengthLimit = 200 * 1024 * 1024)]
    public async Task<List<AttachmentDto>> Attach()
    {
        var (e, a, s) = await svc.ByApproveToken(Token);
        if (a.Status != ApproverStatus.Pending || s.Status != StepStatus.Active) throw ApiException.Bad("Attachments can only be added while your decision is pending.");
        return await svc.AddAttachments(e, Request.Form.Files.GetFiles("files"), a.Name, a.Email, AttachmentRole.Approver, s.Name);
    }

    [HttpGet("attachments/{attId:guid}")]
    public async Task<IActionResult> Attachment(Guid attId)
    {
        var (e, a, _) = await svc.ByApproveToken(Token);
        var (bytes, att) = await svc.AttachmentFile(e, attId, a.Name);
        return File(bytes, att.ContentType, att.FileName);
    }
}
