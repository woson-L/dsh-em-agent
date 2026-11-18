param([int]$Port = 3080, [string]$Log = "E:\DeepSeek\DATA\AGENT\dsh-web-restart.log")
$ErrorActionPreference = "Continue"
function W($m) { $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Write-Host $line; Add-Content -Path $Log -Value $line -Encoding UTF8 }
W "---- restart-web start ----"
$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($conn) { W "stopping PID $($conn.OwningProcess)"; Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3 }
$dsh = Join-Path $env:APPDATA "npm\dsh.cmd"
$boot = "E:\DeepSeek\DATA\AGENT\dsh-web-boot.log"
$inner = '"{0}" web --no-open > "{1}" 2>&1' -f $dsh, $boot
$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ('cmd.exe /c "' + $inner + '"') }
W "launched via WMI rc=$($res.ReturnValue) pid=$($res.ProcessId)"
$up = $false
for ($i = 1; $i -le 30; $i++) {
  Start-Sleep -Seconds 2
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($c) { W "listening after $($i*2)s pid=$($c.OwningProcess)"; $up = $true; break }
}
if (-not $up) { W "FAILED to listen"; if (Test-Path $boot) { Get-Content $boot | Select-Object -Last 20 | ForEach-Object { W $_ } }; exit 1 }
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-runhost.ps1") -Port $Port 2>&1 | ForEach-Object { $line = "$_"; Write-Host $line; Add-Content -Path $Log -Value $line -Encoding UTF8 }
W "---- restart-web done ----"