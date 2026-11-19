using System.Text.Json;
using MgtSign.Api.Contracts;
using MgtSign.Api.Services;
using MgtSign.Api.Support;
using MgtSign.Domain;
using MgtSign.Infrastructure;
using MgtSign.Infrastructure.Directory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace MgtSign.Api.Controllers;

[ApiController, Route("api/templates"), Authorize]
public class TemplatesController(AppDbContext db, EnvelopeService svc, CurrentUser me) : ControllerBase
{
    static TemplateDto ToDto(Template t)
    {
        var d = JsonSerializer.Deserialize<TemplateDefinition>(t.DefinitionJson, Json.Options)!;
        return new TemplateDto(t.Id, t.Name, t.Subject, t.DocumentName, t.PageCount, d.Recipients.Count, d.Fields.Count, d.Workflow?.Type, t.CreatedAt);
    }

    [HttpGet] public async Task<List<TemplateDto>> List() => (await db.Templates.AsNoTracking().OrderBy(t => t.Name).ToListAsync()).Select(ToDto).ToList();

    [HttpGet("{id:guid}")]
    public async Task<TemplateDetail> Get(Guid id)
    {
        var t = await db.Templates.FindAsync(id) ?? throw ApiException.NotFound("Template not found.");
        return new TemplateDetail(ToDto(t), JsonSerializer.Deserialize<TemplateDefinition>(t.DefinitionJson, Json.Options)!);
    }

    [HttpGet("{id:guid}/document")]
    public async Task<IActionResult> Document(Guid id)
    {
        var t = await db.Templates.FindAsync(id) ?? throw ApiException.NotFound("Template not found.");
        var blob = await db.FileBlobs.FindAsync(t.DocumentBlobId) ?? throw ApiException.NotFound("The template document is missing.");
        return File(blob.Content, "application/pdf", t.DocumentName);
    }

    [HttpPost]
    public async Task<TemplateDto> Create(SaveTemplateRequest req)
    {
        var e = await svc.LoadVisible(req.EnvelopeId);
        if (e.SenderId != me.Id) throw ApiException.Forbidden("Only the sender can save this envelope as a template.");
        if (string.IsNullOrWhiteSpace(req.Name)) throw ApiException.Bad("Enter a template name.");
        var recips = e.Recipients.OrderBy(r => r.RoutingOrder).ThenBy(r => r.Name).ToList();
        var def = new TemplateDefinition(e.Subject, e.Message,
            recips.Select(r => new RecipientInput(r.Name, r.Email, r.Role, r.RoutingOrder, null, r.PrivateMessage)).ToList(),
            e.Fields.Select(f => new TemplateField(recips.FindIndex(r => r.Id == f.RecipientId), f.Type, f.Page, f.X, f.Y, f.Width, f.Height, f.Required, f.Label, f.Tooltip)).ToList(),
            e.Workflow is null ? null : new WorkflowInput(e.Workflow.Type, e.Workflow.AllowDelegation, e.Workflow.Amount,
                e.Workflow.Steps.OrderBy(s => s.Sequence).Select(s => new StepInput(s.Name, s.Rule, s.QuorumMode, s.QuorumValue, s.ConditionOp, s.ConditionValue,
                    s.EscalationDays, s.EscalationMode, s.EscalationName, s.EscalationEmail,
                    s.Approvers.Where(a => !a.IsBackup && a.DelegatedFrom is null).OrderBy(a => a.Sequence).Select(a => new ApproverInput(a.Name, a.Email, a.Veto)).ToList())).ToList()));
        var src = await db.FileBlobs.FindAsync(e.Original!.BlobId);
        var blob = new FileBlob { Content = src!.Content };
        var t = new Template { Name = req.Name.Trim(), Subject = e.Subject, Message = e.Message, DefinitionJson = JsonSerializer.Serialize(def, Json.Options),
            DocumentName = e.Original.FileName, PageCount = e.Original.PageCount, DocumentBlobId = blob.Id, CreatedById = me.Id };
        db.FileBlobs.Add(blob); db.Templates.Add(t);
        await db.SaveChangesAsync();
        return ToDto(t);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var t = await db.Templates.FindAsync(id) ?? throw ApiException.NotFound("Template not found.");
        if (t.CreatedById != me.Id && !me.IsAdmin) throw ApiException.Forbidden("Only the creator or an administrator can delete this template.");
        db.Templates.Remove(t);
        await db.SaveChangesAsync();
        await db.FileBlobs.Where(b => b.Id == t.DocumentBlobId).ExecuteDeleteAsync();
        return NoContent();
    }
}

[ApiController, Route("api/contacts"), Authorize]
public class ContactsController(AppDbContext db, IUserDirectory directory) : ControllerBase
{
    static ContactDto ToDto(Contact c) => new(c.Id, c.Name, c.Email, c.Department);

    /// <summary>User list for choosing recipients and approvers: MGT Sign users, saved contacts and active company employees.</summary>
    [HttpGet("~/api/directory/people")]
    public async Task<List<PersonDto>> People(string? q, int take = 30, CancellationToken ct = default)
    {
        take = Math.Clamp(take, 1, 200);
        var s = (q ?? "").Trim();
        var users = db.Users.AsNoTracking().Where(u => u.IsActive);
        var contacts = db.Contacts.AsNoTracking();
        if (s.Length > 0)
        {
            users = users.Where(u => u.Name.Contains(s) || u.Email.Contains(s) || (u.Username != null && u.Username.Contains(s)) || (u.Department != null && u.Department.Contains(s)));
            contacts = contacts.Where(c => c.Name.Contains(s) || c.Email.Contains(s) || (c.Department != null && c.Department.Contains(s)));
        }
        var local = (await users.OrderBy(u => u.Name).Take(take).ToListAsync(ct))
            .Select(u => new PersonDto(u.Name, u.Email, u.Username, u.Department, u.Title, "user"))
            .Concat((await contacts.OrderBy(c => c.Name).Take(take).ToListAsync(ct)).Select(c => new PersonDto(c.Name, c.Email, null, c.Department, null, "contact")));
        var company = (await directory.Search(s, take, ct)).Select(p => new PersonDto(p.Name, p.Email, p.Username, p.Department, p.Position, "company"));
        // One row per email: the company record wins for name/department, local rows fill gaps.
        return company.Concat(local)
            .Where(p => Emails.IsValid(p.Email))
            .GroupBy(p => p.Email.Trim().ToLowerInvariant())
            .Select(g => g.First())
            .OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase)
            .Take(take).ToList();
    }

    [HttpGet]
    public async Task<List<ContactDto>> List()
    {
        // Directory = saved contacts plus active users.
        var contacts = await db.Contacts.AsNoTracking().ToListAsync();
        var users = await db.Users.AsNoTracking().Where(u => u.IsActive).Select(u => new Contact { Id = u.Id, Name = u.Name, Email = u.Email, Department = u.Title }).ToListAsync();
        return users.Concat(contacts).DistinctBy(c => c.Email.ToLowerInvariant()).OrderBy(c => c.Name).Select(ToDto).ToList();
    }

    static void Check(ContactInput c) { if (string.IsNullOrWhiteSpace(c.Name) || !Emails.IsValid(c.Email)) throw ApiException.Bad("Enter a name and a valid email."); }

    [HttpPost]
    public async Task<ContactDto> Add(ContactInput req)
    {
        Check(req);
        if (await db.Contacts.AnyAsync(c => c.Email == req.Email.Trim())) throw ApiException.Bad("This email is already in the directory.");
        var c = new Contact { Name = req.Name.Trim(), Email = req.Email.Trim(), Department = req.Department?.Trim() };
        db.Contacts.Add(c); await db.SaveChangesAsync();
        return ToDto(c);
    }

    [HttpPut("{id:guid}")]
    public async Task<ContactDto> Update(Guid id, ContactInput req)
    {
        Check(req);
        var c = await db.Contacts.FindAsync(id) ?? throw ApiException.NotFound("Contact not found (people with accounts are edited under Users).");
        c.Name = req.Name.Trim(); c.Email = req.Email.Trim(); c.Department = req.Department?.Trim();
        await db.SaveChangesAsync();
        return ToDto(c);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var c = await db.Contacts.FindAsync(id) ?? throw ApiException.NotFound("Contact not found.");
        db.Contacts.Remove(c); await db.SaveChangesAsync();
        return NoContent();
    }
}

[ApiController, Route("api/admin"), Authorize(Roles = nameof(UserRole.Admin))]
public class AdminController(AppDbContext db, EnvelopeService svc) : ControllerBase
{
    static AdminUserDto ToDto(User u) => new(u.Id, u.Email, u.Name, u.Title, u.Company, u.Role, u.IsActive, u.CreatedAt, u.Source, u.Username, u.Department, u.LastLoginAt);

    [HttpGet("users")] public async Task<List<AdminUserDto>> Users() => (await db.Users.AsNoTracking().OrderBy(u => u.Name).ToListAsync()).Select(ToDto).ToList();

    [HttpPost("users")]
    public async Task<AdminUserDto> CreateUser(AdminUserInput req)
    {
        if (string.IsNullOrWhiteSpace(req.Name) || !Emails.IsValid(req.Email)) throw ApiException.Bad("Enter a name and a valid email.");
        if (req.Password is not { Length: >= 10 }) throw ApiException.Bad("Set an initial password of at least 10 characters.");
        if (await db.Users.AnyAsync(u => u.Email == req.Email.Trim())) throw ApiException.Bad("A user with this email already exists.");
        var u = new User { Email = req.Email.Trim(), Name = req.Name.Trim(), Title = req.Title?.Trim(), Company = req.Company?.Trim(), Role = req.Role, IsActive = req.IsActive, PasswordHash = Passwords.Hash(req.Password) };
        db.Users.Add(u); await db.SaveChangesAsync();
        return ToDto(u);
    }

    [HttpPut("users/{id:guid}")]
    public async Task<AdminUserDto> UpdateUser(Guid id, AdminUserInput req)
    {
        var u = await db.Users.FindAsync(id) ?? throw ApiException.NotFound("User not found.");
        if (u.Source == UserSource.Datawarehouse)
        {
            // Name, email, role and password come from MGT_Datawarehouse on every sign-in; only access to MGT Sign is switched here.
            if (!string.IsNullOrEmpty(req.Password)) throw ApiException.Bad("Company accounts use their company password. It cannot be set here.");
            u.IsActive = req.IsActive;
            await db.SaveChangesAsync();
            return ToDto(u);
        }
        if (string.IsNullOrWhiteSpace(req.Name) || !Emails.IsValid(req.Email)) throw ApiException.Bad("Enter a name and a valid email.");
        if (u.Role == UserRole.Admin && (req.Role != UserRole.Admin || !req.IsActive) && await db.Users.CountAsync(x => x.Role == UserRole.Admin && x.IsActive) == 1)
            throw ApiException.Bad("Keep at least one active administrator.");
        u.Email = req.Email.Trim(); u.Name = req.Name.Trim(); u.Title = req.Title?.Trim(); u.Company = req.Company?.Trim(); u.Role = req.Role; u.IsActive = req.IsActive;
        if (!string.IsNullOrEmpty(req.Password)) { if (req.Password.Length < 10) throw ApiException.Bad("Use at least 10 characters for the password."); u.PasswordHash = Passwords.Hash(req.Password); }
        await db.SaveChangesAsync();
        return ToDto(u);
    }

    [HttpGet("outbox")]
    public async Task<List<OutboxDto>> Outbox(int take = 50) =>
        await db.OutboxEmails.AsNoTracking().OrderByDescending(m => m.Id).Take(Math.Clamp(take, 1, 200))
            .Select(m => new OutboxDto(m.Id, m.To, m.Subject, m.BodyHtml, m.CreatedAt, m.SentAt, m.Error, m.EnvelopeId)).ToListAsync();

    [HttpPost("escalations/run")] public async Task<object> Run() => new { escalated = await svc.RunEscalations() };

    /// <summary>Testing aid: treats the active step's escalation deadline as passed, then escalates.</summary>
    [HttpPost("envelopes/{id:guid}/simulate-overdue")] public async Task<object> Simulate(Guid id) => new { escalated = await svc.RunEscalations(id, forceOverdue: true) };
}
