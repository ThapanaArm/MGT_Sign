# End-to-end smoke test against a running API (http://localhost:5080).
# Usage: pwsh backend/tests/e2e-api.ps1 -Password <admin password>
param([string]$Base = 'http://localhost:5080', [string]$Email = 'admin@mgt-sign.local', [Parameter(Mandatory)][string]$Password)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$fails = 0
function Check($name, $cond) { if ($cond) { Write-Host "PASS $name" } else { Write-Host "FAIL $name" -ForegroundColor Red; $script:fails++ } }

# Minimal 2-page PDF built by hand (valid xref) so the test has no external files.
function New-Pdf {
  $objs = @(
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>',
    $null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  $stream = 'BT /F1 24 Tf 72 760 Td (MGT Sign test agreement) Tj ET'
  $objs[4] = "<< /Length $($stream.Length) >>`nstream`n$stream`nendstream"
  $sb = New-Object System.Text.StringBuilder; [void]$sb.Append("%PDF-1.4`n"); $offs = @()
  for ($i = 0; $i -lt $objs.Count; $i++) { $offs += $sb.Length; [void]$sb.Append("$($i+1) 0 obj`n$($objs[$i])`nendobj`n") }
  $x = $sb.Length; [void]$sb.Append("xref`n0 $($objs.Count+1)`n0000000000 65535 f `n")
  foreach ($o in $offs) { [void]$sb.Append(('{0:D10} 00000 n ' -f $o) + "`n") }
  [void]$sb.Append("trailer`n<< /Size $($objs.Count+1) /Root 1 0 R >>`nstartxref`n$x`n%%EOF")
  [System.Text.Encoding]::ASCII.GetBytes($sb.ToString())
}

$login = Invoke-RestMethod "$Base/api/auth/login" -Method Post -ContentType 'application/json' -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
$H = @{ Authorization = "Bearer $($login.token)" }
Check 'login' ($login.user.role -eq 'admin')

$payload = @{
  type = 'request'; subject = 'Please sign: E2E contract'; message = 'Automated test'; signingOrder = $true; expiryDays = 30; reminderDays = 1
  recipients = @(@{ name = 'Signer One'; email = 'signer1@example.com'; role = 'signer'; routingOrder = 1; accessCode = '1234'; privateMessage = 'Page 2 please' },
                 @{ name = 'Viewer'; email = 'viewer@example.com'; role = 'viewer'; routingOrder = 2 },
                 @{ name = 'CC'; email = 'cc@example.com'; role = 'carbonCopy'; routingOrder = 3 })
  workflow = @{ type = 'hybrid'; allowDelegation = $true; amount = 1500000; steps = @(
      @{ name = 'Manager'; rule = 'all'; quorumMode = 'count'; quorumValue = 1; conditionOp = 'always'; approvers = @(@{ name = 'Manager M'; email = 'mgr@example.com'; veto = $false }) },
      @{ name = 'Finance & Legal'; rule = 'all'; quorumMode = 'count'; quorumValue = 1; conditionOp = 'always'; approvers = @(@{ name = 'Finance F'; email = 'fin@example.com'; veto = $false }, @{ name = 'Legal L'; email = 'legal@example.com'; veto = $true }) },
      @{ name = 'CMO (> 1M)'; rule = 'any'; quorumMode = 'count'; quorumValue = 1; conditionOp = 'gt'; conditionValue = 1000000; escalationDays = 2; escalationMode = 'addBackup'; escalationName = 'CEO Backup'; escalationEmail = 'ceo@example.com'; approvers = @(@{ name = 'CMO C'; email = 'cmo@example.com'; veto = $false }) }) }
} | ConvertTo-Json -Depth 8

$client = New-Object System.Net.Http.HttpClient
$client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $login.token)
$form = New-Object System.Net.Http.MultipartFormDataContent
$form.Add((New-Object System.Net.Http.StringContent($payload)), 'payload')
$pdf = New-Object System.Net.Http.ByteArrayContent(, (New-Pdf)); $pdf.Headers.ContentType = 'application/pdf'; $form.Add($pdf, 'documents', 'contract.pdf')
$att = New-Object System.Net.Http.ByteArrayContent(, [System.Text.Encoding]::UTF8.GetBytes("item,qty`nA,1")); $form.Add($att, 'attachments', 'quotation.csv')
$bad = New-Object System.Net.Http.ByteArrayContent(, [byte[]](77, 90));
$resp = $client.PostAsync("$Base/api/envelopes", $form).Result
$body = $resp.Content.ReadAsStringAsync().Result
if (-not $resp.IsSuccessStatusCode) { Write-Host $body; throw "create failed $($resp.StatusCode)" }
$env = $body | ConvertFrom-Json
Check 'create draft' ($env.status -eq 'draft' -and $env.documents[0].pageCount -eq 2 -and $env.attachments.Count -eq 1 -and $env.workflow.steps.Count -eq 3)

# fields: signature for signer
$signer = $env.recipients | Where-Object { $_.role -eq 'signer' }
$fields = @{ fields = @(
  @{ recipientId = $signer.id; type = 'signature'; page = 1; x = 0.1; y = 0.7; width = 0.3; height = 0.06; required = $true },
  @{ recipientId = $signer.id; type = 'dateSigned'; page = 1; x = 0.1; y = 0.78; width = 0.2; height = 0.03; required = $false },
  @{ recipientId = $signer.id; type = 'text'; page = 1; x = 0.5; y = 0.78; width = 0.3; height = 0.03; required = $true; label = 'PO number' }) } | ConvertTo-Json -Depth 5
$env = Invoke-RestMethod "$Base/api/envelopes/$($env.id)/fields" -Method Put -Headers $H -ContentType 'application/json' -Body $fields
Check 'save fields' ($env.fields.Count -eq 3)

$env = Invoke-RestMethod "$Base/api/envelopes/$($env.id)/send" -Method Post -Headers $H -ContentType 'application/json' -Body '{}'
Check 'send starts approval' ($env.status -eq 'pendingApproval' -and $env.statusLabel -like 'Awaiting approval*step 1/3')

function Token($email) { (sqlcmd -S '.\SQLEXPRESS' -E -C -d MGT_Sign -h -1 -W -Q "SET NOCOUNT ON; SELECT TOP 1 a.AccessToken FROM WorkflowApprovers a JOIN WorkflowSteps s ON s.Id=a.StepId JOIN Workflows w ON w.Id=s.WorkflowId WHERE w.EnvelopeId='$($env.id)' AND a.Email='$email' ORDER BY a.Sequence DESC").Trim() }
function Decide($email, $decision, $comment) { Invoke-RestMethod "$Base/api/approve/$(Token $email)/decision" -Method Post -ContentType 'application/json' -Body (@{ decision = $decision; comment = $comment } | ConvertTo-Json) }

$s = Decide 'mgr@example.com' 'approve' 'ok'
Check 'manager approved -> step 2' ($s.workflow.steps[1].status -eq 'active')
# Legal delegates (keeps veto), delegate approves, finance approves
$legal = Invoke-RestMethod "$Base/api/approve/$(Token 'legal@example.com')"
Check 'legal session ready' ($legal.state -eq 'ready')
$d = Invoke-RestMethod "$Base/api/approve/$(Token 'legal@example.com')/delegate" -Method Post -ContentType 'application/json' -Body (@{ name = 'Deputy Legal'; email = 'deputy@example.com'; reason = 'On leave' } | ConvertTo-Json)
Check 'delegated' (($d.workflow.steps[1].approvers | Where-Object { $_.email -eq 'deputy@example.com' }).veto -eq $true)
$s = Decide 'fin@example.com' 'approve' $null
$s = Decide 'deputy@example.com' 'approve' 'fine'
Check 'step 3 active (amount > 1M)' ($s.workflow.steps[2].status -eq 'active')
# escalation adds backup; backup approves
$r = Invoke-RestMethod "$Base/api/admin/envelopes/$($env.id)/simulate-overdue" -Method Post -Headers $H -ContentType 'application/json' -Body '{}'
Check 'escalated' ($r.escalated -eq 1)
$s = Decide 'ceo@example.com' 'approve' 'approved as backup'
$env = Invoke-RestMethod "$Base/api/envelopes/$($env.id)" -Headers $H
Check 'workflow approved -> signing' ($env.workflow.status -eq 'approved' -and $env.status -eq 'sent')

# signer: access code required
$tok = $signer | ForEach-Object { (sqlcmd -S '.\SQLEXPRESS' -E -C -d MGT_Sign -h -1 -W -Q "SET NOCOUNT ON; SELECT AccessToken FROM Recipients WHERE Id='$($_.id)'").Trim() }
$ss = Invoke-RestMethod "$Base/api/sign/$tok"
Check 'access code gate' ($ss.state -eq 'accessCode' -and $ss.fields.Count -eq 0)
$HC = @{ 'X-Access-Code' = '1234' }
$ss = Invoke-RestMethod "$Base/api/sign/$tok" -Headers $HC
Check 'session ready' ($ss.state -eq 'ready' -and $ss.fields.Count -eq 3)
$png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
$sigF = $ss.fields | Where-Object { $_.type -eq 'signature' }; $txtF = $ss.fields | Where-Object { $_.type -eq 'text' }; $dF = $ss.fields | Where-Object { $_.type -eq 'dateSigned' }
# Windows PowerShell 5.1 does not send UTF-8 bodies and hides error bodies, so use HttpClient here.
function PostJson($url, $obj, $code) {
  $c = New-Object System.Net.Http.HttpClient; if ($code) { $c.DefaultRequestHeaders.Add('X-Access-Code', $code) }
  $r = $c.PostAsync($url, (New-Object System.Net.Http.StringContent(($obj | ConvertTo-Json -Depth 6), [Text.Encoding]::UTF8, 'application/json'))).Result
  $text = $r.Content.ReadAsStringAsync().Result
  [pscustomobject]@{ Ok = $r.IsSuccessStatusCode; Body = ($text | ConvertFrom-Json) }
}
$r = PostJson "$Base/api/sign/$tok/complete" @{ fields = @(@{ id = $sigF.id; value = $png }) } '1234'
Check 'required text enforced' (-not $r.Ok -and $r.Body.message -like '*PO number*')
# Thai text built from code points ("ใบสั่งซื้อ") so the test does not depend on the script file encoding.
$thai = -join [char[]](0x0E43, 0x0E1A, 0x0E2A, 0x0E31, 0x0E48, 0x0E07, 0x0E0B, 0x0E37, 0x0E49, 0x0E2D)
$r = PostJson "$Base/api/sign/$tok/complete" @{ fields = @(@{ id = $sigF.id; value = $png }, @{ id = $txtF.id; value = "PO-7781 $thai" }, @{ id = $dF.id; value = '' }) } '1234'
$ss = $r.Body
Check 'signed' ($ss.state -eq 'done')
$env = Invoke-RestMethod "$Base/api/envelopes/$($env.id)" -Headers $H
Check 'viewer is next' ($env.status -eq 'sent')
$vt = (sqlcmd -S '.\SQLEXPRESS' -E -C -d MGT_Sign -h -1 -W -Q "SET NOCOUNT ON; SELECT AccessToken FROM Recipients WHERE Email='viewer@example.com' AND EnvelopeId='$($env.id)'").Trim()
$vs = (PostJson "$Base/api/sign/$vt/complete" @{ fields = @() } $null).Body
Check 'viewer acknowledged' ($vs.state -eq 'done')
$env = Invoke-RestMethod "$Base/api/envelopes/$($env.id)" -Headers $H
Check 'completed with signed document' ($env.status -eq 'completed' -and ($env.documents | Where-Object { $_.kind -eq 'signed' }).pageCount -eq 3)
Invoke-WebRequest "$Base/api/envelopes/$($env.id)/document?kind=signed" -Headers $H -OutFile "$env:TEMP\mgt-e2e-signed.pdf" | Out-Null
Check 'signed pdf downloads' ((Get-Item "$env:TEMP\mgt-e2e-signed.pdf").Length -gt 5000)
$audit = Invoke-RestMethod "$Base/api/envelopes/$($env.id)/audit" -Headers $H
Check 'audit trail' (($audit.action -contains 'Approval delegated') -and ($audit.action -contains 'Backup authority added') -and ($audit.action -contains 'Access code verified') -and ($audit.action -contains 'Envelope completed'))
$out = Invoke-RestMethod "$Base/api/admin/outbox?take=50" -Headers $H
Check 'emails queued' (($out | Where-Object { $_.envelopeId -eq $env.id }).Count -ge 8)
$list = Invoke-RestMethod "$Base/api/envelopes?folder=completed" -Headers $H
Check 'list completed folder' ($list.items.id -contains $env.id -and $list.folderCounts.completed -ge 1)
$dash = Invoke-RestMethod "$Base/api/dashboard" -Headers $H
Check 'dashboard' ($dash.completed -ge 1)
Write-Host "Signed PDF: $env:TEMP\mgt-e2e-signed.pdf"
if ($fails) { Write-Host "$fails check(s) failed" -ForegroundColor Red; exit 1 } else { Write-Host 'All checks passed' -ForegroundColor Green }
