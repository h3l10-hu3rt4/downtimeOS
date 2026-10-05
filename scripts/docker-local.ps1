param(
  [string]$SupabaseWorkdir,
  [string[]]$ComposeArgs = @('up', '-d', '--build'),
  [switch]$WhatsAppDesdeEnvLocal,
  [switch]$IADesdeEnvLocal,
  [switch]$AdminDesdeEnvLocal
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$legacyWorkdir = Join-Path $env:LOCALAPPDATA 'Temp\downtimeos-supabase-check-17e0d9c049a54fb4b73727f6c11b5df4'
$seleccionAutomatica = -not [bool]$SupabaseWorkdir
$composeArguments = @($ComposeArgs | ForEach-Object { [string]$_ })
$isDefaultUp = ($composeArguments.Count -eq 3 -and $composeArguments[0] -eq 'up' -and $composeArguments[1] -eq '-d' -and $composeArguments[2] -eq '--build')
$isReadOnlyPs = ($composeArguments.Count -eq 1 -and $composeArguments[0] -eq 'ps')
if (-not $isDefaultUp -and -not $isReadOnlyPs) {
  throw 'ComposeArgs solo admite "up -d --build" (predeterminado) o "ps" de solo lectura. El lanzador no ejecutará stop, down, rm, prune ni otras operaciones.'
}
if (($WhatsAppDesdeEnvLocal -or $IADesdeEnvLocal -or $AdminDesdeEnvLocal) -and -not $isDefaultUp) {
  throw 'Las opciones de integraciones desde .env.local solo se admiten al levantar la app con "up -d --build".'
}

# El estado es estrictamente de solo lectura: no requiere Supabase CLI, claves
# ni interpolar docker-compose.yml. Así también funciona si npm no tiene disco
# para ejecutar npx y enseña tanto la app como el stack Supabase del proyecto.
if ($isReadOnlyPs) {
  Write-Output 'Aplicación de este checkout:'
  & docker ps --filter "label=com.docker.compose.project.working_dir=$repoRoot" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible consultar los contenedores de la aplicación. Verifica que Docker Desktop esté iniciado.' }
  Write-Output 'Supabase Local de este checkout:'
  & docker ps --filter "label=com.supabase.cli.workdir=$repoRoot" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  if ($LASTEXITCODE -ne 0) { throw 'No fue posible consultar los contenedores de Supabase Local. Verifica que Docker Desktop esté iniciado.' }
  exit 0
}

# Carga las credenciales efímeras del Supabase Local; nunca lee .env.local para
# credenciales de Supabase ni imprime las claves.
function Get-SupabaseLocalStatus([string]$Workdir) {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & npx --yes supabase status --output env --workdir $Workdir 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorActionPreference
  if ($exitCode -ne 0) { return $null }
  return ,$output
}

if (-not $SupabaseWorkdir) {
  # Prefer the self-contained project, but never silently attach the app to a
  # historical database. Require an explicit path when only that stack exists.
  if (Get-SupabaseLocalStatus $repoRoot) {
    $SupabaseWorkdir = $repoRoot
  } elseif (Get-SupabaseLocalStatus $legacyWorkdir) {
    throw "Solo encontré el Supabase histórico '$legacyWorkdir'. Para usarlo conscientemente, vuelve a ejecutar con -SupabaseWorkdir `"$legacyWorkdir`"; para probar de forma aislada, inicia primero el Supabase desechable del repositorio."
  } else {
    throw 'No encontré Supabase Local activo. Inícialo desde el proyecto con: npx supabase start'
  }
}

$status = Get-SupabaseLocalStatus $SupabaseWorkdir
if (-not $status) {
  throw "No pude consultar Supabase Local en '$SupabaseWorkdir'. Verifica que Docker Desktop y ese stack estén levantados."
}

$settings = @{}
foreach ($line in $status) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') {
    $settings[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
  }
}

$apiUrl = $settings.API_URL
$publicKey = $settings.PUBLISHABLE_KEY
if (-not $publicKey) { $publicKey = $settings.ANON_KEY }
$secretKey = $settings.SECRET_KEY
if (-not $secretKey) { $secretKey = $settings.SERVICE_ROLE_KEY }
if (-not $apiUrl -or -not $publicKey -or -not $secretKey) {
  throw 'Supabase Local no devolvió URL y claves completas; no iniciaré la aplicación.'
}

$uri = [uri]$apiUrl
if ($uri.Scheme -ne 'http' -or $uri.Host -notin @('127.0.0.1', 'localhost', '::1') -or $uri.Port -lt 1) {
  throw 'La URL debe corresponder a un Supabase Local HTTP en loopback; operación cancelada.'
}
$apiPort = $uri.Port

if ($seleccionAutomatica) {
  Write-Output "Supabase Local seleccionado desde el repositorio: $SupabaseWorkdir"
} else {
  Write-Output "Supabase Local seleccionado explícitamente: $SupabaseWorkdir"
}
Write-Output 'La app se conectará a esta base local existente; el lanzador no crea, borra ni reinicia datos.'

# .env.local nunca se hereda automáticamente. Las opciones explícitas cargan
# únicamente listas acotadas de WhatsApp o IA; nunca Supabase ni Resend.
$clavesWhatsAppPermitidas = @(
  'WHATSAPP_PROVIDER', 'WHATSAPP_ALERTAS_ACTIVAS', 'WHATSAPP_APROBACIONES_ACTIVAS',
  'WHATSAPP_META_USE_TEMPLATES', 'WHATSAPP_ALERTAS_DESTINATARIOS',
  'WHATSAPP_OPERACIONES_DESTINATARIO', 'WHATSAPP_FINANZAS_DESTINATARIO',
  'META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID',
  'META_WHATSAPP_VERIFY_TOKEN', 'META_WHATSAPP_APP_SECRET',
  'META_WHATSAPP_WEBHOOK_SECRET', 'META_APP_SECRET', 'META_WHATSAPP_GRAPH_VERSION',
  'META_WHATSAPP_TEMPLATE_LANGUAGE', 'META_WHATSAPP_TEMPLATE_PAROS',
  'META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO', 'META_WHATSAPP_TEMPLATE_REPORTE',
  'META_WHATSAPP_TEMPLATE_APROBACION', 'META_WHATSAPP_TEMPLATE_PAROS_LANGUAGE',
  'META_WHATSAPP_TEMPLATE_ALERTA_ACTIVO_LANGUAGE', 'META_WHATSAPP_TEMPLATE_REPORTE_LANGUAGE',
  'META_WHATSAPP_TEMPLATE_APROBACION_LANGUAGE'
)
$valoresWhatsAppLocal = @{}
if ($WhatsAppDesdeEnvLocal) {
  $envLocalPath = Join-Path $repoRoot '.env.local'
  if (-not (Test-Path -LiteralPath $envLocalPath -PathType Leaf)) {
    throw 'No existe .env.local; WhatsApp no fue configurado en Docker.'
  }
  foreach ($line in Get-Content -LiteralPath $envLocalPath) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $nombre = $Matches[1]
      if ($nombre -in $clavesWhatsAppPermitidas) {
        $valor = $Matches[2].Trim()
        if ($valor.Length -ge 2 -and (($valor[0] -eq '"' -and $valor[-1] -eq '"') -or ($valor[0] -eq "'" -and $valor[-1] -eq "'"))) {
          $valor = $valor.Substring(1, $valor.Length - 2)
        }
        $valoresWhatsAppLocal[$nombre] = $valor
      }
    }
  }
  if (-not $valoresWhatsAppLocal['META_WHATSAPP_APP_SECRET']) {
    $valoresWhatsAppLocal['META_WHATSAPP_APP_SECRET'] = $valoresWhatsAppLocal['META_APP_SECRET']
  }
  if (-not $valoresWhatsAppLocal['META_WHATSAPP_WEBHOOK_SECRET']) {
    $valoresWhatsAppLocal['META_WHATSAPP_WEBHOOK_SECRET'] = $valoresWhatsAppLocal['META_WHATSAPP_APP_SECRET']
  }
  $proveedorLocal = if ($valoresWhatsAppLocal['WHATSAPP_PROVIDER']) { $valoresWhatsAppLocal['WHATSAPP_PROVIDER'] } else { 'meta' }
  if ($valoresWhatsAppLocal['WHATSAPP_ALERTAS_ACTIVAS'] -eq 'true' -and $proveedorLocal -eq 'meta') {
    $faltantesMeta = @('META_WHATSAPP_ACCESS_TOKEN', 'META_WHATSAPP_PHONE_NUMBER_ID') |
      Where-Object { [string]::IsNullOrWhiteSpace($valoresWhatsAppLocal[$_]) }
    if ($faltantesMeta.Count) {
      throw "WhatsApp está activado, pero faltan variables Meta en .env.local: $($faltantesMeta -join ', '). No iniciaré el contenedor."
    }
  }
}

# Las llaves de IA también son opt-in. No se heredan automáticamente desde
# .env.local ni se imprimen; los proveedores se validan antes de tocar Docker.
$clavesIALocal = @(
  'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_MODEL', 'ANTHROPIC_MODEL',
  'AI_FINANZAS_PROVIDER', 'AI_OPERACIONES_PROVIDER', 'AI_REPORTE_FALLBACK_PROVIDER'
)
$valoresIALocal = @{}
if ($IADesdeEnvLocal) {
  $envLocalPath = Join-Path $repoRoot '.env.local'
  if (-not (Test-Path -LiteralPath $envLocalPath -PathType Leaf)) {
    throw 'No existe .env.local; los proveedores de IA no fueron configurados en Docker.'
  }
  foreach ($line in Get-Content -LiteralPath $envLocalPath) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $nombre = $Matches[1]
      if ($nombre -in $clavesIALocal) {
        $valor = $Matches[2].Trim()
        if ($valor.Length -ge 2 -and (($valor[0] -eq '"' -and $valor[-1] -eq '"') -or ($valor[0] -eq "'" -and $valor[-1] -eq "'"))) {
          $valor = $valor.Substring(1, $valor.Length - 2)
        }
        $valoresIALocal[$nombre] = $valor
      }
    }
  }
  foreach ($area in @('AI_FINANZAS_PROVIDER', 'AI_OPERACIONES_PROVIDER')) {
    $proveedor = if ($valoresIALocal[$area]) { $valoresIALocal[$area].ToLowerInvariant() } else { 'gemini' }
    if ($proveedor -notin @('gemini', 'anthropic')) {
      throw "Proveedor de IA no permitido en $area. Usa gemini o anthropic."
    }
    $llave = if ($proveedor -eq 'gemini') { 'GEMINI_API_KEY' } else { 'ANTHROPIC_API_KEY' }
    if ([string]::IsNullOrWhiteSpace($valoresIALocal[$llave])) {
      throw "Falta $llave para el proveedor configurado en $area. No iniciaré el contenedor."
    }
  }
  $respaldo = [string]$valoresIALocal['AI_REPORTE_FALLBACK_PROVIDER']
  if ($respaldo -and $respaldo.ToLowerInvariant() -notin @('gemini', 'anthropic')) {
    throw 'AI_REPORTE_FALLBACK_PROVIDER debe ser gemini, anthropic o quedar vacío.'
  }
  if ($respaldo) {
    $llaveRespaldo = if ($respaldo.ToLowerInvariant() -eq 'gemini') { 'GEMINI_API_KEY' } else { 'ANTHROPIC_API_KEY' }
    if ([string]::IsNullOrWhiteSpace($valoresIALocal[$llaveRespaldo])) {
      throw "Falta $llaveRespaldo para el proveedor de respaldo. No iniciaré el contenedor."
    }
  }
}

$adminEmailLocal = [Environment]::GetEnvironmentVariable('DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL', 'Process')
$adminPasswordLocal = [Environment]::GetEnvironmentVariable('DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_PASSWORD', 'Process')
$adminVariablesAnteriores = @{
  DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL = $adminEmailLocal
  DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_PASSWORD = $adminPasswordLocal
}
if ($AdminDesdeEnvLocal) {
  $envLocalPath = Join-Path $repoRoot '.env.local'
  if (Test-Path -LiteralPath $envLocalPath -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $envLocalPath) {
      if ($line -match '^\s*(?:export\s+)?(DASHBOARD_ADMIN_EMAIL|DASHBOARD_ADMIN_PASSWORD)\s*=\s*(.*?)\s*$') {
        $nombre = "DOWNTIMEOS_LOCAL_$($Matches[1])"
        $valor = $Matches[2].Trim()
        if ($valor.Length -ge 2 -and (($valor[0] -eq '"' -and $valor[-1] -eq '"') -or ($valor[0] -eq "'" -and $valor[-1] -eq "'"))) {
          $valor = $valor.Substring(1, $valor.Length - 2)
        }
        [Environment]::SetEnvironmentVariable($nombre, $valor, 'Process')
      }
    }
  }
  $adminEmailLocal = [Environment]::GetEnvironmentVariable('DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL', 'Process')
  $adminPasswordLocal = [Environment]::GetEnvironmentVariable('DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_PASSWORD', 'Process')
}
$tieneAdminEmail = -not [string]::IsNullOrWhiteSpace($adminEmailLocal)
$tieneAdminPassword = -not [string]::IsNullOrWhiteSpace($adminPasswordLocal)
if ($tieneAdminEmail -xor $tieneAdminPassword) {
  throw 'Para habilitar el panel interno local, configura tanto DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL como DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_PASSWORD.'
}
if ($isDefaultUp -and -not $tieneAdminEmail) {
  Write-Warning 'No hay credenciales locales del panel interno. La aprobación administrativa de pagos no estará disponible en esta app.'
}

$variablesLocal = @(
  'DOWNTIMEOS_APP_ENV', 'DOWNTIMEOS_APP_URL',
  'DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_EMAIL', 'DOWNTIMEOS_LOCAL_DASHBOARD_ADMIN_PASSWORD',
  'DOWNTIMEOS_LOCAL_SUPABASE_URL', 'DOWNTIMEOS_LOCAL_SUPABASE_BROWSER_URL',
  'DOWNTIMEOS_LOCAL_SUPABASE_PUBLISHABLE_KEY', 'DOWNTIMEOS_LOCAL_SUPABASE_SECRET_KEY'
)
if ($WhatsAppDesdeEnvLocal) {
  $variablesLocal += $clavesWhatsAppPermitidas | ForEach-Object { "DOWNTIMEOS_LOCAL_$_" }
}
if ($IADesdeEnvLocal) {
  $variablesLocal += $clavesIALocal | ForEach-Object { "DOWNTIMEOS_LOCAL_$_" }
}
$entornoLocalAnterior = @{}
foreach ($nombre in $variablesLocal) {
  $entornoLocalAnterior[$nombre] = [Environment]::GetEnvironmentVariable($nombre, 'Process')
}

$env:DOWNTIMEOS_APP_ENV = 'development'
$env:DOWNTIMEOS_APP_URL = 'http://localhost:3000'
$env:DOWNTIMEOS_LOCAL_SUPABASE_URL = "http://host.docker.internal:$apiPort"
$env:DOWNTIMEOS_LOCAL_SUPABASE_BROWSER_URL = "http://localhost:$apiPort"
$env:DOWNTIMEOS_LOCAL_SUPABASE_PUBLISHABLE_KEY = $publicKey
$env:DOWNTIMEOS_LOCAL_SUPABASE_SECRET_KEY = $secretKey
if ($WhatsAppDesdeEnvLocal) {
  foreach ($nombre in $clavesWhatsAppPermitidas) {
    $nombreLocal = "DOWNTIMEOS_LOCAL_$nombre"
    [Environment]::SetEnvironmentVariable($nombreLocal, [string]$valoresWhatsAppLocal[$nombre], 'Process')
  }
  Write-Output 'Se habilitó el paso local de las variables WhatsApp permitidas desde .env.local; no se imprimieron sus valores.'
}
if ($IADesdeEnvLocal) {
  foreach ($nombre in $clavesIALocal) {
    $nombreLocal = "DOWNTIMEOS_LOCAL_$nombre"
    [Environment]::SetEnvironmentVariable($nombreLocal, [string]$valoresIALocal[$nombre], 'Process')
  }
  Write-Output 'Se habilitó el paso local de las variables IA permitidas desde .env.local; no se imprimieron sus valores.'
}

try {
  & docker compose @composeArguments
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose no pudo completar la operación solicitada.' }
  Write-Output 'La operación Docker se ejecutó con Supabase Local. No se usó el Supabase remoto de .env.local.'
} finally {
  foreach ($nombre in $variablesLocal) {
    $valorAnterior = $entornoLocalAnterior[$nombre]
    if ($null -eq $valorAnterior) {
      Remove-Item -LiteralPath "Env:$nombre" -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($nombre, $valorAnterior, 'Process')
    }
  }
  foreach ($nombre in $adminVariablesAnteriores.Keys) {
    $valorAnterior = $adminVariablesAnteriores[$nombre]
    if ($null -eq $valorAnterior) {
      Remove-Item -LiteralPath "Env:$nombre" -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($nombre, $valorAnterior, 'Process')
    }
  }
}
