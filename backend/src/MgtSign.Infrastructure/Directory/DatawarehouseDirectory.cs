using System.Data;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace MgtSign.Infrastructure.Directory;

/// <summary>
/// Sign-in against the company user table MGT_Datawarehouse.dbo.Ms_User.
/// Who may sign in (configurable lists, defaults match the agreed rule):
///   (Username NOT IN ExcludedUsernames AND Department IN AllowedDepartments) OR Position IN AllowedPositions
///   AND IsActive = 1
/// </summary>
public sealed class DatawarehouseOptions
{
    public bool Enabled { get; set; }
    /// <summary>Set with user-secrets / environment variable ConnectionStrings:Datawarehouse — never in appsettings.json.</summary>
    public string? ConnectionString { get; set; }
    public string[] ExcludedUsernames { get; set; } = ["Admin", "GLC_Admin"];
    public string[] AllowedDepartments { get; set; } = ["IT", "HR", "Finance"];
    public string[] AllowedPositions { get; set; } = ["CFO", "CEO"];
    public bool RequireActive { get; set; } = true;
    /// <summary>Departments whose people become MGT Sign administrators.</summary>
    public string[] AdminDepartments { get; set; } = ["IT"];
    public int TimeoutSeconds { get; set; } = 10;
}

public enum DirectoryLoginStatus { Success, NotFound, WrongPassword, NoPasswordSet, Unavailable, Disabled }

public sealed record DirectoryUser(string UserId, string Username, string Email, string FullName, string? Department, string? Position, bool IsAdmin);
public sealed record DirectoryLoginResult(DirectoryLoginStatus Status, DirectoryUser? User = null);

public interface IUserDirectory
{
    bool Enabled { get; }
    Task<DirectoryLoginResult> Authenticate(string usernameOrEmail, string password, CancellationToken ct = default);
}

public sealed class DatawarehouseDirectory(IOptions<DatawarehouseOptions> options, ILogger<DatawarehouseDirectory> log) : IUserDirectory
{
    readonly DatawarehouseOptions _o = options.Value;
    public bool Enabled => _o.Enabled && !string.IsNullOrWhiteSpace(_o.ConnectionString);

    public async Task<DirectoryLoginResult> Authenticate(string id, string password, CancellationToken ct = default)
    {
        if (!Enabled) return new(DirectoryLoginStatus.Disabled);
        id = id.Trim();
        if (id.Length == 0 || password.Length == 0) return new(DirectoryLoginStatus.NotFound);
        try
        {
            await using var conn = new SqlConnection(_o.ConnectionString);
            await conn.OpenAsync(ct);
            await using var cmd = conn.CreateCommand();
            cmd.CommandTimeout = _o.TimeoutSeconds;
            // Values go in as parameters; only the parameter names are generated.
            string In(string prefix, string[] values)
            {
                if (values.Length == 0) return "(NULL)";
                var names = values.Select((v, i) => { var n = $"@{prefix}{i}"; cmd.Parameters.Add(n, SqlDbType.NVarChar, 200).Value = v; return n; });
                return "(" + string.Join(",", names) + ")";
            }
            cmd.Parameters.Add("@id", SqlDbType.NVarChar, 510).Value = id;
            cmd.CommandText = $"""
                SELECT TOP (5) CAST(UserID AS nvarchar(64)) AS UserID, Username, Email, FullName, Department, Position, PasswordHash
                FROM dbo.Ms_User
                WHERE (Username = @id OR Email = @id)
                  AND ((Username NOT IN {In("x", _o.ExcludedUsernames)} AND Department IN {In("d", _o.AllowedDepartments)}) OR Position IN {In("p", _o.AllowedPositions)})
                  {(_o.RequireActive ? "AND IsActive = 1" : "")}
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct);
            var found = false; var anyHash = false;
            while (await r.ReadAsync(ct))
            {
                found = true;
                var hash = r["PasswordHash"] as string;
                if (string.IsNullOrWhiteSpace(hash)) continue;
                anyHash = true;
                if (!CompanyPasswords.Verify(password, hash)) continue;
                var dept = r["Department"] as string;
                var user = new DirectoryUser((string)r["UserID"], (r["Username"] as string ?? "").Trim(), (r["Email"] as string ?? "").Trim(),
                    (r["FullName"] as string ?? "").Trim(), dept?.Trim(), (r["Position"] as string)?.Trim(),
                    _o.AdminDepartments.Any(a => string.Equals(a, dept?.Trim(), StringComparison.OrdinalIgnoreCase)));
                return new(DirectoryLoginStatus.Success, user);
            }
            return new(!found ? DirectoryLoginStatus.NotFound : anyHash ? DirectoryLoginStatus.WrongPassword : DirectoryLoginStatus.NoPasswordSet);
        }
        catch (Exception ex) when (ex is SqlException or InvalidOperationException or TimeoutException)
        {
            // Never log the connection string or the password.
            log.LogWarning("Company user directory (MGT_Datawarehouse) is unavailable: {Error}", ex.Message);
            return new(DirectoryLoginStatus.Unavailable);
        }
    }
}

/// <summary>Verifies the two hash formats found in Ms_User.PasswordHash.</summary>
public static class CompanyPasswords
{
    static readonly PasswordHasher<object> Identity = new();

    public static bool Verify(string password, string stored)
    {
        stored = stored.Trim();
        // 1) ASP.NET Core Identity hashes ("AQAAAA..." base64, V2/V3).
        if (stored.StartsWith("AQAAAA", StringComparison.Ordinal))
        {
            try { return Identity.VerifyHashedPassword(new object(), stored, password) != PasswordVerificationResult.Failed; }
            catch (FormatException) { return false; }
        }
        // 2) "pbkdf2$<iterations>$<salt b64>$<key b64>". The digest is not recorded, so SHA-256 and SHA-512 are both accepted.
        var p = stored.Split('$');
        if (p.Length == 4 && p[0].Equals("pbkdf2", StringComparison.OrdinalIgnoreCase) && int.TryParse(p[1], out var it) && it is > 0 and <= 5_000_000)
        {
            byte[] salt, key;
            try { salt = Convert.FromBase64String(p[2]); key = Convert.FromBase64String(p[3]); } catch (FormatException) { return false; }
            foreach (var alg in new[] { HashAlgorithmName.SHA256, HashAlgorithmName.SHA512 })
                if (CryptographicOperations.FixedTimeEquals(Rfc2898DeriveBytes.Pbkdf2(password, salt, it, alg, key.Length), key)) return true;
        }
        // Plain-text or unknown formats are never accepted.
        return false;
    }
}
