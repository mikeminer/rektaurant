param(
  [string]$Implementation = "rektaurant",
  [switch]$NoStart,
  [switch]$NoDeploy,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$rootDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$implementationDir = Join-Path $rootDir "implementations\$Implementation"
$configPath = Join-Path $implementationDir "implementation.json"

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Implementation config not found: $configPath"
}

function Resolve-ConfiguredPath {
  param(
    [string]$PathValue,
    [string]$BaseDir
  )

  $clean = $PathValue.Trim().Trim('"')
  if ([System.IO.Path]::IsPathRooted($clean)) {
    return (Resolve-Path -LiteralPath $clean).Path
  }
  return (Resolve-Path -LiteralPath (Join-Path $BaseDir $clean)).Path
}

function Wait-Url {
  param(
    [string]$Url,
    [int]$Attempts = 45,
    [int]$SleepSeconds = 2
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      # Keep waiting.
    }

    if ($attempt -lt $Attempts) {
      Write-Host -NoNewline "."
      Start-Sleep -Seconds $SleepSeconds
    }
  }

  return $false
}

function Wait-PublicUrl {
  param(
    [string]$Url,
    [int]$Attempts = 60,
    [int]$SleepSeconds = 2
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 10
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      # Quick tunnels often need a short DNS propagation window.
    }

    if ($attempt -lt $Attempts) {
      Write-Host -NoNewline "."
      Start-Sleep -Seconds $SleepSeconds
    }
  }

  return $false
}

function Get-VercelTokenArg {
  param([string]$TokenEnvName)

  $token = [Environment]::GetEnvironmentVariable($TokenEnvName, "Process")
  if (-not $token) { $token = [Environment]::GetEnvironmentVariable($TokenEnvName, "User") }
  if (-not $token) { $token = [Environment]::GetEnvironmentVariable($TokenEnvName, "Machine") }
  if ($token) { return "--token `"$token`"" }
  return ""
}

function Invoke-CmdChecked {
  param(
    [string]$Command,
    [string]$WorkingDirectory
  )

  Write-Host ""
  Write-Host "CMD> $Command"
  Write-Host ""

  if ($DryRun) {
    return 0
  }

  Push-Location -LiteralPath $WorkingDirectory
  try {
    cmd /c $Command
    return $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

function Invoke-CmdCapture {
  param(
    [string]$Command,
    [string]$WorkingDirectory
  )

  Write-Host ""
  Write-Host "CMD> $Command"
  Write-Host ""

  if ($DryRun) {
    return [pscustomobject]@{
      ExitCode = 0
      Output = "Dry run."
    }
  }

  Push-Location -LiteralPath $WorkingDirectory
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $lines = @(cmd /c $Command 2>&1 | ForEach-Object { "$_" })
    $exit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }

  $textLines = @($lines | ForEach-Object { [string]$_ })
  foreach ($line in $textLines) {
    Write-Host $line
  }

  return [pscustomobject]@{
    ExitCode = $exit
    Output = ($textLines -join "`n")
  }
}

function Test-VercelDeploySucceeded {
  param($Result)

  if ($Result.ExitCode -eq 0) {
    return $true
  }

  $output = [string]$Result.Output
  return ($output -match '(?im)(^|\s)(Ready in|Production\s+https://|Aliased\s+https://|Ready\s*$)')
}

function Start-CloudflareTunnel {
  param(
    [int]$Port
  )

  $cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cloudflared) {
    throw "cloudflared not found. Install with: winget install Cloudflare.cloudflared"
  }

  $stdoutLog = Join-Path $env:TEMP "mcc_implementation_${Implementation}_${Port}_stdout.log"
  $stderrLog = Join-Path $env:TEMP "mcc_implementation_${Implementation}_${Port}_stderr.log"

  foreach ($file in @($stdoutLog, $stderrLog)) {
    if (Test-Path -LiteralPath $file) {
      Remove-Item -LiteralPath $file -Force
    }
  }

  if ($DryRun) {
    return @{
      Process = $null
      Url = "https://dry-run-$Implementation.trycloudflare.com"
      StdoutLog = $stdoutLog
      StderrLog = $stderrLog
    }
  }

  $process = Start-Process `
    -FilePath $cloudflared.Source `
    -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port", "--edge-ip-version", "4", "--protocol", "http2", "--ha-connections", "1", "--no-autoupdate") `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden `
    -PassThru

  Write-Host "Waiting for Cloudflare tunnel URL..."
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    $combinedLog = ""
    if (Test-Path -LiteralPath $stdoutLog) { $combinedLog += Get-Content -LiteralPath $stdoutLog -Raw }
    if (Test-Path -LiteralPath $stderrLog) { $combinedLog += "`n" + (Get-Content -LiteralPath $stderrLog -Raw) }
    $match = [regex]::Match($combinedLog, "https://[-a-zA-Z0-9]+\.trycloudflare\.com")
    if ($match.Success) {
      return @{
        Process = $process
        Url = $match.Value.TrimEnd("/")
        StdoutLog = $stdoutLog
        StderrLog = $stderrLog
      }
    }
    if ($process.HasExited) {
      throw "cloudflared exited before creating a tunnel. Logs: $stdoutLog $stderrLog"
    }
  }

  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  throw "Unable to retrieve Cloudflare tunnel URL. Logs: $stdoutLog $stderrLog"
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$mccProjectDir = Resolve-ConfiguredPath ([string]$config.mccProjectDir) $implementationDir
$vercelProjectDir = Resolve-ConfiguredPath ([string]$config.vercelProjectDir) $implementationDir
$mccStartBat = Join-Path $mccProjectDir ([string]$config.mccStartBat)
$mccStartArgs = if ($config.mccStartArgs) { [string]$config.mccStartArgs } else { "" }
$mccPort = [int]$config.mccPort
$mccHealthPath = if ($config.mccHealthPath) { [string]$config.mccHealthPath } else { "/api/health" }
$mccHealthUrl = "http://127.0.0.1:$mccPort$mccHealthPath"
$vercelEnvName = [string]$config.vercelEnvName
$vercelEnvironment = if ($config.vercelEnvironment) { [string]$config.vercelEnvironment } else { "production" }
$vercelTokenEnvVar = if ($config.vercelTokenEnvVar) { [string]$config.vercelTokenEnvVar } else { "VERCEL_TOKEN" }
$autoDeploy = if ($NoDeploy) { $false } else { [bool]$config.autoDeploy }

Write-Host ""
Write-Host "====================================="
Write-Host "  MCC Implementation Relay"
Write-Host "====================================="
Write-Host ""
Write-Host "Implementation : $($config.name)"
Write-Host "Description    : $($config.description)"
Write-Host "MCC project    : $mccProjectDir"
Write-Host "MCC local origin: http://127.0.0.1:$mccPort"
Write-Host "MCC health     : $mccHealthUrl"
Write-Host "Vercel project : $vercelProjectDir"
Write-Host "Vercel env name: $vercelEnvName / $vercelEnvironment"
Write-Host "Vercel env value: created Cloudflare tunnel URL"
Write-Host "Auto deploy    : $autoDeploy"
Write-Host "Dry run        : $DryRun"
Write-Host ""

if (-not (Test-Path -LiteralPath (Join-Path $vercelProjectDir ".vercel\project.json"))) {
  throw "Vercel project is not linked: $vercelProjectDir. Run 'vercel link' in that folder once."
}

if (-not $NoStart) {
  if (-not (Test-Path -LiteralPath $mccStartBat)) {
    throw "MCC start BAT not found: $mccStartBat"
  }
  $command = if ($mccStartArgs.Trim()) { "call `"$mccStartBat`" $mccStartArgs" } else { "call `"$mccStartBat`"" }
  Write-Host "Starting MCC local API..."
  if (-not $DryRun) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $command -WorkingDirectory $mccProjectDir | Out-Null
    Start-Sleep -Seconds 3
  }
}

Write-Host "Waiting for MCC health..."
if (-not $DryRun -and -not (Wait-Url -Url $mccHealthUrl -Attempts 45 -SleepSeconds 2)) {
  throw "MCC did not become healthy at $mccHealthUrl"
}
Write-Host ""
Write-Host "[OK] MCC API is ready."

$tunnel = Start-CloudflareTunnel -Port $mccPort
$tunnelUrl = $tunnel.Url.TrimEnd("/")
Write-Host ""
Write-Host "[OK] Tunnel URL: $tunnelUrl"

$publicHealthUrl = $tunnelUrl + $mccHealthPath
Write-Host "Waiting for public tunnel health: $publicHealthUrl"
if (-not $DryRun -and -not (Wait-PublicUrl -Url $publicHealthUrl -Attempts 120 -SleepSeconds 2)) {
  if ($tunnel.Process -and -not $tunnel.Process.HasExited) { Stop-Process -Id $tunnel.Process.Id -Force }
  throw "Cloudflare tunnel URL was created but did not become reachable in time: $publicHealthUrl"
}
Write-Host ""
Write-Host "[OK] Public tunnel is reachable."

$tokenArg = Get-VercelTokenArg -TokenEnvName $vercelTokenEnvVar
Write-Host "Setting $vercelEnvName=$tunnelUrl on Vercel $vercelEnvironment."
$updateCommand = "npx vercel env update $vercelEnvName $vercelEnvironment --yes --value `"$tunnelUrl`" $tokenArg"
$exitCode = Invoke-CmdChecked -Command $updateCommand -WorkingDirectory $vercelProjectDir

if ($exitCode -ne 0) {
  Write-Host "Env update failed. Falling back to rm + add..."
  Invoke-CmdChecked -Command "npx vercel env rm $vercelEnvName $vercelEnvironment -y $tokenArg" -WorkingDirectory $vercelProjectDir | Out-Null
  $exitCode = Invoke-CmdChecked -Command "echo $tunnelUrl | npx vercel env add $vercelEnvName $vercelEnvironment $tokenArg" -WorkingDirectory $vercelProjectDir
}

if ($exitCode -ne 0) {
  if ($tunnel.Process -and -not $tunnel.Process.HasExited) { Stop-Process -Id $tunnel.Process.Id -Force }
  throw "Failed to update Vercel env $vercelEnvName"
}

if ($autoDeploy) {
  $deployResult = Invoke-CmdCapture -Command "npx vercel deploy --prod --yes $tokenArg" -WorkingDirectory $vercelProjectDir
  if (-not (Test-VercelDeploySucceeded -Result $deployResult)) {
    Write-Host "WARNING: Vercel deploy may have failed, but tunnel remains active."
    Write-Host "Deploy exit code: $($deployResult.ExitCode)"
  } elseif ($deployResult.ExitCode -ne 0) {
    Write-Host "Vercel deploy reported a non-zero exit code, but production output shows it completed successfully."
  }
}

Write-Host ""
Write-Host "Relay active."
Write-Host "Implementation : $($config.name)"
Write-Host "MCC local origin: http://127.0.0.1:$mccPort"
Write-Host "MCC tunnel     : $tunnelUrl"
Write-Host "Vercel env     : $vercelEnvName=$tunnelUrl"
Write-Host ""

if ($DryRun) {
  exit 0
}

Write-Host "Keep this window open while the implementation is using the tunnel."
Wait-Process -Id $tunnel.Process.Id
