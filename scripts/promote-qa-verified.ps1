$ErrorActionPreference = 'Stop'
$app = 'downtimeos-mvp-qa-app'
$backup = 'downtimeos-mvp-qa-app-rollback'
$old = (docker inspect $app | ConvertFrom-Json)[0]
if ($old.Mounts.Count -gt 0) { throw 'QA app has mounts; refusing replacement.' }
if (docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $backup }) {
  throw 'QA rollback container already exists.'
}

$runtime = @{}
foreach ($item in $old.Config.Env) {
  $parts = $item -split '=', 2
  if ($parts.Count -eq 2) { $runtime[$parts[0]] = $parts[1] }
}
$allowed = @($runtime.Keys | Where-Object {
  $_ -match '^(APP_|NEXT_PUBLIC_|SUPABASE_|REGLA_|DASHBOARD_|WHATSAPP_|META_|TWILIO_|RESEND_|GEMINI_|ANTHROPIC_|AI_|CRON_)' -or
  $_ -in @('NODE_ENV', 'PORT', 'HOSTNAME')
})
$previous = @{}
foreach ($name in $allowed) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  [Environment]::SetEnvironmentVariable($name, $runtime[$name], 'Process')
}
$previousSmoke = [Environment]::GetEnvironmentVariable('SMOKE_BASE_URL', 'Process')
$oldStopped = $false
$oldRenamed = $false
$newStarted = $false

try {
  docker stop $app | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not stop current QA app.' }
  $oldStopped = $true
  docker rename $app $backup
  if ($LASTEXITCODE -ne 0) { throw 'Could not reserve QA rollback container.' }
  $oldRenamed = $true

  $args = @('run', '--detach', '--name', $app, '--publish', '127.0.0.1:3001:3000')
  foreach ($name in $allowed) { $args += @('--env', $name) }
  $args += 'downtimeos-mvp-qa:verified'
  docker @args | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not start verified QA image.' }
  $newStarted = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    $health = docker inspect $app --format '{{.State.Health.Status}}'
    if ($health -eq 'healthy') { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw 'New QA app did not pass health check.' }

  [Environment]::SetEnvironmentVariable('SMOKE_BASE_URL', 'http://127.0.0.1:3001', 'Process')
  node scripts/smoke-next.mjs
  if ($LASTEXITCODE -ne 0) { throw 'QA HTTP smoke tests failed.' }

  docker rm $backup | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not remove verified QA rollback container.' }
  $oldRenamed = $false
  Write-Output 'QA_PROMOTION=PASS'
  docker inspect $app --format '{{.Config.Image}} {{.State.Health.Status}} {{.State.Status}}'
} catch {
  if ($newStarted) { docker rm -f $app | Out-Null }
  if ($oldRenamed -and (docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $backup })) {
    docker rename $backup $app | Out-Null
    docker start $app | Out-Null
  } elseif ($oldStopped -and (docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $app })) {
    docker start $app | Out-Null
  }
  throw
} finally {
  foreach ($name in $allowed) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
  }
  [Environment]::SetEnvironmentVariable('SMOKE_BASE_URL', $previousSmoke, 'Process')
}
