param([string]$Action, [string]$Path = "", [string]$Folder = "", [int]$Tick = 3600000, [int]$Options = 1, [int]$Position = 4, [string]$Dll = "", [string]$Src = "")
$ErrorActionPreference = "Stop"
# The helper types live in a small DLL. When it's there, nothing is compiled: compiling starts the C# compiler,
# a console program, and from a windowless PowerShell that opens a terminal window on screen for a moment.
$loaded = $false
if ($Dll -and (Test-Path -LiteralPath $Dll)) { try { Add-Type -LiteralPath $Dll; $loaded = $true } catch {} }
if (-not $loaded) {
  $code = Get-Content -LiteralPath $Src -Raw -Encoding UTF8
  if ($Dll) {
    try {
      $tmp = [IO.Path]::ChangeExtension($Dll, "$PID.dll")
      Add-Type -TypeDefinition $code -OutputAssembly $tmp -OutputType Library
      Move-Item -LiteralPath $tmp -Destination $Dll -Force
      Add-Type -LiteralPath $Dll
      $loaded = $true
    } catch {}
  }
  if (-not $loaded) { Add-Type -TypeDefinition $code }
}
switch ($Action) {
  "ping" { [PraxisWall.W].FullName }
  "status" { $s = [PraxisWall.W]::Status(); [ordered]@{ status = [int]$s[0]; wallpaper = $s[1]; folder = $s[2]; options = [int]$s[3]; tick = [int64]$s[4]; position = [int]$s[5] } | ConvertTo-Json -Compress }
  "set" { [PraxisWall.W]::Set($Path, $Position); "ok" }
  "slideshow" { [PraxisWall.W]::Slideshow($Folder, $Options, [uint32]$Tick, $Position); "ok" }
  "attach" { [PraxisWall.W]::Attach([int64]$Path, $Tick, $Options) }
  "watch" { while ($true) { [Console]::Out.WriteLine([PraxisWall.W]::Foreground()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 2000 } }
}
