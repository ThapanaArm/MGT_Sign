namespace MgtSign.Domain;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = "";
    /// <summary>Company username (Ms_User.Username) for Datawarehouse accounts.</summary>
    public string? Username { get; set; }
    public string Name { get; set; } = "";
    public string? Title { get; set; }
    public string? Company { get; set; }
    public string? Department { get; set; }
    /// <summary>Local accounts sign in with PasswordHash; Datawarehouse accounts are checked against MGT_Datawarehouse.dbo.Ms_User.</summary>
    public UserSource Source { get; set; } = UserSource.Local;
    /// <summary>Ms_User.UserID for Datawarehouse accounts.</summary>
    public string? ExternalId { get; set; }
    public DateTime? LastLoginAt { get; set; }
    public string PasswordHash { get; set; } = "";
    public UserRole Role { get; set; } = UserRole.User;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Adopted signature / initials as PNG data URLs.</summary>
    public string? SignatureImage { get; set; }
    public string? InitialImage { get; set; }
}

public class Contact
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string? Department { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Binary content kept apart from metadata so list queries stay light.</summary>
public class FileBlob
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public byte[] Content { get; set; } = [];
}

public class Envelope
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Code { get; set; } = "";
    public EnvelopeType Type { get; set; }
    public EnvelopeStatus Status { get; set; } = EnvelopeStatus.Draft;
    public string Subject { get; set; } = "";
    public string? Message { get; set; }
    public Guid SenderId { get; set; }
    public User? Sender { get; set; }
    public string SenderName { get; set; } = "";
    public string SenderEmail { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public int ReminderDays { get; set; }
    public string? VoidReason { get; set; }
    public bool IsDeleted { get; set; }
    public bool SigningOrderEnabled { get; set; }

    public List<EnvelopeDocument> Documents { get; set; } = [];
    public List<Recipient> Recipients { get; set; } = [];
    public List<Field> Fields { get; set; } = [];
    public ApprovalWorkflow? Workflow { get; set; }
    public List<Attachment> Attachments { get; set; } = [];
    public List<AuditEvent> AuditEvents { get; set; } = [];

    public EnvelopeDocument? Original => Documents.FirstOrDefault(d => d.Kind == DocumentKind.Original);
}

public class EnvelopeDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EnvelopeId { get; set; }
    public DocumentKind Kind { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "application/pdf";
    public long Size { get; set; }
    public int PageCount { get; set; }
    public string Sha256 { get; set; } = "";
    public Guid BlobId { get; set; }
    public FileBlob? Blob { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Recipient
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EnvelopeId { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public RecipientRole Role { get; set; } = RecipientRole.Signer;
    public int RoutingOrder { get; set; } = 1;
    public RecipientStatus Status { get; set; } = RecipientStatus.Pending;
    public string Color { get; set; } = "#F5C04A";
    public string? AccessCodeHash { get; set; }
    public string? PrivateMessage { get; set; }
    /// <summary>Opaque token for the emailed signing link.</summary>
    public string AccessToken { get; set; } = Tokens.New();
    public DateTime? CompletedAt { get; set; }
    public string? DeclineReason { get; set; }

    public bool IsSigner => Role is RecipientRole.Signer or RecipientRole.InPersonSigner;
    public bool Acts => Role != RecipientRole.CarbonCopy;
}

public class Field
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EnvelopeId { get; set; }
    public Guid RecipientId { get; set; }
    public FieldType Type { get; set; }
    public int Page { get; set; }
    /// <summary>Position and size as fractions (0..1) of the page width / height.</summary>
    public double X { get; set; }
    public double Y { get; set; }
    public double Width { get; set; }
    public double Height { get; set; }
    public bool Required { get; set; }
    public string? Label { get; set; }
    public string? Tooltip { get; set; }
    /// <summary>Text value, "true"/"false" for checkboxes, or a PNG data URL for signature/initial/stamp.</summary>
    public string? Value { get; set; }
    /// <summary>Optional PNG data URL rendered by the client for text values (keeps Thai text exact in the PDF).</summary>
    public string? RenderedImage { get; set; }
}

public class ApprovalWorkflow
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EnvelopeId { get; set; }
    public WorkflowType Type { get; set; }
    public bool AllowDelegation { get; set; }
    public decimal? Amount { get; set; }
    public WorkflowStatus Status { get; set; } = WorkflowStatus.Pending;
    public List<WorkflowStep> Steps { get; set; } = [];
}

public class WorkflowStep
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkflowId { get; set; }
    public int Sequence { get; set; }
    public string Name { get; set; } = "";
    public StepRule Rule { get; set; } = StepRule.All;
    public QuorumMode QuorumMode { get; set; } = QuorumMode.Count;
    public int QuorumValue { get; set; } = 1;
    public ConditionOp ConditionOp { get; set; } = ConditionOp.Always;
    public decimal? ConditionValue { get; set; }
    public int? EscalationDays { get; set; }
    public EscalationMode? EscalationMode { get; set; }
    public string? EscalationName { get; set; }
    public string? EscalationEmail { get; set; }
    public StepStatus Status { get; set; } = StepStatus.Waiting;
    public DateTime? StartedAt { get; set; }
    public DateTime? EscalatedAt { get; set; }
    public DateTime? DecidedAt { get; set; }
    public List<WorkflowApprover> Approvers { get; set; } = [];
}

public class WorkflowApprover
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StepId { get; set; }
    public int Sequence { get; set; }
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public bool Veto { get; set; }
    public ApproverStatus Status { get; set; } = ApproverStatus.Pending;
    public bool IsBackup { get; set; }
    /// <summary>For escalation backups: comma-separated approver ids this person may decide for.</summary>
    public string? OnBehalfOf { get; set; }
    public string? DelegatedFrom { get; set; }
    public string? DelegatedToEmail { get; set; }
    public string? Comment { get; set; }
    public DateTime? ActedAt { get; set; }
    public string? ActedBy { get; set; }
    public string AccessToken { get; set; } = Tokens.New();

    public IEnumerable<Guid> OnBehalfOfIds => (OnBehalfOf ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(Guid.Parse);
}

public class Attachment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EnvelopeId { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "application/octet-stream";
    public long Size { get; set; }
    public string Sha256 { get; set; } = "";
    public string AddedByName { get; set; } = "";
    public string AddedByEmail { get; set; } = "";
    public AttachmentRole Role { get; set; }
    public string? Context { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Guid BlobId { get; set; }
    public FileBlob? Blob { get; set; }
}

public class AuditEvent
{
    public long Id { get; set; }
    public Guid EnvelopeId { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string Action { get; set; } = "";
    public string Actor { get; set; } = "";
    public string? Detail { get; set; }
    public string? IpAddress { get; set; }
    public string? UserAgent { get; set; }
}

public class Template
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? Subject { get; set; }
    public string? Message { get; set; }
    /// <summary>JSON: recipient roles, fields and workflow definition.</summary>
    public string DefinitionJson { get; set; } = "{}";
    public string DocumentName { get; set; } = "";
    public int PageCount { get; set; }
    public Guid DocumentBlobId { get; set; }
    public Guid CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Emails are queued here; a background sender delivers them when SMTP is configured.</summary>
public class OutboxEmail
{
    public long Id { get; set; }
    public Guid? EnvelopeId { get; set; }
    public string To { get; set; } = "";
    public string Subject { get; set; } = "";
    public string BodyHtml { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SentAt { get; set; }
    public int Attempts { get; set; }
    public string? Error { get; set; }
}

public class AppSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

public static class Tokens
{
    public static string New() => Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
}
