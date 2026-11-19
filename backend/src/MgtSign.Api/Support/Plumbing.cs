using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MgtSign.Api.Contracts;
using MgtSign.Domain;
using MgtSign.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace MgtSign.Api.Support;

public static class Json
{
    public static readonly JsonSerializerOptions Options = Configure(new JsonSerializerOptions(JsonSerializerDefaults.Web));
    public static JsonSerializerOptions Configure(JsonSerializerOptions o)
    {
        o.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        o.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        return o;
    }
}

/// <summary>4xx errors with a user-facing message.</summary>
public class ApiException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
    public static ApiException NotFound(string what = "Not found.") => new(404, what);
    public static ApiException Forbidden(string why = "You do not have access to this.") => new(403, why);
    public static ApiException Bad(string why) => new(400, why);
}

public sealed class ErrorMiddleware(RequestDelegate next, ILogger<ErrorMiddleware> log)
{
    public async Task Invoke(HttpContext ctx)
    {
        try { await next(ctx); }
        catch (ApiException ex) { await Write(ctx, ex.Status, ex.Message); }
        catch (DomainException ex) { await Write(ctx, 400, ex.Message); }
        catch (DbUpdateConcurrencyException) { await Write(ctx, 409, "Someone else changed this envelope. Reload and try again."); }
        catch (Exception ex) { log.LogError(ex, "Unhandled error"); await Write(ctx, 500, "Something went wrong on the server. Please try again."); }
    }
    static Task Write(HttpContext ctx, int status, string message)
    {
        if (ctx.Response.HasStarted) return Task.CompletedTask;
        ctx.Response.Clear(); ctx.Response.StatusCode = status;
        return ctx.Response.WriteAsJsonAsync(new ProblemMessage(message), Json.Options);
    }
}

/// <summary>The signed-in user (from the JWT) — null for anonymous link-token requests.</summary>
public sealed class CurrentUser(IHttpContextAccessor http)
{
    ClaimsPrincipal? P => http.HttpContext?.User;
    public bool IsAuthenticated => P?.Identity?.IsAuthenticated == true;
    public Guid Id => Guid.TryParse(P?.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? P?.FindFirstValue(ClaimTypes.NameIdentifier), out var g) ? g : Guid.Empty;
    public string Email => P?.FindFirstValue(JwtRegisteredClaimNames.Email) ?? P?.FindFirstValue(ClaimTypes.Email) ?? "";
    public string Name => P?.FindFirstValue("name") ?? "";
    public bool IsAdmin => P?.IsInRole(nameof(UserRole.Admin)) == true;
    public bool Is(string? email) => IsAuthenticated && string.Equals(email, Email, StringComparison.OrdinalIgnoreCase);
}

public sealed class JwtOptions
{
    public string Key { get; set; } = "";
    public string Issuer { get; set; } = "MgtSign";
    public string Audience { get; set; } = "MgtSign";
    public int Hours { get; set; } = 12;
    public SymmetricSecurityKey SigningKey => new(Encoding.UTF8.GetBytes(Key));
}

public sealed class JwtIssuer(Microsoft.Extensions.Options.IOptions<JwtOptions> o)
{
    public (string Token, DateTime ExpiresAt) Issue(User u)
    {
        var exp = DateTime.UtcNow.AddHours(o.Value.Hours);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, u.Id.ToString()), new Claim(JwtRegisteredClaimNames.Email, u.Email),
            new Claim("name", u.Name), new Claim(ClaimTypes.Role, u.Role.ToString()), new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
        };
        var token = new JwtSecurityToken(o.Value.Issuer, o.Value.Audience, claims, expires: exp,
            signingCredentials: new SigningCredentials(o.Value.SigningKey, SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(token), exp);
    }
}

/// <summary>Creates audit writers that stamp the caller's IP address and user agent.</summary>
public sealed class Auditor(IHttpContextAccessor http)
{
    public AuditWriter For(Envelope e) => (action, detail, actor) =>
    {
        var ctx = http.HttpContext;
        e.AuditEvents.Add(new AuditEvent
        {
            EnvelopeId = e.Id, At = DateTime.UtcNow, Action = action, Actor = actor, Detail = Cap(detail, 4000),
            IpAddress = ctx?.Connection.RemoteIpAddress?.ToString(), UserAgent = Cap(ctx?.Request.Headers.UserAgent.ToString(), 400)
        });
        e.UpdatedAt = DateTime.UtcNow;
    };
    static string? Cap(string? s, int n) => s is null || s.Length <= n ? s : s[..n];
}

public static class FileRules
{
    public const long MaxPdf = 25 * 1024 * 1024, MaxAttachment = 25 * 1024 * 1024;
    public const int MaxAttachments = 20;
    static readonly HashSet<string> AttachmentExt = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".msg", ".eml"];

    public static async Task<byte[]> ReadPdf(IFormFile f)
    {
        if (f.Length == 0) throw ApiException.Bad($"{f.FileName} is empty.");
        if (f.Length > MaxPdf) throw ApiException.Bad($"{f.FileName} is larger than 25 MB.");
        var bytes = await Read(f);
        if (bytes.Length < 5 || Encoding.ASCII.GetString(bytes, 0, 5) != "%PDF-") throw ApiException.Bad($"{f.FileName} is not a PDF file.");
        return bytes;
    }

    public static async Task<byte[]> ReadAttachment(IFormFile f)
    {
        var ext = Path.GetExtension(f.FileName).ToLowerInvariant();
        if (!AttachmentExt.Contains(ext)) throw ApiException.Bad($"{f.FileName}: file type not allowed.");
        if (f.Length == 0) throw ApiException.Bad($"{f.FileName} is empty.");
        if (f.Length > MaxAttachment) throw ApiException.Bad($"{f.FileName} is larger than 25 MB.");
        return await Read(f);
    }

    static async Task<byte[]> Read(IFormFile f) { using var ms = new MemoryStream(); await f.CopyToAsync(ms); return ms.ToArray(); }

    public static string SafeName(string name) => string.Concat(Path.GetFileName(name).Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
}

public sealed class SettingsStore(AppDbContext db)
{
    public async Task<SettingsDto> Get()
    {
        var s = await db.Settings.AsNoTracking().ToDictionaryAsync(x => x.Key, x => x.Value);
        string? V(string k) => s.TryGetValue(k, out var v) && v != "" ? v : null;
        return new SettingsDto(
            int.TryParse(V("ExpiryDays"), out var e) ? e : 30, int.TryParse(V("ReminderDays"), out var r) ? r : 0,
            V("RequireApproval") == "true", Enum.TryParse<WorkflowType>(V("DefaultWorkflowType"), out var t) ? t : WorkflowType.Single,
            V("DefaultApproverName"), V("DefaultApproverEmail"));
    }

    public async Task Save(SettingsDto d)
    {
        var map = new Dictionary<string, string>
        {
            ["ExpiryDays"] = Math.Clamp(d.ExpiryDays, 1, 365).ToString(), ["ReminderDays"] = Math.Clamp(d.ReminderDays, 0, 30).ToString(),
            ["RequireApproval"] = d.RequireApproval ? "true" : "false", ["DefaultWorkflowType"] = d.DefaultWorkflowType.ToString(),
            ["DefaultApproverName"] = d.DefaultApproverName?.Trim() ?? "", ["DefaultApproverEmail"] = d.DefaultApproverEmail?.Trim() ?? ""
        };
        foreach (var (k, v) in map)
        {
            var row = await db.Settings.FindAsync(k);
            if (row is null) db.Settings.Add(new AppSetting { Key = k, Value = v }); else row.Value = v;
        }
        await db.SaveChangesAsync();
    }
}
