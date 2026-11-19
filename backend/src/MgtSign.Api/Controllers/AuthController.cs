using MgtSign.Api.Contracts;
using MgtSign.Api.Support;
using MgtSign.Domain;
using MgtSign.Infrastructure;
using MgtSign.Infrastructure.Directory;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace MgtSign.Api.Controllers;

[ApiController, Route("api/auth"), Authorize]
public class AuthController(AppDbContext db, JwtIssuer jwt, CurrentUser me, IUserDirectory directory, ILogger<AuthController> log) : ControllerBase
{
    public static UserDto ToDto(User u) => new(u.Id, u.Email, u.Name, u.Title, u.Company, u.Role, u.SignatureImage is not null, u.Source, u.Username, u.Department);

    const string Wrong = "Username/email or password is incorrect, or your account is not allowed to use MGT Sign.";

    /// <summary>
    /// Local MGT Sign accounts (e.g. the break-glass administrator) sign in with their own password.
    /// Everyone else signs in with their company account from MGT_Datawarehouse.dbo.Ms_User.
    /// </summary>
    [HttpPost("login"), AllowAnonymous, EnableRateLimiting("login")]
    public async Task<LoginResponse> Login(LoginRequest req, CancellationToken ct)
    {
        var id = (req.Email ?? "").Trim();
        if (id.Length == 0 || string.IsNullOrEmpty(req.Password)) throw ApiException.Bad("Enter your username or email and password.");

        var local = await db.Users.FirstOrDefaultAsync(x => x.Source == UserSource.Local && x.Email == id, ct);
        if (local is not null && Passwords.Verify(req.Password, local.PasswordHash))
        {
            if (!local.IsActive) throw new ApiException(401, "Your MGT Sign account is disabled.");
            return Issue(local);
        }

        var r = await directory.Authenticate(id, req.Password, ct);
        switch (r.Status)
        {
            case DirectoryLoginStatus.Success:
                var u = await LinkCompanyUser(r.User!, ct);
                if (!u.IsActive) throw new ApiException(401, "Your MGT Sign access has been disabled by an administrator.");
                return Issue(u);
            case DirectoryLoginStatus.Unavailable:
                throw new ApiException(503, "The company user directory is not reachable right now. Try again in a few minutes.");
            default:
                log.LogInformation("Sign-in refused for {Id}: {Reason}", id, r.Status);
                throw new ApiException(401, Wrong);
        }
    }

    LoginResponse Issue(User u)
    {
        u.LastLoginAt = DateTime.UtcNow;
        db.SaveChanges();
        var (token, exp) = jwt.Issue(u);
        return new LoginResponse(token, exp, ToDto(u));
    }

    /// <summary>Creates or refreshes the MGT Sign account for a company user. The company record is the source of truth.</summary>
    async Task<User> LinkCompanyUser(DirectoryUser d, CancellationToken ct)
    {
        var email = d.Email.Length > 0 ? d.Email : d.Username;
        var u = await db.Users.FirstOrDefaultAsync(x => x.Source == UserSource.Datawarehouse && x.ExternalId == d.UserId, ct)
             ?? await db.Users.FirstOrDefaultAsync(x => x.Email == email, ct);
        if (u is null) { u = new User { PasswordHash = "" }; db.Users.Add(u); }
        u.Source = UserSource.Datawarehouse; u.ExternalId = d.UserId; u.Username = d.Username; u.Email = email;
        u.Name = d.FullName.Length > 0 ? d.FullName : d.Username; u.Title = d.Position; u.Department = d.Department;
        u.Company ??= "MGT Group"; u.Role = d.IsAdmin ? UserRole.Admin : UserRole.User;
        u.PasswordHash = ""; // company accounts never use a local password
        await db.SaveChangesAsync(ct);
        return u;
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
        if (u.Source == UserSource.Datawarehouse) throw ApiException.Bad("Your password is managed by the company user system. Change it there.");
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
