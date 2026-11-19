namespace MgtSign.Domain;

public enum UserRole { User, Admin }

public enum EnvelopeType { Self, Request }
public enum EnvelopeStatus { Draft, PendingApproval, Sent, Completed, Declined, Voided }

public enum RecipientRole { Signer, InPersonSigner, Viewer, CarbonCopy }
public enum RecipientStatus { Pending, Signed, Viewed, Declined, Delivered }

public enum FieldType { Signature, Initial, Stamp, DateSigned, Name, Email, Company, Title, Text, Checkbox }

public enum DocumentKind { Original, Signed }

// The 10 supported approval workflow types. Each is a preset of steps; the engine itself is generic.
public enum WorkflowType { Single, Sequential, Parallel, Hybrid, Quorum, Conditional, AnyOne, Delegated, Escalation, Veto }
public enum WorkflowStatus { Pending, Active, Approved, Rejected }
public enum StepRule { All, Any, Quorum }
public enum QuorumMode { Count, Percent }
public enum ConditionOp { Always, Lte, Lt, Gt, Gte }
public enum EscalationMode { Notify, AddBackup }
public enum StepStatus { Waiting, Active, Approved, Rejected, Skipped }
public enum ApproverStatus { Pending, Approved, Rejected, Delegated, NotRequired }
public enum Decision { Approve, Reject }

public enum AttachmentRole { Sender, Approver, Signer, Viewer }
