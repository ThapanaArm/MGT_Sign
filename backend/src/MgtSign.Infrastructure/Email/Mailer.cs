using System.Net;
using System.Net.Mail;
using MgtSign.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MgtSign.Infrastructure.Email;

public sealed class SmtpOptions
{
    /// <summary>Leave empty to keep emails in the outbox only (development).</summary>
    public string? Host { get; set; }
    public int Port { get; set; } = 587;
    public bool EnableSsl { get; set; } = true;
    public string? UserName { get; set; }
    public string? Password { get; set; }
    public string From { get; set; } = "no-reply@mgt-sign.local";
    public string FromName { get; set; } = "MGT Sign";
}

/// <summary>Delivers queued outbox emails when SMTP is configured. Retries up to 5 times.</summary>
public sealed class OutboxSender(IServiceScopeFactory scopes, IOptions<SmtpOptions> smtp, ILogger<OutboxSender> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(smtp.Value.Host)) { log.LogInformation("SMTP not configured: emails stay in the outbox (see Admin → Outbox)."); return; }
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var batch = await db.OutboxEmails.Where(m => m.SentAt == null && m.Attempts < 5).OrderBy(m => m.Id).Take(20).ToListAsync(ct);
                foreach (var m in batch)
                {
                    try
                    {
                        using var client = new SmtpClient(smtp.Value.Host, smtp.Value.Port) { EnableSsl = smtp.Value.EnableSsl };
                        if (!string.IsNullOrEmpty(smtp.Value.UserName)) client.Credentials = new NetworkCredential(smtp.Value.UserName, smtp.Value.Password);
                        using var msg = new MailMessage { From = new MailAddress(smtp.Value.From, smtp.Value.FromName), Subject = m.Subject, Body = m.BodyHtml, IsBodyHtml = true };
                        foreach (var to in m.To.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) msg.To.Add(to);
                        await client.SendMailAsync(msg, ct);
                        m.SentAt = DateTime.UtcNow; m.Error = null;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException) { m.Attempts++; m.Error = ex.Message; log.LogWarning(ex, "Email {Id} failed", m.Id); }
                }
                await db.SaveChangesAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogError(ex, "Outbox sender loop failed"); }
            await Task.Delay(TimeSpan.FromSeconds(30), ct);
        }
    }
}
