param(
  [string]$BaseUrl = "https://rektaurant.vercel.app",
  [string]$MenuUrl,
  [string]$Secret,
  [int]$IntervalSeconds = 180,
  [ValidateSet("opportunistic", "balanced", "strict", "wave-rider")]
  [string]$Mode = "opportunistic",
  [int]$MinSetupScore = 24,
  [int]$Limit = 14,
  [int]$MaxRecentAgeSeconds = 300,
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
    $course -eq "RECENT MISSED PLATE" -or
    $recommendation -eq "REVIEW_RESOLVED" -or
    @("RESOLVED", "EXPIRED", "CANCELLED", "CANCELED") -contains $lifecycle
}

function Normalize-Decision($value) {
  return ("" + $value).Trim().Replace("_", " ").ToLowerInvariant()
}

function Format-Wait($value) {
  if ($null -eq $value -or ("" + $value).Trim() -eq "") {
    return "open"
  }

  $minutes = 0.0
  $styles = [System.Globalization.NumberStyles]::Float
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  if ([double]::TryParse(("" + $value), $styles, $culture, [ref]$minutes)) {
    if ($minutes -lt 1) { return "<1m" }
    return "$([Math]::Round($minutes))m"
  }

  return "" + $value
}

function Format-Percent($value) {
  $number = 0.0
  $styles = [System.Globalization.NumberStyles]::Float
  $culture = [System.Globalization.CultureInfo]::InvariantCulture
  if ([double]::TryParse(("" + $value), $styles, $culture, [ref]$number)) {
    $prefix = if ($number -gt 0) { "+" } else { "" }
    return "$prefix$([Math]::Round($number, 2))%"
  }

  return "n/a"
}

function Get-SignalAgeSeconds($signal) {
  $signalUtc = ("" + $signal.signalUtc).Trim()
  if (-not $signalUtc) {
    return $null
  }

  try {
    $styles = [System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal
    $parsed = [DateTimeOffset]::Parse($signalUtc, [System.Globalization.CultureInfo]::InvariantCulture, $styles)
    return [Math]::Max(0, [Math]::Round(([DateTimeOffset]::UtcNow - $parsed.ToUniversalTime()).TotalSeconds))
  } catch {
    return $null
  }
}

function Format-Age($seconds) {
  if ($null -eq $seconds) {
    return "fresh"
  }

  $value = [int][Math]::Max(0, [Math]::Round([double]$seconds))
  if ($value -lt 60) {
    return "${value}s"
  }

  $minutes = [Math]::Floor($value / 60)
  if ($minutes -lt 60) {
    return "${minutes}m"
  }

  $hours = [Math]::Floor($minutes / 60)
  return "${hours}h"
}

function Recent-Fingerprint($signal) {
  if ($signal.id) {
    return "$($signal.id)-$($signal.signalUtc)"
  }

  $parts = @(
    $signal.coin,
    $signal.side,
    $signal.decision,
    $signal.score,
    $signal.signalUtc
  )
  return ($parts -join "|")
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

function Select-HotRecentSignal($menu, $state) {
  $sent = @($state.sent)
  $signals = @($menu.recentSignals | Where-Object {
    $decision = Normalize-Decision $_.decision
    $ageSeconds = Get-SignalAgeSeconds $_
    $decision -eq "early alert" -and
      $null -ne $ageSeconds -and
      $ageSeconds -le $MaxRecentAgeSeconds
  })

  if ($signals.Count -eq 0) {
    return $null
  }

  foreach ($signal in $signals) {
    $fingerprint = Recent-Fingerprint $signal
    if ($sent -notcontains $fingerprint) {
      return [pscustomobject]@{
        signal = $signal
        fingerprint = $fingerprint
        ageSeconds = Get-SignalAgeSeconds $signal
      }
    }
  }

  return $null
}

function Select-HotDish($menu) {
  $dishes = @($menu.dishes | Where-Object { -not $_.recentSignal -and -not (Is-MissedDish $_) })
  if ($dishes.Count -eq 0) {
    return $null
  }

  return @($dishes | Sort-Object `
    @{ Expression = { if ($_.decision -eq "ENTER_NOW") { 0 } elseif ($_.decision -eq "PAPER_ONLY") { 1 } elseif ($_.decision -eq "WATCH_SETUP") { 2 } else { 3 } } }, `
    @{ Expression = { -1 * [double]($_.scores.setup) } }, `
    @{ Expression = { -1 * [double]($_.scores.timing) } } |
    Select-Object -First 1)[0]
}

function Send-RecentNotification($signal, $fingerprint, $menu) {
  $symbol = ("" + $signal.coin).Trim().ToUpperInvariant()
  if (-not $symbol) { $symbol = "COIN" }

  $side = ("" + $signal.side).Trim().ToUpperInvariant()
  if (-not $side) { $side = "SETUP" }

  $decision = (Normalize-Decision $signal.decision).ToUpperInvariant()
  $score = Short-Number $signal.score 0
  $outcome = ("" + $signal.outcome).Trim().ToUpperInvariant()
  if (-not $outcome) { $outcome = "OPEN" }
  $mfe = Format-Percent $signal.mfePct
  $mae = Format-Percent $signal.maePct
  $wait = Format-Wait $signal.waitMinutes
  $age = Format-Age (Get-SignalAgeSeconds $signal)

  $title = Trim-Text "Hot plate: $symbol $side" 32
  $body = Trim-Text "$decision. Score $score, outcome $outcome, MFE $mfe, MAE $mae, wait $wait. Served $age ago." 128
  $notificationId = Trim-Text "rektaurant-recent-$fingerprint" 128
  $targetUrl = "$BaseUrl/?r=auto-recent&mode=$([uri]::EscapeDataString($menu.operationMode))&coin=$([uri]::EscapeDataString($symbol))"

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
      recentSignalCount = @($menu.recentSignals).Count
    }
  }

  $headers = @{
    "Authorization" = "Bearer $Secret"
    "Content-Type" = "application/json"
  }

  $payload = $payloadObject | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/notifications/send" -Headers $headers -Body $payload -TimeoutSec 30
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

Write-Host "Rektaurant recent-signal auto-notification watcher"
Write-Host "Menu:    $MenuUrl"
Write-Host "Push:    $BaseUrl/api/notifications/send"
Write-Host "State:   $StatePath"
Write-Host "Every:   $IntervalSeconds seconds"
Write-Host "Fresh:   recent early alerts <= $MaxRecentAgeSeconds seconds"
if ($DryRun) { Write-Host "Mode:    dry run, no push will be sent" }
if ($RunOnce) { Write-Host "Mode:    single check" }
Write-Host ""

while ($true) {
  $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  try {
    $menu = Invoke-RestMethod -Method Get -Uri $MenuUrl -Headers @{ accept = "application/json" } -TimeoutSec 45
    $state = Get-State
    $recentMatch = Select-HotRecentSignal $menu $state
    $dish = if ($recentMatch) { $null } else { Select-HotDish $menu }

    if ($recentMatch) {
      $signal = $recentMatch.signal
      $fingerprint = $recentMatch.fingerprint
      $age = Format-Age $recentMatch.ageSeconds
      Write-Host "[$now] Fresh recent early alert found: $($signal.coin) $($signal.side) score=$($signal.score) outcome=$($signal.outcome), served $age ago. Sending push..."
      $result = Send-RecentNotification $signal $fingerprint $menu
      $result | ConvertTo-Json -Depth 8

      if ($result.ok -and -not $DryRun) {
        $state.sent = @($fingerprint) + @($state.sent)
        Save-State $state
        Write-Host "[$now] Saved recent notification state."
      } elseif ($result.ok -and $DryRun) {
        Write-Host "[$now] Dry run only, state not saved."
      } else {
        Write-Host "[$now] Push API returned ok=false. Will retry on next loop."
      }
    } elseif (-not $dish) {
      $rawCount = if ($null -ne $menu.rawSignalCount) { $menu.rawSignalCount } else { "n/a" }
      Write-Host "[$now] No new recent early alert. Source=$($menu.source), recent=$(@($menu.recentSignals).Count), raw=$rawCount, served=$(@($menu.dishes).Count)."
    } else {
      $fingerprint = Dish-Fingerprint $dish
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
