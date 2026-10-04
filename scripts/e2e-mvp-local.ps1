param(
  [string]$SupabaseWorkdir,
  [int]$Port = 3001,
  [int]$ExpectedSupabasePort = 54321,
  [switch]$ConfirmDisposableDatabase,
  [switch]$VisualQA
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $SupabaseWorkdir) {
  # Default to this checkout's config and complete migration chain. Never
  # silently select a developer's historical Supabase project from Temp.
  $SupabaseWorkdir = $repo
}
if (-not $ConfirmDisposableDatabase) {
  throw 'El E2E crea cuentas y datos persistentes. Confirma que Supabase Local está vacío y desechable con -ConfirmDisposableDatabase.'
}
$SupabaseWorkdir = (Resolve-Path -LiteralPath $SupabaseWorkdir).Path
$migrationsEsperadasPath = Join-Path $repo 'supabase/migrations'
$migrationsDisponiblesPath = Join-Path $SupabaseWorkdir 'supabase/migrations'
if (-not (Test-Path -LiteralPath $migrationsDisponiblesPath -PathType Container)) {
  throw 'SupabaseWorkdir debe ser la raíz del proyecto y contener supabase/migrations.'
}
$migrationsEsperadas = @(Get-ChildItem -LiteralPath $migrationsEsperadasPath -Filter '*.sql' -File | Sort-Object Name | ForEach-Object Name)
$migrationsDisponibles = @(Get-ChildItem -LiteralPath $migrationsDisponiblesPath -Filter '*.sql' -File | Sort-Object Name | ForEach-Object Name)
if ($migrationsEsperadas.Count -eq 0 -or (Compare-Object $migrationsEsperadas $migrationsDisponibles)) {
  throw "La cadena de migraciones en '$SupabaseWorkdir' no coincide exactamente con esta rama. Actualiza esa copia antes del E2E; no se hicieron cambios en la base."
}
$appUrl = "http://127.0.0.1:$Port"
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$statusArguments = @('status', '--output', 'env', '--workdir', $SupabaseWorkdir)
$supabaseOutput = & npx --yes supabase @statusArguments 2>&1
$supabaseExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($supabaseExitCode -ne 0) {
  throw 'No se pudo consultar Supabase Local; no se inició el E2E.'
}
$settings = @{}
foreach ($line in $supabaseOutput) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') {
    $settings[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
  }
}

$publicKey = $settings.PUBLISHABLE_KEY
if (-not $publicKey) { $publicKey = $settings.ANON_KEY }
$secretKey = $settings.SERVICE_ROLE_KEY
if (-not $secretKey) { $secretKey = $settings.SECRET_KEY }
if (-not $settings.API_URL -or -not $publicKey -or -not $secretKey) {
  throw 'No se pudo leer la configuración de Supabase Local. No se inició la aplicación.'
}
$apiUri = [uri]$settings.API_URL
if ($apiUri.Host -notin @('127.0.0.1', 'localhost', '::1') -or $apiUri.Port -ne $ExpectedSupabasePort) {
  throw "Supabase no coincide con el puerto local esperado ($ExpectedSupabasePort); prueba cancelada sin iniciar la aplicación."
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
  throw "El puerto $Port ya está ocupado. No se iniciará ni reemplazará otro proceso."
}
$browserExecutable = $null
if ($VisualQA) {
  $browserCandidates = @(
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
  )
  $browserExecutable = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $browserExecutable) { throw 'No se encontró Microsoft Edge instalado; no se inició el E2E visual.' }
}

$variablesEntorno = @(
  'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_JWT_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SITE_URL', 'SITE_URL', 'PORT',
  'HOSTNAME', 'NODE_ENV', 'MVP_E2E_LOCAL', 'MVP_E2E_DATABASE_DISPOSABLE',
  'APP_URL', 'MVP_E2E_APP_URL', 'MVP_E2E_MAILPIT_URL', 'DASHBOARD_ADMIN_EMAIL',
  'DASHBOARD_ADMIN_PASSWORD', 'MVP_E2E_ADMIN_EMAIL', 'MVP_E2E_ADMIN_PASSWORD',
  'MVP_E2E_BROWSER', 'MVP_E2E_BROWSER_EXECUTABLE'
)
$integracionesExternas = @(
  'GEMINI_API_KEY', 'ANTHROPIC_API_KEY',
  'AI_OPERACIONES_PROVIDER', 'AI_FINANZAS_PROVIDER', 'AI_REPORTE_FALLBACK_PROVIDER',
  'GEMINI_MODEL', 'ANTHROPIC_MODEL',
  'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'CRON_SECRET', 'PUBLIC_APP_URL',
  'WHATSAPP_PROVIDER', 'WHATSAPP_ALERTAS_ACTIVAS', 'WHATSAPP_APROBACIONES_ACTIVAS',
  'WHATSAPP_ALERTAS_DESTINATARIOS', 'WHATSAPP_OPERACIONES_DESTINATARIO', 'WHATSAPP_FINANZAS_DESTINATARIO',
  'WHATSAPP_META_USE_TEMPLATES',
  'META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID', 'META_WHATSAPP_VERIFY_TOKEN',
  'META_WHATSAPP_APP_SECRET', 'META_WHATSAPP_WEBHOOK_SECRET', 'META_APP_SECRET',
  'META_WHATSAPP_GRAPH_VERSION', 'META_WHATSAPP_TEMPLATE_LANGUAGE',
  'META_WHATSAPP_TEMPLATE_PAROS', 'META_WHATSAPP_TEMPLATE_PAROS_LANGUAGE',
  'META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO', 'META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO_LANGUAGE',
  'META_WHATSAPP_TEMPLATE_REPORTE', 'META_WHATSAPP_TEMPLATE_REPORTE_LANGUAGE',
  'META_WHATSAPP_TEMPLATE_APROBACION', 'META_WHATSAPP_TEMPLATE_APROBACION_LANGUAGE',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'
)
$variablesEntorno += $integracionesExternas
$entornoAnterior = @{}
foreach ($nombre in $variablesEntorno) {
  $entornoAnterior[$nombre] = [Environment]::GetEnvironmentVariable($nombre, 'Process')
}

$env:SUPABASE_URL = $settings.API_URL
$env:SUPABASE_SECRET_KEY = $secretKey
$env:SUPABASE_SERVICE_ROLE_KEY = $secretKey
$env:SUPABASE_PUBLISHABLE_KEY = $publicKey
$env:SUPABASE_ANON_KEY = $publicKey
$env:SUPABASE_ANON_JWT_KEY = $settings.ANON_KEY
$env:NEXT_PUBLIC_SUPABASE_URL = $settings.API_URL
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $publicKey
$env:NEXT_PUBLIC_SITE_URL = $appUrl
$env:SITE_URL = $appUrl
$env:PORT = [string]$Port
$env:HOSTNAME = '127.0.0.1'
$env:NODE_ENV = 'development'
$env:MVP_E2E_LOCAL = '1'
$env:MVP_E2E_DATABASE_DISPOSABLE = '1'
$env:SUPABASE_PUBLISHABLE_KEY = $publicKey
$env:APP_URL = $appUrl
$env:MVP_E2E_APP_URL = $appUrl
$env:MVP_E2E_MAILPIT_URL = $settings.MAILPIT_URL
foreach ($nombre in $integracionesExternas) {
  [Environment]::SetEnvironmentVariable($nombre, '', 'Process')
}
$env:WHATSAPP_ALERTAS_ACTIVAS = 'false'
$env:WHATSAPP_APROBACIONES_ACTIVAS = 'false'
if ($VisualQA) {
  $env:MVP_E2E_BROWSER = '1'
  $env:MVP_E2E_BROWSER_EXECUTABLE = $browserExecutable
}

# Credenciales temporales exclusivas para probar el endpoint administrativo
# en el servidor local del E2E. Nunca se reutilizan credenciales del entorno.
$adminEmailE2E = "mvp-e2e-admin-$([guid]::NewGuid().ToString('N'))@example.test"
$adminPasswordE2E = [guid]::NewGuid().ToString('N') + 'Aa9!'
$env:DASHBOARD_ADMIN_EMAIL = $adminEmailE2E
$env:DASHBOARD_ADMIN_PASSWORD = $adminPasswordE2E
$env:MVP_E2E_ADMIN_EMAIL = $adminEmailE2E
$env:MVP_E2E_ADMIN_PASSWORD = $adminPasswordE2E

$server = $null
$logOut = Join-Path $env:TEMP "downtimeos-e2e-$PID.out.log"
$logErr = Join-Path $env:TEMP "downtimeos-e2e-$PID.err.log"
try {
  $server = Start-Process -FilePath 'node' `
    -ArgumentList @('node_modules/next/dist/bin/next', 'dev', '-p', [string]$Port) `
    -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $logOut -RedirectStandardError $logErr

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if ($server.HasExited) { throw 'La instancia aislada de Next.js terminó antes de estar lista.' }
    try {
      $null = Invoke-RestMethod -Uri "$appUrl/api/health" -TimeoutSec 2
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) { throw 'La instancia local de Next.js no respondió a tiempo.' }

  Push-Location $repo
  try { & node scripts/e2e-mvp-local.mjs; $code = $LASTEXITCODE }
  finally { Pop-Location }
  if ($code -ne 0) {
    if (Test-Path $logErr) {
      Select-String -Path $logErr -Pattern '\[downtimeos\] error no controlado:' -Context 0,6 |
        ForEach-Object { $_.ToString() }
    }
    throw "El runner E2E terminó con código $code."
  }
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
  foreach ($nombre in $variablesEntorno) {
    [Environment]::SetEnvironmentVariable($nombre, $entornoAnterior[$nombre], 'Process')
  }
}
