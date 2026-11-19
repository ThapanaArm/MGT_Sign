using System.Security.Cryptography;
using MgtSign.Infrastructure.Directory;
using Microsoft.AspNetCore.Identity;

namespace MgtSign.Tests;

public class CompanyPasswordsTests
{
    static string Pbkdf2(string password, HashAlgorithmName alg)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        return $"pbkdf2$210000${Convert.ToBase64String(salt)}${Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(password, salt, 210000, alg, 32))}";
    }

    [Fact] public void Accepts_aspnet_identity_v3_hash()
    {
        var hash = new PasswordHasher<object>().HashPassword(new object(), "S3cret!pass");
        Assert.StartsWith("AQAAAA", hash);
        Assert.True(CompanyPasswords.Verify("S3cret!pass", hash));
        Assert.False(CompanyPasswords.Verify("wrong", hash));
    }

    [Theory] [InlineData("SHA256")] [InlineData("SHA512")]
    public void Accepts_pbkdf2_dollar_format(string alg)
    {
        var hash = Pbkdf2("ใบสั่งซื้อ-123", new HashAlgorithmName(alg));
        Assert.True(CompanyPasswords.Verify("ใบสั่งซื้อ-123", hash));
        Assert.False(CompanyPasswords.Verify("ใบสั่งซื้อ-124", hash));
    }

    [Theory] [InlineData("plaintext")] [InlineData("")] [InlineData("pbkdf2$abc$x$y")] [InlineData("AQAAAA-not-base64")]
    public void Rejects_unknown_or_plain_formats(string stored) => Assert.False(CompanyPasswords.Verify(stored, stored));
}
