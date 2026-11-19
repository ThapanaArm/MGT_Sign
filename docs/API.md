# MGT Sign API

Base URL `http://localhost:5080` (dev). JSON is camelCase; enums are camelCase strings. Errors return `{ "message": "..." }` with 400/401/403/404/409/429/500.
Types are defined in `backend/src/MgtSign.Api/Contracts/Dtos.cs` and mirrored in `frontend/src/api/types.ts`. OpenAPI (dev): `/openapi/v1.json`.

Auth: `Authorization: Bearer <JWT>` from `POST /api/auth/login`, except `/api/sign/*`, `/api/approve/*` and `/api/health` (personal link token in the URL).

| Method | Path | Body → Response |
|---|---|---|
| POST | /api/auth/login | LoginRequest → LoginResponse (rate-limited 10/min/IP) |
| GET / PUT | /api/auth/me | → UserDto / ProfileUpdate → UserDto |
| POST | /api/auth/password | PasswordChange → 204 |
| GET / PUT | /api/auth/signature | → SignatureDto / SignatureDto → 204 |
| GET | /api/meta/workflow-types | → WorkflowTypeDto[] |
| GET / PUT | /api/settings | → SettingsDto / SettingsDto (admin) |
| GET | /api/dashboard | → DashboardDto |
| GET | /api/envelopes?folder=&q=&status=&sender=all\|me\|received&days=&page=&pageSize= | → EnvelopeListResponse |
| POST | /api/envelopes | multipart `payload` (CreateEnvelopeRequest JSON), `documents` (PDF), `attachments` → EnvelopeDetail |
| GET | /api/envelopes/{id} | → EnvelopeDetail (includes `actions.signToken` / `approveToken` when it is your turn) |
| PUT | /api/envelopes/{id}/fields | FieldsUpdate → EnvelopeDetail (draft only) |
| POST | /api/envelopes/{id}/send | → EnvelopeDetail (starts approval workflow, else signing) |
| POST | /api/envelopes/{id}/void | VoidRequest → EnvelopeDetail |
| POST | /api/envelopes/{id}/remind | → 204 |
| DELETE / POST | /api/envelopes/{id} · /restore · DELETE /permanent | soft delete, restore, purge |
| GET | /api/envelopes/{id}/document?kind=original\|signed\|current | → PDF |
| GET | /api/envelopes/{id}/audit | → AuditDto[] |
| POST / GET | /api/envelopes/{id}/attachments · /attachments/{attId} | multipart `files` → AttachmentDto[] / file |
| GET | /api/envelopes/export.csv | → CSV |
| GET | /api/sign/{token} | → SignSession (header `X-Access-Code` when required) |
| GET | /api/sign/{token}/document · /signed | → original PDF / signed PDF when completed |
| POST | /api/sign/{token}/complete | CompleteSigningRequest → SignSession |
| POST | /api/sign/{token}/decline | DeclineRequest → SignSession |
| POST / GET | /api/sign/{token}/attachments · /attachments/{attId} | multipart `files` / file |
| GET | /api/approve/{token} | → ApprovalSession |
| GET | /api/approve/{token}/document | → PDF with current values |
| POST | /api/approve/{token}/decision | DecisionRequest → ApprovalSession |
| POST | /api/approve/{token}/delegate | DelegateRequest → ApprovalSession |
| POST / GET | /api/approve/{token}/attachments · /attachments/{attId} | multipart `files` / file |
| GET / POST | /api/templates | → TemplateDto[] / SaveTemplateRequest → TemplateDto |
| GET / DELETE | /api/templates/{id} · GET /document | TemplateDetail / 204 / PDF |
| GET / POST / PUT / DELETE | /api/contacts[/{id}] | directory (contacts + active users) |
| GET | /api/reports | → ReportDto |
| GET / POST / PUT | /api/admin/users[/{id}] | admin only |
| GET | /api/admin/outbox?take= | → OutboxDto[] (admin) |
| POST | /api/admin/escalations/run · /api/admin/envelopes/{id}/simulate-overdue | admin testing aids |
| GET | /api/health | → { status } |
