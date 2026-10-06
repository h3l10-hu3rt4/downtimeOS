param(
  [ValidateSet('start')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# Windows PowerShell 5.1 convierte cada línea de stderr en un error terminante
# bajo 'Stop'; la CLI escribe su progreso ahí, así que se relaja solo en esta llamada.
$ErrorActionPreference = 'Continue'
$salida = & npx --yes supabase start --workdir $repoRoot 2>&1
$codigoSalida = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($codigoSalida -ne 0) {
  throw "Supabase CLI terminó con código $codigoSalida. Se ocultó su salida para evitar imprimir llaves locales; revisa Docker Desktop y vuelve a intentarlo."
}

# `supabase start` imprime un JSON con claves locales; nunca lo propagamos a
# la terminal del usuario.
Write-Output 'Supabase Local está iniciado. API: http://localhost:54321'
Write-Output 'Correos locales en Mailpit: http://localhost:54324'
