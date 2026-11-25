# Checks the wallpaper helper on Windows (run by CI after `npm run build:node`):
#   1. the build made the helper DLL;
#   2. with that DLL the script loads its types without compiling anything (the C# source isn't even there);
#   3. without a DLL the script builds one from the source, once, and then loads it the same way.
$ErrorActionPreference = "Stop"
$helper = Join-Path $PSScriptRoot "..\electron\wallpaper-helper.ps1"
$source = Join-Path $PSScriptRoot "..\electron\wallpaper-native.cs"
$missing = Join-Path $env:TEMP "praxis-no-such-source.cs"
function Ping([string]$dll, [string]$src) {
  $out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Action ping -Dll $dll -Src $src
  if ($LASTEXITCODE -ne 0) { throw "helper exited with $LASTEXITCODE" }
  if (("$out").Trim() -ne "PraxisWall.W") { throw "unexpected answer: $out" }
}

$built = @(Get-ChildItem (Join-Path $PSScriptRoot "..\native-build") -Filter "praxis-wall-*.dll")
if ($built.Count -ne 1) { throw "expected one prebuilt DLL in native-build, found $($built.Count)" }
Write-Host "1. build made $($built[0].Name)"

Ping $built[0].FullName $missing
Write-Host "2. prebuilt DLL loads with no source present, so nothing was compiled"

$fresh = Join-Path $env:TEMP ("praxis-wall-test-" + [guid]::NewGuid().ToString("N") + ".dll")
Ping $fresh $source
if (-not (Test-Path -LiteralPath $fresh)) { throw "the fallback didn't write its DLL" }
Ping $fresh $missing
Write-Host "3. fallback built its DLL once and reloads it with no source present"

$status = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Action status -Dll $built[0].FullName -Src $missing
Write-Host "status action answered: $status"
Write-Host "All wallpaper helper checks passed."
