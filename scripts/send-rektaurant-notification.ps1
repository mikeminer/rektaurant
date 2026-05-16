param(
  [Parameter(Position = 0)]
  [ValidateSet("open", "closed", "closing", "happy-hour", "preview")]
  [string]$Type,

  [string]$Secret,
  [string]$BaseUrl = "https://rektaurant.vercel.app"
)

$ErrorActionPreference = "Stop"

if (-not $Type) {
  Write-Host ""
  Write-Host "Rektaurant notification menu"
  Write-Host "1) New menu live"
  Write-Host "   Hot perp specials are on the pass. Longs, shorts, and risk notes served fresh."
  Write-Host ""
  Write-Host "2) Service paused"
  Write-Host "   The pass is cooling down. Fresh long and short dishes return when the kitchen reopens."
  Write-Host ""
  Write-Host "3) Final plates"
  Write-Host "   Last signals are leaving the kitchen. Check the menu before the lights go off."
  Write-Host ""
  Write-Host "4) Chef's happy hour"
  Write-Host "   Fresh Hyperliquid setups on the counter. Come pick a hot plate."
  Write-Host ""
  Write-Host "5) Preview random variants"
  Write-Host ""
  $choice = Read-Host "Select option"
  switch ($choice.Trim()) {
    "1" { $Type = "open" }
    "2" { $Type = "closed" }
    "3" { $Type = "closing" }
    "4" { $Type = "happy-hour" }
    "5" { $Type = "preview" }
    default { throw "Invalid option: $choice" }
  }
}

if ($Type -eq "preview") {
  Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/notifications/preview" | ConvertTo-Json -Depth 8
  exit 0
}

if (-not $Secret) {
  $localSecretPath = Join-Path (Split-Path $PSScriptRoot -Parent) ".rektaurant-notify-secret"
  if (Test-Path $localSecretPath) {
    $Secret = (Get-Content -Raw $localSecretPath).Trim()
  }
}

if (-not $Secret) {
  $Secret = Read-Host "REKTAURANT_NOTIFY_SECRET"
}

$payload = @{ type = $Type } | ConvertTo-Json -Compress
$headers = @{
  "Authorization" = "Bearer $Secret"
  "Content-Type" = "application/json"
}

Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/notifications/send" -Headers $headers -Body $payload | ConvertTo-Json -Depth 8
