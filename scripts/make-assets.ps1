Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$assetDir = Join-Path $root "public\assets"
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null

function New-Canvas {
  param([int]$Width, [int]$Height)
  $bmp = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  return @($bmp, $g)
}

function Brush($hex) {
  return New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.ColorTranslator]::FromHtml($hex))
}

function Pen($hex, [float]$width = 2) {
  return New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.ColorTranslator]::FromHtml($hex)), $width
}

function Font($name, [float]$size, [System.Drawing.FontStyle]$style = [System.Drawing.FontStyle]::Regular) {
  return New-Object System.Drawing.Font -ArgumentList $name, $size, $style, ([System.Drawing.GraphicsUnit]::Pixel)
}

function Draw-Background($g, $w, $h) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect,
    ([System.Drawing.ColorTranslator]::FromHtml("#171214")),
    ([System.Drawing.ColorTranslator]::FromHtml("#2b171a")),
    35
  $g.FillRectangle($brush, $rect)
  $brush.Dispose()
  $g.FillEllipse((Brush "#3a1a1d"), -120, -90, [int]($w * 0.72), [int]($h * 0.74))
  $g.FillEllipse((Brush "#123225"), [int]($w * 0.62), [int]($h * 0.48), [int]($w * 0.62), [int]($h * 0.62))
}

function Draw-Plate($g, $cx, $cy, $r) {
  $g.FillEllipse((Brush "#f6ead8"), $cx - $r, $cy - $r, $r * 2, $r * 2)
  $g.FillEllipse((Brush "#22181b"), $cx - $r + 22, $cy - $r + 22, ($r - 22) * 2, ($r - 22) * 2)
  $g.DrawEllipse((Pen "#d79a5b" 6), $cx - $r + 36, $cy - $r + 36, ($r - 36) * 2, ($r - 36) * 2)
  $candlePen = Pen "#66c59b" 7
  $wickPen = Pen "#f6ead8" 3
  for ($i = 0; $i -lt 5; $i++) {
    $x = $cx - 92 + ($i * 46)
    $top = $cy - 35 - ($i % 2) * 18
    $bottom = $cy + 50 - ($i % 3) * 13
    $g.DrawLine($wickPen, $x, $top - 22, $x, $bottom + 22)
    $g.DrawLine($candlePen, $x, $top, $x, $bottom)
  }
  $candlePen.Dispose()
  $wickPen.Dispose()
}

function Draw-LogoText($g, $w, $h, $large) {
  $serif = Font "Georgia" $large ([System.Drawing.FontStyle]::Bold)
  $sans = Font "Arial" ([Math]::Max(24, [int]($large * 0.28))) ([System.Drawing.FontStyle]::Bold)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString("Rektaurant", $serif, (Brush "#f6ead8"), (New-Object System.Drawing.RectangleF 0, ($h * 0.58), $w, ($large * 1.1)), $format)
  $g.DrawString("HYPERLIQUID SIGNAL MENU", $sans, (Brush "#d79a5b"), (New-Object System.Drawing.RectangleF 0, ($h * 0.72), $w, 50), $format)
}

function Fill-RoundedRect($g, $brush, [float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($brush, $path)
  $path.Dispose()
}

function Draw-ScreenshotText($g, $text, [float]$x, [float]$y, [float]$w, [float]$h, $font, $brush, [string]$align = "Near") {
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::$align
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $format.Trimming = [System.Drawing.StringTrimming]::Word
  $g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF $x, $y, $w, $h), $format)
  $format.Dispose()
}

function Draw-ScreenshotCard($g, [float]$x, [float]$y, [float]$w, [float]$h, [string]$accent, [string]$title, [string]$body, [string]$badge) {
  Fill-RoundedRect $g (Brush "#24191b") $x $y $w $h 24
  $g.DrawRectangle((Pen $accent 5), $x, $y, $w, $h)
  Draw-ScreenshotText $g $badge ($x + 36) ($y + 34) ($w - 72) 34 (Font "Arial" 28 ([System.Drawing.FontStyle]::Bold)) (Brush $accent)
  Draw-ScreenshotText $g $title ($x + 36) ($y + 86) ($w - 72) 72 (Font "Georgia" 54 ([System.Drawing.FontStyle]::Bold)) (Brush "#f6ead8")
  Draw-ScreenshotText $g $body ($x + 36) ($y + 176) ($w - 72) ($h - 214) (Font "Arial" 30) (Brush "#d8c7ad")
}

function Draw-ManifestScreenshot($path, [string]$variant) {
  $w = 1284
  $h = 2778
  $canvas = New-Canvas $w $h
  $bmp = $canvas[0]
  $g = $canvas[1]
  Draw-Background $g $w $h

  $margin = 88
  Draw-Plate $g ([int]($w / 2)) 410 230
  Draw-ScreenshotText $g "Rektaurant" $margin 675 ($w - ($margin * 2)) 150 (Font "Georgia" 118 ([System.Drawing.FontStyle]::Bold)) (Brush "#f6ead8") "Center"
  Draw-ScreenshotText $g "Base signal menu" $margin 830 ($w - ($margin * 2)) 56 (Font "Arial" 38 ([System.Drawing.FontStyle]::Bold)) (Brush "#d79a5b") "Center"

  if ($variant -eq "gate") {
    Draw-ScreenshotCard $g $margin 980 ($w - ($margin * 2)) 330 "#d79a5b" "Choose your plate" "Pay with Base ETH, MiniPay USDm, pappardelle token, or STX to unlock hot long and short signals." "RESERVATION"
    Draw-ScreenshotCard $g $margin 1380 ($w - ($margin * 2)) 290 "#66c59b" "Stacks vault" "Connect a Stacks wallet and deposit 0.1 STX into the Rektaurant vault for a 10 minute table." "STX"
    Draw-ScreenshotCard $g $margin 1738 ($w - ($margin * 2)) 290 "#8ea45d" "MiniPay table" "Pay 1 USDm on Celo from MiniPay for fast mobile access to the menu." "CELO"
    Draw-ScreenshotCard $g $margin 2096 ($w - ($margin * 2)) 290 "#d84f3f" "Pappardelle pass" "Buy the monthly pass for 10000000 pappardelle token on Base." "MONTHLY"
  }
  else {
    Draw-ScreenshotCard $g $margin 980 ($w - ($margin * 2)) 300 "#66c59b" "BTC Long plate" "Entry, target, invalidation, confidence and chef notes served as read only market research." "LONG"
    Draw-ScreenshotCard $g $margin 1348 ($w - ($margin * 2)) 300 "#d84f3f" "ETH Short plate" "Risk notes and setup scores help crypto hunters scan hot Hyperliquid opportunities." "SHORT"
    Draw-ScreenshotCard $g $margin 1716 ($w - ($margin * 2)) 300 "#d79a5b" "Chef ticket" "Inspect every dish before taking your own execution decision outside Rektaurant." "DETAILS"
    Draw-ScreenshotCard $g $margin 2084 ($w - ($margin * 2)) 300 "#8ea45d" "Share the dish" "Farcaster and Twitter sharing bring friends back when fresh plates arrive." "SOCIAL"
  }

  Draw-ScreenshotText $g "Read only research. No orders. No custody." $margin 2520 ($w - ($margin * 2)) 70 (Font "Arial" 34 ([System.Drawing.FontStyle]::Bold)) (Brush "#f6ead8") "Center"
  Save-Png $bmp $path
  $g.Dispose()
  $bmp.Dispose()
}

function Save-Png($bitmap, $path) {
  $tempPath = Join-Path (Split-Path -Parent $path) ("." + [System.Guid]::NewGuid().ToString("N") + ".png")
  $bitmap.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
  try {
    Move-Item -LiteralPath $tempPath -Destination $path -Force
  }
  catch {
    if (Test-Path -LiteralPath $path) {
      Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
      Write-Warning "Skipped locked asset $path"
      return
    }
    throw
  }
}

$items = @(
  @{ Name = "icon-1024.png"; W = 1024; H = 1024; Logo = 92; Plate = 220 },
  @{ Name = "splash-200.png"; W = 200; H = 200; Logo = 0; Plate = 66 },
  @{ Name = "og-image.png"; W = 1200; H = 800; Logo = 78; Plate = 210 },
  @{ Name = "hero-1200x630.png"; W = 1200; H = 630; Logo = 74; Plate = 175 },
  @{ Name = "plate-signal-v2.png"; W = 900; H = 650; Logo = 0; Plate = 210; NoText = $true }
)

foreach ($item in $items) {
  $canvas = New-Canvas $item.W $item.H
  $bmp = $canvas[0]
  $g = $canvas[1]
  Draw-Background $g $item.W $item.H
  Draw-Plate $g ([int]($item.W / 2)) ([int]($item.H * 0.38)) $item.Plate
  if ($item.Logo -gt 0) {
    Draw-LogoText $g $item.W $item.H $item.Logo
  }
  elseif (-not $item.NoText) {
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString("R", (Font "Georgia" 70 ([System.Drawing.FontStyle]::Bold)), (Brush "#f6ead8"), (New-Object System.Drawing.RectangleF 0, 116, 200, 70), $format)
  }
  Save-Png $bmp (Join-Path $assetDir $item.Name)
  $g.Dispose()
  $bmp.Dispose()
}

Write-Host "Rektaurant assets written to $assetDir"

Draw-ManifestScreenshot (Join-Path $assetDir "screenshot-gate-1284x2778.png") "gate"
Draw-ManifestScreenshot (Join-Path $assetDir "screenshot-menu-1284x2778.png") "menu"
Write-Host "Rektaurant manifest screenshots written to $assetDir"
