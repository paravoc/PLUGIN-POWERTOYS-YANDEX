Add-Type -AssemblyName System.Drawing

$assetsDirectory = Join-Path $PSScriptRoot "..\\assets"
New-Item -ItemType Directory -Force -Path $assetsDirectory | Out-Null

$sizes = @(16, 32, 48, 128)
$startColor = [System.Drawing.ColorTranslator]::FromHtml("#0f766e")
$endColor = [System.Drawing.ColorTranslator]::FromHtml("#38bdf8")
$textColor = [System.Drawing.ColorTranslator]::FromHtml("#f8fafc")
$shadowColor = [System.Drawing.Color]::FromArgb(55, 15, 23, 42)

foreach ($size in $sizes) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $rect = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $radius = [Math]::Max([Math]::Floor($size * 0.22), 3)
  $diameter = $radius * 2

  $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $path.AddArc($size - $diameter - 1, 0, $diameter, $diameter, 270, 90)
  $path.AddArc($size - $diameter - 1, $size - $diameter - 1, $diameter, $diameter, 0, 90)
  $path.AddArc(0, $size - $diameter - 1, $diameter, $diameter, 90, 90)
  $path.CloseFigure()

  $shadowRect = [System.Drawing.Rectangle]::new(0, [Math]::Max([Math]::Floor($size * 0.06), 1), $size - 1, $size - 1)
  $shadowPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $shadowPath.AddArc($shadowRect.Left, $shadowRect.Top, $diameter, $diameter, 180, 90)
  $shadowPath.AddArc($shadowRect.Right - $diameter, $shadowRect.Top, $diameter, $diameter, 270, 90)
  $shadowPath.AddArc($shadowRect.Right - $diameter, $shadowRect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $shadowPath.AddArc($shadowRect.Left, $shadowRect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $shadowPath.CloseFigure()

  $shadowBrush = [System.Drawing.SolidBrush]::new($shadowColor)
  $graphics.FillPath($shadowBrush, $shadowPath)

  $gradientBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $startColor, $endColor, 45)
  $graphics.FillPath($gradientBrush, $path)

  $fontSize = [Math]::Max([Math]::Floor($size * 0.33), 6)
  $font = [System.Drawing.Font]::new("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $textBrush = [System.Drawing.SolidBrush]::new($textColor)
  $stringSize = $graphics.MeasureString("BR", $font)
  $textPoint = [System.Drawing.PointF]::new(
    [Math]::Round(($size - $stringSize.Width) / 2, 2),
    [Math]::Round(($size - $stringSize.Height) / 2 - ($size * 0.02), 2)
  )

  $graphics.DrawString("BR", $font, $textBrush, $textPoint)

  $iconPath = Join-Path $assetsDirectory ("icon{0}.png" -f $size)
  $bitmap.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)

  $textBrush.Dispose()
  $font.Dispose()
  $gradientBrush.Dispose()
  $shadowBrush.Dispose()
  $shadowPath.Dispose()
  $path.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}
