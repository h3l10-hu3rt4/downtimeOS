param(
  [ValidateSet('start')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envLocalPath = Join-Path $repoRoot '.env.local'
$mailVariables = @(
  'MAIL_HOST', 'MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD',
  'MAIL_FROM_ADDRESS', 'MAIL_FROM_NAME'
)
$previousValues = @{}
$configuredMailVariables = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)

foreach ($name in $mailVariables) {
  $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
  # Supabase CLI expands env(NAME) in config.toml from the process environment.
  # Read only the SMTP allowlist from .env.local; never print its values.
  if (Test-Path -LiteralPath $envLocalPath -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $envLocalPath) {
      if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        $name = $Matches[1]
        if ($name -in $mailVariables) {
          $value = $Matches[2].Trim()
          if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
            $value = $value.Substring(1, $value.Length - 2)
          }
          [Environment]::SetEnvironmentVariable($name, $value, 'Process')
          if (-not [string]::IsNullOrWhiteSpace($value)) { [void]$configuredMailVariables.Add($name) }
        }
      }
    }
  }

  # Keep the local capture stack when no external SMTP credentials are set.
  $defaults = @{
    MAIL_HOST = 'inbucket'
    MAIL_PORT = '2500'
    MAIL_USERNAME = ''
    MAIL_PASSWORD = ''
    MAIL_FROM_ADDRESS = 'admin@email.com'
    MAIL_FROM_NAME = 'DowntimeOS Local'
  }
  foreach ($name in $mailVariables) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
      [Environment]::SetEnvironmentVariable($name, $defaults[$name], 'Process')
    }
  }

  if ($Action -eq 'start' -and $env:MAIL_HOST -eq 'smtp.resend.com') {
    $requiredResendVariables = @('MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_FROM_ADDRESS')
    $missingResendVariables = @($requiredResendVariables | Where-Object { -not $configuredMailVariables.Contains($_) })
    if ($missingResendVariables.Count) {
      throw "Resend SMTP está seleccionado, pero faltan variables explícitas en .env.local: $($missingResendVariables -join ', '). No iniciaré el envío."
    }
    $sender = $env:MAIL_FROM_ADDRESS
    if ($sender -notmatch '^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$' -or $sender -eq 'admin@email.com') {
      throw 'MAIL_FROM_ADDRESS debe ser una dirección completa de un dominio verificado en Resend.'
    }
    if ($env:MAIL_PORT -notin @('465', '587')) {
      throw 'Resend SMTP requiere MAIL_PORT=465 o MAIL_PORT=587.'
    }
    if ($env:MAIL_USERNAME -ne 'resend' -or [string]::IsNullOrWhiteSpace($env:MAIL_PASSWORD)) {
      throw 'Para Resend configura MAIL_USERNAME=resend y MAIL_PASSWORD con una API key SMTP.'
    }
  }

  & npx --yes supabase start --workdir $repoRoot
  if ($LASTEXITCODE -ne 0) { throw "Supabase CLI terminó con código $LASTEXITCODE." }
} finally {
  foreach ($name in $mailVariables) {
    [Environment]::SetEnvironmentVariable($name, $previousValues[$name], 'Process')
  }
}
