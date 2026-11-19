// Mirrors backend/src/MgtSign.Api/Contracts/Dtos.cs — keep both in sync.
// JSON is camelCase; enums are camelCase strings.

export type Guid = string;
export type UserRole = 'user' | 'admin';
/** 'datawarehouse' = company account from MGT_Datawarehouse; its password is managed there. */
export type UserSource = 'local' | 'datawarehouse';
export type EnvelopeType = 'self' | 'request';
export type EnvelopeStatus = 'draft' | 'pendingApproval' | 'sent' | 'completed' | 'declined' | 'voided';
export type RecipientRole = 'signer' | 'inPersonSigner' | 'viewer' | 'carbonCopy';
export type RecipientStatus = 'pending' | 'signed' | 'viewed' | 'declined' | 'delivered';
export type FieldType = 'signature' | 'initial' | 'stamp' | 'dateSigned' | 'name' | 'email' | 'company' | 'title' | 'text' | 'checkbox';
export type DocumentKind = 'original' | 'signed';
export type WorkflowType = 'single' | 'sequential' | 'parallel' | 'hybrid' | 'quorum' | 'conditional' | 'anyOne' | 'delegated' | 'escalation' | 'veto';
export type WorkflowStatus = 'pending' | 'active' | 'approved' | 'rejected';
export type StepRule = 'all' | 'any' | 'quorum';
export type QuorumMode = 'count' | 'percent';
export type ConditionOp = 'always' | 'lte' | 'lt' | 'gt' | 'gte';
export type EscalationMode = 'notify' | 'addBackup';
export type StepStatus = 'waiting' | 'active' | 'approved' | 'rejected' | 'skipped';
export type ApproverStatus = 'pending' | 'approved' | 'rejected' | 'delegated' | 'notRequired';
export type Decision = 'approve' | 'reject';
export type AttachmentRole = 'sender' | 'approver' | 'signer' | 'viewer';
export type Folder = 'all' | 'drafts' | 'progress' | 'approval' | 'completed' | 'voided' | 'deleted';

// auth & profile
export interface LoginRequest { email: string; password: string }
export interface UserDto { id: Guid; email: string; name: string; title?: string | null; company?: string | null; role: UserRole; hasSignature: boolean; source: UserSource; username?: string | null; department?: string | null }
export interface LoginResponse { token: string; expiresAt: string; user: UserDto }
export interface ProfileUpdate { name: string; title?: string | null; company?: string | null }
export interface PasswordChange { currentPassword: string; newPassword: string }
export interface SignatureDto { signatureImage?: string | null; initialImage?: string | null }

// create / edit
export interface RecipientInput { name: string; email: string; role: RecipientRole; routingOrder: number; accessCode?: string | null; privateMessage?: string | null }
export interface ApproverInput { name: string; email: string; veto: boolean }
export interface StepInput {
  name: string; rule: StepRule; quorumMode: QuorumMode; quorumValue: number; conditionOp: ConditionOp; conditionValue?: number | null;
  escalationDays?: number | null; escalationMode?: EscalationMode | null; escalationName?: string | null; escalationEmail?: string | null;
  approvers: ApproverInput[];
}
export interface WorkflowInput { type: WorkflowType; allowDelegation: boolean; amount?: number | null; steps: StepInput[] }
/** Sent as multipart field "payload" with files in "documents" (PDF) and optional "attachments". */
export interface CreateEnvelopeRequest {
  type: EnvelopeType; subject: string; message?: string | null; signingOrder: boolean; expiryDays: number; reminderDays: number;
  recipients: RecipientInput[]; workflow?: WorkflowInput | null; templateId?: Guid | null;
}
export interface FieldInput {
  id?: Guid | null; recipientId: Guid; type: FieldType; page: number; x: number; y: number; width: number; height: number;
  required: boolean; label?: string | null; tooltip?: string | null; value?: string | null;
}
export interface FieldsUpdate { fields: FieldInput[] }
export interface VoidRequest { reason: string }

// views
export interface EnvelopeListItem {
  id: Guid; code: string; subject: string; status: EnvelopeStatus; statusLabel: string; myTurn: boolean; myAction?: 'sign' | 'approve' | 'view' | 'host' | null;
  done: number; total: number; recipientNames: string[]; attachmentCount: number; updatedAt: string; isDeleted: boolean;
  workflowType?: WorkflowType | null; currentStep?: number | null; stepCount?: number | null;
}
export interface EnvelopeListResponse { items: EnvelopeListItem[]; total: number; page: number; pageSize: number; folderCounts: Record<Folder, number> }
export interface RecipientDto {
  id: Guid; name: string; email: string; role: RecipientRole; routingOrder: number; status: RecipientStatus; color: string;
  hasAccessCode: boolean; privateMessage?: string | null; completedAt?: string | null;
}
export interface FieldDto {
  id: Guid; recipientId: Guid; type: FieldType; page: number; x: number; y: number; width: number; height: number;
  required: boolean; label?: string | null; tooltip?: string | null; value?: string | null;
}
export interface ApproverDto {
  id: Guid; name: string; email: string; veto: boolean; status: ApproverStatus; isBackup: boolean; delegatedFrom?: string | null;
  delegatedToEmail?: string | null; comment?: string | null; actedAt?: string | null; actedBy?: string | null;
}
export interface StepDto {
  id: Guid; sequence: number; name: string; rule: StepRule; quorumMode: QuorumMode; quorumValue: number; conditionOp: ConditionOp;
  conditionValue?: number | null; escalationDays?: number | null; escalationMode?: EscalationMode | null; escalationName?: string | null;
  escalationEmail?: string | null; status: StepStatus; startedAt?: string | null; escalatedAt?: string | null; ruleText: string;
  approved: number; need: number; approvers: ApproverDto[];
}
export interface WorkflowDto { type: WorkflowType; allowDelegation: boolean; amount?: number | null; status: WorkflowStatus; steps: StepDto[] }
export interface AttachmentDto { id: Guid; fileName: string; contentType: string; size: number; sha256: string; addedByName: string; role: AttachmentRole; context?: string | null; createdAt: string }
export interface DocumentDto { id: Guid; kind: DocumentKind; fileName: string; size: number; pageCount: number; sha256: string }
export interface AuditDto { id: number; at: string; action: string; actor: string; detail?: string | null; ipAddress?: string | null }
export interface EnvelopeActions {
  canEditFields: boolean; canSend: boolean; canVoid: boolean; canDelete: boolean; canAddAttachments: boolean; canRemind: boolean;
  canSaveTemplate: boolean; signToken?: string | null; approveToken?: string | null;
}
export interface EnvelopeDetail {
  id: Guid; code: string; type: EnvelopeType; status: EnvelopeStatus; statusLabel: string; subject: string; message?: string | null;
  senderName: string; senderEmail: string; createdAt: string; sentAt?: string | null; completedAt?: string | null; expiresAt: string;
  reminderDays: number; signingOrder: boolean; voidReason?: string | null; isDeleted: boolean; documents: DocumentDto[];
  recipients: RecipientDto[]; fields: FieldDto[]; workflow?: WorkflowDto | null; attachments: AttachmentDto[]; actions: EnvelopeActions;
}

// signing (link token)
export type SignState = 'ready' | 'accessCode' | 'done' | 'declined' | 'closed' | 'waiting' | 'expired';
export interface SignSession {
  token: string; envelopeId: Guid; code: string; subject: string; message?: string | null; senderName: string; senderEmail: string;
  recipient: RecipientDto; state: SignState; pageCount: number; fields: FieldDto[]; attachments: AttachmentDto[];
  savedSignature?: SignatureDto | null; canAddAttachments: boolean;
}
export interface FieldValueInput { id: Guid; value?: string | null; renderedImage?: string | null }
export interface CompleteSigningRequest { fields: FieldValueInput[]; adoptedSignature?: SignatureDto | null }
export interface DeclineRequest { reason: string }

// approval (link token)
export type ApprovalState = 'ready' | 'done' | 'waiting' | 'closed';
export interface ApprovalSession {
  token: string; envelopeId: Guid; code: string; subject: string; message?: string | null; senderName: string; senderEmail: string;
  approver: ApproverDto; state: ApprovalState; activeStepId?: Guid | null; workflow: WorkflowDto; attachments: AttachmentDto[];
  pageCount: number; fields: FieldDto[]; canAddAttachments: boolean;
}
export interface DecisionRequest { decision: Decision; comment?: string | null }
export interface DelegateRequest { name: string; email: string; reason: string }

// dashboard / reports
export interface DashboardDto {
  waitingForMe: number; waitingForOthers: number; awaitingApproval: number; expiringSoon: number; completed: number;
  tasks: EnvelopeListItem[]; recent: EnvelopeListItem[];
}
export interface ReportDto {
  total: number; byStatus: Record<string, number>; byWorkflowType: Record<string, number>; avgHoursToComplete?: number | null; recentEvents: AuditDto[];
}

// library / admin
export interface TemplateDto { id: Guid; name: string; subject?: string | null; documentName: string; pageCount: number; recipientCount: number; fieldCount: number; workflowType?: WorkflowType | null; createdAt: string }
export interface TemplateField { recipientIndex: number; type: FieldType; page: number; x: number; y: number; width: number; height: number; required: boolean; label?: string | null; tooltip?: string | null }
export interface TemplateDefinition { subject?: string | null; message?: string | null; recipients: RecipientInput[]; fields: TemplateField[]; workflow?: WorkflowInput | null }
export interface TemplateDetail { template: TemplateDto; definition: TemplateDefinition }
export interface SaveTemplateRequest { envelopeId: Guid; name: string }
export interface ContactDto { id: Guid; name: string; email: string; department?: string | null }
export interface ContactInput { name: string; email: string; department?: string | null }
export interface AdminUserDto { id: Guid; email: string; name: string; title?: string | null; company?: string | null; role: UserRole; isActive: boolean; createdAt: string; source: UserSource; username?: string | null; department?: string | null; lastLoginAt?: string | null }
export interface AdminUserInput { email: string; name: string; title?: string | null; company?: string | null; role: UserRole; isActive: boolean; password?: string | null }
export interface SettingsDto { expiryDays: number; reminderDays: number; requireApproval: boolean; defaultWorkflowType: WorkflowType; defaultApproverName?: string | null; defaultApproverEmail?: string | null }
export interface OutboxDto { id: number; to: string; subject: string; bodyHtml: string; createdAt: string; sentAt?: string | null; error?: string | null; envelopeId?: Guid | null }
export interface WorkflowTypeDto { type: WorkflowType; nameEn: string; nameTh: string; description: string }
export interface ProblemMessage { message: string }
