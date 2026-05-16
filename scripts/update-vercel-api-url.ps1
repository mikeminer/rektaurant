param(
  [Parameter(Position = 0)]
  [string]$ApiUrl
)

$ErrorActionPreference = "Stop"

if ($null -eq $ApiUrl) {
  $ApiUrl = ""
} else {
  $ApiUrl = $ApiUrl.Trim()
}
if (-not $ApiUrl) {
  $ApiUrl = (Read-Host "Inserisci la nuova API URL MCC").Trim()
}

try {
  $parsed = [Uri]$ApiUrl
} catch {
  throw "Invalid API URL: $ApiUrl"
}

if ($parsed.Scheme -notin @("http", "https")) {
  throw "API URL must start with http:// or https://"
}

$cleanUrl = $ApiUrl.TrimEnd("/")
$env:npm_config_strict_ssl = "false"
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"

Write-Host "Updating Vercel MCC_API_BASE..."
npx vercel env update MCC_API_BASE production --yes --value $cleanUrl

Write-Host "Redeploying Rektaurant production..."
npx vercel deploy --prod --yes

Write-Host "Done. Backend API URL is now: $cleanUrl"
Write-Host "Live app: https://rektaurant.vercel.app"
