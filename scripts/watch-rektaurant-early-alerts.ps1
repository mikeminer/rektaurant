param(
  [string]$BaseUrl = "https://rektaurant.vercel.app",
  [string]$MenuUrl,
  [string]$Secret,
  [int]$IntervalSeconds = 180,
  [ValidateSet("opportunistic", "balanced", "strict", "wave-rider")]
  [string]$Mode = "opportunistic",
  [int]$MinSetupScore = 24,
  [int]$Limit = 14,
  [string]$StatePath,
  [switch]$DryRun,
  [switch]$RunOnce
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $StatePath) {
  $StatePath = Join-Path $projectRoot ".rektaurant-early-alert-state.json"
}

function Normalize-BaseUrl($value) {
  return ("" + $value).Trim().TrimEnd("/")
}

$BaseUrl = Normalize-BaseUrl $BaseUrl

if (-not $MenuUrl) {
  $operationMode = if ($Mode -eq "wave-rider") { "wave-rider" } else { $Mode }
  $MenuUrl = "$BaseUrl/api/menu?limit=$Limit&minSetupScore=$MinSetupScore&operationMode=$operationMode"
}

if (-not $DryRun -and -not $Secret) {
  $localSecretPath = Join-Path $projectRoot ".rektaurant-notify-secret"
  if (Test-Path $localSecretPath) {
    $Secret = (Get-Content -Raw $localSecretPath).Trim()
  }
}

if (-not $DryRun -and -not $Secret) {
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

function Trim-Text($text, $maxLength) {
  $value = "" + $text
  if ($value.Length -le $maxLength) {
    return $value
  }
  return $value.Substring(0, $maxLength)
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

function Is-MissedDish($dish) {
  $course = ("" + $dish.course).ToUpperInvariant()
  $lifecycle = ("" + $dish.lifecycle).ToUpperInvariant()
  $recommendation = ("" + $dish.recommendation).ToUpperInvariant()
  return $course -eq "MISSED PLATE" -or
    $recommendation -eq "REVIEW_RESOLVED" -or
    @("RESOLVED", "EXPIRED", "CANCELLED", "CANCELED") -contains $lifecycle
}

function Dish-Fingerprint($dish) {
  if ($dish.id) {
    return "$($dish.id)-$($dish.servedAt)"
  }

  $parts = @(
    $dish.coin,
    $dish.side,
    $dish.decision,
    $dish.entryUsd,
    $dish.targetUsd,
    $dish.invalidationUsd,
    $dish.servedAt
  )
  return ($parts -join "|")
}

function Select-HotDish($menu) {
  $dishes = @($menu.dishes | Where-Object { -not (Is-MissedDish $_) })
  if ($dishes.Count -eq 0) {
    return $null
  }

  return @($dishes | Sort-Object `
    @{ Expression = { if ($_.decision -eq "ENTER_NOW") { 0 } elseif ($_.decision -eq "PAPER_ONLY") { 1 } elseif ($_.decision -eq "WATCH_SETUP") { 2 } else { 3 } } }, `
    @{ Expression = { -1 * [double]($_.scores.setup) } }, `
    @{ Expression = { -1 * [double]($_.scores.timing) } } |
    Select-Object -First 1)[0]
}

function Send-DishNotification($dish, $fingerprint, $menu) {
  $symbol = ("" + $dish.coin).Trim().ToUpperInvariant()
  if (-not $symbol) { $symbol = "COIN" }

  $side = ("" + $dish.side).Trim().ToUpperInvariant()
  if (-not $side) { $side = "SETUP" }

  $decision = ("" + $dish.decision).Trim().Replace("_", " ").ToUpperInvariant()
  $setup = Short-Number $dish.scores.setup 0
  $ev = Short-Number $dish.expectedValuePct 2
  $rr = if ($null -ne $dish.riskRewardRatio) { "$(Short-Number $dish.riskRewardRatio 2)x" } else { "n/a" }
  $prefix = if ($menu.operationMode -eq "wave-rider") { "Wave Rider" } else { "Executive plate" }

  $title = Trim-Text "${prefix}: $symbol $side" 32
  $body = Trim-Text "$decision served hot. Setup $setup, EV $ev%, R/R $rr. Strict invalidation on Rektaurant." 128
  $notificationId = Trim-Text "rektaurant-$($menu.operationMode)-$fingerprint" 128
  $targetUrl = "$BaseUrl/?r=auto-premium&mode=$([uri]::EscapeDataString($menu.operationMode))&coin=$([uri]::EscapeDataString($symbol))"

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
      source = $menu.source
      rawSignalCount = $menu.rawSignalCount
    }
  }

  $headers = @{
    "Authorization" = "Bearer $Secret"
    "Content-Type" = "application/json"
  }

  $payload = $payloadObject | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/notifications/send" -Headers $headers -Body $payload -TimeoutSec 30
}

Write-Host "Rektaurant premium auto-notification watcher"
Write-Host "Menu:    $MenuUrl"
Write-Host "Push:    $BaseUrl/api/notifications/send"
Write-Host "State:   $StatePath"
Write-Host "Every:   $IntervalSeconds seconds"
if ($DryRun) { Write-Host "Mode:    dry run, no push will be sent" }
if ($RunOnce) { Write-Host "Mode:    single check" }
Write-Host ""

while ($true) {
  $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  try {
    $menu = Invoke-RestMethod -Method Get -Uri $MenuUrl -Headers @{ accept = "application/json" } -TimeoutSec 45
    $dish = Select-HotDish $menu

    if (-not $dish) {
      $rawCount = if ($null -ne $menu.rawSignalCount) { $menu.rawSignalCount } else { "n/a" }
      Write-Host "[$now] No Rektaurant premium dish. Source=$($menu.source), raw=$rawCount, served=$(@($menu.dishes).Count)."
    } else {
      $fingerprint = Dish-Fingerprint $dish
      $state = Get-State
      $alreadySent = @($state.sent) -contains $fingerprint

      if ($alreadySent) {
        Write-Host "[$now] Already notified $($dish.coin) $($dish.side) ($fingerprint)."
      } else {
        Write-Host "[$now] Rektaurant premium dish found: $($dish.coin) $($dish.side) $($dish.decision). Sending push..."
        $result = Send-DishNotification $dish $fingerprint $menu
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
