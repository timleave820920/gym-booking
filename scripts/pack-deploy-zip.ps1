# Pack WeChat CloudRun deploy zip (gym-deploy-local.zip)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/pack-deploy-zip.ps1
# Purpose: "Upload code package" deploy bypasses GitHub clone in cloud build
#          (clone slowness/failure is a common cause of build "task failed").
#          Dockerfile must sit at zip root so cloud docker build works directly.
# Notes:
#  - Entry paths MUST use forward slashes (Windows tools write backslash,
#    cloud extractor won't match COPY paths -> build fails)
#  - Exclusions mirror .dockerignore: server/.env (WX_SECRET - never leak),
#    server/data, server/logs, *.md, miniprogram keeps only images/
#    (index.js serves /images/ from miniprogram/images - coach avatars / covers)
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'gym-deploy-local.zip'
if (Test-Path $out) { Remove-Item $out -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)

$excludeDirRe = @(
  '^\.git/', '(^|/)node_modules/', '^server/data/', '^server/logs/',
  '^cloudfunctions/', '^minitest/', '^\.claude/', '^\.workbuddy/', '^\.github/', '^\.githooks/'
)
$excludeFileRe = @('\.env$', '\.md$', '\.zip$', 'preview-qrcode', 'gym-deploy')

$count = 0
Get-ChildItem -Path $root -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
  # miniprogram: only images/ allowed (same rule as .dockerignore)
  if ($rel -like 'miniprogram/*' -and $rel -notlike 'miniprogram/images/*') { return }
  foreach ($re in $excludeDirRe) { if ($rel -match $re) { return } }
  foreach ($re in $excludeFileRe) { if ($rel -match $re) { return } }
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null
  $count++
}
$zip.Dispose()

$size = [math]::Round((Get-Item $out).Length / 1MB, 2)
Write-Host "Packed: gym-deploy-local.zip ($count files, ${size} MB)"
Write-Host "Verify key files:"
$need = @('Dockerfile', 'package.json', 'server/seed.js', 'server/index.js', 'web/courses.html', 'miniprogram/images/2_1468.png')
$z = [System.IO.Compression.ZipFile]::OpenRead($out)
foreach ($n in $need) {
  $hit = $z.Entries | Where-Object { $_.FullName -eq $n }
  Write-Host ("  {0} {1}" -f ($(if ($hit) { 'OK  ' } else { 'MISS' })), $n)
}
$bad = $z.Entries | Where-Object { $_.FullName -match '\.env$|\.git/|node_modules/' }
if ($bad) { Write-Host '  WARN sensitive files in package:'; $bad | ForEach-Object { Write-Host "    $($_.FullName)" } }
else { Write-Host '  No sensitive files (.env/.git/node_modules) - OK' }
$z.Dispose()
