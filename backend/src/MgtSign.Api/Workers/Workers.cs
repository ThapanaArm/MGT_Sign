using MgtSign.Api.Services;
using MgtSign.Domain;
using MgtSign.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace MgtSign.Api.Workers;

public sealed class EscalationOptions
{
    public int IntervalMinutes { get; set; } = 15;
}

/// <summary>Checks overdue approval steps on a timer. Escalation reminds or adds a backup; it never approves.</summary>
public sealed class EscalationWorker(IServiceScopeFactory scopes, IOptions<EscalationOptions> o, ILogger<EscalationWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromSeconds(20), ct);
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var n = await scope.ServiceProvider.GetRequiredService<EnvelopeService>().RunEscalations();
                if (n > 0) log.LogInformation("Escalated {Count} overdue approval step(s)", n);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Escalation check failed"); }
            await Task.Delay(TimeSpan.FromMinutes(Math.Max(1, o.Value.IntervalMinutes)), ct);
        }
    }
}

public static class Seeder
{
    /// <summary>Applies migrations and creates the first administrator from configuration (Seed:*).</summary>
    public static async Task Run(IServiceProvider sp, IConfiguration cfg, ILogger log)
    {
        var db = sp.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
        if (await db.Users.AnyAsync()) return;
        var email = cfg["Seed:AdminEmail"]; var password = cfg["Seed:AdminPassword"];
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        { log.LogWarning("No users exist. Set Seed:AdminEmail and Seed:AdminPassword to create the first administrator."); return; }
        db.Users.Add(new User { Email = email.Trim(), Name = cfg["Seed:AdminName"] ?? "Administrator", Title = cfg["Seed:AdminTitle"], Company = "MGT Group",
            Role = UserRole.Admin, PasswordHash = Passwords.Hash(password) });
        await db.SaveChangesAsync();
        log.LogInformation("Created first administrator {Email}. Change the password after signing in.", email);
    }
}
