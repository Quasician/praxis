# Checks the wallpaper helper on Windows (run by CI after `npm run build:node`):
#   1. the build made the helper program;
#   2. it is a windowed program, not a console one, so starting it can't open a terminal window;
#   3. it answers when started the way Praxis starts it (output read through a pipe).
$ErrorActionPreference = "Stop"
$built = @(Get-ChildItem (Join-Path $PSScriptRoot "..\native-build") -Filter "praxis-wall-*.exe")
if ($built.Count -ne 1) { throw "expected one prebuilt helper in native-build, found $($built.Count)" }
$exe = $built[0].FullName
Write-Host "1. build made $($built[0].Name)"

# The PE header says which kind of program it is: 2 = windowed (no console), 3 = console.
$bytes = [IO.File]::ReadAllBytes($exe)
$pe = [BitConverter]::ToInt32($bytes, 0x3C)
$subsystem = [BitConverter]::ToUInt16($bytes, $pe + 4 + 20 + 68)
if ($subsystem -ne 2) { throw "the helper's subsystem is $subsystem; it must be 2 (windowed), or it can open a terminal window" }
Write-Host "2. the helper is a windowed program (no console)"

function Run([string[]]$a) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.Arguments = ($a -join " "); $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd()
  if (-not $p.WaitForExit(30000)) { $p.Kill(); throw "helper '$a' didn't finish" }
  return @{ code = $p.ExitCode; out = $out.Trim(); err = $err.Trim() }
}
$r = Run @("ping")
if ($r.code -ne 0 -or $r.out -ne "PraxisWall.W") { throw "ping: exit $($r.code), said '$($r.out)' '$($r.err)'" }
$r = Run @("nonsense")
if ($r.code -ne 2) { throw "an unknown action should exit with 2, got $($r.code)" }
$r = Run @("status")
if ($r.code -ne 0) { throw "status: exit $($r.code) '$($r.err)'" }
$null = $r.out | ConvertFrom-Json
Write-Host "3. ping and status answered through a pipe: $($r.out)"

# watch stops by itself once the program that started it is gone (here: a process id that doesn't exist).
$r = Run @("watch", "999999")
if ($r.code -ne 0) { throw "watch with a dead parent: exit $($r.code) '$($r.err)'" }
Write-Host "4. watch stops when its parent is gone"

# 4.7 the focus lock: "front" names the window in front (four tab-separated fields), "minimize" refuses a window that
# doesn't exist, and "frontwatch" stops by itself when its parent is gone.
$r = Run @("front")
if ($r.code -ne 0) { throw "front: exit $($r.code) '$($r.err)'" }
$parts = $r.out -split "`t"
if ($parts.Count -lt 3) { throw "front should give hwnd, pid, program and title separated by tabs, got '$($r.out)'" }
$r = Run @("minimize", "0")
if ($r.code -ne 0 -or $r.out -ne "no-window") { throw "minimize 0: exit $($r.code), said '$($r.out)' '$($r.err)'" }
$r = Run @("frontwatch", "999999")
if ($r.code -ne 0) { throw "frontwatch with a dead parent: exit $($r.code) '$($r.err)'" }
Write-Host "5. front, minimize and frontwatch answer"
Write-Host "All wallpaper helper checks passed."
