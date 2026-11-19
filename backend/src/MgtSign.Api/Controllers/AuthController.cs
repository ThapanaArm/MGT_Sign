using MgtSign.Api.Contracts;
using MgtSign.Api.Support;
using MgtSign.Domain;
using MgtSign.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace MgtSign.Api.Controllers;

[ApiController, Route("api/auth"), Authorize]
public class AuthController(AppDbContext db, JwtIssuer jwt, CurrentUser me) : ControllerBase
{
    public static UserDto ToDto(User u) => new(u.Id, u.Email, u.Name, u.Title, u.Company, u.Role, u.SignatureImage is not null);

    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("login")]
    public async Task<LoginResponse> Login(LoginRequest req)
    {
        var u = await db.Users.FirstOrDefaultAsync(x => x.Email == req.Email.Trim());
        if (u is null || !u.IsActive || !Passwords.Verify(req.Password, u.PasswordHash)) throw new ApiException(401, "Email or password is incorrect.");
        var (token, exp) = jwt.Issue(u);
        return new LoginResponse(token, exp, ToDto(u));
    }

    async Task<User> Me() => await db.Users.FindAsync(me.Id) ?? throw new ApiException(401, "Your session has ended. Sign in again.");

    [HttpGet("me")] public async Task<UserDto> Get() => ToDto(await Me());

    [HttpPut("me")]
    public async Task<UserDto> Update(ProfileUpdate req)
    {
        var u = await Me();
        if (string.IsNullOrWhiteSpace(req.Name)) throw ApiException.Bad("Enter your name.");
        u.Name = req.Name.Trim(); u.Title = req.Title?.Trim(); u.Company = req.Company?.Trim();
        await db.SaveChangesAsync();
        return ToDto(u);
    }

    [HttpPost("password")]
    public async Task<IActionResult> ChangePassword(PasswordChange req)
    {
        var u = await Me();
        if (!Passwords.Verify(req.CurrentPassword, u.PasswordHash)) throw ApiException.Bad("The current password is incorrect.");
        if (req.NewPassword is not { Length: >= 10 }) throw ApiException.Bad("Use at least 10 characters for the new password.");
        u.PasswordHash = Passwords.Hash(req.NewPassword);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("signature")] public async Task<SignatureDto> GetSignature() { var u = await Me(); return new(u.SignatureImage, u.InitialImage); }

    [HttpPut("signature")]
    public async Task<IActionResult> SaveSignature(SignatureDto req)
    {
        var u = await Me();
        bool Ok(string? s) => s is null || (s.StartsWith("data:image/png;base64,") && s.Length < 3_000_000);
        if (!Ok(req.SignatureImage) || !Ok(req.InitialImage)) throw ApiException.Bad("Signatures must be PNG images smaller than 2 MB.");
        u.SignatureImage = req.SignatureImage; u.InitialImage = req.InitialImage;
        await db.SaveChangesAsync();
        return NoContent();
    }
}

[ApiController, Route("api"), Authorize]
public class MetaController(SettingsStore settings, CurrentUser me) : ControllerBase
{
    [HttpGet("meta/workflow-types")]
    public IEnumerable<WorkflowTypeDto> WorkflowTypes() => WorkflowPresets.Types.Select(t => new WorkflowTypeDto(t.Type, t.NameEn, t.NameTh, t.Description));

    [HttpGet("settings")] public Task<SettingsDto> Get() => settings.Get();

    [HttpPut("settings")]
    public async Task<SettingsDto> Put(SettingsDto req)
    {
        if (!me.IsAdmin) throw ApiException.Forbidden("Only administrators can change workflow settings.");
        if (req.RequireApproval && !Emails.IsValid(req.DefaultApproverEmail)) throw ApiException.Bad("Enter a valid default approver email.");
        await settings.Save(req);
        return await settings.Get();
    }
}
