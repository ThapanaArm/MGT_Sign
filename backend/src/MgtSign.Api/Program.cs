using System.Security.Claims;
using System.Threading.RateLimiting;
using MgtSign.Api.Services;
using MgtSign.Api.Support;
using MgtSign.Api.Workers;
using MgtSign.Infrastructure;
using MgtSign.Infrastructure.Directory;
using MgtSign.Infrastructure.Email;
using MgtSign.Infrastructure.Pdf;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
var cfg = builder.Configuration;

// ---------- data ----------
var conn = cfg.GetConnectionString("Default") ?? throw new InvalidOperationException("Set ConnectionStrings:Default (see README).");
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlServer(conn, sql => sql.EnableRetryOnFailure(3)));

// ---------- options ----------
builder.Services.Configure<JwtOptions>(cfg.GetSection("Jwt"));
builder.Services.Configure<AppOptions>(cfg.GetSection("App"));
builder.Services.Configure<SmtpOptions>(cfg.GetSection("Smtp"));
builder.Services.Configure<EscalationOptions>(cfg.GetSection("Escalation"));
builder.Services.PostConfigure<JwtOptions>(o =>
{
    if (o.Key.Length >= 32) return;
    if (!builder.Environment.IsDevelopment()) throw new InvalidOperationException("Jwt:Key must be at least 32 characters. Set it with user-secrets or an environment variable.");
    o.Key = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48)); // dev only: sessions end when the API restarts
});

// ---------- auth ----------
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme).Configure<IOptions<JwtOptions>>((o, jwt) =>
{
    o.MapInboundClaims = false;
    o.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true, ValidIssuer = jwt.Value.Issuer, ValidateAudience = true, ValidAudience = jwt.Value.Audience,
        ValidateIssuerSigningKey = true, IssuerSigningKey = jwt.Value.SigningKey, ValidateLifetime = true, ClockSkew = TimeSpan.FromMinutes(1),
        NameClaimType = "name", RoleClaimType = ClaimTypes.Role
    };
});
builder.Services.AddAuthorization();

// Brute-force protection for sign-in and for the personal links (access codes).
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    static string Ip(HttpContext c) => c.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    o.AddPolicy("login", c => RateLimitPartition.GetFixedWindowLimiter(Ip(c), _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("links", c => RateLimitPartition.GetFixedWindowLimiter(Ip(c), _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1) }));
});

// ---------- web ----------
builder.Services.AddControllers().AddJsonOptions(o => Json.Configure(o.JsonSerializerOptions));
builder.Services.AddOpenApi();
builder.Services.AddHttpContextAccessor();
var origins = cfg.GetSection("App:CorsOrigins").Get<string[]>() ?? ["http://localhost:5173"];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod()));

// ---------- app services ----------
builder.Services.AddScoped<CurrentUser>();
builder.Services.AddScoped<Auditor>();
builder.Services.AddScoped<Notifier>();
builder.Services.AddScoped<SettingsStore>();
builder.Services.AddScoped<EnvelopeService>();
builder.Services.AddSingleton<JwtIssuer>();
builder.Services.AddSingleton(cfg.GetSection("Pdf").Get<PdfFontOptions>() ?? new PdfFontOptions());
builder.Services.AddSingleton<IPdfService, PdfService>();
// Company sign-in against MGT_Datawarehouse.dbo.Ms_User (connection string from secrets: ConnectionStrings:Datawarehouse).
builder.Services.Configure<DatawarehouseOptions>(o =>
{
    cfg.GetSection("Datawarehouse").Bind(o);
    o.ConnectionString ??= cfg.GetConnectionString("Datawarehouse");
});
builder.Services.AddSingleton<IUserDirectory, DatawarehouseDirectory>();
builder.Services.AddHostedService<OutboxSender>();
builder.Services.AddHostedService<EscalationWorker>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    await Seeder.Run(scope.ServiceProvider, app.Configuration, app.Logger);

app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto });
app.UseMiddleware<ErrorMiddleware>();
if (app.Environment.IsDevelopment()) app.MapOpenApi();
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapGet("/api/health", () => Results.Ok(new { status = "ok", time = DateTime.UtcNow })).AllowAnonymous();

// In production the built React app (frontend/dist) is copied to wwwroot and served from here.
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapFallbackToFile("{*path:regex(^(?!api/).*$)}", "index.html");

app.Run();
