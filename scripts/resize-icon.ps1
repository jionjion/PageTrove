Add-Type -AssemblyName System.Drawing

$source = 'W:\PageTrove\icon-1254.png'
$outDir = 'W:\PageTrove\public\icon'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$img = New-Object System.Drawing.Bitmap($source)
$w = $img.Width
$h = $img.Height

# 扫描非白色且非透明像素的包围盒（隔行采样加速）
$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$bd = $img.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($bd.Stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $bytes, 0, $bytes.Length)
$img.UnlockBits($bd)

$minX = $w; $minY = $h; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $h; $y += 2) {
    $row = $y * $bd.Stride
    for ($x = 0; $x -lt $w; $x += 2) {
        $i = $row + $x * 4
        $b = $bytes[$i]; $g = $bytes[$i + 1]; $r = $bytes[$i + 2]; $a = $bytes[$i + 3]
        if ($a -gt 16 -and -not ($r -gt 245 -and $g -gt 245 -and $b -gt 245)) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}

if ($maxX -le $minX -or $maxY -le $minY) { throw 'no content pixels found' }
Write-Host "content bbox: ($minX,$minY)-($maxX,$maxY)"

# 以内容为中心裁出正方形，四周留 8% 边距
$bw = $maxX - $minX + 1
$bh = $maxY - $minY + 1
$side = [Math]::Max($bw, $bh)
$side = [int]($side * 1.16)
if ($side -gt $w) { $side = $w }
if ($side -gt $h) { $side = $h }
$cx = [int](($minX + $maxX) / 2)
$cy = [int](($minY + $maxY) / 2)
$x0 = [Math]::Min([Math]::Max($cx - [int]($side / 2), 0), $w - $side)
$y0 = [Math]::Min([Math]::Max($cy - [int]($side / 2), 0), $h - $side)
Write-Host "crop: ($x0,$y0) side=$side"

$srcRect = New-Object System.Drawing.Rectangle($x0, $y0, $side, $side)

foreach ($size in 16, 32, 48, 96, 128) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $g.DrawImage($img, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $path = Join-Path $outDir "$size.png"
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "saved $path"
}

$img.Dispose()
