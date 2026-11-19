# MGT Sign

**MGT Electronic Signature Management System** — a secure e-signature platform for MGT Group: single and multiple signers, email signature requests, 10 approval workflow types, supporting attachments, document tracking and a full audit trail with a Certificate of Completion.

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite, pdf.js, MGT Design System (Portal) look |
| Backend | ASP.NET Core (.NET 10) Web API, EF Core 10, JWT auth |
| Database | Microsoft SQL Server — database `MGT_Sign` |
| PDF | PDFsharp **6.2.4 (MIT)** — stamping values + Certificate of Completion |

```
MGT_Sign/
├─ backend/
│  ├─ MgtSign.slnx
│  ├─ src/MgtSign.Domain          entities, enums, approval workflow engine, signing routing (no dependencies)
│  ├─ src/MgtSign.Infrastructure  EF Core DbContext + migrations, PDF service, password hashing, email outbox sender
│  ├─ src/MgtSign.Api             controllers, DTO contract, services, JWT, background workers
│  └─ tests/                      xUnit engine tests + e2e-api.ps1 (end-to-end smoke test)
├─ frontend/                      React app (src/api/types.ts mirrors the C# DTOs)
├─ prototype/                     the original single-file HTML prototype (UX reference)
└─ docs/API.md                    endpoint reference
```

## Prerequisites

- .NET SDK 10, Node.js 20+ (tested with 26), SQL Server 2019+ (Express is fine)
- Windows: the PDF service uses the Thai-capable *Leelawadee UI* / *Tahoma* fonts. On Linux set `Pdf:FontPath` to a Thai TTF (e.g. Noto Sans Thai).

## First run (development)

```powershell
# 1) Backend secrets — never put these in appsettings.json or Git
cd backend
dotnet user-secrets set "Jwt:Key" "<random 48+ character string>" --project src/MgtSign.Api
# Optional: use SQL authentication instead of Windows authentication (default)
dotnet user-secrets set "ConnectionStrings:Default" "Server=.\SQLEXPRESS;Database=MGT_Sign;User Id=sa;Password=<password>;TrustServerCertificate=True" --project src/MgtSign.Api

# 2) Run the API (creates/migrates the MGT_Sign database and the first admin on startup)
dotnet run --project src/MgtSign.Api --launch-profile http        # http://localhost:5080

# 3) Run the web app in another terminal
cd ../frontend
npm install
npm run dev                                                        # http://localhost:5173
```

The first administrator is created on the first start of an empty database from `Seed:AdminEmail` (in `appsettings.Development.json`) and `Seed:AdminPassword`, which you set as a secret:

```powershell
dotnet user-secrets set "Seed:AdminPassword" "<initial admin password>" --project src/MgtSign.Api
```

Change that password after the first sign-in (Admin → Profile) and create the other users in Admin → Users.

### Sign-in with company accounts (MGT_Datawarehouse)

Staff sign in with their company **username or email** and password from `MGT_Datawarehouse.dbo.Ms_User`. Who may sign in (configurable under `Datawarehouse` in `appsettings.json`):

```sql
((Username NOT IN ('Admin','GLC_Admin') AND Department IN ('IT','HR','Finance')) OR Position IN ('CFO','CEO'))
AND IsActive = 1
```

- Passwords are checked against `Ms_User.PasswordHash` (ASP.NET Identity `AQAAAA…` and `pbkdf2$…` formats). Plain-text `Password` is never used.
- On every sign-in the MGT Sign account is created or refreshed from Ms_User (name, email, position, department). **Department IT → Admin**, everyone else → User (`Datawarehouse:AdminDepartments`).
- Local accounts (e.g. the first admin) keep working as a break-glass login. Admins can switch a company user's MGT Sign access off in Admin → Users.
- Set the connection string as a secret, never in a file:

```powershell
dotnet user-secrets set "ConnectionStrings:Datawarehouse" "Server=<dw server>;Database=MGT_Datawarehouse;User Id=<login>;Password=<password>;TrustServerCertificate=True;Encrypt=True" --project src/MgtSign.Api
```

Use a read-only SQL login that can only `SELECT` from `dbo.Ms_User` rather than `sa`.

### Emails

Without SMTP settings every email is kept in the `OutboxEmails` table. Admins can open them in **Admin → Outbox** and click the personal signing/approval links. To send real email set `Smtp:Host`, `Smtp:Port`, `Smtp:UserName`, `Smtp:Password`, `Smtp:From` (user-secrets or environment variables) and `App:PublicUrl` to the address users open.

## How it works

1. **Create** — `POST /api/envelopes` (multipart: PDF documents, optional attachments, JSON payload with recipients and optional approval workflow). Multiple PDFs are merged; each document and attachment is fingerprinted with SHA-256.
2. **Prepare** — place fields per signer (`PUT /api/envelopes/{id}/fields`); positions are fractions of the page so they survive any zoom.
3. **Send** — if there is an approval workflow it runs first; signers receive the document only after it is approved.
4. **Approve / sign by personal link** — every recipient and approver gets a link with an unguessable token (`/sign/{token}`, `/approve/{token}`). Recipients can be protected with an access code. Signed-in users reach the same pages from their task list.
5. **Complete** — the server stamps all values into the PDF and appends a **Certificate of Completion** (envelope summary, workflow decisions, recipients, attachments, audit trail with IP addresses).

### Live signing (เซ็นสด, face to face)

When a signer is in the same room, the sender opens the envelope and clicks **Sign live now** next to that signer (shown for signers whose turn it is). The sender records how they checked the signer's identity (for example "Thai ID card ending 1234") and hands the device over. No email is needed.

- The signer must **draw** the signature and initials by hand (finger, stylus or mouse). Typed, uploaded and saved signatures are switched off, and the server refuses a live signature without handwriting evidence.
- The audit trail and the Certificate of Completion record the host, the identity check, and how the signature was drawn (input type, strokes, points, time).
- A live session is valid for 2 hours. Access codes still apply.

### Approval workflow types

All 10 types are presets of one engine (`backend/src/MgtSign.Domain/WorkflowEngine.cs`): ordered steps, each with a rule (*all / any one / quorum by count or %*), an optional document-value condition (THB), optional escalation and approvers with optional veto.

Single · Sequential · Parallel · Hybrid · Majority/Quorum · Conditional · Any-one · Delegated · Escalation · Unanimous/Veto.
Escalation runs every `Escalation:IntervalMinutes` and **never approves automatically** — it reminds, or adds a backup authority who may decide for the overdue approvers.

## Tests

```powershell
cd backend
dotnet test                                                   # workflow engine unit tests (all 10 types)
.\tests\e2e-api.ps1 -Password '<admin password>'              # full flow against a running API
```

## Deployment (IIS / Windows Server)

```powershell
cd frontend; npm run build
cd ../backend; dotnet publish src/MgtSign.Api -c Release -o ../publish
Copy-Item ../frontend/dist/* ../publish/wwwroot -Recurse        # the API serves the React app
```

Set in the server environment: `ConnectionStrings__Default`, `Jwt__Key` (48+ random characters), `App__PublicUrl`, `App__CorsOrigins__0`, `Smtp__*`. Use HTTPS. Use a dedicated SQL login with rights only on `MGT_Sign` rather than `sa`.

## Security notes

- Passwords and access codes: PBKDF2-SHA256 (210,000 iterations). Sign-in and link endpoints are rate-limited.
- Secrets live in user-secrets (development) or environment variables (servers) — never in this repository.
- **PDFsharp is pinned to 6.2.4 (MIT).** Versions 6.3+ are AGPL-3.0 and require a license key; do not upgrade without a licensing decision.
