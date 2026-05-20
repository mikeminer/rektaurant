param(
  [string]$SignalsUrl = "http://127.0.0.1:3000/api/v1/bot/hyperliquid/signals?limit=12&includeWatch=true&operationMode=opportunistic",
  [string]$BaseUrl = "https://rektaurant.vercel.app",
  [string]$Secret,
  [int]$IntervalSeconds = 180,
  [string]$StatePath,
  [switch]$DryRun,
  [switch]$RunOnce
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $StatePath) {
  $StatePath = Join-Path $projectRoot ".rektaurant-early-alert-state.json"
}

if (-not $Secret) {
  $localSecretPath = Join-Path $projectRoot ".rektaurant-notify-secret"
  if (Test-Path $localSecretPath) {
    $Secret = (Get-Content -Raw $localSecretPath).Trim()
  }
}

if (-not $Secret) {
  $Secret = Read-Host "REKTAURANT_NOTIFY_SECRET"
}

function Get-State {
  if (-not (Test-Path $StatePath)) {
    return @{ sent = @() }
  }

  try {
    $raw = Get-Content -Raw $StatePath
    if (-not $raw.Trim()) {
      return @{ sent = @() }
    }
    $parsed = $raw | ConvertFrom-Json
    $sent = @()
    if ($parsed.sent) {
      $sent = @($parsed.sent)
    }
    return @{ sent = $sent }
  } catch {
    Write-Host "State file is unreadable, starting fresh: $($_.Exception.Message)"
    return @{ sent = @() }
  }
}

function Save-State($state) {
  $sent = @($state.sent) | Select-Object -First 100
  @{ sent = $sent; updatedAt = (Get-Date).ToUniversalTime().ToString("o") } |
    ConvertTo-Json -Depth 5 |
    Set-Content -Path $StatePath -Encoding UTF8
}

function Normalize-Decision($value) {
  return ("" + $value).Trim().Replace(" ", "_").Replace("-", "_").ToUpperInvariant()
}

function Short-Number($value, $digits) {
  $number = 0.0
  $styles = [System.Globalization.NumberStyles]::Float
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  if ([double]::TryParse(("" + $value), $styles, $culture, [ref]$number)) {
    return [Math]::Round($number, $digits)
  }
  return "n/a"
}

function Signal-Fingerprint($signal) {
  if ($signal.id) {
    return ("" + $signal.id)
  }

  $parts = @(
    $signal.symbol,
    $signal.side,
    $signal.decision,
    $signal.entryTriggerUsd,
    $signal.targetUsd,
    $signal.invalidationUsd
  )
  return ($parts -join "|")
}

function Trim-Text($text, $maxLength) {
  $value = "" + $text
  if ($value.Length -le $maxLength) {
    return $value
  }
  return $value.Substring(0, $maxLength)
}

function Send-EarlyAlertNotification($signal, $fingerprint) {
  $symbol = ("" + $signal.symbol).Trim().ToUpperInvariant()
  if (-not $symbol) { $symbol = "COIN" }

  $side = ("" + $signal.side).Trim().ToUpperInvariant()
  if (-not $side) { $side = "SETUP" }

  $setup = Short-Number $signal.setupScore 0
  $confidence = Short-Number $signal.confidence 0
  $wait = Short-Number $signal.expectedWaitMinutes 0

  $title = Trim-Text "Early alert $symbol $side" 32
  $body = Trim-Text "$symbol $side early alert: setup $setup, confidence $confidence%, wait ~$wait min. Hot plate on Rektaurant." 128
  $notificationId = Trim-Text "early-alert-$fingerprint" 128
  $targetUrl = "$BaseUrl/?r=early-alert&coin=$([uri]::EscapeDataString($symbol))"

  $payloadObject = @{
    type = "open"
    title = $title
    body = $body
    notificationId = $notificationId
    targetUrl = $targetUrl
  }

  if ($DryRun) {
    return [pscustomobject]@{
      ok = $true
      dryRun = $true
      title = $title
      body = $body
      notificationId = $notificationId
      targetUrl = $targetUrl
    }
  }

  $headers = @{
    "Authorization" = "Bearer $Secret"
    "Content-Type" = "application/json"
  }

  $payload = $payloadObject | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/notifications/send" -Headers $headers -Body $payload -TimeoutSec 30
}

Write-Host "Rektaurant EARLY_ALERT watcher"
Write-Host "Signals: $SignalsUrl"
Write-Host "Push:    $BaseUrl/api/notifications/send"
Write-Host "State:   $StatePath"
Write-Host "Every:   $IntervalSeconds seconds"
if ($DryRun) { Write-Host "Mode:    dry run, no push will be sent" }
if ($RunOnce) { Write-Host "Mode:    single check" }
Write-Host ""

while ($true) {
  $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  try {
    $feed = Invoke-RestMethod -Method Get -Uri $SignalsUrl -Headers @{ accept = "application/json" } -TimeoutSec 45
    $signals = @($feed.signals)
    $earlyAlerts = @($signals | Where-Object { (Normalize-Decision $_.decision) -eq "EARLY_ALERT" })

    if ($earlyAlerts.Count -eq 0) {
      Write-Host "[$now] No EARLY_ALERT recent signal."
    } else {
      $signal = $earlyAlerts[0]
      $fingerprint = Signal-Fingerprint $signal
      $state = Get-State
      $alreadySent = @($state.sent) -contains $fingerprint

      if ($alreadySent) {
        Write-Host "[$now] Already notified EARLY_ALERT $($signal.symbol) $($signal.side) ($fingerprint)."
      } else {
        Write-Host "[$now] EARLY_ALERT found: $($signal.symbol) $($signal.side) ($fingerprint). Sending push..."
        $result = Send-EarlyAlertNotification $signal $fingerprint
        $result | ConvertTo-Json -Depth 8

        if ($result.ok -and -not $DryRun) {
          $state.sent = @($fingerprint) + @($state.sent)
          Save-State $state
          Write-Host "[$now] Saved notification state."
        } elseif ($result.ok -and $DryRun) {
          Write-Host "[$now] Dry run only, state not saved."
        } else {
          Write-Host "[$now] Push API returned ok=false. Will retry on next loop."
        }
      }
    }
  } catch {
    Write-Host "[$now] Watcher error: $($_.Exception.Message)"
  }

  if ($RunOnce) {
    break
  }

  Start-Sleep -Seconds $IntervalSeconds
}
