# Post-restart proof that the run host is wired (ASCII only).
param([int]$Port = 3080)
$ErrorActionPreference = 'Continue'
$base = "http://127.0.0.1:$Port"
$ok = 0
$fail = 0
function Probe($name, $path, $method, $expect, $extra) {
  try {
    $r = Invoke-WebRequest ($base + $path) -Method $method -UseBasicParsing -TimeoutSec 8 -Headers @{ 'x-em-token' = 'wrong' }
    $code = [int]$r.StatusCode
    $ct = $r.Headers['content-type']
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $ct = ''
  }
  $pass = $code -eq $expect
  if ($pass) { $script:ok++ } else { $script:fail++ }
  $tag = if ($pass) { 'PASS' } else { 'FAIL' }
  Write-Host ("[{0}] {1,-26} {2,-7} {3} expect {4} got {5} {6}" -f $tag, $name, $method, $path, $expect, $code, $extra)
  return $ct
}
Write-Host "---- verify-runhost ----"
$panel = Probe 'panel' '/em-agent' 'GET' 200
Probe 'bridge script' '/em-agent/run-bridge.js' 'GET' 200
Probe 'runs list (no token)' '/em-agent/runs' 'GET' 403
Probe 'run start (no token)' '/em-agent/run' 'POST' 403
try {
  $b = Invoke-WebRequest ($base + '/em-agent/run-bridge.js') -UseBasicParsing -TimeoutSec 8
  $hasToken = $b.Content -match 'dsh-em-agent-token'
  Write-Host ("[INFO] bridge bytes = {0}, mentions token meta = {1}" -f $b.RawContentLength, $hasToken)
} catch { Write-Host '[INFO] bridge fetch failed' }
Write-Host ("---- result: ok={0} fail={1} ----" -f $ok, $fail)
if ($fail -ne 0) { exit 1 } else { exit 0 }