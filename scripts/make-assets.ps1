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
