param(
  [ValidateSet('start')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$mailVariables = @(
  'MAIL_HOST', 'MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD',
  'MAIL_FROM_ADDRESS', 'MAIL_FROM_NAME'
)
$previousValues = @{}

foreach ($name in $mailVariables) {
  $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
  # Auth mail stays local for this MVP. Ignore .env.local and inherited SMTP
  # values so confirmations, invitations, and recovery always go to Mailpit.
  $defaults = @{
    MAIL_HOST = 'inbucket'
    MAIL_PORT = '1025'
    MAIL_USERNAME = ''
    MAIL_PASSWORD = ''
    MAIL_FROM_ADDRESS = 'admin@email.com'
    MAIL_FROM_NAME = 'DowntimeOS Local'
  }
  foreach ($name in $mailVariables) {
    [Environment]::SetEnvironmentVariable($name, $defaults[$name], 'Process')
  }

  & npx --yes supabase start --workdir $repoRoot
  if ($LASTEXITCODE -ne 0) { throw "Supabase CLI terminó con código $LASTEXITCODE." }
} finally {
  foreach ($name in $mailVariables) {
    [Environment]::SetEnvironmentVariable($name, $previousValues[$name], 'Process')
  }
}
