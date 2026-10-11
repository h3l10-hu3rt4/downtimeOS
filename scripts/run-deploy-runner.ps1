param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoUrl = 'https://github.com/h3l10-hu3rt4/downtimeOS'
$dockerImage = 'downtimeos-deploy-runner:local'
$containerName = "downtimeos-deploy-runner-$PID"
$githubToken = $null
$registrationToken = $null
$credentialLines = $null
$containerCreated = $false

try {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker Desktop debe estar instalado y activo.'
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git debe estar instalado y autenticado con Git Credential Manager.'
  }

  Push-Location $repoRoot
  try {
    $origin = (& git remote get-url origin 2>$null | Select-Object -First 1).Trim()
    if ($origin -notmatch '(^|[:/])h3l10-hu3rt4/downtimeOS(\.git)?$') {
      throw 'Este script solo puede ejecutarse desde el repositorio h3l10-hu3rt4/downtimeOS.'
    }

    $credentialInput = "protocol=https`nhost=github.com`n`n"
    $credentialLines = $credentialInput | & git credential fill 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Git Credential Manager no devolvió una credencial de GitHub.' }
    $usernameLine = $credentialLines | Where-Object { $_ -like 'username=*' } | Select-Object -First 1
    $tokenLine = $credentialLines | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
    if (-not $usernameLine -or -not $tokenLine) {
      throw 'Inicia sesión en GitHub con Git Credential Manager y vuelve a ejecutar el script.'
    }
    $githubUsername = $usernameLine.Substring(9)
    $githubToken = $tokenLine.Substring(9)
    if ($githubUsername -ne 'h3l10-hu3rt4' -or -not $githubToken) {
      throw 'La credencial de GitHub no corresponde al propietario del repositorio.'
    }

    $headers = @{
      Authorization = "Bearer $githubToken"
      'X-GitHub-Api-Version' = '2022-11-28'
      'User-Agent' = 'DowntimeOS-ephemeral-deploy-runner'
      Accept = 'application/vnd.github+json'
    }
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/actions/runner/releases/latest' `
      -Headers @{ 'User-Agent' = 'DowntimeOS-ephemeral-deploy-runner' } -TimeoutSec 20
    if ($release.tag_name -notmatch '^v(?<version>\d+\.\d+\.\d+)$') {
      throw 'GitHub devolvió una versión de runner no estable.'
    }
    $runnerVersion = $Matches.version

    $registration = Invoke-RestMethod -Method Post `
      -Uri 'https://api.github.com/repos/h3l10-hu3rt4/downtimeOS/actions/runners/registration-token' `
      -Headers $headers -TimeoutSec 20
    $registrationToken = $registration.token
    if (-not $registrationToken) { throw 'GitHub no emitió el token temporal del runner.' }

    Write-Output "Preparando runner efímero oficial v$runnerVersion en un contenedor aislado..."
    & docker build --pull --build-arg "RUNNER_VERSION=$runnerVersion" `
      --file (Join-Path $repoRoot 'deploy/runner/Dockerfile') `
      --tag $dockerImage (Join-Path $repoRoot 'deploy/runner')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la imagen local del runner.' }

    & docker create --name $containerName --memory 768m --pids-limit 256 `
      --security-opt no-new-privileges --cap-drop ALL $dockerImage
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el contenedor aislado del runner.' }
    $containerCreated = $true
    & docker start $containerName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar el contenedor aislado del runner.' }

    $runnerName = "downtimeos-deploy-$PID"
    $configuration = @'
read -r registration_token
registration_token=$(printf '%s' "$registration_token" | tr -d '\r')
./config.sh --unattended --url https://github.com/h3l10-hu3rt4/downtimeOS --token "$registration_token" --name "RUNNER_NAME_PLACEHOLDER" --labels downtimeos-deploy --ephemeral --work _work
result=$?
unset registration_token
exit "$result"
'@.Replace('RUNNER_NAME_PLACEHOLDER', $runnerName)
    $registrationToken | & docker exec -i --user runner --workdir /home/runner/actions-runner `
      $containerName bash -lc $configuration
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo registrar el runner efímero con GitHub.' }

    $registrationToken = $null
    $githubToken = $null
    $credentialLines = $null
    Write-Output 'Runner listo; esperará exactamente un job de despliegue aprobado.'
    & docker exec --user runner --workdir /home/runner/actions-runner $containerName ./run.sh
    $runnerExit = $LASTEXITCODE
    if ($runnerExit -ne 0) { throw "El runner terminó con código $runnerExit." }
  }
  finally {
    Pop-Location
  }
}
finally {
  $githubToken = $null
  $registrationToken = $null
  $credentialLines = $null
  if ($containerCreated) {
    & docker rm --force $containerName 2>$null | Out-Null
  }
}
