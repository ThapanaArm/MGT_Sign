using MgtSign.Domain;
using Microsoft.EntityFrameworkCore;

namespace MgtSign.Infrastructure;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Contact> Contacts => Set<Contact>();
    public DbSet<FileBlob> FileBlobs => Set<FileBlob>();
    public DbSet<Envelope> Envelopes => Set<Envelope>();
    public DbSet<EnvelopeDocument> EnvelopeDocuments => Set<EnvelopeDocument>();
    public DbSet<Recipient> Recipients => Set<Recipient>();
    public DbSet<Field> Fields => Set<Field>();
    public DbSet<ApprovalWorkflow> Workflows => Set<ApprovalWorkflow>();
    public DbSet<WorkflowStep> WorkflowSteps => Set<WorkflowStep>();
    public DbSet<WorkflowApprover> WorkflowApprovers => Set<WorkflowApprover>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<Template> Templates => Set<Template>();
    public DbSet<OutboxEmail> OutboxEmails => Set<OutboxEmail>();
    public DbSet<AppSetting> Settings => Set<AppSetting>();

    protected override void ConfigureConventions(ModelConfigurationBuilder b)
    {
        // Enums are stored as readable strings.
        foreach (var t in typeof(Envelope).Assembly.GetTypes().Where(t => t.IsEnum))
            b.Properties(t).HaveConversion<string>().HaveMaxLength(32);
        b.Properties<decimal>().HavePrecision(18, 2);
        b.Properties<DateTime>().HavePrecision(3);
    }

    protected override void OnModelCreating(ModelBuilder m)
    {
        m.Entity<User>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Company).HasMaxLength(200);
            e.Property(x => x.PasswordHash).HasMaxLength(256);
            e.Property(x => x.Username).HasMaxLength(100);
            e.Property(x => x.Department).HasMaxLength(200);
            e.Property(x => x.ExternalId).HasMaxLength(64);
            e.HasIndex(x => x.Username);
        });
        m.Entity<Contact>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Department).HasMaxLength(200);
        });
        m.Entity<Envelope>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.HasIndex(x => new { x.SenderId, x.Status, x.UpdatedAt });
            e.Property(x => x.Code).HasMaxLength(32);
            e.Property(x => x.Subject).HasMaxLength(200);
            e.Property(x => x.SenderName).HasMaxLength(200);
            e.Property(x => x.SenderEmail).HasMaxLength(256);
            e.Property(x => x.VoidReason).HasMaxLength(1000);
            e.HasOne(x => x.Sender).WithMany().HasForeignKey(x => x.SenderId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Documents).WithOne().HasForeignKey(x => x.EnvelopeId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Recipients).WithOne().HasForeignKey(x => x.EnvelopeId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Fields).WithOne().HasForeignKey(x => x.EnvelopeId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Attachments).WithOne().HasForeignKey(x => x.EnvelopeId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.AuditEvents).WithOne().HasForeignKey(x => x.EnvelopeId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Workflow).WithOne().HasForeignKey<ApprovalWorkflow>(x => x.EnvelopeId).OnDelete(DeleteBehavior.Cascade);
            e.Ignore(x => x.Original);
        });
        m.Entity<EnvelopeDocument>(e =>
        {
            e.Property(x => x.FileName).HasMaxLength(260);
            e.Property(x => x.ContentType).HasMaxLength(100);
            e.Property(x => x.Sha256).HasMaxLength(64);
            e.HasOne(x => x.Blob).WithMany().HasForeignKey(x => x.BlobId).OnDelete(DeleteBehavior.Restrict);
        });
        m.Entity<Recipient>(e =>
        {
            e.HasIndex(x => x.AccessToken).IsUnique();
            e.HasIndex(x => x.Email);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.Color).HasMaxLength(16);
            e.Property(x => x.AccessCodeHash).HasMaxLength(256);
            e.Property(x => x.PrivateMessage).HasMaxLength(1000);
            e.Property(x => x.AccessToken).HasMaxLength(64);
            e.Property(x => x.DeclineReason).HasMaxLength(1000);
            e.Ignore(x => x.IsSigner); e.Ignore(x => x.Acts);
        });
        m.Entity<Field>(e =>
        {
            e.Property(x => x.Label).HasMaxLength(200);
            e.Property(x => x.Tooltip).HasMaxLength(300);
            e.HasIndex(x => new { x.EnvelopeId, x.RecipientId });
        });
        m.Entity<ApprovalWorkflow>(e =>
        {
            e.HasMany(x => x.Steps).WithOne().HasForeignKey(x => x.WorkflowId).OnDelete(DeleteBehavior.Cascade);
        });
        m.Entity<WorkflowStep>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.EscalationName).HasMaxLength(200);
            e.Property(x => x.EscalationEmail).HasMaxLength(256);
            e.HasMany(x => x.Approvers).WithOne().HasForeignKey(x => x.StepId).OnDelete(DeleteBehavior.Cascade);
        });
        m.Entity<WorkflowApprover>(e =>
        {
            e.HasIndex(x => x.AccessToken).IsUnique();
            e.HasIndex(x => x.Email);
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Email).HasMaxLength(256);
            e.Property(x => x.OnBehalfOf).HasMaxLength(2000);
            e.Property(x => x.DelegatedFrom).HasMaxLength(200);
            e.Property(x => x.DelegatedToEmail).HasMaxLength(256);
            e.Property(x => x.Comment).HasMaxLength(2000);
            e.Property(x => x.ActedBy).HasMaxLength(200);
            e.Property(x => x.AccessToken).HasMaxLength(64);
            e.Ignore(x => x.OnBehalfOfIds);
        });
        m.Entity<Attachment>(e =>
        {
            e.Property(x => x.FileName).HasMaxLength(260);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.Property(x => x.Sha256).HasMaxLength(64);
            e.Property(x => x.AddedByName).HasMaxLength(200);
            e.Property(x => x.AddedByEmail).HasMaxLength(256);
            e.Property(x => x.Context).HasMaxLength(200);
            e.HasOne(x => x.Blob).WithMany().HasForeignKey(x => x.BlobId).OnDelete(DeleteBehavior.Restrict);
        });
        m.Entity<AuditEvent>(e =>
        {
            e.HasIndex(x => new { x.EnvelopeId, x.At });
            e.Property(x => x.Action).HasMaxLength(120);
            e.Property(x => x.Actor).HasMaxLength(200);
            e.Property(x => x.IpAddress).HasMaxLength(64);
            e.Property(x => x.UserAgent).HasMaxLength(400);
        });
        m.Entity<Template>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Subject).HasMaxLength(200);
            e.Property(x => x.DocumentName).HasMaxLength(260);
        });
        m.Entity<OutboxEmail>(e =>
        {
            e.HasIndex(x => x.SentAt);
            e.Property(x => x.To).HasMaxLength(1000);
            e.Property(x => x.Subject).HasMaxLength(300);
            e.Property(x => x.Error).HasMaxLength(2000);
        });
        m.Entity<AppSetting>(e => { e.HasKey(x => x.Key); e.Property(x => x.Key).HasMaxLength(100); e.Property(x => x.Value).HasMaxLength(2000); });
        m.Entity<FileBlob>(e => e.ToTable("FileBlobs"));

        // Ids are created in code (Guid.NewGuid), so new children reached through navigations are inserted, not updated.
        foreach (var et in m.Model.GetEntityTypes())
        {
            var key = et.FindPrimaryKey();
            if (key is { Properties.Count: 1 } && key.Properties[0].ClrType == typeof(Guid)) key.Properties[0].ValueGenerated = Microsoft.EntityFrameworkCore.Metadata.ValueGenerated.Never;
        }
    }
}
