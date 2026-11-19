using MgtSign.Domain;

namespace MgtSign.Api.Contracts;

// Mirrored in frontend/src/api/types.ts — keep both in sync.
// JSON is camelCase; enums are camelCase strings (e.g. "pendingApproval", "inPersonSigner", "anyOne").

// ---------- auth & profile ----------
public record LoginRequest(string Email, string Password);
/// <summary>Source "datawarehouse" = company account from MGT_Datawarehouse (password managed there).</summary>
public record UserDto(Guid Id, string Email, string Name, string? Title, string? Company, UserRole Role, bool HasSignature,
    UserSource Source, string? Username, string? Department);
public record LoginResponse(string Token, DateTime ExpiresAt, UserDto User);
public record ProfileUpdate(string Name, string? Title, string? Company);
public record PasswordChange(string CurrentPassword, string NewPassword);
public record SignatureDto(string? SignatureImage, string? InitialImage);

// ---------- create / edit ----------
public record RecipientInput(string Name, string Email, RecipientRole Role, int RoutingOrder, string? AccessCode, string? PrivateMessage);
public record ApproverInput(string Name, string Email, bool Veto);
public record StepInput(string Name, StepRule Rule, QuorumMode QuorumMode, int QuorumValue, ConditionOp ConditionOp, decimal? ConditionValue,
    int? EscalationDays, EscalationMode? EscalationMode, string? EscalationName, string? EscalationEmail, List<ApproverInput> Approvers);
public record WorkflowInput(WorkflowType Type, bool AllowDelegation, decimal? Amount, List<StepInput> Steps);
/// <summary>Sent as the multipart form field "payload" (JSON) together with "documents" (PDF files) and optional "attachments".</summary>
public record CreateEnvelopeRequest(EnvelopeType Type, string Subject, string? Message, bool SigningOrder, int ExpiryDays, int ReminderDays,
    List<RecipientInput> Recipients, WorkflowInput? Workflow, Guid? TemplateId);
public record FieldInput(Guid? Id, Guid RecipientId, FieldType Type, int Page, double X, double Y, double Width, double Height,
    bool Required, string? Label, string? Tooltip, string? Value);
public record FieldsUpdate(List<FieldInput> Fields);
public record VoidRequest(string Reason);

// ---------- views ----------
public record EnvelopeListItem(Guid Id, string Code, string Subject, EnvelopeStatus Status, string StatusLabel, bool MyTurn, string? MyAction,
    int Done, int Total, List<string> RecipientNames, int AttachmentCount, DateTime UpdatedAt, bool IsDeleted,
    WorkflowType? WorkflowType, int? CurrentStep, int? StepCount);
public record EnvelopeListResponse(List<EnvelopeListItem> Items, int Total, int Page, int PageSize, Dictionary<string, int> FolderCounts);

public record RecipientDto(Guid Id, string Name, string Email, RecipientRole Role, int RoutingOrder, RecipientStatus Status, string Color,
    bool HasAccessCode, string? PrivateMessage, DateTime? CompletedAt);
public record FieldDto(Guid Id, Guid RecipientId, FieldType Type, int Page, double X, double Y, double Width, double Height,
    bool Required, string? Label, string? Tooltip, string? Value);
public record ApproverDto(Guid Id, string Name, string Email, bool Veto, ApproverStatus Status, bool IsBackup, string? DelegatedFrom,
    string? DelegatedToEmail, string? Comment, DateTime? ActedAt, string? ActedBy);
public record StepDto(Guid Id, int Sequence, string Name, StepRule Rule, QuorumMode QuorumMode, int QuorumValue, ConditionOp ConditionOp,
    decimal? ConditionValue, int? EscalationDays, EscalationMode? EscalationMode, string? EscalationName, string? EscalationEmail,
    StepStatus Status, DateTime? StartedAt, DateTime? EscalatedAt, string RuleText, int Approved, int Need, List<ApproverDto> Approvers);
public record WorkflowDto(WorkflowType Type, bool AllowDelegation, decimal? Amount, WorkflowStatus Status, List<StepDto> Steps);
public record AttachmentDto(Guid Id, string FileName, string ContentType, long Size, string Sha256, string AddedByName, AttachmentRole Role,
    string? Context, DateTime CreatedAt);
public record DocumentDto(Guid Id, DocumentKind Kind, string FileName, long Size, int PageCount, string Sha256);
public record AuditDto(long Id, DateTime At, string Action, string Actor, string? Detail, string? IpAddress);
/// <summary>LiveSignRecipientIds: signers the host (sender) may sign with face to face on this device right now.</summary>
public record EnvelopeActions(bool CanEditFields, bool CanSend, bool CanVoid, bool CanDelete, bool CanAddAttachments, bool CanRemind,
    bool CanSaveTemplate, string? SignToken, string? ApproveToken, List<Guid> LiveSignRecipientIds);
public record EnvelopeDetail(Guid Id, string Code, EnvelopeType Type, EnvelopeStatus Status, string StatusLabel, string Subject, string? Message,
    string SenderName, string SenderEmail, DateTime CreatedAt, DateTime? SentAt, DateTime? CompletedAt, DateTime ExpiresAt, int ReminderDays,
    bool SigningOrder, string? VoidReason, bool IsDeleted, List<DocumentDto> Documents, List<RecipientDto> Recipients, List<FieldDto> Fields,
    WorkflowDto? Workflow, List<AttachmentDto> Attachments, EnvelopeActions Actions);

// ---------- signing via link token (also used by signed-in users through actions.signToken) ----------
/// <summary>State: ready | accessCode | done | declined | closed | waiting | expired.
/// LiveHost is set during a face-to-face session: signatures must then be drawn by hand on this device.</summary>
public record SignSession(string Token, Guid EnvelopeId, string Code, string Subject, string? Message, string SenderName, string SenderEmail,
    RecipientDto Recipient, string State, int PageCount, List<FieldDto> Fields, List<AttachmentDto> Attachments, SignatureDto? SavedSignature,
    bool CanAddAttachments, string? LiveHost);
public record FieldValueInput(Guid Id, string? Value, string? RenderedImage);
/// <summary>Summary of the handwriting captured on the drawing pad (required for live signing).</summary>
public record LiveSignatureEvidence(int Strokes, int Points, int DurationMs, string PointerType);
public record CompleteSigningRequest(List<FieldValueInput> Fields, SignatureDto? AdoptedSignature, LiveSignatureEvidence? Live = null);
/// <summary>The host confirms how they checked the signer's identity (e.g. "Thai ID card ending 1234").</summary>
public record StartLiveRequest(string IdentityCheck);
public record LiveSessionResponse(string Token, Guid RecipientId, string RecipientName, DateTime ExpiresAt);
public record DeclineRequest(string Reason);

// ---------- approval via link token ----------
/// <summary>State: ready | done | waiting | closed</summary>
public record ApprovalSession(string Token, Guid EnvelopeId, string Code, string Subject, string? Message, string SenderName, string SenderEmail,
    ApproverDto Approver, string State, Guid? ActiveStepId, WorkflowDto Workflow, List<AttachmentDto> Attachments, int PageCount, List<FieldDto> Fields,
    bool CanAddAttachments);
public record DecisionRequest(Decision Decision, string? Comment);
public record DelegateRequest(string Name, string Email, string Reason);

// ---------- dashboard / reports ----------
public record DashboardDto(int WaitingForMe, int WaitingForOthers, int AwaitingApproval, int ExpiringSoon, int Completed,
    List<EnvelopeListItem> Tasks, List<EnvelopeListItem> Recent);
public record ReportDto(int Total, Dictionary<string, int> ByStatus, Dictionary<string, int> ByWorkflowType, double? AvgHoursToComplete,
    List<AuditDto> RecentEvents);

// ---------- library / admin ----------
public record TemplateDto(Guid Id, string Name, string? Subject, string DocumentName, int PageCount, int RecipientCount, int FieldCount,
    WorkflowType? WorkflowType, DateTime CreatedAt);
public record TemplateDefinition(string? Subject, string? Message, List<RecipientInput> Recipients, List<TemplateField> Fields, WorkflowInput? Workflow);
/// <summary>RecipientIndex points into TemplateDefinition.Recipients.</summary>
public record TemplateField(int RecipientIndex, FieldType Type, int Page, double X, double Y, double Width, double Height, bool Required, string? Label, string? Tooltip);
public record TemplateDetail(TemplateDto Template, TemplateDefinition Definition);
public record SaveTemplateRequest(Guid EnvelopeId, string Name);
public record ContactDto(Guid Id, string Name, string Email, string? Department);
/// <summary>A person to send to. Source: user (MGT Sign account) | contact (saved) | company (MGT_Datawarehouse employee).</summary>
public record PersonDto(string Name, string Email, string? Username, string? Department, string? Position, string Source);
public record ContactInput(string Name, string Email, string? Department);
public record AdminUserDto(Guid Id, string Email, string Name, string? Title, string? Company, UserRole Role, bool IsActive, DateTime CreatedAt,
    UserSource Source, string? Username, string? Department, DateTime? LastLoginAt);
public record AdminUserInput(string Email, string Name, string? Title, string? Company, UserRole Role, bool IsActive, string? Password);
public record SettingsDto(int ExpiryDays, int ReminderDays, bool RequireApproval, WorkflowType DefaultWorkflowType, string? DefaultApproverName, string? DefaultApproverEmail);
public record OutboxDto(long Id, string To, string Subject, string BodyHtml, DateTime CreatedAt, DateTime? SentAt, string? Error, Guid? EnvelopeId);
public record WorkflowTypeDto(WorkflowType Type, string NameEn, string NameTh, string Description);

public record ProblemMessage(string Message);
